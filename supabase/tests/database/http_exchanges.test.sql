begin;

-- Exercise the production capability boundary without persisting test grants.
grant firewatch_collector to postgres;

create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public, pg_catalog;

select no_plan();

select has_table('ingest', 'http_exchanges', 'per-HTTP-call ledger exists');
select has_column('ingest', 'http_exchanges', 'request_no', 'calls are ordered within a run');
select has_column('ingest', 'http_exchanges', 'request_fingerprint_sha256', 'request identity is durable');
select has_column('ingest', 'http_exchanges', 'request_body_blob_id', 'request bodies link to reconstructable content');
select has_column('ingest', 'http_exchanges', 'request_query_safe', 'request query values use a typed safe envelope');
select has_column('ingest', 'http_exchanges', 'request_metadata_safe', 'request metadata is explicitly secret-safe');
select has_column('ingest', 'http_exchanges', 'response_raw_object_id', 'responses link to raw evidence');
select has_column('ingest', 'http_exchanges', 'result_metadata_safe', 'terminal metadata is explicitly secret-safe');
select has_column('ingest', 'content_blobs', 'inline_bytes', 'exact inline body bytes are durable');
select has_column('ingest', 'content_blobs', 'representation_kind', 'blob byte semantics are explicit');
select has_column('ingest', 'raw_objects', 'http_exchange_id', 'raw responses identify their issued exchange');

select ok(
  (select relrowsecurity and relforcerowsecurity
   from pg_class
   where oid = 'ingest.http_exchanges'::regclass),
  'HTTP exchange ledger has enabled and forced RLS'
);

select ok(
  has_table_privilege('firewatch_collector', 'ingest.http_exchanges', 'SELECT')
  and has_table_privilege('firewatch_collector', 'ingest.http_exchanges', 'INSERT')
  and not has_table_privilege('firewatch_collector', 'ingest.http_exchanges', 'UPDATE')
  and not has_table_privilege('firewatch_collector', 'ingest.http_exchanges', 'DELETE')
  and not has_table_privilege('service_role', 'ingest.http_exchanges', 'INSERT')
  and not has_table_privilege('anon', 'ingest.http_exchanges', 'SELECT')
  and not has_table_privilege('authenticated', 'ingest.http_exchanges', 'SELECT'),
  'only the collector can read and append HTTP exchanges'
);

select ok(
  has_sequence_privilege(
    'firewatch_collector', 'ingest.http_exchanges_id_seq', 'USAGE'
  )
  and not has_sequence_privilege(
    'service_role', 'ingest.http_exchanges_id_seq', 'USAGE'
  ),
  'HTTP exchange identity sequence follows the collector boundary'
);

select ok(
  exists (
    select 1
    from pg_policies
    where schemaname = 'ingest'
      and tablename = 'http_exchanges'
      and policyname = 'firewatch_collector_read'
      and cmd = 'SELECT'
      and roles = array['firewatch_collector']::name[]
      and qual = 'true'
  )
  and exists (
    select 1
    from pg_policies
    where schemaname = 'ingest'
      and tablename = 'http_exchanges'
      and policyname = 'firewatch_collector_insert'
      and cmd = 'INSERT'
      and roles = array['firewatch_collector']::name[]
      and with_check like '%outcome%pending%'
  ),
  'collector HTTP exchange policies are explicit and narrow'
);

select ok(
  has_function_privilege(
    'firewatch_collector',
    'ingest.finish_http_exchange(bigint,bigint,uuid,text,text,smallint,bigint,jsonb,text,text,jsonb)',
    'EXECUTE'
  )
  and not has_function_privilege(
    'service_role',
    'ingest.finish_http_exchange(bigint,bigint,uuid,text,text,smallint,bigint,jsonb,text,text,jsonb)',
    'EXECUTE'
  ),
  'only the collector can invoke the lease-fenced HTTP terminalizer'
);

select ok(
  to_regclass('ingest.http_exchanges_run_request_key') is not null
  and to_regclass('ingest.http_exchanges_response_raw_object_key') is not null
  and to_regclass('ingest.http_exchanges_request_body_blob_idx') is not null
  and to_regclass('ingest.http_exchanges_endpoint_started_idx') is not null
  and to_regclass('ingest.raw_objects_http_exchange_idx') is not null,
  'HTTP exchange identity, request body, response, and endpoint access paths exist'
);

select ok(
  exists (
    select 1 from pg_constraint
    where conname = 'raw_objects_http_exchange_execution_fkey'
      and conrelid = 'ingest.raw_objects'::regclass
  )
  and exists (
    select 1 from pg_constraint
    where conname = 'http_exchanges_response_exact_exchange_fkey'
      and conrelid = 'ingest.http_exchanges'::regclass
  ),
  'raw response and terminal exchange references are bound in both directions'
);

select ok(
  (
    select strpos(definition, 'for update of job') > 0
      and strpos(definition, 'for update of job')
        < strpos(definition, 'for update of run')
    from (
      select lower(pg_get_functiondef(
        'ingest.finish_http_exchange(bigint,bigint,uuid,text,text,smallint,bigint,jsonb,text,text,jsonb)'::regprocedure
      )) as definition
    ) as function_source
  )
  and (
    select strpos(definition, 'for update of job') > 0
      and strpos(definition, 'for update of job')
        < strpos(definition, 'for update of run, state')
    from (
      select lower(pg_get_functiondef(
        'ingest.finish_ingestion_run(bigint,uuid,text,text,smallint,integer,text,text,integer,text,text,timestamptz,integer,integer,integer,integer,integer,jsonb,jsonb,jsonb,jsonb,jsonb,timestamptz)'::regprocedure
      )) as definition
    ) as function_source
  ),
  'terminalizers acquire job locks before run locks'
);

select ok(
  (
    select strpos(definition, 'for update of j') > 0
      and strpos(definition, 'for update of j')
        < strpos(definition, 'for update of r')
    from (
      select lower(pg_get_functiondef(
        'ingest.require_active_run_lease()'::regprocedure
      )) as definition
    ) as function_source
  )
  and (
    select strpos(definition, 'order by run.id') > 0
      and strpos(definition, 'order by run.id')
        < strpos(definition, 'update ingest.http_exchanges')
    from (
      select lower(pg_get_functiondef(
        'ingest.close_run_on_job_reclaim()'::regprocedure
      )) as definition
    ) as function_source
  ),
  'issuance and reclaim preserve the job to run to exchange lock order'
);

insert into core.providers (
  public_id, contract_version, slug, name, organization_type
)
values (
  '018f0000-0000-7000-8000-000000009801', '1.1.0',
  'http-exchange-test-provider', 'HTTP exchange test provider', 'unknown'
);

insert into core.sources (
  public_id, contract_version, provider_id, slug, name, product_family,
  default_trust_class, default_evidence_class, operational_scope, enabled
)
select
  '018f0000-0000-7000-8000-000000009802', '1.1.0', provider.id,
  'http-exchange-test-source', 'HTTP exchange test source', 'test',
  'official_observation', 'test_measurement', 'context', true
from core.providers as provider
where provider.slug = 'http-exchange-test-provider';

insert into core.endpoints (
  public_id, contract_version, source_id, endpoint_key, name, endpoint_kind,
  source_kind, authority_scopes, content_policy, license_policy, transport,
  base_url, http_method, trust_class, evidence_class, coverage_scope,
  freshness, max_staleness
)
select
  '018f0000-0000-7000-8000-000000009803', '1.1.0', source.id,
  'http-json', 'HTTP JSON test endpoint', 'feed', 'measurement',
  array['weather_measurement'], 'structured_data', 'test-only', 'http_poll',
  'https://example.test/api', 'POST', 'official_observation',
  'test_measurement', 'global', interval '5 minutes', interval '30 minutes'
from core.sources as source
where source.slug = 'http-exchange-test-source';

insert into ingest.endpoint_state (endpoint_id, enabled)
select endpoint.id, true
from core.endpoints as endpoint
where endpoint.public_id = '018f0000-0000-7000-8000-000000009803';

insert into core.adapter_releases (
  public_id, contract_version, source_id, release_no, version_label,
  artifact_digest, schema_version, released_at
)
select
  '018f0000-0000-7000-8000-000000009804', '1.1.0', source.id, 1,
  'http-exchange-test-1', repeat('1', 64), '1.0.0', now()
from core.sources as source
where source.slug = 'http-exchange-test-source';

insert into ingest.adapter_release_state (adapter_release_id, enabled)
select adapter.id, true
from core.adapter_releases as adapter
where adapter.public_id = '018f0000-0000-7000-8000-000000009804';

insert into core.collection_targets (
  public_id, contract_version, source_id, endpoint_id, target_key, name, enabled
)
select
  '018f0000-0000-7000-8000-000000009805', '1.1.0', source.id,
  endpoint.id, 'http-exchange-test', 'HTTP exchange test target', true
from core.sources as source
join core.endpoints as endpoint on endpoint.source_id = source.id
where source.slug = 'http-exchange-test-source'
  and endpoint.endpoint_key = 'http-json';

insert into core.collection_target_revisions (
  public_id, contract_version, identity_version, collection_target_id,
  endpoint_id, version_no, target_kind, configuration_sha256, scope,
  claim_kind, operational_role, cadence, stale_after, enabled, effective_at
)
select
  '018f0000-0000-7000-8000-000000009806', '1.1.0', '2.0.0', target.id,
  target.endpoint_id, 1, 'global', repeat('2', 64), 'global',
  'test_measurement', 'context', interval '5 minutes', interval '30 minutes',
  true, now()
from core.collection_targets as target
where target.public_id = '018f0000-0000-7000-8000-000000009805';

insert into ingest.collection_target_state (
  collection_target_revision_id, collection_target_id
)
select revision.id, revision.collection_target_id
from core.collection_target_revisions as revision
where revision.public_id = '018f0000-0000-7000-8000-000000009806';

insert into ingest.jobs (
  public_id, contract_version, source_id, endpoint_id, collection_target_id,
  collection_target_revision_id, adapter_release_id, idempotency_key
)
select
  '018f0000-0000-7000-8000-000000009807', '1.1.0', target.source_id,
  target.endpoint_id, target.id, revision.id, adapter.id,
  'http-exchange-test-job-1'
from core.collection_targets as target
join core.collection_target_revisions as revision
  on revision.collection_target_id = target.id
join core.adapter_releases as adapter on adapter.source_id = target.source_id
where target.public_id = '018f0000-0000-7000-8000-000000009805'
  and revision.public_id = '018f0000-0000-7000-8000-000000009806'
  and adapter.public_id = '018f0000-0000-7000-8000-000000009804';

set local role firewatch_collector;

select is(
  (select count(*) from ingest.claim_collection_job('http-exchange-worker-1', interval '1 hour')),
  1::bigint,
  'collector claims the HTTP exchange fixture job'
);

insert into ingest.runs (
  public_id, contract_version, job_id, source_id, endpoint_id,
  collection_target_id, collection_target_revision_id, adapter_release_id,
  lease_token, lease_owner, attempt_no, collector_version
)
select
  '018f0000-0000-7000-8000-000000009808', '1.1.0', job.id,
  job.source_id, job.endpoint_id, job.collection_target_id,
  job.collection_target_revision_id, job.adapter_release_id, job.lease_token,
  job.lease_owner, job.attempt_count, 'http-exchange-test-collector'
from ingest.jobs as job
where job.public_id = '018f0000-0000-7000-8000-000000009807';

-- The credential-redacted request body is durable before the issued exchange,
-- which in turn must commit before the collector performs network I/O.
insert into ingest.content_blobs (
  public_id, contract_version, identity_version, content_sha256,
  content_type, byte_size, inline_bytes
)
select
  '018f0000-0000-7000-8000-000000009818', '1.1.0', '2.0.0',
  encode(pg_catalog.sha256(payload.bytes), 'hex'), 'application/json',
  octet_length(payload.bytes), payload.bytes
from (
  values (convert_to('{"model":"test","prompt":"[REDACTED]"}', 'UTF8'))
) as payload(bytes);

insert into ingest.http_exchanges (
  public_id, contract_version, run_id, source_id, endpoint_id, request_no,
  idempotency_key, request_method, request_url_redacted,
  request_query_safe,
  request_fingerprint_sha256, request_body_blob_id, request_body_sha256,
  request_headers_safe, request_metadata_safe, started_at, created_at
)
select
  '018f0000-0000-7000-8000-000000009811', '1.1.0', run.id,
  run.source_id, run.endpoint_id, 1, 'http-exchange-test-call-1', 'POST',
  'https://example.test/api', '{}'::jsonb, repeat('4', 64), body.id,
  body.content_sha256, '{"accept":"application/json"}'::jsonb,
  '{"operation":"test-completion"}'::jsonb,
  now() - interval '1 day', now() - interval '1 day'
from ingest.runs as run
cross join ingest.content_blobs as body
where run.public_id = '018f0000-0000-7000-8000-000000009808'
  and body.public_id = '018f0000-0000-7000-8000-000000009818';

select ok(
  (select exchange.outcome = 'pending'
      and exchange.started_at = now()
      and exchange.created_at = now()
      and exchange.completed_at is null
      and exchange.request_body_blob_id is not null
   from ingest.http_exchanges as exchange
   where exchange.public_id = '018f0000-0000-7000-8000-000000009811'),
  'HTTP request issuance is durable and database-timestamped before network I/O'
);

select is(
  (select convert_from(body.inline_bytes, 'UTF8')
   from ingest.http_exchanges as exchange
   join ingest.content_blobs as body on body.id = exchange.request_body_blob_id
   where exchange.public_id = '018f0000-0000-7000-8000-000000009811'),
  '{"model":"test","prompt":"[REDACTED]"}'::text,
  'the exact credential-redacted POST body is reconstructable at issuance'
);

insert into ingest.content_blobs (
  public_id, contract_version, identity_version, content_sha256,
  content_type, byte_size, inline_bytes
)
select
  '018f0000-0000-7000-8000-000000009809', '1.1.0', '2.0.0',
  encode(pg_catalog.sha256(payload.bytes), 'hex'), 'application/json',
  octet_length(payload.bytes), payload.bytes
from (values (convert_to('{"ok":true}', 'UTF8'))) as payload(bytes);

select throws_ok(
  $$
    insert into ingest.content_blobs (
      public_id, contract_version, identity_version, content_sha256,
      content_type, byte_size, inline_bytes
    ) values (
      '018f0000-0000-7000-8000-000000009821', '1.1.0', '2.0.0',
      repeat('0', 64), 'application/octet-stream', 3, convert_to('bad', 'UTF8')
    )
  $$,
  '23514',
  'new row for relation "content_blobs" violates check constraint "content_blobs_inline_bytes_integrity_check"',
  'inline exact bytes must match their persisted size and SHA-256'
);

select throws_ok(
  $$
    insert into ingest.raw_objects (
      public_id, contract_version, source_id, endpoint_id, run_id, blob_id,
      content_sha256, idempotency_key, retrieved_at
    )
    select
      '018f0000-0000-7000-8000-000000009822', '1.1.0', run.source_id,
      run.endpoint_id, run.id, blob.id, blob.content_sha256,
      'http-exchange-test-unledgered-raw', now()
    from ingest.runs as run
    cross join ingest.content_blobs as blob
    where run.public_id = '018f0000-0000-7000-8000-000000009808'
      and blob.public_id = '018f0000-0000-7000-8000-000000009809'
  $$,
  '23514',
  'raw HTTP responses require their pending exchange and exact-byte content',
  'raw responses cannot bypass the issued-call ledger'
);

select throws_ok(
  $$
    insert into ingest.raw_objects (
      public_id, contract_version, source_id, endpoint_id, run_id, blob_id,
      content_sha256, idempotency_key, retrieved_at, http_exchange_id, metadata
    )
    select
      '018f0000-0000-7000-8000-000000009823', '1.1.0', run.source_id,
      run.endpoint_id, run.id, blob.id, blob.content_sha256,
      'http-exchange-test-unsafe-raw-meta', now(), exchange.id,
      '{"authorization":"Bearer must-not-persist"}'::jsonb
    from ingest.runs as run
    join ingest.http_exchanges as exchange on exchange.run_id = run.id
    cross join ingest.content_blobs as blob
    where run.public_id = '018f0000-0000-7000-8000-000000009808'
      and exchange.public_id = '018f0000-0000-7000-8000-000000009811'
      and blob.public_id = '018f0000-0000-7000-8000-000000009809'
  $$,
  '23514',
  'raw HTTP response metadata must use the typed exchange envelope',
  'raw response metadata cannot become a secret-bearing side channel'
);

insert into ingest.raw_objects (
  public_id, contract_version, source_id, endpoint_id, run_id, blob_id,
  content_sha256, idempotency_key, retrieved_at, http_exchange_id
)
select
  '018f0000-0000-7000-8000-000000009810', '1.1.0', run.source_id,
  run.endpoint_id, run.id, blob.id, blob.content_sha256,
  'http-exchange-test-raw-1', now(), exchange.id
from ingest.runs as run
join ingest.http_exchanges as exchange on exchange.run_id = run.id
cross join ingest.content_blobs as blob
where run.public_id = '018f0000-0000-7000-8000-000000009808'
  and exchange.public_id = '018f0000-0000-7000-8000-000000009811'
  and blob.public_id = '018f0000-0000-7000-8000-000000009809';

select throws_ok(
  $$
    insert into ingest.source_revisions (
      public_id, contract_version, identity_version, source_id,
      source_record_key, revision_no, run_id, raw_object_id,
      adapter_release_id, idempotency_key, content_sha256, schema_version,
      retrieved_at, raw_payload, canonical_data
    )
    select
      '018f0000-0000-7000-8000-000000009824', '1.1.0', '2.0.0', run.source_id,
      'premature-http-record', 1, run.id, raw.id, run.adapter_release_id,
      'premature-http-revision', raw.content_sha256, '1.0.0', now(),
      '{}'::jsonb, '{}'::jsonb
    from ingest.runs as run
    join ingest.raw_objects as raw on raw.run_id = run.id
    where run.public_id = '018f0000-0000-7000-8000-000000009808'
      and raw.public_id = '018f0000-0000-7000-8000-000000009810'
  $$,
  '23514',
  'source revisions require a terminal HTTP response exchange',
  'normalized revisions cannot precede response terminalization'
);

select ok(
  (
    select ingest.finish_http_exchange(
      p_exchange_id => exchange.id,
      p_run_id => run.id,
      p_lease_token => run.lease_token,
      p_worker_id => run.lease_owner,
      p_outcome => 'response',
      p_http_status => 200::smallint,
      p_response_raw_object_id => raw.id,
      p_response_headers_safe => '{"content-type":"application/json"}'::jsonb
    )
    from ingest.http_exchanges as exchange
    join ingest.runs as run on run.id = exchange.run_id
    join ingest.raw_objects as raw on raw.run_id = run.id
    where exchange.public_id = '018f0000-0000-7000-8000-000000009811'
      and raw.public_id = '018f0000-0000-7000-8000-000000009810'
  ),
  'lease-fenced terminalizer records the stored HTTP response'
);

select ok(
  not (
    select ingest.finish_http_exchange(
      p_exchange_id => exchange.id,
      p_run_id => run.id,
      p_lease_token => run.lease_token,
      p_worker_id => run.lease_owner,
      p_outcome => 'response',
      p_http_status => 200::smallint,
      p_response_raw_object_id => raw.id
    )
    from ingest.http_exchanges as exchange
    join ingest.runs as run on run.id = exchange.run_id
    join ingest.raw_objects as raw on raw.run_id = run.id
    where exchange.public_id = '018f0000-0000-7000-8000-000000009811'
      and raw.public_id = '018f0000-0000-7000-8000-000000009810'
  ),
  'an HTTP exchange cannot be terminalized twice'
);

reset role;

select is(
  (select convert_from(blob.inline_bytes, 'UTF8')
   from ingest.http_exchanges as exchange
   join ingest.raw_objects as raw on raw.id = exchange.response_raw_object_id
   join ingest.content_blobs as blob on blob.id = raw.blob_id
   where exchange.public_id = '018f0000-0000-7000-8000-000000009811'),
  '{"ok":true}'::text,
  'a successful HTTP response is reconstructable through raw evidence'
);

select throws_ok(
  $$
    update ingest.http_exchanges
    set request_url_redacted = 'https://example.test/rewritten'
    where public_id = '018f0000-0000-7000-8000-000000009811'
  $$,
  '55000',
  'terminal HTTP exchanges are immutable',
  'terminal HTTP exchanges reject all rewrites'
);

select throws_ok(
  $$
    delete from ingest.http_exchanges
    where public_id = '018f0000-0000-7000-8000-000000009811'
  $$,
  '55000',
  'ingest.http_exchanges rows are immutable; append a successor revision',
  'HTTP exchanges reject deletes'
);

set local role firewatch_collector;

insert into ingest.http_exchanges (
  public_id, contract_version, run_id, source_id, endpoint_id, request_no,
  idempotency_key, request_method, request_url_redacted,
  request_query_safe, request_fingerprint_sha256
)
select
  '018f0000-0000-7000-8000-000000009812', '1.1.0', run.id,
  run.source_id, run.endpoint_id, 2, 'http-exchange-test-call-2', 'GET',
  'https://example.test/api', '{"page":2}'::jsonb, repeat('5', 64)
from ingest.runs as run
where run.public_id = '018f0000-0000-7000-8000-000000009808';

select ok(
  (select request_body_blob_id is null and request_body_sha256 is null
   from ingest.http_exchanges
   where public_id = '018f0000-0000-7000-8000-000000009812'),
  'GET issuance has no request body reference or hash'
);

select throws_ok(
  $$
    insert into ingest.http_exchanges (
      public_id, contract_version, run_id, source_id, endpoint_id, request_no,
      idempotency_key, request_method, request_url_redacted,
      request_fingerprint_sha256, request_body_blob_id, request_body_sha256
    )
    select
      '018f0000-0000-7000-8000-000000009819', '1.1.0', run.id,
      run.source_id, run.endpoint_id, 3, 'http-exchange-get-with-body', 'GET',
      'https://example.test/api', repeat('a', 64), body.id,
      body.content_sha256
    from ingest.runs as run
    cross join ingest.content_blobs as body
    where run.public_id = '018f0000-0000-7000-8000-000000009808'
      and body.public_id = '018f0000-0000-7000-8000-000000009818'
  $$,
  '23514',
  'new row for relation "http_exchanges" violates check constraint "http_exchanges_get_has_no_body_check"',
  'GET requests cannot claim a request body'
);

select throws_ok(
  $$
    insert into ingest.http_exchanges (
      public_id, contract_version, run_id, source_id, endpoint_id, request_no,
      idempotency_key, request_method, request_url_redacted,
      request_fingerprint_sha256
    )
    select
      '018f0000-0000-7000-8000-000000009813', '1.1.0', run.id,
      run.source_id, run.endpoint_id, 2, 'http-exchange-duplicate-number', 'GET',
      'https://example.test/api', repeat('6', 64)
    from ingest.runs as run
    where run.public_id = '018f0000-0000-7000-8000-000000009808'
  $$,
  '23505',
  'duplicate key value violates unique constraint "http_exchanges_run_request_key"',
  'request number is unique within its run'
);

select ok(
  not (
    select ingest.finish_http_exchange(
      p_exchange_id => exchange.id,
      p_run_id => run.id,
      p_lease_token => run.lease_token,
      p_worker_id => run.lease_owner,
      p_outcome => 'response',
      p_http_status => 503::smallint
    )
    from ingest.http_exchanges as exchange
    join ingest.runs as run on run.id = exchange.run_id
    where exchange.public_id = '018f0000-0000-7000-8000-000000009812'
  ),
  'terminalizer requires raw evidence even for an HTTP error response'
);

select ok(
  not (
    select ingest.finish_http_exchange(
      p_exchange_id => exchange.id,
      p_run_id => run.id,
      p_lease_token => run.lease_token,
      p_worker_id => run.lease_owner,
      p_outcome => 'response',
      p_http_status => 200::smallint,
      p_response_raw_object_id => raw.id
    )
    from ingest.http_exchanges as exchange
    join ingest.runs as run on run.id = exchange.run_id
    join ingest.raw_objects as raw on raw.run_id = run.id
    where exchange.public_id = '018f0000-0000-7000-8000-000000009812'
      and raw.public_id = '018f0000-0000-7000-8000-000000009810'
  ),
  'an exchange cannot claim a raw response produced by another request'
);

select ok(
  not (
    select ingest.finish_http_exchange(
      p_exchange_id => exchange.id,
      p_run_id => run.id,
      p_lease_token => '00000000-0000-4000-8000-000000009899'::uuid,
      p_worker_id => run.lease_owner,
      p_outcome => 'transport_error',
      p_error_class => 'network'
    )
    from ingest.http_exchanges as exchange
    join ingest.runs as run on run.id = exchange.run_id
    where exchange.public_id = '018f0000-0000-7000-8000-000000009812'
  ),
  'terminalizer rejects a stale or forged lease token'
);

select ok(
  not (
    select ingest.finish_http_exchange(
      p_exchange_id => exchange.id,
      p_run_id => run.id,
      p_lease_token => run.lease_token,
      p_worker_id => run.lease_owner,
      p_outcome => 'transport_error',
      p_response_headers_safe => jsonb_build_object('oversized', repeat('x', 20000)),
      p_error_class => 'network'
    )
    from ingest.http_exchanges as exchange
    join ingest.runs as run on run.id = exchange.run_id
    where exchange.public_id = '018f0000-0000-7000-8000-000000009812'
  ),
  'terminalizer rejects oversized safe header metadata'
);

select ok(
  not (
    select ingest.finish_http_exchange(
      p_exchange_id => exchange.id,
      p_run_id => run.id,
      p_lease_token => run.lease_token,
      p_worker_id => run.lease_owner,
      p_outcome => 'response',
      p_http_status => 503::smallint,
      p_response_raw_object_id => raw.id,
      p_response_headers_safe => '{"set-cookie":"session=secret"}'::jsonb,
      p_error_class => 'upstream'
    )
    from ingest.http_exchanges as exchange
    join ingest.runs as run on run.id = exchange.run_id
    join ingest.raw_objects as raw on raw.run_id = run.id
    where exchange.public_id = '018f0000-0000-7000-8000-000000009812'
      and raw.public_id = '018f0000-0000-7000-8000-000000009810'
  ),
  'terminalizer rejects a secret-bearing response header'
);

select throws_ok(
  $$
    insert into ingest.http_exchanges (
      public_id, contract_version, run_id, source_id, endpoint_id, request_no,
      idempotency_key, request_method, request_url_redacted,
      request_fingerprint_sha256, request_headers_safe
    )
    select
      '018f0000-0000-7000-8000-000000009820', '1.1.0', run.id,
      run.source_id, run.endpoint_id, 3, 'http-exchange-secret-header', 'GET',
      'https://example.test/api', repeat('f', 64),
      '{"authorization":"Bearer must-not-persist"}'::jsonb
    from ingest.runs as run
    where run.public_id = '018f0000-0000-7000-8000-000000009808'
  $$,
  '23514',
  'HTTP exchanges must be issued in pristine pending state',
  'issuance rejects a secret-bearing request header'
);

select throws_ok(
  $$
    insert into ingest.http_exchanges (
      public_id, contract_version, run_id, source_id, endpoint_id, request_no,
      idempotency_key, request_method, request_url_redacted,
      request_fingerprint_sha256, request_headers_safe
    )
    select
      '018f0000-0000-7000-8000-000000009825', '1.1.0', run.id,
      run.source_id, run.endpoint_id, 3, 'http-exchange-x-auth-token', 'GET',
      'https://example.test/api', repeat('1', 64),
      '{"x-auth-token":"must-not-persist"}'::jsonb
    from ingest.runs as run
    where run.public_id = '018f0000-0000-7000-8000-000000009808'
  $$,
  '23514',
  'HTTP exchanges must be issued in pristine pending state',
  'issuance rejects x-auth-token even without a bearer prefix'
);

select throws_ok(
  $$
    insert into ingest.http_exchanges (
      public_id, contract_version, run_id, source_id, endpoint_id, request_no,
      idempotency_key, request_method, request_url_redacted,
      request_fingerprint_sha256, request_metadata_safe
    )
    select
      '018f0000-0000-7000-8000-000000009826', '1.1.0', run.id,
      run.source_id, run.endpoint_id, 3, 'http-exchange-nested-meta', 'GET',
      'https://example.test/api', repeat('2', 64),
      '{"operation":{"token":"nested"}}'::jsonb
    from ingest.runs as run
    where run.public_id = '018f0000-0000-7000-8000-000000009808'
  $$,
  '23514',
  'HTTP exchanges must be issued in pristine pending state',
  'issuance rejects nested metadata that could conceal credentials'
);

select throws_ok(
  $$
    insert into ingest.http_exchanges (
      public_id, contract_version, run_id, source_id, endpoint_id, request_no,
      idempotency_key, request_method, request_url_redacted,
      request_fingerprint_sha256
    )
    select
      '018f0000-0000-7000-8000-000000009827', '1.1.0', run.id,
      run.source_id, run.endpoint_id, 3, 'http-exchange-signed-url', 'GET',
      'https://example.test/api?X-Amz-Signature=must-not-persist', repeat('3', 64)
    from ingest.runs as run
    where run.public_id = '018f0000-0000-7000-8000-000000009808'
  $$,
  '23514',
  'HTTP exchanges must be issued in pristine pending state',
  'issuance rejects signed URLs instead of persisting their query string'
);

select throws_ok(
  $$
    insert into ingest.http_exchanges (
      public_id, contract_version, run_id, source_id, endpoint_id, request_no,
      idempotency_key, request_method, request_url_redacted,
      request_fingerprint_sha256
    )
    select
      '018f0000-0000-7000-8000-000000009828', '1.1.0', run.id,
      run.source_id, run.endpoint_id, 3, 'http-exchange-uncatalogued-path', 'GET',
      'https://example.test/api/arbitrary-target', repeat('4', 64)
    from ingest.runs as run
    where run.public_id = '018f0000-0000-7000-8000-000000009808'
  $$,
  '23514',
  'HTTP exchanges must be issued in pristine pending state',
  'issuance binds the safe URL to the exact catalog endpoint target'
);

select throws_ok(
  $$
    insert into ingest.http_exchanges (
      public_id, contract_version, run_id, source_id, endpoint_id, request_no,
      idempotency_key, request_method, request_url_redacted,
      request_query_safe, request_fingerprint_sha256
    )
    select
      '018f0000-0000-7000-8000-000000009829', '1.1.0', run.id,
      run.source_id, run.endpoint_id, 3, 'http-exchange-secret-query', 'GET',
      'https://example.test/api', '{"token":"[REDACTED]"}'::jsonb,
      repeat('5', 64)
    from ingest.runs as run
    where run.public_id = '018f0000-0000-7000-8000-000000009808'
  $$,
  '23514',
  'HTTP exchanges must be issued in pristine pending state',
  'issuance rejects query keys outside the positive provider allowlist'
);

select ok(
  ingest.http_safe_map_is_allowed(
    '{
      "current":"temperature_2m,wind_speed_10m",
      "temperature_unit":"celsius",
      "wind_speed_unit":"kmh",
      "ids":"LGMT",
      "hours":2,
      "max_results":10,
      "start_time":"2026-07-30T00:00:00Z",
      "exclude":"retweets,replies",
      "tweet.fields":"created_at,lang",
      "provider":"LANCEMODIS",
      "short_name":"VNP14IMGTDL_NRT",
      "version":"2",
      "sort_key[]":["-start_date","granule_ur"]
    }'::jsonb,
    'request_query'
  ),
  'the positive query allowlist covers the configured upstream adapters'
);

select ok(
  ingest.http_safe_map_is_allowed(
    '{
      "client-id":"plomari-wildfire-tracker",
      "cmr-search-after":"opaque-pagination-cursor",
      "x-request-id":"request-9836"
    }'::jsonb,
    'request_header'
  ),
  'the positive request-header allowlist covers CMR pagination evidence'
);

select ok(
  ingest.http_safe_map_is_allowed(
    '{
      "cmr-hits":"408",
      "cmr-request-id":"request-9836",
      "cmr-search-after":"[\"next\",123]",
      "cmr-timed-out":"false",
      "cmr-took":"96"
    }'::jsonb,
    'response_header'
  ),
  'the positive response-header allowlist preserves CMR completeness and pagination evidence'
);

select ok(
  not (
    select ingest.finish_http_exchange(
      p_exchange_id => exchange.id,
      p_run_id => run.id,
      p_lease_token => run.lease_token,
      p_worker_id => run.lease_owner,
      p_outcome => 'response',
      p_http_status => 302::smallint,
      p_response_raw_object_id => raw.id,
      p_response_headers_safe => '{"location":"https://signed.example/object?signature=secret"}'::jsonb
    )
    from ingest.http_exchanges as exchange
    join ingest.runs as run on run.id = exchange.run_id
    join ingest.raw_objects as raw on raw.run_id = run.id
    where exchange.public_id = '018f0000-0000-7000-8000-000000009812'
      and raw.public_id = '018f0000-0000-7000-8000-000000009810'
  ),
  'terminalizer rejects Location and signed redirect URLs'
);

select ok(
  not (
    select ingest.finish_http_exchange(
      p_exchange_id => exchange.id,
      p_run_id => run.id,
      p_lease_token => run.lease_token,
      p_worker_id => run.lease_owner,
      p_outcome => 'transport_error',
      p_error_class => 'network',
      p_result_metadata_safe => '{"reason":{"token":"nested"}}'::jsonb
    )
    from ingest.http_exchanges as exchange
    join ingest.runs as run on run.id = exchange.run_id
    where exchange.public_id = '018f0000-0000-7000-8000-000000009812'
  ),
  'terminalizer rejects nested result metadata'
);

select ok(
  not (
    select ingest.finish_http_exchange(
      p_exchange_id => exchange.id,
      p_run_id => run.id,
      p_lease_token => run.lease_token,
      p_worker_id => run.lease_owner,
      p_outcome => 'transport_error',
      p_error_class => 'authentication',
      p_error_detail_safe => 'Bearer must-not-persist'
    )
    from ingest.http_exchanges as exchange
    join ingest.runs as run on run.id = exchange.run_id
    where exchange.public_id = '018f0000-0000-7000-8000-000000009812'
  ),
  'terminalizer rejects credential-like error detail text'
);

insert into ingest.content_blobs (
  public_id, contract_version, identity_version, content_sha256,
  content_type, byte_size, inline_payload
)
select
  '018f0000-0000-7000-8000-000000009830', '1.1.0', '2.0.0',
  encode(pg_catalog.sha256(convert_to(payload.value::text, 'UTF8')), 'hex'),
  'application/json', octet_length(convert_to(payload.value::text, 'UTF8')),
  payload.value
from (values ('{"semantic_test_9830":true}'::jsonb)) as payload(value);

select throws_ok(
  $$
    insert into ingest.http_exchanges (
      public_id, contract_version, run_id, source_id, endpoint_id, request_no,
      idempotency_key, request_method, request_url_redacted,
      request_fingerprint_sha256, request_body_blob_id, request_body_sha256
    )
    select
      '018f0000-0000-7000-8000-000000009831', '1.1.0', run.id,
      run.source_id, run.endpoint_id, 3, 'http-exchange-canonical-body', 'POST',
      'https://example.test/api', repeat('6', 64), body.id, body.content_sha256
    from ingest.runs as run
    cross join ingest.content_blobs as body
    where run.public_id = '018f0000-0000-7000-8000-000000009808'
      and body.public_id = '018f0000-0000-7000-8000-000000009830'
  $$,
  '23514',
  'HTTP exchanges must be issued in pristine pending state',
  'canonical jsonb cannot masquerade as exact outbound request bytes'
);

select throws_ok(
  $$
    insert into ingest.raw_objects (
      public_id, contract_version, source_id, endpoint_id, run_id, blob_id,
      content_sha256, idempotency_key, retrieved_at, http_exchange_id
    )
    select
      '018f0000-0000-7000-8000-000000009836', '1.1.0', run.source_id,
      run.endpoint_id, run.id, body.id, body.content_sha256,
      'http-exchange-canonical-response', now(), exchange.id
    from ingest.runs as run
    join ingest.http_exchanges as exchange on exchange.run_id = run.id
    cross join ingest.content_blobs as body
    where run.public_id = '018f0000-0000-7000-8000-000000009808'
      and exchange.public_id = '018f0000-0000-7000-8000-000000009812'
      and body.public_id = '018f0000-0000-7000-8000-000000009830'
  $$,
  '23514',
  'raw HTTP responses require their pending exchange and exact-byte content',
  'canonical jsonb cannot masquerade as exact response bytes'
);

select throws_ok(
  $$
    insert into ingest.content_blobs (
      public_id, contract_version, identity_version, content_sha256,
      content_type, byte_size, inline_bytes
    )
    select
      '018f0000-0000-7000-8000-000000009832', '1.1.0', '2.0.0',
      encode(pg_catalog.sha256(payload.bytes), 'hex'),
      'application/octet-stream', octet_length(payload.bytes) + 1, payload.bytes
    from (values (convert_to('size-mismatch', 'UTF8'))) as payload(bytes)
  $$,
  '23514',
  'new row for relation "content_blobs" violates check constraint "content_blobs_inline_bytes_integrity_check"',
  'inline exact bytes must match their declared byte size'
);

select throws_ok(
  $$
    select ingest.finish_ingestion_run(
      p_run_id => run.id,
      p_lease_token => run.lease_token,
      p_worker_id => run.lease_owner,
      p_status => 'success',
      p_request_count => 2,
      p_cursor_before => '{}'::jsonb,
      p_cursor_after => '{"cursor":"bad-count"}'::jsonb
    )
    from ingest.runs as run
    where run.public_id = '018f0000-0000-7000-8000-000000009808'
  $$,
  '23514',
  'terminal ingestion run cannot contain pending HTTP exchanges',
  'run finalization rejects an issued request without a terminal outcome'
);

reset role;

select throws_ok(
  $$
    update ingest.http_exchanges
    set request_url_redacted = 'https://example.test/changed-before-terminal'
    where public_id = '018f0000-0000-7000-8000-000000009812'
  $$,
  '55000',
  'HTTP exchange request identity is immutable after issuance',
  'pending request identity cannot be rewritten'
);

set local role firewatch_collector;

select ok(
  (
    select ingest.finish_http_exchange(
      p_exchange_id => exchange.id,
      p_run_id => run.id,
      p_lease_token => run.lease_token,
      p_worker_id => run.lease_owner,
      p_outcome => 'transport_error',
      p_error_class => 'timeout',
      p_error_detail_safe => 'Upstream request timed out.'
    )
    from ingest.http_exchanges as exchange
    join ingest.runs as run on run.id = exchange.run_id
    where exchange.public_id = '018f0000-0000-7000-8000-000000009812'
  ),
  'transport failures are durable terminal outcomes'
);

-- A response event exists even when its application-visible body is empty.
insert into ingest.http_exchanges (
  public_id, contract_version, run_id, source_id, endpoint_id, request_no,
  idempotency_key, request_method, request_url_redacted,
  request_fingerprint_sha256
)
select
  '018f0000-0000-7000-8000-000000009833', '1.1.0', run.id,
  run.source_id, run.endpoint_id, 3, 'http-exchange-zero-body', 'GET',
  'https://example.test/api', repeat('7', 64)
from ingest.runs as run
where run.public_id = '018f0000-0000-7000-8000-000000009808';

insert into ingest.content_blobs (
  public_id, contract_version, identity_version, content_sha256,
  content_type, byte_size, inline_bytes
)
select
  '018f0000-0000-7000-8000-000000009834', '1.1.0', '2.0.0',
  encode(pg_catalog.sha256(payload.bytes), 'hex'),
  'application/octet-stream', octet_length(payload.bytes), payload.bytes
from (values (''::bytea)) as payload(bytes);

insert into ingest.raw_objects (
  public_id, contract_version, source_id, endpoint_id, run_id, blob_id,
  content_sha256, idempotency_key, retrieved_at, http_exchange_id
)
select
  '018f0000-0000-7000-8000-000000009835', '1.1.0', run.source_id,
  run.endpoint_id, run.id, blob.id, blob.content_sha256,
  'http-exchange-zero-body-raw', now(), exchange.id
from ingest.runs as run
join ingest.http_exchanges as exchange on exchange.run_id = run.id
cross join ingest.content_blobs as blob
where run.public_id = '018f0000-0000-7000-8000-000000009808'
  and exchange.public_id = '018f0000-0000-7000-8000-000000009833'
  and blob.public_id = '018f0000-0000-7000-8000-000000009834';

select ok(
  (
    select ingest.finish_http_exchange(
      p_exchange_id => exchange.id,
      p_run_id => run.id,
      p_lease_token => run.lease_token,
      p_worker_id => run.lease_owner,
      p_outcome => 'response',
      p_http_status => 204::smallint,
      p_response_raw_object_id => raw.id,
      p_result_metadata_safe => '{"response_body_bytes":0}'::jsonb
    )
    from ingest.http_exchanges as exchange
    join ingest.runs as run on run.id = exchange.run_id
    join ingest.raw_objects as raw on raw.http_exchange_id = exchange.id
    where exchange.public_id = '018f0000-0000-7000-8000-000000009833'
      and raw.public_id = '018f0000-0000-7000-8000-000000009835'
  ),
  'zero-byte HTTP bodies are persisted as response occurrences'
);

select is(
  (select octet_length(blob.inline_bytes)
   from ingest.http_exchanges as exchange
   join ingest.raw_objects as raw on raw.id = exchange.response_raw_object_id
   join ingest.content_blobs as blob on blob.id = raw.blob_id
   where exchange.public_id = '018f0000-0000-7000-8000-000000009833'),
  0,
  'the zero-byte response remains exactly reconstructable'
);

select ok(
  not (
    select ingest.finish_ingestion_run(
      p_run_id => run.id,
      p_lease_token => run.lease_token,
      p_worker_id => run.lease_owner,
      p_status => 'success',
      p_request_count => 3,
      p_cursor_before => '{}'::jsonb,
      p_cursor_after => '{"cursor":"unsafe-meta"}'::jsonb,
      p_response_meta => '{"provider_request_id":{"token":"nested"}}'::jsonb
    )
    from ingest.runs as run
    where run.public_id = '018f0000-0000-7000-8000-000000009808'
  ),
  'run finalization rejects nested aggregate metadata side channels'
);

select throws_ok(
  $$
    select ingest.finish_ingestion_run(
      p_run_id => run.id,
      p_lease_token => run.lease_token,
      p_worker_id => run.lease_owner,
      p_status => 'success',
      p_request_count => 1,
      p_cursor_before => '{}'::jsonb,
      p_cursor_after => '{"cursor":"bad-count"}'::jsonb
    )
    from ingest.runs as run
    where run.public_id = '018f0000-0000-7000-8000-000000009808'
  $$,
  '23514',
  'terminal ingestion run request_count must equal persisted HTTP exchange count',
  'run finalization cannot understate its persisted HTTP request count'
);

select ok(
  (
    select ingest.finish_ingestion_run(
      p_run_id => run.id,
      p_lease_token => run.lease_token,
      p_worker_id => run.lease_owner,
      p_status => 'success',
      p_request_count => 3,
      p_cursor_before => '{}'::jsonb,
      p_cursor_after => '{"cursor":"three"}'::jsonb
    )
    from ingest.runs as run
    where run.public_id = '018f0000-0000-7000-8000-000000009808'
  ),
  'run finalization accepts and stores the database-derived request count'
);

select throws_ok(
  $$
    insert into ingest.http_exchanges (
      public_id, contract_version, run_id, source_id, endpoint_id, request_no,
      idempotency_key, request_method, request_url_redacted,
      request_fingerprint_sha256
    )
    select
      '018f0000-0000-7000-8000-000000009814', '1.1.0', run.id,
      run.source_id, run.endpoint_id, 3, 'http-exchange-after-finish', 'GET',
      'https://example.test/api', repeat('7', 64)
    from ingest.runs as run
    where run.public_id = '018f0000-0000-7000-8000-000000009808'
  $$,
  '55000',
  'ingestion side effects require the active run lease',
  'HTTP exchanges cannot be appended after run finalization'
);

reset role;

-- A reclaimed job has no finalizer argument, so the reclaim trigger derives
-- request_count from the same immutable exchange ledger.
insert into ingest.jobs (
  public_id, contract_version, source_id, endpoint_id, collection_target_id,
  collection_target_revision_id, adapter_release_id, idempotency_key
)
select
  '018f0000-0000-7000-8000-000000009815', '1.1.0', target.source_id,
  target.endpoint_id, target.id, revision.id, adapter.id,
  'http-exchange-test-job-2'
from core.collection_targets as target
join core.collection_target_revisions as revision
  on revision.collection_target_id = target.id
join core.adapter_releases as adapter on adapter.source_id = target.source_id
where target.public_id = '018f0000-0000-7000-8000-000000009805'
  and revision.public_id = '018f0000-0000-7000-8000-000000009806'
  and adapter.public_id = '018f0000-0000-7000-8000-000000009804';

set local role firewatch_collector;

select is(
  (select count(*) from ingest.claim_collection_job('http-exchange-worker-2', interval '1 hour')),
  1::bigint,
  'collector claims the reclaim fixture job'
);

insert into ingest.runs (
  public_id, contract_version, job_id, source_id, endpoint_id,
  collection_target_id, collection_target_revision_id, adapter_release_id,
  lease_token, lease_owner, attempt_no, collector_version
)
select
  '018f0000-0000-7000-8000-000000009816', '1.1.0', job.id,
  job.source_id, job.endpoint_id, job.collection_target_id,
  job.collection_target_revision_id, job.adapter_release_id, job.lease_token,
  job.lease_owner, job.attempt_count, 'http-exchange-test-collector'
from ingest.jobs as job
where job.public_id = '018f0000-0000-7000-8000-000000009815';

insert into ingest.http_exchanges (
  public_id, contract_version, run_id, source_id, endpoint_id, request_no,
  idempotency_key, request_method, request_url_redacted,
  request_fingerprint_sha256
)
select
  '018f0000-0000-7000-8000-000000009817', '1.1.0', run.id,
  run.source_id, run.endpoint_id, 1, 'http-exchange-test-timeout', 'GET',
  'https://example.test/api', repeat('8', 64)
from ingest.runs as run
where run.public_id = '018f0000-0000-7000-8000-000000009816';

reset role;

update ingest.jobs
set lease_expires_at = now() - interval '1 minute'
where public_id = '018f0000-0000-7000-8000-000000009815';

set local role firewatch_collector;

select is(
  (select count(*) from ingest.claim_collection_job('http-exchange-worker-3', interval '1 hour')),
  1::bigint,
  'expired job is reclaimed'
);

reset role;

select ok(
  (select status = 'failed' and request_count = 1
   from ingest.runs
   where public_id = '018f0000-0000-7000-8000-000000009816')
  and (select outcome = 'indeterminate'
          and completed_at is not null
          and error_class = 'database'
       from ingest.http_exchanges
       where public_id = '018f0000-0000-7000-8000-000000009817'),
  'lease reclaim terminalizes pending issuance before deriving and closing the run'
);

select * from finish();
rollback;
