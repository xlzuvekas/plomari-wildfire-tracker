begin;

create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public, pg_catalog;

select no_plan();

select ok(
  to_regprocedure(
    'api.thermal_anomalies_v3(integer,integer,integer,timestamptz,timestamptz,integer,timestamptz,uuid,text)'
  ) is not null,
  'bounded v3 thermal anomaly RPC exists'
);

select ok(
  (
    select procedure.prosecdef and procedure.provolatile = 's'
    from pg_proc as procedure
    where procedure.oid =
      'api.thermal_anomalies_v3(integer,integer,integer,timestamptz,timestamptz,integer,timestamptz,uuid,text)'::regprocedure
  ),
  'thermal anomaly projection is a stable SECURITY DEFINER boundary'
);

select ok(
  (
    select procedure.proconfig @> array['search_path=""']::text[]
      and not (
        procedure.proconfig && array[
          'statement_timeout=5s',
          'statement_timeout=5000'
        ]::text[]
      )
    from pg_proc as procedure
    where procedure.oid =
      'api.thermal_anomalies_v3(integer,integer,integer,timestamptz,timestamptz,integer,timestamptz,uuid,text)'::regprocedure
  ),
  'thermal anomaly projection fixes an empty search path without claiming an ineffective in-function statement timeout'
);

select ok(
  (
    select pg_get_functiondef(procedure.oid) like
      '%limit candidate_scan_limit + 1%'
      and pg_get_functiondef(procedure.oid) like
        '%Thermal anomaly candidate scan bound exceeded%'
      and pg_get_functiondef(procedure.oid) like
        '%pg_catalog.unnest(selected_assessment_cursors)%'
    from pg_proc as procedure
    where procedure.oid =
      'api.thermal_anomalies_v3(integer,integer,integer,timestamptz,timestamptz,integer,timestamptz,uuid,text)'::regprocedure
  ),
  'candidate materialization is capped before the bounded page reaches wide projection'
);

select ok(
  has_function_privilege(
    'firewatch_discovery_reader',
    'api.thermal_anomalies_v3(integer,integer,integer,timestamptz,timestamptz,integer,timestamptz,uuid,text)',
    'EXECUTE'
  )
  and not has_function_privilege(
    'anon',
    'api.thermal_anomalies_v3(integer,integer,integer,timestamptz,timestamptz,integer,timestamptz,uuid,text)',
    'EXECUTE'
  )
  and not has_function_privilege(
    'authenticated',
    'api.thermal_anomalies_v3(integer,integer,integer,timestamptz,timestamptz,integer,timestamptz,uuid,text)',
    'EXECUTE'
  )
  and not has_function_privilege(
    'service_role',
    'api.thermal_anomalies_v3(integer,integer,integer,timestamptz,timestamptz,integer,timestamptz,uuid,text)',
    'EXECUTE'
  )
  and not has_function_privilege(
    'firewatch_collector',
    'api.thermal_anomalies_v3(integer,integer,integer,timestamptz,timestamptz,integer,timestamptz,uuid,text)',
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
  'thermal_anomaly_assessments_projection_chain_idx',
  'assessment chain lookup has a dedicated covered index'
);

select has_index(
  'ingest',
  'firms_detection_details',
  'firms_detection_details_projection_original_idx',
  'stable original detection ordering has a partial index'
);

select ok(
  to_regprocedure(
    'truth.thermal_anomalies_v3_legacy(integer,integer,integer,timestamptz,timestamptz,integer)'
  ) is not null
  and not has_function_privilege(
    'firewatch_discovery_reader',
    'truth.thermal_anomalies_v3_legacy(integer,integer,integer,timestamptz,timestamptz,integer)',
    'EXECUTE'
  )
  and not has_function_privilege(
    'anon',
    'truth.thermal_anomalies_v3_legacy(integer,integer,integer,timestamptz,timestamptz,integer)',
    'EXECUTE'
  )
  and not has_function_privilege(
    'service_role',
    'truth.thermal_anomalies_v3_legacy(integer,integer,integer,timestamptz,timestamptz,integer)',
    'EXECUTE'
  ),
  'the exact rollback copy of the superseded projection is not executable'
);

select is(
  truth.ceil_millisecond_utc(
    timestamptz '2026-07-31 12:00:00.000001+00'
  ),
  timestamptz '2026-07-31 12:00:00.001+00',
  'sub-millisecond evidence clocks are conservatively rounded upward'
);

select ok(
  (
    select table_class.relrowsecurity
      and table_class.relforcerowsecurity
      and not has_table_privilege(
        'firewatch_discovery_reader',
        'truth.thermal_anomaly_projection_epochs',
        'SELECT'
      )
    from pg_class as table_class
    where table_class.oid =
      'truth.thermal_anomaly_projection_epochs'::regclass
  ),
  'the evidence snapshot epoch is private and forced-RLS protected'
);

select ok(
  exists (
    select 1
    from pg_trigger as trigger_row
    where trigger_row.tgrelid = 'ingest.firms_detection_details'::regclass
      and trigger_row.tgname = 'firms_detection_details_projection_epoch'
      and not trigger_row.tgisinternal
  )
  and exists (
    select 1
    from pg_trigger as trigger_row
    where trigger_row.tgrelid = 'truth.thermal_anomaly_assessments'::regclass
      and trigger_row.tgname = 'thermal_anomaly_assessments_projection_epoch'
      and not trigger_row.tgisinternal
  ),
  'every relevant append-only evidence table invalidates pagination snapshots'
);

select ok(
  (
    select procedure.prosecdef
      and procedure.provolatile = 'v'
      and not has_function_privilege(
        'firewatch_discovery_reader',
        'truth.bump_thermal_anomaly_projection_epoch()',
        'EXECUTE'
      )
    from pg_proc as procedure
    where procedure.oid =
      'truth.bump_thermal_anomaly_projection_epoch()'::regprocedure
  ),
  'the volatile epoch writer is a private SECURITY DEFINER trigger boundary'
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
      10, 587, 391,
      pg_catalog.date_trunc(
        'milliseconds', now() - interval '32 days'
      ),
      pg_catalog.date_trunc('milliseconds', now()),
      10
    )$$,
  '22023',
  'Thermal anomaly cutoffs must be ordered and current within 31 days',
  'direct callers cannot request unbounded historical replay'
);

select throws_ok(
  $$select * from api.thermal_anomalies_v3(
      10, 587, 391,
      pg_catalog.date_trunc('milliseconds', now())
        + interval '0.0004 seconds',
      pg_catalog.date_trunc('milliseconds', now())
        + interval '1 millisecond',
      10
    )$$,
  '22023',
  'Thermal anomaly cutoffs must be ordered and current within 31 days',
  'direct callers must use replay-safe millisecond cutoffs'
);

select throws_ok(
  $$select * from api.thermal_anomalies_v3(
      10, 587, 391,
      pg_catalog.date_trunc('milliseconds', now()),
      pg_catalog.date_trunc('milliseconds', now()),
      102
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
-- projection test isolates read semantics with a check-valid fixture. Drop only
-- the two upstream-ledger foreign keys transaction-locally and disable user
-- validation triggers; PostgreSQL does not permit a non-superuser test runner
-- to disable the system triggers that implement foreign keys.
alter table ingest.firms_detection_details
  drop constraint firms_detection_details_observation_cursor_fkey;
alter table ingest.firms_detection_details
  drop constraint firms_detection_details_source_revision_fkey;
alter table ingest.firms_detection_details disable trigger user;
alter table truth.thermal_anomaly_assessments disable trigger user;
alter table ingest.firms_detection_details
  enable trigger firms_detection_details_projection_epoch;
alter table truth.thermal_anomaly_assessments
  enable trigger thermal_anomaly_assessments_projection_epoch;

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
  900002,
  '019a0000-0000-7000-8000-000000000302',
  '1.1.0',
  'firms-detection-v1',
  repeat('b', 64),
  900002,
  900002,
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
  0.500,
  0.625,
  'centroid_with_circumscribed_radius_v1',
  null,
  'high',
  null,
  371.25,
  303.50,
  'viirs_bright_ti4_ti5',
  13.25,
  'day',
  '2.0NRT-revised',
  'firms-area-csv-viirs-v1',
  date_trunc('milliseconds', now() - interval '54 minutes')
    + interval '0.0004 seconds',
  date_trunc('milliseconds', now() - interval '49 minutes')
    + interval '0.0004 seconds',
  2,
  900001,
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
  date_trunc('milliseconds', now() - interval '48 minutes')
    + interval '0.0004 seconds'
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
    900001, 900002, 2, 910001, 'unknown', 'operator_withheld',
    null, null, null, 'firms.assessment-review', '1.0.0',
    now() - interval '30 minutes',
    date_trunc('milliseconds', now() - interval '25 minutes')
      + interval '0.0004 seconds',
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
    date_trunc('milliseconds', now() - interval '24 minutes')
      + interval '0.0004 seconds'
  );

select is(
  (
    select evidence_epoch
    from truth.thermal_anomaly_projection_epochs
    where projection_key = 'nasa-firms-thermal-anomaly-v3'
  ),
  3::bigint,
  'two detection statements and one assessment statement transactionally bump the evidence epoch'
);

set local role firewatch_discovery_reader;

select is(
  (
    select assessment_state
    from api.thermal_anomalies_v3(
      10, 587, 391,
      pg_catalog.date_trunc(
        'milliseconds', now() - interval '40 minutes'
      ),
      pg_catalog.date_trunc(
        'milliseconds', now() - interval '35 minutes'
      ),
      10
    )
  ),
  'detected',
  'rewinding before a later assessment selects the first visible state'
);

select is(
  (
    select assessment_state
    from api.thermal_anomalies_v3(
      10, 587, 391,
      pg_catalog.date_trunc('milliseconds', now()),
      pg_catalog.date_trunc('milliseconds', now()),
      10
    )
  ),
  'unknown',
  'the latest assessment visible at both current cutoffs is selected'
);

select ok(
  (
    select
      detection_id = '019a0000-0000-7000-8000-000000000301'::uuid
      and basis_detection_id = '019a0000-0000-7000-8000-000000000302'::uuid
      and basis_version_no = 2
      and source_key = 'nasa-firms'
      and product_key = 'VIIRS_NOAA20_NRT'
      and platform = 'NOAA-20'
      and instrument = 'VIIRS'
      and source_time_precision = 'minute'
      and scan_km = 0.500
      and track_km = 0.625
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
    from api.thermal_anomalies_v3(
      10, 587, 391,
      pg_catalog.date_trunc('milliseconds', now()),
      pg_catalog.date_trunc('milliseconds', now()),
      10
    )
  ),
  'projection uses the exact assessment basis while preserving stable identity and non-authoritative semantics'
);

select is(
  (
    with first_read as (
      select item_known_at
      from api.thermal_anomalies_v3(
        10, 587, 391,
        pg_catalog.date_trunc('milliseconds', now()),
        pg_catalog.date_trunc('milliseconds', now()),
        10
      )
    )
    select count(*)
    from first_read
    cross join lateral api.thermal_anomalies_v3(
      10, 587, 391,
      first_read.item_known_at,
      first_read.item_known_at,
      10
    )
  ),
  1::bigint,
  'a returned millisecond knowledge cutoff includes the same microsecond evidence on replay'
);

select is(
  (
    with first_read as (
      select acquired_at, detection_id, gate_snapshot
      from api.thermal_anomalies_v3(
        10, 587, 391,
        pg_catalog.date_trunc('milliseconds', now()),
        pg_catalog.date_trunc('milliseconds', now()),
        10
      )
    )
    select count(*)
    from first_read
    cross join lateral api.thermal_anomalies_v3(
      10, 587, 391,
      pg_catalog.date_trunc('milliseconds', now()),
      pg_catalog.date_trunc('milliseconds', now()),
      10,
      first_read.acquired_at,
      first_read.detection_id,
      first_read.gate_snapshot
    )
  ),
  0::bigint,
  'the descending keyset boundary excludes the last row from the next page'
);

select throws_ok(
  $$with first_read as (
      select acquired_at, detection_id
      from api.thermal_anomalies_v3(
        10, 587, 391,
        pg_catalog.date_trunc('milliseconds', now()),
        pg_catalog.date_trunc('milliseconds', now()),
        10
      )
    )
    select *
    from first_read
    cross join lateral api.thermal_anomalies_v3(
      10, 587, 391,
      pg_catalog.date_trunc('milliseconds', now()),
      pg_catalog.date_trunc('milliseconds', now()),
      10,
      first_read.acquired_at,
      first_read.detection_id,
      repeat('f', 64)
    )$$,
  '22023',
  'Thermal anomaly publication gate snapshot changed',
  'a continuation cannot mix publication gate snapshots'
);

select is(
  (
    select count(*)
    from api.thermal_anomalies_v3(
      10, 587, 391,
      pg_catalog.date_trunc(
        'milliseconds', now() - interval '50 minutes'
      ),
      pg_catalog.date_trunc(
        'milliseconds', now() - interval '46 minutes'
      ),
      10
    )
  ),
  0::bigint,
  'an assessment unknown at the knowledge cutoff remains absent'
);

reset role;

update core.firms_products
set enabled = false,
    assessment_enabled = false
where product_key = 'VIIRS_NOAA20_NRT';

set local role firewatch_discovery_reader;

select is(
  (
    select count(*)
    from api.thermal_anomalies_v3(
      10, 587, 391,
      pg_catalog.date_trunc('milliseconds', now()),
      pg_catalog.date_trunc('milliseconds', now()),
      10
    )
  ),
  0::bigint,
  'disabled FIRMS catalog state cannot surface a valid row or empty-coverage claim'
);

reset role;

select * from finish();
rollback;
