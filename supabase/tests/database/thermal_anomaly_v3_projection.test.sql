begin;

create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public, pg_catalog;

select no_plan();

select ok(
  to_regprocedure(
    'api.thermal_anomalies_v3(integer,integer,integer,timestamptz,timestamptz,integer)'
  ) is not null,
  'bounded v3 thermal anomaly RPC exists'
);

select ok(
  (
    select procedure.prosecdef and procedure.provolatile = 's'
    from pg_proc as procedure
    where procedure.oid =
      'api.thermal_anomalies_v3(integer,integer,integer,timestamptz,timestamptz,integer)'::regprocedure
  ),
  'thermal anomaly projection is a stable SECURITY DEFINER boundary'
);

select ok(
  (
    select procedure.proconfig @> array[
      'search_path=""',
      'statement_timeout=5s'
    ]::text[]
    from pg_proc as procedure
    where procedure.oid =
      'api.thermal_anomalies_v3(integer,integer,integer,timestamptz,timestamptz,integer)'::regprocedure
  ),
  'thermal anomaly projection fixes an empty search path and five-second timeout'
);

select ok(
  has_function_privilege(
    'firewatch_discovery_reader',
    'api.thermal_anomalies_v3(integer,integer,integer,timestamptz,timestamptz,integer)',
    'EXECUTE'
  )
  and not has_function_privilege(
    'anon',
    'api.thermal_anomalies_v3(integer,integer,integer,timestamptz,timestamptz,integer)',
    'EXECUTE'
  )
  and not has_function_privilege(
    'authenticated',
    'api.thermal_anomalies_v3(integer,integer,integer,timestamptz,timestamptz,integer)',
    'EXECUTE'
  )
  and not has_function_privilege(
    'service_role',
    'api.thermal_anomalies_v3(integer,integer,integer,timestamptz,timestamptz,integer)',
    'EXECUTE'
  )
  and not has_function_privilege(
    'firewatch_collector',
    'api.thermal_anomalies_v3(integer,integer,integer,timestamptz,timestamptz,integer)',
    'EXECUTE'
  ),
  'only the scoped server discovery role can execute the RPC'
);

select ok(
  not has_table_privilege(
    'firewatch_discovery_reader',
    'ingest.firms_detection_details',
    'SELECT'
  )
  and not has_table_privilege(
    'firewatch_discovery_reader',
    'truth.thermal_anomaly_assessments',
    'SELECT'
  ),
  'the scoped reader cannot bypass the curated function to read private evidence'
);

select has_index(
  'truth',
  'thermal_anomaly_assessments',
  'thermal_anomaly_assessments_projection_cutoff_idx',
  'assessment cutoff lookup has a dedicated covered index'
);

-- The production reader deliberately has no access to pgTAP helpers. Grant
-- transaction-local test access so bounds execute under the exact caller role.
grant usage on schema extensions to firewatch_discovery_reader;
grant execute on all functions in schema extensions to firewatch_discovery_reader;

set local role firewatch_discovery_reader;

select throws_ok(
  $$select * from api.thermal_anomalies_v3(
      6, 36, 24, now(), now(), 10
    )$$,
  '22023',
  'Web Mercator cell zoom must be between 7 and 11',
  'direct callers cannot bypass the canonical cell zoom boundary'
);

select throws_ok(
  $$select * from api.thermal_anomalies_v3(
      10, 587, 391, now() - interval '32 days', now(), 10
    )$$,
  '22023',
  'Thermal anomaly cutoffs must be ordered and current within 31 days',
  'direct callers cannot request unbounded historical replay'
);

select throws_ok(
  $$select * from api.thermal_anomalies_v3(
      10, 587, 391, now(), now(), 102
    )$$,
  '22023',
  'Thermal anomaly result limit must be between 1 and 101',
  'direct callers cannot amplify the result page'
);

reset role;

-- Create one transaction-local reviewed projection fixture. No collector or
-- provider is called, and all catalog state rolls back after the test.
update core.sources
set license_status = 'approved',
    commercial_use_allowed = true,
    redistribution_allowed = true,
    sensitivity = 'public',
    enabled = true,
    is_public = true
where slug = 'nasa-firms';

update core.firms_products
set license_status = 'approved',
    enabled = true,
    assessment_enabled = true
where product_key = 'VIIRS_NOAA20_NRT';

-- Backdate mutable publication gates to prove independent historical cutoffs.
-- These trigger changes and fixture rows are transaction-local.
alter table core.providers disable trigger user;
alter table core.sources disable trigger user;
alter table core.firms_products disable trigger user;
update core.providers
set updated_at = now() - interval '2 hours'
where slug = 'nasa';
update core.sources
set updated_at = now() - interval '2 hours'
where slug = 'nasa-firms';
update core.firms_products
set updated_at = now() - interval '2 hours'
where product_key = 'VIIRS_NOAA20_NRT';

-- Typed detector validation normally binds the full immutable HTTP ledger. The
-- projection test isolates read semantics by inserting a check-valid fixture
-- with FK/validation triggers disabled inside this rolled-back transaction.
alter table ingest.firms_detection_details disable trigger all;
alter table truth.thermal_anomaly_assessments disable trigger all;

insert into ingest.firms_detection_details (
  id, public_id, contract_version, identity_version,
  normalized_content_sha256, observation_cursor, source_revision_id,
  source_id, product_id, product_key, satellite, source_satellite_raw,
  instrument, acquired_at, acquired_date, acquired_time_utc,
  source_time_precision, latitude, longitude, scan_km, track_km,
  spatial_support_method, footprint_orientation_deg, confidence_class,
  confidence_percent, brightness_primary_k, brightness_secondary_k,
  brightness_contract, frp_mw, day_night, source_dataset_version,
  source_row_contract, published_at, retrieved_at, version_no,
  previous_detail_id, original_detail_id, limitations, recorded_at
)
overriding system value
select
  900001,
  '019a0000-0000-7000-8000-000000000301',
  '1.1.0',
  'firms-detection-v1',
  repeat('a', 64),
  900001,
  900001,
  source.id,
  product.id,
  product.product_key,
  'NOAA-20',
  'N20',
  'VIIRS',
  date_trunc('minute', now() - interval '1 hour'),
  (date_trunc('minute', now() - interval '1 hour') at time zone 'UTC')::date,
  (date_trunc('minute', now() - interval '1 hour') at time zone 'UTC')::time(0),
  'minute',
  39.001000,
  26.402000,
  0.375,
  0.375,
  'centroid_with_circumscribed_radius_v1',
  null,
  'high',
  null,
  370.25,
  302.50,
  'viirs_bright_ti4_ti5',
  12.25,
  'day',
  '2.0NRT',
  'firms-area-csv-viirs-v1',
  now() - interval '55 minutes',
  now() - interval '50 minutes',
  1,
  null,
  900001,
  array[
    'thermal_pixel_not_flame_location',
    'not_incident_confirmation',
    'pixel_orientation_not_source_supplied',
    'modeled_support_is_not_pixel_footprint',
    'source_time_precision_minute',
    'not_official_status',
    'not_protective_guidance',
    'not_all_clear'
  ]::text[],
  now() - interval '49 minutes'
from core.sources as source
join core.firms_products as product on product.source_id = source.id
where source.slug = 'nasa-firms'
  and product.product_key = 'VIIRS_NOAA20_NRT';

insert into truth.thermal_anomaly_assessments (
  cursor, public_id, contract_version, original_detection_id,
  basis_detection_id, version_no, previous_assessment_cursor,
  assessment_state, reason_code, firms_completion_health_cursor,
  cmr_observation_cursor, failed_product_result_id, rule_id, rule_version,
  as_of, known_at, claim_kind, operational_effect, limitations, recorded_at
)
overriding system value
values
  (
    910001, '019a0000-0000-7000-8000-000000000401', '1.1.0',
    900001, 900001, 1, null, 'detected', 'firms_detection_observed',
    null, null, null, 'firms.initial-detection', '1.0.0',
    date_trunc('minute', now() - interval '1 hour'),
    now() - interval '45 minutes',
    'thermal_anomaly_observation_only', 'none',
    array[
      'thermal_detection_not_incident_confirmation',
      'cmr_catalog_metadata_does_not_assess_anomalies',
      'sensor_assessability_unknown',
      'not_official_status',
      'not_protective_guidance',
      'not_containment_statement',
      'not_incident_resolution',
      'not_all_clear'
    ]::text[],
    now() - interval '44 minutes'
  ),
  (
    910002, '019a0000-0000-7000-8000-000000000402', '1.1.0',
    900001, 900001, 2, 910001, 'unknown', 'operator_withheld',
    null, null, null, 'firms.assessment-review', '1.0.0',
    now() - interval '30 minutes',
    now() - interval '25 minutes',
    'thermal_anomaly_observation_only', 'none',
    array[
      'thermal_detection_not_incident_confirmation',
      'cmr_catalog_metadata_does_not_assess_anomalies',
      'sensor_assessability_unknown',
      'not_official_status',
      'not_protective_guidance',
      'not_containment_statement',
      'not_incident_resolution',
      'not_all_clear'
    ]::text[],
    now() - interval '24 minutes'
  );

set local role firewatch_discovery_reader;

select is(
  (
    select assessment_state
    from api.thermal_anomalies_v3(
      10, 587, 391,
      now() - interval '40 minutes',
      now() - interval '35 minutes',
      10
    )
  ),
  'detected',
  'rewinding before a later assessment selects the first visible state'
);

select is(
  (
    select assessment_state
    from api.thermal_anomalies_v3(10, 587, 391, now(), now(), 10)
  ),
  'unknown',
  'the latest assessment visible at both current cutoffs is selected'
);

select ok(
  (
    select
      source_key = 'nasa-firms'
      and product_key = 'VIIRS_NOAA20_NRT'
      and platform = 'NOAA-20'
      and instrument = 'VIIRS'
      and source_time_precision = 'minute'
      and scan_km = 0.375
      and track_km = 0.375
      and assessment_reason = 'operator_withheld'
      and assessment_rule_id = 'firms.assessment-review'
      and claim_kind = 'thermal_anomaly_observation_only'
      and operational_effect = 'none'
      and not notification_eligible
      and not official_status_eligible
      and not protective_action_eligible
      and not incident_resolution_eligible
      and assessment_limitations @> array[
        'not_incident_resolution', 'not_all_clear'
      ]::text[]
    from api.thermal_anomalies_v3(10, 587, 391, now(), now(), 10)
  ),
  'projection preserves evidence detail and exposes only non-authoritative semantics'
);

select is(
  (
    select count(*)
    from api.thermal_anomalies_v3(
      10, 587, 391,
      now() - interval '50 minutes',
      now() - interval '46 minutes',
      10
    )
  ),
  0::bigint,
  'an assessment unknown at the knowledge cutoff remains absent'
);

reset role;

update core.firms_products
set enabled = false
where product_key = 'VIIRS_NOAA20_NRT';

set local role firewatch_discovery_reader;

select is(
  (
    select count(*)
    from api.thermal_anomalies_v3(10, 587, 391, now(), now(), 10)
  ),
  0::bigint,
  'disabled FIRMS catalog state cannot surface a valid row or empty-coverage claim'
);

reset role;

select * from finish();
rollback;
