begin;

create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public, pg_catalog;

select no_plan();

select has_table('core', 'firms_products', 'typed FIRMS product registry exists');
select has_table('ingest', 'firms_detection_details', 'typed FIRMS detection details exist');
select has_table('ingest', 'firms_response_rows', 'per-response FIRMS row evidence exists');
select has_table('ingest', 'firms_query_product_results', 'per-product FIRMS request results exist');
select has_table('ingest', 'firms_query_completions', 'all-product FIRMS completion evidence exists');
select has_table('truth', 'thermal_anomaly_assessments', 'versioned private anomaly assessments exist');

select has_column('ingest', 'firms_detection_details', 'source_time_precision', 'source minute precision is explicit');
select has_column('ingest', 'firms_detection_details', 'normalized_content_sha256', 'normalized revision content identity is durable');
select has_column('ingest', 'firms_detection_details', 'scan_km', 'reported scan dimension is typed');
select has_column('ingest', 'firms_detection_details', 'track_km', 'reported track dimension is typed');
select has_column('ingest', 'firms_detection_details', 'modeled_support_radius_m', 'modeled support is separate from source geometry');
select hasnt_column('ingest', 'firms_detection_details', 'footprint_geom', 'schema does not fabricate a source pixel polygon');
select has_column('ingest', 'firms_response_rows', 'item_index', 'response occurrence preserves raw row position');
select has_column('ingest', 'firms_detection_details', 'source_satellite_raw', 'source satellite alias remains durable');
select has_column('ingest', 'firms_query_product_results', 'logical_request_sha256', 'FIRMS logical request identity is durable');
select has_column('ingest', 'firms_query_product_results', 'http_request_fingerprint_sha256', 'generic HTTP ledger identity is bound separately');
select has_column('ingest', 'firms_query_product_results', 'issued_at', 'canonical request issuance instant is typed');
select has_column('ingest', 'firms_query_product_results', 'response_raw_object_id', 'durable response occurrence ID is bound');
select has_column('ingest', 'firms_query_product_results', 'response_content_sha256', 'exact response-body hash is bound');
select has_column('ingest', 'firms_query_product_results', 'response_retrieved_at', 'raw occurrence retrieval instant is bound');
select has_column('ingest', 'firms_query_product_results', 'accepted_row_count', 'accepted occurrences are counted without an unprovable dedup claim');
select has_column('ingest', 'firms_query_completions', 'sensor_assessability', 'completion preserves unknown sensor assessability');
select has_column('ingest', 'firms_query_completions', 'negative_assessment_eligible', 'negative gate is explicit and database-derived');
select has_column('truth', 'thermal_anomaly_assessments', 'as_of', 'assessment as-of time is durable');
select has_column('truth', 'thermal_anomaly_assessments', 'known_at', 'assessment knowledge time is durable');
select has_column('truth', 'thermal_anomaly_assessments', 'rule_version', 'assessment rule version is durable');

select ok(
  (select bool_and(relrowsecurity and relforcerowsecurity)
   from pg_class
   where oid in (
     'core.firms_products'::regclass,
     'ingest.firms_detection_details'::regclass,
     'ingest.firms_response_rows'::regclass,
     'ingest.firms_query_product_results'::regclass,
     'ingest.firms_query_completions'::regclass,
     'truth.thermal_anomaly_assessments'::regclass
   )),
  'all FIRMS private tables enable and force RLS'
);

select ok(
  has_table_privilege('firewatch_collector', 'ingest.firms_detection_details', 'SELECT')
  and has_table_privilege('firewatch_collector', 'ingest.firms_detection_details', 'INSERT')
  and not has_table_privilege('firewatch_collector', 'ingest.firms_detection_details', 'UPDATE')
  and has_table_privilege('firewatch_collector', 'ingest.firms_response_rows', 'INSERT')
  and has_table_privilege('firewatch_collector', 'ingest.firms_query_completions', 'INSERT')
  and has_table_privilege('firewatch_reconciler', 'ingest.firms_query_completions', 'SELECT')
  and has_table_privilege('firewatch_reconciler', 'truth.thermal_anomaly_assessments', 'INSERT')
  and not has_table_privilege('firewatch_reconciler', 'truth.thermal_anomaly_assessments', 'UPDATE')
  and not has_table_privilege('service_role', 'ingest.firms_query_completions', 'SELECT')
  and not has_table_privilege('anon', 'ingest.firms_detection_details', 'SELECT')
  and not has_table_privilege('authenticated', 'truth.thermal_anomaly_assessments', 'SELECT'),
  'least-privileged capability roles can append, never mutate, with no public/service shortcut'
);

select is(
  (select count(*) from core.firms_products),
  4::bigint,
  'production catalog contains exactly four FIRMS products'
);

select ok(
  (select bool_and(
      not product.enabled
      and not product.assessment_enabled
      and product.license_status = 'unreviewed'
    )
   from core.firms_products as product),
  'all FIRMS products remain disabled and license-review gated'
);

select ok(
  (select
     not source.enabled
     and not source.is_public
     and source.sensitivity = 'restricted'
     and source.license_status = 'unreviewed'
   from core.sources as source
   where source.slug = 'nasa-firms')
  and (select
     endpoint.auth_mode = 'path_secret'
     and endpoint.credential_ref = 'FIRMS_MAP_KEY'
     and not state.enabled
   from core.endpoints as endpoint
   join core.sources as source on source.id = endpoint.source_id
   join ingest.endpoint_state as state on state.endpoint_id = endpoint.id
   where source.slug = 'nasa-firms'
     and endpoint.endpoint_key = 'area-csv')
  and (select
     not target.enabled
     and target.visibility = 'restricted'
     and not revision.enabled
     and revision.request_params = '{}'::jsonb
   from core.collection_targets as target
   join core.collection_target_revisions as revision
     on revision.collection_target_id = target.id
   join core.sources as source on source.id = target.source_id
   where source.slug = 'nasa-firms'
     and target.target_key = 'global-discovery')
  and not exists (
    select 1
    from core.adapter_releases as adapter
    join core.sources as source on source.id = adapter.source_id
    where source.slug = 'nasa-firms'
  ),
  'FIRMS source, path-secret endpoint, and target are restricted and inert without an adapter'
);

select ok(
  (select pg_get_constraintdef(oid) like '%day_count >= 1%day_count <= 5%'
   from pg_constraint
   where conrelid = 'ingest.firms_query_product_results'::regclass
     and conname = 'firms_query_product_results_day_count_check')
  and (select pg_get_constraintdef(oid) like '%explicit_starting_on%'
       from pg_constraint
       where conrelid = 'ingest.firms_query_product_results'::regclass
         and conname = 'firms_query_product_results_date_request_mode_check'),
  'typed completion accepts only the network boundary 1..5 explicit-date contract'
);

select ok(
  ingest.firms_area_token_is_valid_v1(
    '25.900000,39.500000,26.100000,39.700000'
  )
  and ingest.firms_area_token_matches_v1(
    '25.900000,39.500000,26.100000,39.700000',
    25.9, 39.5, 26.1, 39.7
  )
  and not ingest.firms_area_token_is_valid_v1(
    '25.9,39.500000,26.100000,39.700000'
  )
  and not ingest.firms_area_token_is_valid_v1(
    '-0.000000,39.500000,26.100000,39.700000'
  )
  and not ingest.firms_area_token_is_valid_v1(
    '25.9000000,39.500000,26.100000,39.700000'
  )
  and not ingest.firms_area_token_is_valid_v1(
    '25.900000,39.500000,181.000000,39.700000'
  )
  and not ingest.firms_area_token_matches_v1(
    '25.900000,39.500000,26.100000,39.700000',
    25.9, 39.5, 26.100001, 39.7
  ),
  'area-token golden vectors reject noncanonical precision, negative zero, range, and rounding collisions'
);

select ok(
  ingest.http_safe_map_is_allowed(
    '{"issued_at":"2026-07-31T03:35:00.123Z"}'::jsonb,
    'request_metadata'
  )
  and ingest.firms_issued_at_token_is_valid_v1(
    '2026-07-31T03:35:00.123Z'
  )
  and not ingest.firms_issued_at_token_is_valid_v1(
    '2026-07-31T03:35:00Z'
  )
  and not ingest.firms_issued_at_token_is_valid_v1(
    '2026-02-31T03:35:00.123Z'
  ),
  'issued_at is allowlisted only as a canonical millisecond UTC scalar'
);

select ok(
  (select pg_get_constraintdef(oid) ilike
      '%(response_raw_object_id, http_exchange_id, run_id, source_id, endpoint_id)%REFERENCES ingest.raw_objects(id, http_exchange_id, run_id, source_id, endpoint_id)%'
    from pg_constraint
    where conrelid = 'ingest.firms_query_product_results'::regclass
      and conname = 'firms_query_product_results_response_raw_fkey'
      and contype = 'f'
  )
  and pg_get_functiondef(
    'ingest.validate_firms_query_product_result()'::regprocedure
  ) like '%exact durable response occurrence receipt%'
  and pg_get_functiondef(
    'ingest.validate_firms_detection_detail()'::regprocedure
  ) like '%raw_retrieved_at is distinct from new.retrieved_at%',
  'product results and typed details retain the exact joined exchange/raw receipt invariants'
);

select is(
  ingest.firms_area_logical_request_sha256_v1(
    'https://firms.modaps.eosdis.nasa.gov/api/area/csv',
    'VIIRS_SNPP_NRT',
    25.9, 39.5, 26.1, 39.7,
    date '2026-07-31',
    5
  ),
  '71ffe07c01217707e780ce842d4fb7a3a2bc94f0933daf412e5b978af21085ae',
  'FIRMS logical request identity has a cross-runtime golden vector'
);

select is(
  ingest.firms_detection_identity_v1(
    'VIIRS_SNPP_NRT',
    'Suomi-NPP',
    timestamptz '2026-07-31 03:35:00+00',
    39.1234,
    26.1234
  ),
  'c7b3f4bb16e79d9a93e4743b1fb8bc28302c53ef68bd623573da6b07c1c9e125',
  'FIRMS semantic detection identity has a cross-runtime golden vector'
);

select is(ingest.firms_source_satellite_code_v1('VIIRS_SNPP_NRT', 'N'), 'N', 'SNPP alias N maps to canonical N');
select is(ingest.firms_source_satellite_code_v1('VIIRS_SNPP_NRT', 'SNPP'), 'N', 'SNPP alias SNPP maps to canonical N');
select is(ingest.firms_source_satellite_code_v1('VIIRS_SNPP_NRT', 'S-NPP'), 'N', 'SNPP alias S-NPP maps to canonical N');
select is(ingest.firms_source_satellite_code_v1('VIIRS_SNPP_NRT', 'SUOMI-NPP'), 'N', 'SNPP alias SUOMI-NPP maps to canonical N');
select is(ingest.firms_source_satellite_code_v1('VIIRS_NOAA20_NRT', 'N20'), 'N20', 'NOAA-20 alias N20 maps to canonical N20');
select is(ingest.firms_source_satellite_code_v1('VIIRS_NOAA20_NRT', 'NOAA-20'), 'N20', 'NOAA-20 alias NOAA-20 maps to canonical N20');
select is(ingest.firms_source_satellite_code_v1('VIIRS_NOAA21_NRT', 'N21'), 'N21', 'NOAA-21 alias N21 maps to canonical N21');
select is(ingest.firms_source_satellite_code_v1('VIIRS_NOAA21_NRT', 'NOAA-21'), 'N21', 'NOAA-21 alias NOAA-21 maps to canonical N21');
select is(ingest.firms_source_satellite_code_v1('MODIS_NRT', 'A'), 'A', 'Aqua alias A maps to canonical A');
select is(ingest.firms_source_satellite_code_v1('MODIS_NRT', 'AQUA'), 'A', 'Aqua alias AQUA maps to canonical A');
select is(ingest.firms_source_satellite_code_v1('MODIS_NRT', 'T'), 'T', 'Terra alias T maps to canonical T');
select is(ingest.firms_source_satellite_code_v1('MODIS_NRT', 'TERRA'), 'T', 'Terra alias TERRA maps to canonical T');

select ok(
  ingest.firms_detection_is_within_request_v1(
    '25.900000,39.500000,26.200000,39.700000',
    '2026-07-31/1',
    39.600000,
    26.150000,
    date '2026-07-31'
  )
  and not ingest.firms_detection_is_within_request_v1(
    '25.900000,39.500000,26.100000,39.700000',
    '2026-07-31/1',
    39.600000,
    26.150000,
    date '2026-07-31'
  )
  and pg_get_functiondef(
    'ingest.validate_firms_response_row()'::regprocedure
  ) like '%firms_detection_is_within_request_v1%',
  'an outside-narrow/inside-wide detail is rejected against the issued narrow envelope'
);

select ok(
  (select pg_get_constraintdef(oid) not ilike '%no_anomaly_returned%'
   from pg_constraint
   where conrelid = 'truth.thermal_anomaly_assessments'::regclass
     and conname = 'thermal_anomaly_assessments_assessment_state_check')
  and (select pg_get_expr(adbin, adrelid) = 'false'
       from pg_attrdef
       where adrelid = 'ingest.firms_query_completions'::regclass
         and adnum = (
           select attnum from pg_attribute
           where attrelid = 'ingest.firms_query_completions'::regclass
             and attname = 'negative_assessment_eligible'
         )),
  'negative anomaly assessment is structurally impossible in this contract'
);

create temporary table assessment_shape_contract (
  like truth.thermal_anomaly_assessments
    including defaults including generated including constraints
);

select lives_ok(
  $$
    insert into assessment_shape_contract (
      cursor, public_id, contract_version, original_detection_id,
      basis_detection_id, version_no, previous_assessment_cursor,
      assessment_state, reason_code, firms_completion_health_cursor,
      cmr_observation_cursor, failed_product_result_id, rule_id, rule_version,
      as_of, known_at, claim_kind, operational_effect, limitations, recorded_at
    ) values (
      0, '018f0000-0000-7000-8000-000000009000', '1.1.0', 1,
      1, 2, 1, 'unknown', 'operator_withheld', null, null, null,
      'firms.test', '1.0.0', '2026-07-31 00:00:00+00',
      '2026-07-31 01:00:00+00', 'thermal_anomaly_observation_only', 'none',
      array[
        'thermal_detection_not_incident_confirmation',
        'cmr_catalog_metadata_does_not_assess_anomalies',
        'sensor_assessability_unknown', 'not_official_status',
        'not_protective_guidance', 'not_containment_statement',
        'not_incident_resolution', 'not_all_clear'
      ]::text[], '2026-07-31 01:00:00+00'
    )
  $$,
  'control assessment shape is valid before negative evidence-shape cases'
);

select throws_ok(
  $$
    insert into assessment_shape_contract (
      cursor, public_id, contract_version, original_detection_id,
      basis_detection_id, version_no, previous_assessment_cursor,
      assessment_state, reason_code, firms_completion_health_cursor,
      cmr_observation_cursor, failed_product_result_id, rule_id, rule_version,
      as_of, known_at, claim_kind, operational_effect, limitations, recorded_at
    ) values (
      1, '018f0000-0000-7000-8000-000000009001', '1.1.0', 1,
      1, 2, 1, 'awaiting_later_assessment',
      'cmr_coverage_only_anomaly_not_assessed', null, null, null,
      'firms.test', '1.0.0', '2026-07-31 00:00:00+00',
      '2026-07-31 01:00:00+00', 'thermal_anomaly_observation_only', 'none',
      array[
        'thermal_detection_not_incident_confirmation',
        'cmr_catalog_metadata_does_not_assess_anomalies',
        'sensor_assessability_unknown', 'not_official_status',
        'not_protective_guidance', 'not_containment_statement',
        'not_incident_resolution', 'not_all_clear'
      ]::text[], '2026-07-31 01:00:00+00'
    )
  $$,
  '23514',
  'new row for relation "assessment_shape_contract" violates check constraint "thermal_anomaly_assessments_cmr_semantics_check"',
  'CMR-only reason cannot be recorded without its CMR observation'
);

select throws_ok(
  $$
    insert into assessment_shape_contract (
      cursor, public_id, contract_version, original_detection_id,
      basis_detection_id, version_no, previous_assessment_cursor,
      assessment_state, reason_code, firms_completion_health_cursor,
      cmr_observation_cursor, failed_product_result_id, rule_id, rule_version,
      as_of, known_at, claim_kind, operational_effect, limitations, recorded_at
    ) values (
      2, '018f0000-0000-7000-8000-000000009002', '1.1.0', 1,
      1, 2, 1, 'unknown', 'firms_response_incomplete', null, null, null,
      'firms.test', '1.0.0', '2026-07-31 00:00:00+00',
      '2026-07-31 01:00:00+00', 'thermal_anomaly_observation_only', 'none',
      array[
        'thermal_detection_not_incident_confirmation',
        'cmr_catalog_metadata_does_not_assess_anomalies',
        'sensor_assessability_unknown', 'not_official_status',
        'not_protective_guidance', 'not_containment_statement',
        'not_incident_resolution', 'not_all_clear'
      ]::text[], '2026-07-31 01:00:00+00'
    )
  $$,
  '23514',
  'new row for relation "assessment_shape_contract" violates check constraint "thermal_anomaly_assessments_failed_result_check"',
  'incomplete-response reason cannot omit its failed product result'
);

select throws_ok(
  $$
    insert into assessment_shape_contract (
      cursor, public_id, contract_version, original_detection_id,
      basis_detection_id, version_no, previous_assessment_cursor,
      assessment_state, reason_code, firms_completion_health_cursor,
      cmr_observation_cursor, failed_product_result_id, rule_id, rule_version,
      as_of, known_at, claim_kind, operational_effect, limitations, recorded_at
    ) values (
      3, '018f0000-0000-7000-8000-000000009003', '1.1.0', 1,
      1, 2, 1, 'unknown', 'operator_withheld', 99, null, null,
      'firms.test', '1.0.0', '2026-07-31 00:00:00+00',
      '2026-07-31 01:00:00+00', 'thermal_anomaly_observation_only', 'none',
      array[
        'thermal_detection_not_incident_confirmation',
        'cmr_catalog_metadata_does_not_assess_anomalies',
        'sensor_assessability_unknown', 'not_official_status',
        'not_protective_guidance', 'not_containment_statement',
        'not_incident_resolution', 'not_all_clear'
      ]::text[], '2026-07-31 01:00:00+00'
    )
  $$,
  '23514',
  'new row for relation "assessment_shape_contract" violates check constraint "thermal_anomaly_assessments_completion_check"',
  'unrelated reasons cannot attach a FIRMS completion'
);

select ok(
  (select prosecdef
   from pg_proc
   where oid = 'truth.validate_thermal_anomaly_assessment()'::regprocedure)
  and (select proconfig @> array['search_path=""']
       from pg_proc
       where oid = 'truth.validate_thermal_anomaly_assessment()'::regprocedure)
  and not has_function_privilege(
    'firewatch_reconciler',
    'truth.validate_thermal_anomaly_assessment()',
    'EXECUTE'
  )
  and not has_function_privilege(
    'service_role',
    'truth.validate_thermal_anomaly_assessment()',
    'EXECUTE'
  ),
  'private CMR assessment validator is an empty-search-path, non-callable trigger boundary'
);

select ok(
  to_regclass('ingest.firms_detection_details_product_acquired_idx') is not null
  and to_regclass('ingest.firms_detection_details_centroid_geom_gist') is not null
  and to_regclass('ingest.firms_response_rows_run_product_disposition_idx') is not null
  and to_regclass('ingest.firms_query_product_results_run_product_key') is not null
  and to_regclass('ingest.firms_query_completions_run_id_key') is not null
  and to_regclass('ingest.firms_query_completions_bbox_geom_gist') is not null
  and to_regclass('truth.thermal_anomaly_assessments_detection_as_of_idx') is not null,
  'FIRMS equality/time, lineage, uniqueness, and PostGIS access paths exist'
);

select ok(
  to_regclass('api.firms_detections') is null
  and to_regclass('api.thermal_anomaly_assessments') is null,
  'inert foundation creates no public FIRMS or assessment view'
);

select * from finish();
rollback;
