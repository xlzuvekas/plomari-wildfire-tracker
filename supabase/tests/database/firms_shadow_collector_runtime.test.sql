begin;

create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public, pg_catalog;

select no_plan();

select ok(
  to_regprocedure(
    'ingest.claim_firms_collection_job_exact(bigint,text,interval)'
  ) is not null
  and to_regprocedure(
    'ingest.abandon_pending_firms_http_exchanges(bigint,uuid,text,text)'
  ) is not null
  and to_regprocedure(
    'ingest.reap_expired_firms_collection_job(core.uuid_v7)'
  ) is not null
  and to_regprocedure(
    'ingest.firms_shadow_job_input_is_valid_v1(jsonb)'
  ) is not null,
  'FIRMS shadow runtime installs exact claim, abandonment, reaper, and input validation RPCs'
);

select ok(
  (select prosecdef from pg_proc
   where oid = 'ingest.claim_firms_collection_job_exact(bigint,text,interval)'::regprocedure)
  and (select prosecdef from pg_proc
   where oid = 'ingest.abandon_pending_firms_http_exchanges(bigint,uuid,text,text)'::regprocedure)
  and (select prosecdef from pg_proc
   where oid = 'ingest.reap_expired_firms_collection_job(core.uuid_v7)'::regprocedure)
  and (select proconfig @> array['search_path=""'] from pg_proc
   where oid = 'ingest.claim_firms_collection_job_exact(bigint,text,interval)'::regprocedure)
  and (select proconfig @> array['search_path=""'] from pg_proc
   where oid = 'ingest.abandon_pending_firms_http_exchanges(bigint,uuid,text,text)'::regprocedure)
  and (select proconfig @> array['search_path=""'] from pg_proc
   where oid = 'ingest.reap_expired_firms_collection_job(core.uuid_v7)'::regprocedure),
  'FIRMS lease RPCs are security definer with an empty search path'
);

select ok(
  has_function_privilege(
    'firewatch_collector',
    'ingest.claim_firms_collection_job_exact(bigint,text,interval)',
    'EXECUTE'
  )
  and has_function_privilege(
    'firewatch_collector',
    'ingest.abandon_pending_firms_http_exchanges(bigint,uuid,text,text)',
    'EXECUTE'
  )
  and has_function_privilege(
    'firewatch_collector',
    'ingest.reap_expired_firms_collection_job(core.uuid_v7)',
    'EXECUTE'
  )
  and not has_function_privilege(
    'service_role',
    'ingest.claim_firms_collection_job_exact(bigint,text,interval)',
    'EXECUTE'
  )
  and not has_function_privilege(
    'anon',
    'ingest.reap_expired_firms_collection_job(core.uuid_v7)',
    'EXECUTE'
  ),
  'only the collector capability can execute FIRMS lease RPCs'
);

select has_column(
  'ingest', 'firms_response_rows', 'source_row_number',
  'FIRMS response occurrences preserve their CSV source row number'
);
select has_column(
  'ingest', 'firms_response_rows', 'rejection_reasons',
  'FIRMS response occurrences preserve the complete parser reason set'
);
select has_column(
  'ingest', 'firms_query_product_results', 'failure_code',
  'FIRMS product results preserve a typed failure code'
);

select ok(
  ingest.firms_shadow_job_input_is_valid_v1('{
    "collector":"firms_shadow",
    "plan":{
      "area":{"east":27.100000,"north":39.000000,"south":38.900000,"west":27.000000},
      "areaToken":"27.000000,38.900000,27.100000,39.000000",
      "coverage":"requested-bbox-only",
      "dateFrom":"2026-07-31",
      "dateRequestMode":"explicit-starting-on",
      "dateTo":"2026-07-31",
      "dayCount":1,
      "kind":"firms-shadow-plan-v1",
      "negativeAssessmentEligible":false,
      "planKey":"firms-shadow-v1:27.000000,38.900000,27.100000,39.000000:2026-07-31:1",
      "products":["MODIS_NRT","VIIRS_NOAA20_NRT","VIIRS_NOAA21_NRT","VIIRS_SNPP_NRT"],
      "scheduledFor":"2026-07-31T12:00:00.000Z",
      "sensorAssessability":"unknown"
    }
  }'::jsonb)
  and not ingest.firms_shadow_job_input_is_valid_v1('{
    "collector":"firms_shadow",
    "mapKey":"must-never-be-durable",
    "plan":{}
  }'::jsonb),
  'job input admits one exact bounded credential-free plan and rejects secret-shaped drift'
);

select is(
  (select count(*) from ingest.claim_firms_collection_job_exact(
    -1, 'pgTAP FIRMS worker', interval '150 seconds'
  )),
  0::bigint,
  'an unknown FIRMS job cannot claim unrelated queue work'
);

select throws_ok(
  $$select ingest.abandon_pending_firms_http_exchanges(
    -1,
    '018f0000-0000-7000-8000-000000009901'::uuid,
    'pgTAP FIRMS worker',
    'operator-supplied-detail'
  )$$,
  '22023',
  'invalid FIRMS exchange-abandon request',
  'FIRMS exchange abandonment accepts only the fixed safe taxonomy'
);

select ok(
  exists (
    select 1 from core.sources as source
    join core.endpoints as endpoint on endpoint.source_id = source.id
    join ingest.endpoint_state as endpoint_state
      on endpoint_state.endpoint_id = endpoint.id
    join core.collection_targets as target on target.source_id = source.id
    join core.collection_target_revisions as revision
      on revision.collection_target_id = target.id
    join core.adapter_releases as adapter on adapter.source_id = source.id
    join ingest.adapter_release_state as adapter_state
      on adapter_state.adapter_release_id = adapter.id
    where source.slug = 'nasa-firms' and not source.enabled
      and source.license_status = 'unreviewed'
      and endpoint.endpoint_key = 'area-csv' and not endpoint_state.enabled
      and target.target_key = 'global-discovery' and not target.enabled
      and revision.public_id = '018f0000-0000-7000-8000-000000000702'
      and not revision.enabled
      and adapter.public_id = '018f0000-0000-7000-8000-000000000701'
      and not adapter_state.enabled
  ),
  'the shipped FIRMS source, endpoint, target, revision, and adapter are inert'
);

-- Activate only inside this rolled-back pgTAP transaction, then prove the
-- exact claim and abandonment fence with a real job/run/issuance row.
update core.sources
set enabled = true, license_status = 'approved',
    commercial_use_allowed = true, redistribution_allowed = true
where slug = 'nasa-firms';

update ingest.endpoint_state
set enabled = true, paused_reason = null
where endpoint_id = (
  select endpoint.id from core.endpoints as endpoint
  join core.sources as source on source.id = endpoint.source_id
  where source.slug = 'nasa-firms' and endpoint.endpoint_key = 'area-csv'
);

update core.collection_targets
set enabled = true
where public_id = '018f0000-0000-7000-8000-000000000401';

update core.firms_products
set license_status = 'approved', enabled = true
where source_id = (select id from core.sources where slug = 'nasa-firms');

update ingest.adapter_release_state
set enabled = true
where adapter_release_id = (
  select id from core.adapter_releases
  where public_id = '018f0000-0000-7000-8000-000000000701'
);

insert into core.collection_target_revisions (
  public_id, contract_version, identity_version, collection_target_id,
  endpoint_id, version_no, previous_revision_id, target_kind,
  configuration_sha256, scope, geometry_precision_source, claim_kind,
  operational_role, cadence, stale_after, enabled, request_params,
  effective_at
)
select
  '018f0000-0000-7000-8000-000000009902', '1.1.0', '2.0.0',
  prior.collection_target_id, prior.endpoint_id, 3, prior.id, prior.target_kind,
  prior.configuration_sha256, prior.scope, prior.geometry_precision_source,
  prior.claim_kind, prior.operational_role, prior.cadence, prior.stale_after,
  true, prior.request_params, prior.effective_at
from core.collection_target_revisions as prior
where prior.public_id = '018f0000-0000-7000-8000-000000000702';

insert into ingest.collection_target_state (
  collection_target_revision_id, collection_target_id
)
select revision.id, revision.collection_target_id
from core.collection_target_revisions as revision
where revision.public_id = '018f0000-0000-7000-8000-000000009902';

insert into ingest.jobs (
  public_id, contract_version, source_id, endpoint_id,
  collection_target_id, collection_target_revision_id,
  adapter_release_id, idempotency_key, scheduled_for,
  available_at, max_attempts, input
)
select
  '018f0000-0000-7000-8000-000000009903', '1.1.0', source.id,
  endpoint.id, target.id, revision.id, adapter.id,
  'pgtap-firms-shadow-claim',
  timestamptz '2026-07-31 12:00:00+00', now(), 3,
  '{
    "collector":"firms_shadow",
    "plan":{
      "area":{"east":27.100000,"north":39.000000,"south":38.900000,"west":27.000000},
      "areaToken":"27.000000,38.900000,27.100000,39.000000",
      "coverage":"requested-bbox-only",
      "dateFrom":"2026-07-31",
      "dateRequestMode":"explicit-starting-on",
      "dateTo":"2026-07-31",
      "dayCount":1,
      "kind":"firms-shadow-plan-v1",
      "negativeAssessmentEligible":false,
      "planKey":"firms-shadow-v1:27.000000,38.900000,27.100000,39.000000:2026-07-31:1",
      "products":["MODIS_NRT","VIIRS_NOAA20_NRT","VIIRS_NOAA21_NRT","VIIRS_SNPP_NRT"],
      "scheduledFor":"2026-07-31T12:00:00.000Z",
      "sensorAssessability":"unknown"
    }
  }'::jsonb
from core.sources as source
join core.endpoints as endpoint on endpoint.source_id = source.id
join core.collection_targets as target on target.endpoint_id = endpoint.id
join core.collection_target_revisions as revision
  on revision.collection_target_id = target.id
join core.adapter_releases as adapter on adapter.source_id = source.id
where source.slug = 'nasa-firms' and endpoint.endpoint_key = 'area-csv'
  and target.target_key = 'global-discovery'
  and revision.public_id = '018f0000-0000-7000-8000-000000009902'
  and adapter.public_id = '018f0000-0000-7000-8000-000000000701';

select is(
  (select count(*) from ingest.claim_firms_collection_job_exact(
    (select id from ingest.jobs
      where public_id = '018f0000-0000-7000-8000-000000009903'),
    'pgTAP FIRMS worker', interval '150 seconds'
  )),
  1::bigint,
  'the exact fully activated bounded FIRMS job can be claimed once'
);

insert into ingest.runs (
  public_id, contract_version, job_id, source_id, endpoint_id,
  collection_target_id, collection_target_revision_id,
  adapter_release_id, lease_token, lease_owner, attempt_no,
  collector_version, cursor_before, request_meta
)
select
  '018f0000-0000-7000-8000-000000009904', '1.1.0', job.id,
  job.source_id, job.endpoint_id, job.collection_target_id,
  job.collection_target_revision_id, job.adapter_release_id,
  job.lease_token, job.lease_owner, job.attempt_count,
  'firms-shadow-runtime@1.0.0', '{}'::jsonb,
  '{"operation":"firms_area_csv_shadow","scope":"bounded_area"}'::jsonb
from ingest.jobs as job
where job.public_id = '018f0000-0000-7000-8000-000000009903';

insert into ingest.http_exchanges (
  public_id, contract_version, run_id, source_id, endpoint_id,
  request_no, idempotency_key, request_method, request_url_redacted,
  request_query_safe, request_fingerprint_sha256,
  request_headers_safe, request_metadata_safe
)
select
  '018f0000-0000-7000-8000-000000009905', '1.1.0', run.id,
  run.source_id, run.endpoint_id, 1, 'pgtap-firms-http-1', 'GET',
  'https://firms.modaps.eosdis.nasa.gov/api/area/csv',
  '{
    "area":"27.000000,38.900000,27.100000,39.000000",
    "date":"2026-07-31/1",
    "product":"MODIS_NRT"
  }'::jsonb,
  repeat('a', 64), '{"accept":"text/csv"}'::jsonb,
  '{
    "issued_at":"2026-07-31T12:00:00.000Z",
    "operation":"firms-area-csv",
    "product":"MODIS_NRT",
    "scope":"geographic-area"
  }'::jsonb
from ingest.runs as run
where run.public_id = '018f0000-0000-7000-8000-000000009904';

select throws_ok(
  $$select ingest.abandon_pending_firms_http_exchanges(
    (select id from ingest.runs
      where public_id = '018f0000-0000-7000-8000-000000009904'),
    '018f0000-0000-7000-8000-000000009999'::uuid,
    'pgTAP FIRMS worker', 'database'
  )$$,
  '55000',
  'FIRMS exchange abandonment requires the active job lease',
  'a stale FIRMS lease cannot terminalize an issued exchange'
);

select is(
  ingest.abandon_pending_firms_http_exchanges(
    (select id from ingest.runs
      where public_id = '018f0000-0000-7000-8000-000000009904'),
    (select lease_token from ingest.jobs
      where public_id = '018f0000-0000-7000-8000-000000009903'),
    'pgTAP FIRMS worker', 'database'
  ),
  1,
  'the active FIRMS lease closes exactly one pending issuance without response material'
);

select * from finish();
rollback;
