begin;

create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public, pg_catalog;

select no_plan();

select ok(
  to_regprocedure(
    'ingest.claim_cmr_collection_job_exact(bigint,text,interval)'
  ) is not null
  and to_regprocedure(
    'ingest.abandon_pending_cmr_http_exchanges(bigint,uuid,text,text)'
  ) is not null
  and to_regprocedure(
    'ingest.reap_expired_cmr_collection_job(core.uuid_v7)'
  ) is not null,
  'CMR runtime has exact claim, exchange terminalization, and hard-crash recovery RPCs'
);

select ok(
  (select prosecdef
   from pg_proc
   where oid = 'ingest.claim_cmr_collection_job_exact(bigint,text,interval)'::regprocedure)
  and (select prosecdef
       from pg_proc
       where oid = 'ingest.abandon_pending_cmr_http_exchanges(bigint,uuid,text,text)'::regprocedure)
  and (select prosecdef
       from pg_proc
       where oid = 'ingest.reap_expired_cmr_collection_job(core.uuid_v7)'::regprocedure)
  and (select proconfig @> array['search_path=""']
       from pg_proc
       where oid = 'ingest.claim_cmr_collection_job_exact(bigint,text,interval)'::regprocedure)
  and (select proconfig @> array['search_path=""']
       from pg_proc
       where oid = 'ingest.abandon_pending_cmr_http_exchanges(bigint,uuid,text,text)'::regprocedure)
  and (select proconfig @> array['search_path=""']
       from pg_proc
       where oid = 'ingest.reap_expired_cmr_collection_job(core.uuid_v7)'::regprocedure),
  'CMR runtime RPCs are security definer with an empty search path'
);

select ok(
  has_function_privilege(
    'firewatch_collector',
    'ingest.claim_cmr_collection_job_exact(bigint,text,interval)',
    'EXECUTE'
  )
  and has_function_privilege(
    'firewatch_collector',
    'ingest.abandon_pending_cmr_http_exchanges(bigint,uuid,text,text)',
    'EXECUTE'
  )
  and has_function_privilege(
    'firewatch_collector',
    'ingest.reap_expired_cmr_collection_job(core.uuid_v7)',
    'EXECUTE'
  )
  and not has_function_privilege(
    'service_role',
    'ingest.claim_cmr_collection_job_exact(bigint,text,interval)',
    'EXECUTE'
  )
  and not has_function_privilege(
    'service_role',
    'ingest.abandon_pending_cmr_http_exchanges(bigint,uuid,text,text)',
    'EXECUTE'
  )
  and not has_function_privilege(
    'service_role',
    'ingest.reap_expired_cmr_collection_job(core.uuid_v7)',
    'EXECUTE'
  )
  and not has_function_privilege(
    'anon',
    'ingest.claim_cmr_collection_job_exact(bigint,text,interval)',
    'EXECUTE'
  )
  and not has_function_privilege(
    'authenticated',
    'ingest.abandon_pending_cmr_http_exchanges(bigint,uuid,text,text)',
    'EXECUTE'
  ),
  'only the collector capability can execute the CMR runtime RPCs'
);

select ok(
  ingest.http_safe_map_is_allowed(
    '{"updated_since":"2026-07-30T12:20:00.000Z"}'::jsonb,
    'request_query'
  )
  and ingest.http_safe_map_is_allowed(
    '{"cmr-time-out":"true"}'::jsonb,
    'response_header'
  )
  and ingest.http_safe_map_is_allowed(
    '{"cmr-timed-out":"true"}'::jsonb,
    'response_header'
  )
  and not ingest.http_safe_map_is_allowed(
    '{"api_key":"must-never-be-evidence"}'::jsonb,
    'request_query'
  ),
  'HTTP evidence admits CMR incremental and timeout fields while rejecting unsafe keys'
);

select ok(
  pg_get_functiondef(
    'ingest.claim_cmr_collection_job_exact(bigint,text,interval)'::regprocedure
  ) ilike '%job.status = ''pending''%'
  and pg_get_functiondef(
    'ingest.claim_cmr_collection_job_exact(bigint,text,interval)'::regprocedure
  ) ilike '%job.attempt_count = 0%'
  and pg_get_functiondef(
    'ingest.claim_cmr_collection_job_exact(bigint,text,interval)'::regprocedure
  ) ilike '%job.max_attempts = 1%'
  and pg_get_functiondef(
    'ingest.claim_cmr_collection_job_exact(bigint,text,interval)'::regprocedure
  ) ilike '%job.available_at <= now()%'
  and pg_get_functiondef(
    'ingest.claim_cmr_collection_job_exact(bigint,text,interval)'::regprocedure
  ) ilike '%source.slug = ''nasa-cmr-firemask''%'
  and pg_get_functiondef(
    'ingest.claim_cmr_collection_job_exact(bigint,text,interval)'::regprocedure
  ) ilike '%adapter.schema_version = ''cmr-umm-g-1.6.7-pass-v1''%'
  and pg_get_functiondef(
    'ingest.claim_cmr_collection_job_exact(bigint,text,interval)'::regprocedure
  ) ilike '%revision.request_params =%'
  and pg_get_functiondef(
    'ingest.claim_cmr_collection_job_exact(bigint,text,interval)'::regprocedure
  ) ilike '%revision.geometry_precision_source = ''not_applicable''%'
  and pg_get_functiondef(
    'ingest.claim_cmr_collection_job_exact(bigint,text,interval)'::regprocedure
  ) ilike '%p_lease_for <= interval ''150 seconds''%'
  and pg_get_functiondef(
    'ingest.abandon_pending_cmr_http_exchanges(bigint,uuid,text,text)'::regprocedure
  ) ilike '%exchange.outcome = ''pending''%'
  and pg_get_functiondef(
    'ingest.abandon_pending_cmr_http_exchanges(bigint,uuid,text,text)'::regprocedure
  ) ilike '%job.lease_expires_at > now()%'
  and pg_get_functiondef(
    'ingest.abandon_pending_cmr_http_exchanges(bigint,uuid,text,text)'::regprocedure
  ) ilike '%for update of job%'
  and pg_get_functiondef(
    'ingest.abandon_pending_cmr_http_exchanges(bigint,uuid,text,text)'::regprocedure
  ) ilike '%for update of run%'
  ,
  'claim and abandonment definitions remain one-attempt, CMR-only, bounded, and lease fenced'
);

select is(
  (
    select count(*)
    from ingest.claim_cmr_collection_job_exact(
      -1,
      'pgTAP CMR runtime worker',
      interval '150 seconds'
    )
  ),
  0::bigint,
  'an unknown job identity cannot claim unrelated queued work'
);

select throws_ok(
  $$select ingest.abandon_pending_cmr_http_exchanges(
    -1,
    '018f0000-0000-7000-8000-000000009901'::uuid,
    'pgTAP CMR runtime worker',
    'operator-supplied-detail'
  )$$,
  '22023',
  'invalid CMR exchange-abandon request',
  'exchange abandonment accepts only the fixed safe failure taxonomy'
);

select throws_ok(
  $$select ingest.abandon_pending_cmr_http_exchanges(
    -1,
    '018f0000-0000-7000-8000-000000009901'::uuid,
    'pgTAP CMR runtime worker',
    'database'
  )$$,
  '55000',
  'CMR run identity did not resolve',
  'exchange abandonment cannot target an unknown or non-CMR run'
);

-- Simulate an Edge runtime killed after its exact job/run claim and after an
-- HTTP issuance commit. Everything is rolled back with this pgTAP file.
update core.sources
set enabled = true
where slug = 'nasa-cmr-firemask';

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
    and endpoint.endpoint_key = 'granules-umm-g-1-6-7'
);

insert into core.adapter_releases (
  public_id, contract_version, source_id, release_no, version_label,
  artifact_digest, git_commit, schema_version, released_at,
  capabilities, config_schema
)
select
  '018f0000-0000-7000-8000-000000009901', '1.1.0', source.id, 1,
  'cmr-runtime-reaper-test@1.0.0', repeat('d', 64), repeat('e', 40),
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
where adapter.public_id = '018f0000-0000-7000-8000-000000009901';

insert into core.collection_target_revisions (
  public_id, contract_version, identity_version, collection_target_id,
  endpoint_id, version_no, previous_revision_id, target_kind,
  configuration_sha256, scope, geometry_precision_source, claim_kind,
  operational_role, cadence, stale_after, enabled, request_params,
  effective_at
)
select
  '018f0000-0000-7000-8000-000000009902', '1.1.0', '2.0.0',
  prior.collection_target_id, prior.endpoint_id, 2, prior.id, 'global',
  repeat('f', 64), 'global', 'not_applicable',
  'satellite_pass_metadata', 'context', interval '5 minutes',
  interval '3 hours', true, prior.request_params, now()
from core.collection_target_revisions as prior
where prior.public_id = '018f0000-0000-7000-8000-000000000515';

insert into ingest.collection_target_state (
  collection_target_revision_id, collection_target_id
)
select revision.id, revision.collection_target_id
from core.collection_target_revisions as revision
where revision.public_id = '018f0000-0000-7000-8000-000000009902';

update ingest.collection_target_state as state
set last_succeeded_at = now() - interval '10 minutes'
from core.collection_target_revisions as revision
where revision.public_id = '018f0000-0000-7000-8000-000000009902'
  and state.collection_target_revision_id = revision.id
  and state.collection_target_id = revision.collection_target_id;

insert into ingest.jobs (
  public_id, contract_version, source_id, endpoint_id, collection_target_id,
  collection_target_revision_id, adapter_release_id, idempotency_key,
  max_attempts, input
)
select
  '018f0000-0000-7000-8000-000000009903', '1.1.0', target.source_id,
  target.endpoint_id, target.id, revision.id, adapter.id,
  'cmr-runtime-kill-slot', 1,
  '{"collector":"cmr_firemask_catalog","plan":{"harvestKey":"cmr-runtime-kill-slot"}}'::jsonb
from core.collection_targets as target
join core.collection_target_revisions as revision
  on revision.collection_target_id = target.id
join core.adapter_releases as adapter on adapter.source_id = target.source_id
where target.public_id = '018f0000-0000-7000-8000-000000000415'
  and revision.public_id = '018f0000-0000-7000-8000-000000009902'
  and adapter.public_id = '018f0000-0000-7000-8000-000000009901';

select is(
  (
    select count(*)
    from ingest.claim_cmr_collection_job_exact(
      (select id from ingest.jobs
       where public_id = '018f0000-0000-7000-8000-000000009903'),
      'pgTAP killed CMR worker',
      interval '150 seconds'
    )
  ),
  1::bigint,
  'kill fixture claims the exact one-attempt CMR slot'
);

insert into ingest.runs (
  public_id, contract_version, job_id, source_id, endpoint_id,
  collection_target_id, collection_target_revision_id, adapter_release_id,
  lease_token, lease_owner, attempt_no, collector_version, cursor_before,
  request_meta
)
select
  '018f0000-0000-7000-8000-000000009904', '1.1.0', job.id,
  job.source_id, job.endpoint_id, job.collection_target_id,
  job.collection_target_revision_id, job.adapter_release_id,
  job.lease_token, job.lease_owner, job.attempt_count,
  'cmr-runtime-reaper-test@1.0.0', '{}'::jsonb,
  '{"operation":"cmr_firemask_catalog","scope":"global"}'::jsonb
from ingest.jobs as job
where job.public_id = '018f0000-0000-7000-8000-000000009903';

insert into ingest.http_exchanges (
  public_id, contract_version, run_id, source_id, endpoint_id, request_no,
  idempotency_key, request_method, request_url_redacted,
  request_query_safe, request_fingerprint_sha256, request_headers_safe,
  request_metadata_safe
)
select
  '018f0000-0000-7000-8000-000000009905', '1.1.0', run.id,
  run.source_id, run.endpoint_id, 1, 'cmr-runtime-killed-http-1', 'GET',
  'https://cmr.earthdata.nasa.gov/search/granules.umm_json_v1_6_7',
  '{"updated_since":"2026-07-30T12:20:00.000Z"}'::jsonb,
  repeat('1', 64), '{}'::jsonb,
  '{"operation":"cmr_firemask_catalog","page":1,"scope":"global"}'::jsonb
from ingest.runs as run
where run.public_id = '018f0000-0000-7000-8000-000000009904';

update ingest.jobs
set lease_expires_at = now() - interval '1 second'
where public_id = '018f0000-0000-7000-8000-000000009903';

select ok(
  ingest.reap_expired_cmr_collection_job(
    '018f0000-0000-7000-8000-000000009906'
  ) is not null,
  'the next invocation atomically reaps the killed exact CMR execution'
);

select ok(
  (select
     job.status = 'failed'
     and job.lease_token is null
     and job.completed_at is not null
   from ingest.jobs as job
   where job.public_id = '018f0000-0000-7000-8000-000000009903')
  and (select
     run.status = 'failed'
     and run.finished_at is not null
     and run.request_count = 1
     and run.error_class = 'database'
   from ingest.runs as run
   where run.public_id = '018f0000-0000-7000-8000-000000009904')
  and (select
     exchange.outcome = 'indeterminate'
     and exchange.error_class = 'database'
   from ingest.http_exchanges as exchange
   where exchange.public_id = '018f0000-0000-7000-8000-000000009905'),
  'recovery closes job, run, and pending HTTP issuance fail-closed'
);

select ok(
  (select
     health.status = 'failed'
     and health.visibility = 'public'
     and health.error_class = 'database'
     and health.last_success_at is not null
     and health.geographic_completeness is null
     and health.details->'failure'->>'reason' = 'collector_lease_expired'
   from truth.source_health as health
   where health.public_id = '018f0000-0000-7000-8000-000000009906')
  and (select state.consecutive_failures = 1
       from ingest.collection_target_state as state
       join core.collection_target_revisions as revision
         on revision.id = state.collection_target_revision_id
       where revision.public_id = '018f0000-0000-7000-8000-000000009902'),
  'hard-crash recovery preserves last success and appends target-specific failed health'
);

insert into ingest.jobs (
  public_id, contract_version, source_id, endpoint_id, collection_target_id,
  collection_target_revision_id, adapter_release_id, idempotency_key,
  max_attempts, input
)
select
  '018f0000-0000-7000-8000-000000009907', '1.1.0', prior.source_id,
  prior.endpoint_id, prior.collection_target_id,
  prior.collection_target_revision_id, prior.adapter_release_id,
  'cmr-runtime-kill-slot-recovery-' || run.id::text, 1,
  jsonb_build_object('collector', 'cmr_firemask_catalog')
from ingest.jobs as prior
join ingest.runs as run on run.job_id = prior.id
where prior.public_id = '018f0000-0000-7000-8000-000000009903';

select is(
  (
    select count(*)
    from ingest.claim_cmr_collection_job_exact(
      (select id from ingest.jobs
       where public_id = '018f0000-0000-7000-8000-000000009907'),
      'pgTAP deterministic CMR recovery worker',
      interval '150 seconds'
    )
  ),
  1::bigint,
  'a deterministic recovery slot can be claimed without reopening the killed job'
);

insert into core.collection_target_revisions (
  public_id, contract_version, identity_version, collection_target_id,
  endpoint_id, version_no, previous_revision_id, target_kind,
  configuration_sha256, scope, geometry_precision_source, claim_kind,
  operational_role, cadence, stale_after, enabled, request_params,
  effective_at
)
select
  '018f0000-0000-7000-8000-000000009908', '1.1.0', '2.0.0',
  prior.collection_target_id, prior.endpoint_id, 3, prior.id, 'global',
  repeat('2', 64), 'global', 'not_applicable',
  'satellite_pass_metadata', 'context', interval '5 minutes',
  interval '3 hours', true,
  jsonb_set(prior.request_params, '{pageSize}', '199'::jsonb), now()
from core.collection_target_revisions as prior
where prior.public_id = '018f0000-0000-7000-8000-000000009902';

insert into ingest.collection_target_state (
  collection_target_revision_id, collection_target_id
)
select revision.id, revision.collection_target_id
from core.collection_target_revisions as revision
where revision.public_id = '018f0000-0000-7000-8000-000000009908';

insert into ingest.jobs (
  public_id, contract_version, source_id, endpoint_id, collection_target_id,
  collection_target_revision_id, adapter_release_id, idempotency_key,
  max_attempts, input
)
select
  '018f0000-0000-7000-8000-000000009909', '1.1.0', target.source_id,
  target.endpoint_id, target.id, revision.id, adapter.id,
  'cmr-runtime-drifted-contract', 1,
  jsonb_build_object('collector', 'cmr_firemask_catalog')
from core.collection_targets as target
join core.collection_target_revisions as revision
  on revision.collection_target_id = target.id
join core.adapter_releases as adapter on adapter.source_id = target.source_id
where target.public_id = '018f0000-0000-7000-8000-000000000415'
  and revision.public_id = '018f0000-0000-7000-8000-000000009908'
  and adapter.public_id = '018f0000-0000-7000-8000-000000009901';

select is(
  (
    select count(*)
    from ingest.claim_cmr_collection_job_exact(
      (select id from ingest.jobs
       where public_id = '018f0000-0000-7000-8000-000000009909'),
      'pgTAP drifted CMR worker',
      interval '150 seconds'
    )
  ),
  0::bigint,
  'an enabled immutable target revision that drifts from the binary contract fails closed'
);

select * from finish();
rollback;
