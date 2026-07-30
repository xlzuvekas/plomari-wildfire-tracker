begin;

grant firewatch_collector to postgres;

create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public, pg_catalog;

select no_plan();

select has_table('ingest', 'cmr_granule_details', 'typed CMR granule detail table exists');
select has_table('ingest', 'cmr_granule_occurrences', 'per-run CMR granule occurrence evidence exists');
select has_table('ingest', 'cmr_rejections', 'typed CMR rejected-item evidence exists');
select has_table('ingest', 'cmr_scan_completions', 'typed CMR scan lineage exists');
select has_table('ingest', 'cmr_scan_product_completions', 'per-product CMR completion evidence exists');
select has_view('api', 'satellite_passes', 'public CMR pass projection exists');
select has_view('api', 'satellite_scan_status', 'public CMR scan summary exists');

select has_column('ingest', 'cmr_granule_details', 'catalog_granule_id', 'CMR granule identity is typed');
select has_column('ingest', 'cmr_granule_details', 'cmr_revision_id', 'CMR upstream revision is typed');
select has_column('ingest', 'cmr_granule_occurrences', 'item_index', 'CMR occurrence retains its exact raw page position');
select has_column('ingest', 'cmr_granule_occurrences', 'observation_cursor', 'CMR occurrence resolves to immutable normalized identity');
select has_column('ingest', 'cmr_rejections', 'http_exchange_id', 'CMR rejection retains its exact response occurrence');
select has_column('ingest', 'cmr_rejections', 'item_index', 'CMR rejection retains source item position');
select has_column('ingest', 'cmr_scan_completions', 'updated_since', 'incremental CMR query watermark is durable');
select has_column('ingest', 'cmr_scan_completions', 'predecessor_health_cursor', 'incremental predecessor is durable');
select has_column('ingest', 'cmr_scan_completions', 'baseline_health_cursor', 'complete baseline identity is durable');
select has_column('ingest', 'cmr_scan_completions', 'continuous_coverage_from', 'continuous coverage start is durable');
select has_column('ingest', 'cmr_scan_completions', 'continuous_coverage_to', 'continuous coverage end is durable');
select has_column('api', 'satellite_passes', 'footprint_geojson', 'public passes expose typed GeoJSON');
select hasnt_column('api', 'satellite_passes', 'observation_cursor', 'public passes hide internal bigint cursors');
select hasnt_column('api', 'satellite_passes', 'footprint_geom', 'public passes do not duplicate private PostGIS geometry');

select ok(
  (select bool_and(relrowsecurity and relforcerowsecurity)
   from pg_class
   where oid in (
     'ingest.cmr_granule_details'::regclass,
     'ingest.cmr_granule_occurrences'::regclass,
     'ingest.cmr_rejections'::regclass,
     'ingest.cmr_scan_completions'::regclass,
     'ingest.cmr_scan_product_completions'::regclass
   )),
  'all CMR private tables have enabled and forced RLS'
);

select ok(
  has_table_privilege('firewatch_collector', 'ingest.cmr_granule_details', 'SELECT')
  and has_table_privilege('firewatch_collector', 'ingest.cmr_granule_details', 'INSERT')
  and not has_table_privilege('firewatch_collector', 'ingest.cmr_granule_details', 'UPDATE')
  and not has_table_privilege('firewatch_collector', 'ingest.cmr_granule_details', 'DELETE')
  and has_table_privilege('firewatch_collector', 'ingest.cmr_scan_completions', 'INSERT')
  and has_table_privilege('firewatch_collector', 'ingest.cmr_granule_occurrences', 'INSERT')
  and not has_table_privilege('firewatch_collector', 'ingest.cmr_granule_occurrences', 'UPDATE')
  and not has_table_privilege('anon', 'ingest.cmr_granule_occurrences', 'SELECT')
  and has_table_privilege('firewatch_collector', 'ingest.cmr_rejections', 'INSERT')
  and not has_table_privilege('firewatch_collector', 'ingest.cmr_rejections', 'UPDATE')
  and not has_table_privilege('anon', 'ingest.cmr_rejections', 'SELECT')
  and has_table_privilege('firewatch_collector', 'ingest.cmr_scan_product_completions', 'INSERT')
  and not has_table_privilege('service_role', 'ingest.cmr_scan_completions', 'INSERT')
  and not has_table_privilege('anon', 'ingest.cmr_scan_product_completions', 'SELECT'),
  'collector can append typed CMR evidence without mutation or service-role widening'
);

select ok(
  (select reloptions @> array['security_invoker=true', 'security_barrier=true']
   from pg_class where oid = 'api.satellite_passes'::regclass)
  and (select reloptions @> array['security_invoker=true', 'security_barrier=true']
       from pg_class where oid = 'api.satellite_scan_status'::regclass),
  'CMR public views are security-invoker security barriers'
);

select ok(
  not (select prosecdef from pg_proc
       where oid = 'api.satellite_scan_status_for_window(timestamptz,timestamptz)'::regprocedure)
  and not (select prosecdef from pg_proc
           where oid = 'api.satellite_passes_for_cell(integer,integer,integer,timestamptz,timestamptz,integer)'::regprocedure)
  and has_function_privilege(
    'anon',
    'api.satellite_scan_status_for_window(timestamptz,timestamptz)',
    'EXECUTE'
  )
  and has_function_privilege(
    'authenticated',
    'api.satellite_passes_for_cell(integer,integer,integer,timestamptz,timestamptz,integer)',
    'EXECUTE'
  ),
  'bounded CMR RPCs are security invoker and callable by public read roles'
);

select ok(
  to_regclass('ingest.cmr_granule_details_observed_to_cursor_idx') is not null
  and to_regclass('ingest.cmr_granule_occurrences_observation_run_idx') is not null
  and to_regclass('ingest.cmr_granule_occurrences_run_product_idx') is not null
  and to_regclass('ingest.cmr_granule_occurrences_run_observation_key') is not null
  and to_regclass('ingest.cmr_scan_completions_baseline_health_idx') is not null
  and to_regclass('ingest.cmr_scan_completions_predecessor_health_cursor_key') is not null
  and to_regclass('ingest.cmr_scan_completions_run_id_key') is not null,
  'CMR temporal, lineage, predecessor, and run access paths are indexed'
);

select ok(
  ingest.http_safe_map_is_allowed(
    '{"updated_since":"2026-07-30T00:00:00Z"}'::jsonb,
    'request_query'
  )
  and ingest.http_safe_map_is_allowed(
    '{"cmr-time-out":"false","cmr-timed-out":"false"}'::jsonb,
    'response_header'
  ),
  'durable HTTP evidence permits CMR incremental watermark and both timeout spellings'
);

select ok(
  (select
     not source.enabled
     and source.license_code = 'us_government_work'
     and source.license_status = 'approved'
     and source.commercial_use_allowed is true
     and source.redistribution_allowed is true
     and source.default_evidence_class = 'satellite_pass_metadata'
   from core.sources as source
   where source.slug = 'nasa-cmr-firemask')
  and (select
     endpoint.auth_mode = 'none'
     and endpoint.credential_ref is null
     and endpoint.poll_interval = interval '5 minutes'
     and not state.enabled
   from core.endpoints as endpoint
   join ingest.endpoint_state as state on state.endpoint_id = endpoint.id
   join core.sources as source on source.id = endpoint.source_id
   where source.slug = 'nasa-cmr-firemask')
  and (select
     not target.enabled
     and not revision.enabled
     and revision.cadence = interval '5 minutes'
     and revision.stale_after = interval '3 hours'
     and revision.configuration_sha256 = '1d8dd3f510d333495f3c92ab245f6f1883a6cccb2e5323c0c2c17f832cd4f199'
   from core.collection_targets as target
   join core.collection_target_revisions as revision
     on revision.collection_target_id = target.id
   join core.sources as source on source.id = target.source_id
   where source.slug = 'nasa-cmr-firemask')
  and not exists (
    select 1
    from core.adapter_releases as adapter
    join core.sources as source on source.id = adapter.source_id
    where source.slug = 'nasa-cmr-firemask'
  ),
  'CMR catalog is licensed and configured but cannot run without an exact adapter release and activation'
);

set local role anon;

select ok(
  (select
     collection_target_revision_id = '018f0000-0000-7000-8000-000000000515'::uuid
     and health_status = 'disabled'
     and coverage_status = 'disabled'
     and not is_current
   from api.satellite_scan_status),
  'disabled CMR target has an explicit public status and public revision identity'
);

select ok(
  (select not covers_requested_window and not valid_empty_eligible
   from api.satellite_scan_status_for_window(
     now() - interval '36 hours', now()
   )),
  'unconfigured CMR state returns false booleans instead of fabricating valid-empty'
);

select throws_ok(
  $$select * from api.satellite_passes_for_cell(
      6, 36, 24, now() - interval '1 hour', now(), 20
    )$$,
  '22023',
  'Web Mercator cell zoom must be between 7 and 11',
  'direct PostgREST callers cannot bypass the coarse-cell zoom boundary'
);

select throws_ok(
  $$select * from api.satellite_passes_for_cell(
      7, 128, 24, now() - interval '1 hour', now(), 20
    )$$,
  '22023',
  'Web Mercator cell coordinates are outside the zoom grid',
  'cell coordinates must belong to the requested zoom grid'
);

select throws_ok(
  $$select * from api.satellite_passes_for_cell(
      7, 73, 48, now() - interval '1 hour', now(), 501
    )$$,
  '22023',
  'satellite pass result limit must be between 1 and 500',
  'public cell reads have a hard result cap'
);

select throws_ok(
  $$select * from api.satellite_scan_status_for_window(
      now() - interval '37 hours', now()
    )$$,
  '22023',
  'satellite scan window must be nonempty, at most 36 hours, and not in the future',
  'coverage eligibility cannot be requested for an unbounded window'
);

reset role;

-- Activate an enabled successor revision only inside this rolled-back test.
update core.sources set enabled = true where slug = 'nasa-cmr-firemask';

update core.collection_targets
set enabled = true
where public_id = '018f0000-0000-7000-8000-000000000415';

update ingest.endpoint_state
set enabled = true
where endpoint_id = (
  select endpoint.id
  from core.endpoints as endpoint
  join core.sources as source on source.id = endpoint.source_id
  where source.slug = 'nasa-cmr-firemask'
);

insert into core.adapter_releases (
  public_id, contract_version, source_id, release_no, version_label,
  artifact_digest, git_commit, schema_version, released_at,
  capabilities, config_schema
)
select
  '018f0000-0000-7000-8000-000000009301', '1.1.0', source.id, 1,
  'cmr-test-adapter@1.0.0', repeat('a', 64), repeat('b', 40),
  'cmr-umm-g-1.6.7-pass-v1', now(),
  '{
    "anomalyAssessment":"not_assessed",
    "catalogMetadataOnly":true,
    "pagination":"CMR-Search-After",
    "products":["VNP14IMG_NRT","VJ114IMG_NRT","VJ214IMG_NRT"],
    "ummGVersion":"1.6.7"
  }'::jsonb, '{}'::jsonb
from core.sources as source
where source.slug = 'nasa-cmr-firemask';

insert into ingest.adapter_release_state (adapter_release_id, enabled)
select adapter.id, true
from core.adapter_releases as adapter
where adapter.public_id = '018f0000-0000-7000-8000-000000009301';

insert into core.collection_target_revisions (
  public_id, contract_version, identity_version, collection_target_id,
  endpoint_id, version_no, previous_revision_id, target_kind,
  configuration_sha256, scope, geometry_precision_source, claim_kind,
  operational_role, cadence, stale_after, enabled, request_params,
  effective_at
)
select
  '018f0000-0000-7000-8000-000000009302', '1.1.0', '2.0.0',
  prior.collection_target_id, prior.endpoint_id, 2, prior.id, 'global',
  repeat('c', 64), 'global', 'not_applicable',
  'satellite_pass_metadata', 'context', interval '5 minutes',
  interval '3 hours', true, prior.request_params, now()
from core.collection_target_revisions as prior
where prior.public_id = '018f0000-0000-7000-8000-000000000515';

insert into ingest.collection_target_state (
  collection_target_revision_id, collection_target_id
)
select revision.id, revision.collection_target_id
from core.collection_target_revisions as revision
where revision.public_id = '018f0000-0000-7000-8000-000000009302';

insert into ingest.jobs (
  public_id, contract_version, source_id, endpoint_id, collection_target_id,
  collection_target_revision_id, adapter_release_id, idempotency_key
)
select
  '018f0000-0000-7000-8000-000000009303', '1.1.0', target.source_id,
  target.endpoint_id, target.id, revision.id, adapter.id,
  'cmr-catalog-projection-test-job'
from core.collection_targets as target
join core.collection_target_revisions as revision
  on revision.collection_target_id = target.id
join core.adapter_releases as adapter on adapter.source_id = target.source_id
where target.public_id = '018f0000-0000-7000-8000-000000000415'
  and revision.public_id = '018f0000-0000-7000-8000-000000009302'
  and adapter.public_id = '018f0000-0000-7000-8000-000000009301';

set local role firewatch_collector;

select is(
  (select count(*) from ingest.claim_collection_job(
    'cmr-catalog-projection-test-worker', interval '1 hour'
  )),
  1::bigint,
  'collector claims only the fully activated CMR test target'
);

insert into ingest.runs (
  public_id, contract_version, job_id, source_id, endpoint_id,
  collection_target_id, collection_target_revision_id, adapter_release_id,
  lease_token, lease_owner, attempt_no, collector_version
)
select
  '018f0000-0000-7000-8000-000000009304', '1.1.0', job.id,
  job.source_id, job.endpoint_id, job.collection_target_id,
  job.collection_target_revision_id, job.adapter_release_id, job.lease_token,
  job.lease_owner, job.attempt_count, 'cmr-test-collector'
from ingest.jobs as job
where job.public_id = '018f0000-0000-7000-8000-000000009303';

insert into ingest.content_blobs (
  public_id, contract_version, identity_version, content_sha256,
  content_type, byte_size, inline_bytes
)
select
  '018f0000-0000-7000-8000-000000009305', '1.1.0', '2.0.0',
  encode(pg_catalog.sha256(payload.bytes), 'hex'), 'application/json',
  octet_length(payload.bytes), payload.bytes
from (values (convert_to('{"items":[]}', 'UTF8'))) as payload(bytes);

insert into ingest.http_exchanges (
  public_id, contract_version, run_id, source_id, endpoint_id, request_no,
  idempotency_key, request_method, request_url_redacted,
  request_query_safe, request_fingerprint_sha256, request_headers_safe,
  request_metadata_safe
)
select
  page.public_id::core.uuid_v7, '1.1.0', run.id, run.source_id,
  run.endpoint_id, page.request_no, 'cmr-test-call-' || page.request_no,
  'GET',
  'https://cmr.earthdata.nasa.gov/search/granules.umm_json_v1_6_7',
  jsonb_build_object(
    'page_size', 200,
    'provider', 'LANCEMODIS',
    'short_name', page.product,
    'sort_key[]', jsonb_build_array('-start_date', 'granule_ur'),
    'temporal', (now() - interval '36 hours')::text || ',' || now()::text,
    'version', '2'
  ),
  repeat(page.fingerprint, 64),
  jsonb_build_object(
    'accept', 'application/vnd.nasa.cmr.umm_results+json',
    'client-id', 'plomari-wildfire-tracker',
    'x-request-id', 'cmr-test-' || page.request_no
  ),
  jsonb_build_object(
    'page', 1, 'page_size', 200, 'product', page.product, 'scope', 'global'
  )
from ingest.runs as run
cross join (
  values
    ('018f0000-0000-7000-8000-000000009311'::uuid, 1, 'VNP14IMG_NRT', '1'),
    ('018f0000-0000-7000-8000-000000009312'::uuid, 2, 'VJ114IMG_NRT', '2'),
    ('018f0000-0000-7000-8000-000000009313'::uuid, 3, 'VJ214IMG_NRT', '3')
) as page(public_id, request_no, product, fingerprint)
where run.public_id = '018f0000-0000-7000-8000-000000009304';

insert into ingest.raw_objects (
  public_id, contract_version, source_id, endpoint_id, run_id, blob_id,
  content_sha256, idempotency_key, retrieved_at, http_exchange_id
)
select
  raw.public_id::core.uuid_v7, '1.1.0', run.source_id, run.endpoint_id,
  run.id, blob.id, blob.content_sha256,
  'cmr-test-raw-' || exchange.request_no, now(), exchange.id
from ingest.runs as run
join ingest.http_exchanges as exchange on exchange.run_id = run.id
cross join ingest.content_blobs as blob
join (
  values
    (1, '018f0000-0000-7000-8000-000000009321'::uuid),
    (2, '018f0000-0000-7000-8000-000000009322'::uuid),
    (3, '018f0000-0000-7000-8000-000000009323'::uuid)
) as raw(request_no, public_id) on raw.request_no = exchange.request_no
where run.public_id = '018f0000-0000-7000-8000-000000009304'
  and blob.public_id = '018f0000-0000-7000-8000-000000009305';

select ok(
  (select bool_and(ingest.finish_http_exchange(
    p_exchange_id => exchange.id,
    p_run_id => run.id,
    p_lease_token => run.lease_token,
    p_worker_id => run.lease_owner,
    p_outcome => 'response',
    p_http_status => 200::smallint,
    p_response_raw_object_id => raw.id,
    p_response_headers_safe => jsonb_build_object(
      'cmr-hits', case when exchange.request_no = 1 then '1' else '0' end,
      'x-request-id', 'cmr-test-' || exchange.request_no,
      'cmr-time-out', 'false',
      'cmr-timed-out', 'false'
    ),
    p_result_metadata_safe => jsonb_build_object(
      'page', 1, 'page_count', 1, 'terminal', true,
      'partial', false, 'truncated', false,
      'response_body_bytes', 12,
      'provider_request_id', 'cmr-test-' || exchange.request_no
    )
  ))
   from ingest.runs as run
   join ingest.http_exchanges as exchange on exchange.run_id = run.id
   join ingest.raw_objects as raw on raw.http_exchange_id = exchange.id
   where run.public_id = '018f0000-0000-7000-8000-000000009304'),
  'all three CMR product responses terminalize against durable raw evidence'
);

select throws_ok(
  $$
    insert into ingest.cmr_rejections (
      run_id, http_exchange_id, item_index, product, catalog_granule_id,
      cmr_revision_id, reason, lease_token, lease_owner
    )
    select run.id, exchange.id, 0, 'VNP14IMG_NRT', null, null,
      'missing required UMM-G geometry', gen_random_uuid(), run.lease_owner
    from ingest.runs as run
    join ingest.http_exchanges as exchange on exchange.run_id = run.id
    where run.public_id = '018f0000-0000-7000-8000-000000009304'
      and exchange.request_metadata_safe->>'product' = 'VNP14IMG_NRT'
  $$,
  '55000',
  'CMR rejection insertion requires the active fenced run lease',
  'rejected-item evidence is fenced to the exact active collector lease'
);

insert into ingest.source_revisions (
  public_id, contract_version, identity_version, source_id,
  source_record_key, external_id, canonical_url, revision_no, run_id,
  raw_object_id, adapter_release_id, idempotency_key, content_sha256,
  schema_version, observed_at, observed_precision, observed_timezone,
  published_at, published_precision, published_timezone,
  modified_at, modified_precision, modified_timezone, retrieved_at,
  valid_from, valid_to, raw_payload, canonical_data, geom, quality_flags
)
select
  '018f0000-0000-7000-8000-000000009306', '1.1.0', '2.0.0',
  run.source_id, 'cmr-test-granule-G123-LANCEMODIS',
  'G123-LANCEMODIS',
  'https://cmr.earthdata.nasa.gov/search/concepts/G123-LANCEMODIS/7.umm_json_v1_6_7',
  1, run.id, raw.id, run.adapter_release_id, 'cmr-test-source-revision',
  raw.content_sha256, 'cmr-umm-g-1.6.7+test',
  now() - interval '36 hours 5 minutes', 'exact', 'UTC',
  now() - interval '35 hours 50 minutes', 'exact', 'UTC',
  now() - interval '1 minute', 'exact', 'UTC', now(),
  now() - interval '36 hours 5 minutes', now() - interval '35 hours 55 minutes',
  '{"conceptId":"G123-LANCEMODIS","revisionId":7}'::jsonb,
  '{"product":"VNP14IMG_NRT","satellite":"Suomi-NPP"}'::jsonb,
  extensions.st_makeenvelope(26.30, 38.90, 26.50, 39.10, 4326),
  array['catalog_metadata_only', 'anomaly_not_assessed']::text[]
from ingest.runs as run
join ingest.raw_objects as raw
  on raw.run_id = run.id and raw.id = (
    select min(candidate.id) from ingest.raw_objects as candidate
    where candidate.run_id = run.id
  )
where run.public_id = '018f0000-0000-7000-8000-000000009304';

insert into ingest.global_observations (
  public_id, contract_version, identity_version, source_id,
  source_revision_id, idempotency_key, observation_kind, source_record_key,
  observed_at, observed_precision, observed_timezone,
  published_at, published_precision, published_timezone,
  modified_at, modified_precision, modified_timezone, retrieved_at,
  valid_from, valid_to, trust_class, evidence_class, visibility,
  geom, geometry_precision_m, geometry_precision_source,
  validation_state, properties, quality_flags
)
select
  '018f0000-0000-7000-8000-000000009307', '1.1.0', '2.0.0',
  revision.source_id, revision.id, 'cmr-test-observation',
  'satellite_imagery', revision.source_record_key,
  revision.observed_at, 'exact', 'UTC',
  revision.published_at, 'exact', 'UTC',
  revision.modified_at, 'exact', 'UTC', revision.retrieved_at,
  revision.valid_from, revision.valid_to,
  'official_observation', 'satellite_pass_metadata', 'public',
  revision.geom, null, 'not_applicable', 'accepted',
  '{"catalogMetadataOnly":true}'::jsonb,
  array['catalog_metadata_only', 'anomaly_not_assessed']::text[]
from ingest.source_revisions as revision
where revision.public_id = '018f0000-0000-7000-8000-000000009306';

insert into ingest.cmr_granule_details (
  observation_cursor, catalog_granule_id, catalog_collection_id,
  cmr_revision_id, umm_g_version, product, product_version, satellite,
  sensor, observed_to, produced_at, cataloged_at, day_night
)
select
  observation.cursor, 'G123-LANCEMODIS', 'C1886251885-LANCEMODIS', 7,
  '1.6.7', 'VNP14IMG_NRT', '2', 'Suomi-NPP', 'VIIRS',
  observation.valid_to, observation.published_at, observation.modified_at,
  'night'
from ingest.global_observations as observation
where observation.public_id = '018f0000-0000-7000-8000-000000009307';

set constraints ingest.global_observations_require_cmr_granule_detail immediate;
set constraints ingest.global_observations_require_cmr_granule_detail deferred;

insert into ingest.cmr_granule_occurrences (
  run_id, http_exchange_id, item_index, observation_cursor, product,
  catalog_granule_id, cmr_revision_id, lease_token, lease_owner
)
select
  run.id, exchange.id, 0, observation.cursor, 'VNP14IMG_NRT',
  'G123-LANCEMODIS', 7, run.lease_token, run.lease_owner
from ingest.runs as run
join ingest.http_exchanges as exchange on exchange.run_id = run.id
join ingest.global_observations as observation
  on observation.public_id = '018f0000-0000-7000-8000-000000009307'
where run.public_id = '018f0000-0000-7000-8000-000000009304'
  and exchange.request_metadata_safe->>'product' = 'VNP14IMG_NRT';

set local role anon;

select is(
  (select count(*) from api.satellite_passes),
  0::bigint,
  'accepted early-page CMR metadata remains private before global scan completion'
);

select is(
  (select count(*)
   from ingest.global_observations
   where public_id = '018f0000-0000-7000-8000-000000009307'),
  0::bigint,
  'generic public observation access cannot bypass CMR completion gating'
);

reset role;
set local role firewatch_collector;

select ok(
  (select ingest.finish_ingestion_run(
    p_run_id => run.id,
    p_lease_token => run.lease_token,
    p_worker_id => run.lease_owner,
    p_status => 'failed',
    p_http_status => 200::smallint,
    p_item_count => 1,
    p_source_latest_observed_at => null,
    p_request_count => 3,
    p_fetched_count => 1,
    p_accepted_count => 1,
    p_rejected_count => 0,
    p_duplicate_count => 0,
    p_cursor_before => '{}'::jsonb,
    p_error_class => 'upstream',
    p_error_detail_safe => 'Later CMR product failed after the first item was normalized.',
    p_response_meta => '{"terminal":false,"partial":true,"truncated":false}'::jsonb,
    p_retry_at => now()
  )
   from ingest.runs as run
   where run.public_id = '018f0000-0000-7000-8000-000000009304'),
  'first CMR attempt retains normalized evidence but finalizes as failed'
);

reset role;
set local role anon;

select is(
  (select count(*) from api.satellite_passes),
  0::bigint,
  'an occurrence from a failed first attempt remains private'
);

reset role;
set local role firewatch_collector;

select is(
  (select count(*) from ingest.claim_collection_job(
    'cmr-catalog-projection-replay-worker', interval '1 hour'
  )),
  1::bigint,
  'collector reclaims the same CMR job for its replay attempt'
);

insert into ingest.runs (
  public_id, contract_version, job_id, source_id, endpoint_id,
  collection_target_id, collection_target_revision_id, adapter_release_id,
  lease_token, lease_owner, attempt_no, collector_version
)
select
  '018f0000-0000-7000-8000-000000009330', '1.1.0', job.id,
  job.source_id, job.endpoint_id, job.collection_target_id,
  job.collection_target_revision_id, job.adapter_release_id, job.lease_token,
  job.lease_owner, job.attempt_count, 'cmr-test-collector-replay'
from ingest.jobs as job
where job.public_id = '018f0000-0000-7000-8000-000000009303';

insert into ingest.http_exchanges (
  public_id, contract_version, run_id, source_id, endpoint_id, request_no,
  idempotency_key, request_method, request_url_redacted,
  request_query_safe, request_fingerprint_sha256, request_headers_safe,
  request_metadata_safe
)
select
  page.public_id::core.uuid_v7, '1.1.0', run.id, run.source_id,
  run.endpoint_id, page.request_no, 'cmr-replay-call-' || page.request_no,
  'GET',
  'https://cmr.earthdata.nasa.gov/search/granules.umm_json_v1_6_7',
  jsonb_build_object(
    'page_size', 200,
    'provider', 'LANCEMODIS',
    'short_name', page.product,
    'sort_key[]', jsonb_build_array('-start_date', 'granule_ur'),
    'temporal', (now() - interval '36 hours')::text || ',' || now()::text,
    'version', '2'
  ),
  repeat(page.fingerprint, 64),
  jsonb_build_object(
    'accept', 'application/vnd.nasa.cmr.umm_results+json',
    'client-id', 'plomari-wildfire-tracker',
    'x-request-id', 'cmr-replay-' || page.request_no
  ),
  jsonb_build_object(
    'page', 1, 'page_size', 200, 'product', page.product, 'scope', 'global'
  )
from ingest.runs as run
cross join (
  values
    ('018f0000-0000-7000-8000-000000009331'::uuid, 1, 'VNP14IMG_NRT', '4'),
    ('018f0000-0000-7000-8000-000000009332'::uuid, 2, 'VJ114IMG_NRT', '5'),
    ('018f0000-0000-7000-8000-000000009333'::uuid, 3, 'VJ214IMG_NRT', '6')
) as page(public_id, request_no, product, fingerprint)
where run.public_id = '018f0000-0000-7000-8000-000000009330';

insert into ingest.raw_objects (
  public_id, contract_version, source_id, endpoint_id, run_id, blob_id,
  content_sha256, idempotency_key, retrieved_at, http_exchange_id
)
select
  raw.public_id::core.uuid_v7, '1.1.0', run.source_id, run.endpoint_id,
  run.id, blob.id, blob.content_sha256,
  'cmr-replay-raw-' || exchange.request_no, now(), exchange.id
from ingest.runs as run
join ingest.http_exchanges as exchange on exchange.run_id = run.id
cross join ingest.content_blobs as blob
join (
  values
    (1, '018f0000-0000-7000-8000-000000009341'::uuid),
    (2, '018f0000-0000-7000-8000-000000009342'::uuid),
    (3, '018f0000-0000-7000-8000-000000009343'::uuid)
) as raw(request_no, public_id) on raw.request_no = exchange.request_no
where run.public_id = '018f0000-0000-7000-8000-000000009330'
  and blob.public_id = '018f0000-0000-7000-8000-000000009305';

select ok(
  (select bool_and(ingest.finish_http_exchange(
    p_exchange_id => exchange.id,
    p_run_id => run.id,
    p_lease_token => run.lease_token,
    p_worker_id => run.lease_owner,
    p_outcome => 'response',
    p_http_status => 200::smallint,
    p_response_raw_object_id => raw.id,
    p_response_headers_safe => jsonb_build_object(
      'cmr-hits', case when exchange.request_no = 1 then '1' else '0' end,
      'x-request-id', 'cmr-replay-' || exchange.request_no,
      'cmr-time-out', 'false',
      'cmr-timed-out', 'false'
    ),
    p_result_metadata_safe => jsonb_build_object(
      'page', 1, 'page_count', 1, 'terminal', true,
      'partial', false, 'truncated', false,
      'response_body_bytes', 12,
      'provider_request_id', 'cmr-replay-' || exchange.request_no
    )
  ))
   from ingest.runs as run
   join ingest.http_exchanges as exchange on exchange.run_id = run.id
   join ingest.raw_objects as raw on raw.http_exchange_id = exchange.id
   where run.public_id = '018f0000-0000-7000-8000-000000009330'),
  'replay responses retain complete terminal HTTP evidence'
);

select throws_ok(
  $outer$
    do $inner$
    declare
      replay_health_cursor bigint;
      replay_finished boolean;
    begin
      select ingest.finish_ingestion_run(
        p_run_id => run.id,
        p_lease_token => run.lease_token,
        p_worker_id => run.lease_owner,
        p_status => 'success',
        p_http_status => 200::smallint,
        p_item_count => 1,
        p_request_count => 3,
        p_fetched_count => 1,
        p_accepted_count => 0,
        p_rejected_count => 0,
        p_duplicate_count => 1,
        p_cursor_before => '{}'::jsonb,
        p_cursor_after => '{"watermark":"cmr-replay"}'::jsonb,
        p_response_meta => '{"terminal":true,"partial":false,"truncated":false}'::jsonb
      )
      into replay_finished
      from ingest.runs as run
      where run.public_id = '018f0000-0000-7000-8000-000000009330';

      if replay_finished is distinct from true then
        raise exception 'replay fixture did not finalize';
      end if;

      insert into truth.source_health (
        public_id, contract_version, source_id, endpoint_id,
        collection_target_id, collection_target_revision_id, run_id,
        idempotency_key, status, visibility, checked_at, last_success_at,
        geographic_completeness, record_count, schema_failure_count
      )
      select
        '018f0000-0000-7000-8000-000000009308', '1.1.0', run.source_id,
        run.endpoint_id, run.collection_target_id,
        run.collection_target_revision_id, run.id, 'cmr-replay-health',
        'healthy', 'public', now(), now(), 1, 1, 0
      from ingest.runs as run
      where run.public_id = '018f0000-0000-7000-8000-000000009330'
      returning cursor into replay_health_cursor;

      insert into ingest.cmr_scan_completions (
        health_cursor, run_id, scan_kind, requested_from, requested_to,
        watermark_to, completed_products, page_count, upstream_hit_count,
        accepted_granule_count
      ) values (
        replay_health_cursor,
        (select id from ingest.runs
         where public_id = '018f0000-0000-7000-8000-000000009330'),
        'bootstrap', now() - interval '36 hours', now(),
        now() - interval '10 minutes', array[
          'VJ114IMG_NRT', 'VJ214IMG_NRT', 'VNP14IMG_NRT'
        ]::text[], 3, 1, 1
      );
    end;
    $inner$
  $outer$,
  '23514',
  'CMR completion counts must match the durable run, health, and occurrence ledgers',
  'a replay cannot claim completion without a per-run occurrence'
);

insert into ingest.cmr_granule_occurrences (
  run_id, http_exchange_id, item_index, observation_cursor, product,
  catalog_granule_id, cmr_revision_id, lease_token, lease_owner
)
select
  run.id, exchange.id, 0, observation.cursor, 'VNP14IMG_NRT',
  'G123-LANCEMODIS', 7, run.lease_token, run.lease_owner
from ingest.runs as run
join ingest.http_exchanges as exchange on exchange.run_id = run.id
join ingest.global_observations as observation
  on observation.public_id = '018f0000-0000-7000-8000-000000009307'
where run.public_id = '018f0000-0000-7000-8000-000000009330'
  and exchange.request_metadata_safe->>'product' = 'VNP14IMG_NRT';

select ok(
  (select ingest.finish_ingestion_run(
    p_run_id => run.id,
    p_lease_token => run.lease_token,
    p_worker_id => run.lease_owner,
    p_status => 'success',
    p_http_status => 200::smallint,
    p_item_count => 1,
    p_request_count => 3,
    p_fetched_count => 1,
    p_accepted_count => 0,
    p_rejected_count => 0,
    p_duplicate_count => 1,
    p_cursor_before => '{}'::jsonb,
    p_cursor_after => '{"watermark":"cmr-replay"}'::jsonb,
    p_response_meta => '{"terminal":true,"partial":false,"truncated":false}'::jsonb
  )
   from ingest.runs as run
   where run.public_id = '018f0000-0000-7000-8000-000000009330'),
  'completed replay finalizes with duplicate accounting and occurrence proof'
);

insert into truth.source_health (
  public_id, contract_version, source_id, endpoint_id,
  collection_target_id, collection_target_revision_id, run_id,
  idempotency_key, status, visibility, checked_at, last_success_at,
  geographic_completeness, record_count, schema_failure_count
)
select
  '018f0000-0000-7000-8000-000000009308', '1.1.0', run.source_id,
  run.endpoint_id, run.collection_target_id, run.collection_target_revision_id,
  run.id, 'cmr-replay-health', 'healthy', 'public', now(), now(), 1, 1, 0
from ingest.runs as run
where run.public_id = '018f0000-0000-7000-8000-000000009330';

insert into ingest.cmr_scan_completions (
  health_cursor, run_id, scan_kind, requested_from, requested_to,
  watermark_to, completed_products, page_count, upstream_hit_count,
  accepted_granule_count
)
select
  health.cursor, health.run_id, 'bootstrap', now() - interval '36 hours',
  now(), now() - interval '10 minutes', array[
    'VJ114IMG_NRT', 'VJ214IMG_NRT', 'VNP14IMG_NRT'
  ]::text[], 3, 1, 1
from truth.source_health as health
where health.public_id = '018f0000-0000-7000-8000-000000009308';

select throws_ok(
  $$set constraints ingest.cmr_scan_completions_require_product_set immediate$$,
  '23514',
  'CMR completion requires all three product page chains and matching aggregate counts',
  'a caller-asserted scan completion is rejected without three product proofs'
);

select throws_ok(
  $$
    insert into ingest.cmr_scan_product_completions (
      health_cursor, product, page_count, upstream_hit_count,
      accepted_granule_count
    )
    select cursor, 'VNP14IMG_NRT', 2, 1, 1
    from truth.source_health
    where public_id = '018f0000-0000-7000-8000-000000009308'
  $$,
  '23514',
  'nonterminal CMR product pages must provide their next cursor',
  'a skipped or falsely extended page chain cannot authorize completeness'
);

reset role;

alter table ingest.http_exchanges
  disable trigger http_exchanges_validate_transition;
update ingest.http_exchanges as exchange
set response_headers_safe = exchange.response_headers_safe - 'x-request-id'
from ingest.runs as run
where exchange.run_id = run.id
  and run.public_id = '018f0000-0000-7000-8000-000000009330'
  and exchange.request_metadata_safe->>'product' = 'VNP14IMG_NRT';
alter table ingest.http_exchanges
  enable trigger http_exchanges_validate_transition;

set local role firewatch_collector;

select throws_ok(
  $$
    insert into ingest.cmr_scan_product_completions (
      health_cursor, product, page_count, upstream_hit_count,
      accepted_granule_count
    )
    select cursor, 'VNP14IMG_NRT', 1, 1, 1
    from truth.source_health
    where public_id = '018f0000-0000-7000-8000-000000009308'
  $$,
  '23514',
  'CMR product page is not a successful complete response in the stable query envelope',
  'omitting both reviewed provider request-id headers fails closed'
);

reset role;

alter table ingest.http_exchanges
  disable trigger http_exchanges_validate_transition;
update ingest.http_exchanges as exchange
set response_headers_safe = exchange.response_headers_safe
  || jsonb_build_object('x-request-id', 'cmr-replay-' || exchange.request_no)
from ingest.runs as run
where exchange.run_id = run.id
  and run.public_id = '018f0000-0000-7000-8000-000000009330'
  and exchange.request_metadata_safe->>'product' = 'VNP14IMG_NRT';
alter table ingest.http_exchanges
  enable trigger http_exchanges_validate_transition;

set local role firewatch_collector;

insert into ingest.cmr_scan_product_completions (
  health_cursor, product, page_count, upstream_hit_count,
  accepted_granule_count
)
select
  health.cursor, product.name, 1, product.hits, product.accepted
from truth.source_health as health
cross join (
  values
    ('VNP14IMG_NRT'::text, 1::bigint, 1::bigint),
    ('VJ114IMG_NRT'::text, 0::bigint, 0::bigint),
    ('VJ214IMG_NRT'::text, 0::bigint, 0::bigint)
) as product(name, hits, accepted)
where health.public_id = '018f0000-0000-7000-8000-000000009308';

set constraints ingest.cmr_scan_completions_require_product_set immediate;
set constraints ingest.cmr_scan_completions_require_product_set deferred;

reset role;

set local role anon;

select ok(
  (select
     scan_kind = 'bootstrap'
     and baseline_health_id = scan_health_id
     and predecessor_health_id is null
     and lineage_depth = 0
     and is_current
     and covers_requested_window
     and valid_empty_eligible
     and anomaly_assessment = 'not_assessed'
   from api.satellite_scan_status_for_window(
     now() - interval '36 hours', now()
   )),
  'complete current baseline authorizes coverage only for its exact requested window'
);

select is(
  (select count(*) from api.satellite_passes_for_cell(
    7, 73, 48, now() - interval '36 hours', now(), 20
  )),
  1::bigint,
  'cell RPC uses temporal interval overlap and exact PostGIS intersection'
);

select ok(
  (select
     observation_id = '018f0000-0000-7000-8000-000000009307'::uuid
     and footprint_geojson->>'type' in ('Polygon', 'MultiPolygon')
     and footprint_basis = 'cmr_catalog_metadata'
     and anomaly_assessment = 'not_assessed'
     and spatial_relationship = 'catalog_footprint_intersection'
   from api.satellite_passes_for_cell(
     7, 73, 48, now() - interval '36 hours', now(), 20
   )),
  'localized pass output exposes public identities, GeoJSON, and non-anomaly semantics'
);

select is(
  (select count(*) from api.satellite_passes_for_cell(
    7, 0, 0, now() - interval '36 hours', now(), 20
  )),
  0::bigint,
  'a nonintersecting cell returns no sentinel or fabricated observation'
);

reset role;

select ok(
  (select count(*) = 1
   from ingest.source_revisions
   where external_id = 'G123-LANCEMODIS')
  and (select count(*) = 1
       from ingest.global_observations
       where public_id = '018f0000-0000-7000-8000-000000009307')
  and (select count(*) = 1
       from ingest.cmr_granule_details
       where catalog_granule_id = 'G123-LANCEMODIS'
         and cmr_revision_id = 7),
  'successful replay reuses one immutable revision, observation, and typed detail'
);

select ok(
  (select count(*) = 2
   from ingest.cmr_granule_occurrences as occurrence
   join ingest.runs as run on run.id = occurrence.run_id
   where occurrence.observation_cursor = (
     select observation.cursor
     from ingest.global_observations as observation
     where observation.public_id = '018f0000-0000-7000-8000-000000009307'
   )
     and run.status in ('failed', 'success'))
  and (select count(*) = 1
       from ingest.cmr_granule_occurrences as occurrence
       join ingest.runs as run on run.id = occurrence.run_id
       where occurrence.observation_cursor = (
         select observation.cursor
         from ingest.global_observations as observation
         where observation.public_id = '018f0000-0000-7000-8000-000000009307'
       )
         and run.status = 'failed')
  and (select count(*) = 1
       from ingest.cmr_granule_occurrences as occurrence
       join ingest.runs as run on run.id = occurrence.run_id
       where occurrence.observation_cursor = (
         select observation.cursor
         from ingest.global_observations as observation
         where observation.public_id = '018f0000-0000-7000-8000-000000009307'
       )
         and run.status = 'success'),
  'append-only occurrences retain both the failed attempt and successful replay'
);

select ok(
  (select run.status = 'failed'
   from ingest.global_observations as observation
   join ingest.source_revisions as revision
     on revision.id = observation.source_revision_id
   join ingest.runs as run on run.id = revision.run_id
   where observation.public_id = '018f0000-0000-7000-8000-000000009307')
  and ingest.cmr_observation_is_publishable(
    (select observation.cursor
     from ingest.global_observations as observation
     where observation.public_id = '018f0000-0000-7000-8000-000000009307')
  ),
  'completed replay publishes the original failed-run observation through occurrence proof'
);

select throws_ok(
  $$
    update ingest.cmr_granule_occurrences
    set recorded_at = recorded_at
    where run_id = (
      select id from ingest.runs
      where public_id = '018f0000-0000-7000-8000-000000009330'
    )
  $$,
  '55000',
  'ingest.cmr_granule_occurrences rows are immutable; append a successor revision',
  'occurrence provenance is append-only even for privileged callers'
);

select ok(
  strpos(
    pg_get_functiondef('ingest.validate_cmr_scan_completion()'::regprocedure),
    'new.updated_since is distinct from new.watermark_from'
  ) > 0,
  'incremental updated_since is exactly the predecessor continuity watermark'
);

select ok(
  strpos(
    pg_get_functiondef('ingest.validate_cmr_scan_completion()'::regprocedure),
    'new.watermark_to is distinct from new.requested_to - interval ''10 minutes'''
  ) > 0,
  'every complete scan retains the configured ten-minute replay watermark lag'
);

select ok(
  strpos(
    pg_get_functiondef('ingest.validate_cmr_scan_completion()'::regprocedure),
    'from ingest.cmr_rejections as rejection'
  ) > 0,
  'any durable item rejection independently blocks complete-scan evidence'
);

select ok(
  strpos(
    pg_get_functiondef('ingest.validate_cmr_scan_completion()'::regprocedure),
    'observation.validation_state <> ''accepted'''
  ) > 0,
  'quarantined granule metadata independently blocks complete-scan evidence'
);

select * from finish();
rollback;
