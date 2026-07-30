-- Record issuance before outbound network I/O. Runs remain the aggregate
-- attempt ledger; this table is the per-request source of truth. Request
-- metadata is deliberately redacted/safe, while every received HTTP response
-- (including an empty or error response) points at the exact raw response
-- occurrence in ingest.raw_objects.

-- Safe request evidence is deliberately narrower than arbitrary HTTP data.
-- URLs contain only an HTTPS origin/path; query values live in a separately
-- allowlisted map. Safe maps are flat and key-allowlisted, so nested objects
-- and non-reviewed names are rejected. A trusted collector remains responsible
-- for ensuring opaque values under allowed keys are not credentials.
create or replace function ingest.http_url_is_safe(p_url text)
returns boolean
language sql
immutable
strict
security invoker
set search_path = ''
as $$
  select p_url = btrim(p_url)
    and octet_length(p_url) <= 4096
    and p_url ~* '^https://[a-z0-9]([a-z0-9.-]*[a-z0-9])?(:[0-9]{1,5})?(/[a-z0-9._~!$&''()*+,;=:@%/\[\]-]*)?$'
    and strpos(p_url, '?') = 0
    and strpos(p_url, '#') = 0
    and p_url !~ '[[:cntrl:][:space:]]'
    and p_url !~* '%(23|3f|40)'
    and p_url !~* '(^|[/._-])(authorization|password|secret|signature|credential|api[-_]?key|access[-_]?token|refresh[-_]?token)([/._=-]|$)';
$$;

create or replace function ingest.http_safe_text_is_allowed(p_value text)
returns boolean
language sql
immutable
strict
security invoker
set search_path = ''
as $$
  select octet_length(p_value) <= 2048
    and p_value !~ '[[:cntrl:]]'
    and p_value !~* '^\s*(bearer|basic)\s+'
    and strpos(lower(p_value), '://') = 0
    and p_value !~* '//[^[:space:]]+\?';
$$;

create or replace function ingest.http_safe_map_is_allowed(
  p_values jsonb,
  p_kind text
)
returns boolean
language plpgsql
immutable
strict
security invoker
set search_path = ''
as $$
declare
  allowed_keys text[];
  entry record;
  element jsonb;
  scalar_text text;
begin
  allowed_keys := case p_kind
    when 'request_header' then array[
      'accept', 'accept-encoding', 'accept-language', 'content-type',
      'client-id', 'cmr-search-after', 'if-match', 'if-modified-since',
      'if-none-match', 'if-unmodified-since', 'range', 'user-agent',
      'x-request-id'
    ]::text[]
    when 'response_header' then array[
      'age', 'cache-control', 'cmr-hits', 'cmr-request-id',
      'cmr-search-after', 'cmr-timed-out', 'cmr-took', 'content-encoding',
      'content-language', 'content-length', 'content-range', 'content-type',
      'date', 'etag', 'expires', 'last-modified', 'retry-after',
      'traceparent', 'vary', 'x-ratelimit-limit', 'x-ratelimit-remaining',
      'x-ratelimit-reset', 'x-request-id'
    ]::text[]
    when 'request_query' then array[
      'area', 'bbox', 'bounding_box', 'collection', 'concept_id', 'cursor',
      'current', 'date', 'date_from', 'date_to', 'end', 'end_date', 'exclude',
      'forecast_days', 'format', 'hourly', 'hours', 'ids', 'language', 'lat',
      'latitude', 'limit', 'lon', 'longitude', 'max_results', 'model',
      'offset', 'order', 'page', 'page_num', 'page_size', 'polygon',
      'product', 'provider', 'radius', 'search_after', 'short_name',
      'short_name[]', 'sort_key', 'sort_key[]', 'start', 'start_date',
      'start_time', 'temperature_unit', 'temporal', 'timezone',
      'tweet.fields', 'units', 'version', 'wind_speed_unit'
    ]::text[]
    when 'request_metadata' then array[
      'attempt', 'cache_mode', 'collection', 'cursor_kind', 'operation',
      'page', 'page_size', 'product', 'scope'
    ]::text[]
    when 'result_metadata' then array[
      'cache_status', 'class', 'error_class', 'page', 'page_count', 'partial',
      'provider_request_id', 'reason', 'response_body_bytes',
      'retry_after_ms', 'terminal', 'truncated'
    ]::text[]
    else null
  end;

  if allowed_keys is null or jsonb_typeof(p_values) <> 'object' then
    return false;
  end if;

  for entry in
    select item.key, item.value
    from jsonb_each(p_values) as item
  loop
    if entry.key <> lower(entry.key) or not (entry.key = any(allowed_keys)) then
      return false;
    end if;

    if jsonb_typeof(entry.value) = 'array' then
      for element in select item.value from jsonb_array_elements(entry.value) as item
      loop
        if jsonb_typeof(element) not in ('string', 'number', 'boolean', 'null') then
          return false;
        end if;
        if jsonb_typeof(element) = 'string' then
          scalar_text := element #>> '{}';
          if not ingest.http_safe_text_is_allowed(scalar_text) then
            return false;
          end if;
        end if;
      end loop;
    elsif jsonb_typeof(entry.value) not in ('string', 'number', 'boolean', 'null') then
      return false;
    elsif jsonb_typeof(entry.value) = 'string' then
      scalar_text := entry.value #>> '{}';
      if not ingest.http_safe_text_is_allowed(scalar_text) then
        return false;
      end if;
    end if;
  end loop;

  return true;
end;
$$;

revoke execute on function ingest.http_url_is_safe(text)
  from public, anon, authenticated, service_role,
  firewatch_catalog_admin, firewatch_collector, firewatch_reconciler,
  firewatch_publisher, firewatch_dispatcher;
revoke execute on function ingest.http_safe_text_is_allowed(text)
  from public, anon, authenticated, service_role,
  firewatch_catalog_admin, firewatch_collector, firewatch_reconciler,
  firewatch_publisher, firewatch_dispatcher;
revoke execute on function ingest.http_safe_map_is_allowed(jsonb, text)
  from public, anon, authenticated, service_role,
  firewatch_catalog_admin, firewatch_collector, firewatch_reconciler,
  firewatch_publisher, firewatch_dispatcher;
grant execute on function ingest.http_url_is_safe(text),
  ingest.http_safe_text_is_allowed(text),
  ingest.http_safe_map_is_allowed(jsonb, text)
  to firewatch_collector;

create table ingest.http_exchanges (
  id bigint generated always as identity primary key,
  public_id core.uuid_v7 not null unique,
  contract_version text not null check (contract_version = '1.1.0'),
  run_id bigint not null,
  source_id bigint not null,
  endpoint_id bigint not null,
  request_no integer not null check (request_no > 0),
  idempotency_key text not null unique check (btrim(idempotency_key) <> ''),
  request_method text not null check (
    request_method ~ '^[A-Z][A-Z0-9_-]{0,31}$'
  ),
  request_url_redacted text not null check (
    ingest.http_url_is_safe(request_url_redacted)
  ),
  request_query_safe jsonb not null default '{}'::jsonb check (
    octet_length(request_query_safe::text) <= 16384
    and ingest.http_safe_map_is_allowed(request_query_safe, 'request_query')
  ),
  request_fingerprint_sha256 text not null
    check (request_fingerprint_sha256 ~ '^[a-f0-9]{64}$'),
  request_body_blob_id bigint,
  request_body_sha256 text
    check (request_body_sha256 is null or request_body_sha256 ~ '^[a-f0-9]{64}$'),
  request_headers_safe jsonb not null default '{}'::jsonb
    check (
      jsonb_typeof(request_headers_safe) = 'object'
      and octet_length(request_headers_safe::text) <= 16384
      and ingest.http_safe_map_is_allowed(request_headers_safe, 'request_header')
    ),
  started_at timestamptz not null,
  completed_at timestamptz,
  outcome text not null default 'pending'
    check (outcome in ('pending', 'response', 'transport_error', 'indeterminate')),
  http_status smallint check (http_status is null or http_status between 100 and 599),
  latency_ms bigint check (latency_ms is null or latency_ms >= 0),
  response_headers_safe jsonb not null default '{}'::jsonb
    check (
      jsonb_typeof(response_headers_safe) = 'object'
      and octet_length(response_headers_safe::text) <= 16384
      and ingest.http_safe_map_is_allowed(response_headers_safe, 'response_header')
    ),
  response_raw_object_id bigint,
  error_class text check (
    error_class is null or error_class in (
      'timeout', 'authentication', 'rate_limit', 'network',
      'upstream', 'parser', 'validation', 'database'
    )
  ),
  error_detail_safe text check (
    error_detail_safe is null or (
      btrim(error_detail_safe) <> ''
      and char_length(error_detail_safe) <= 4096
    )
  ),
  request_metadata_safe jsonb not null default '{}'::jsonb
    check (
      jsonb_typeof(request_metadata_safe) = 'object'
      and octet_length(request_metadata_safe::text) <= 32768
      and ingest.http_safe_map_is_allowed(request_metadata_safe, 'request_metadata')
    ),
  result_metadata_safe jsonb not null default '{}'::jsonb
    check (
      jsonb_typeof(result_metadata_safe) = 'object'
      and octet_length(result_metadata_safe::text) <= 32768
      and ingest.http_safe_map_is_allowed(result_metadata_safe, 'result_metadata')
    ),
  created_at timestamptz not null default now(),
  constraint http_exchanges_run_request_key unique (run_id, request_no),
  constraint http_exchanges_response_raw_object_key unique (response_raw_object_id),
  constraint http_exchanges_request_body_pair_check check (
    (request_body_blob_id is null and request_body_sha256 is null)
    or (request_body_blob_id is not null and request_body_sha256 is not null)
  ),
  constraint http_exchanges_get_has_no_body_check check (
    request_method not in ('GET', 'HEAD') or request_body_blob_id is null
  ),
  constraint http_exchanges_run_execution_fkey
    foreign key (run_id, source_id, endpoint_id)
    references ingest.runs(id, source_id, endpoint_id),
  constraint http_exchanges_request_body_hash_fkey
    foreign key (request_body_blob_id, request_body_sha256)
    references ingest.content_blobs(id, content_sha256),
  constraint http_exchanges_response_same_run_fkey
    foreign key (response_raw_object_id, run_id, source_id)
    references ingest.raw_objects(id, run_id, source_id),
  constraint http_exchanges_time_order_check check (
    completed_at is null or completed_at >= started_at
  ),
  constraint http_exchanges_outcome_shape_check check (
    (
      outcome = 'pending'
      and completed_at is null
      and http_status is null
      and latency_ms is null
      and response_headers_safe = '{}'::jsonb
      and response_raw_object_id is null
      and error_class is null
      and error_detail_safe is null
      and result_metadata_safe = '{}'::jsonb
    )
    or (
      outcome = 'response'
      and completed_at is not null
      and http_status is not null
      and latency_ms is not null
      and response_raw_object_id is not null
    )
    or (
      outcome = 'transport_error'
      and completed_at is not null
      and http_status is null
      and latency_ms is not null
      and response_headers_safe = '{}'::jsonb
      and response_raw_object_id is null
      and error_class is not null
    )
    or (
      outcome = 'indeterminate'
      and completed_at is not null
      and http_status is null
      and latency_ms is not null
      and response_headers_safe = '{}'::jsonb
      and response_raw_object_id is null
      and error_class is not null
    )
  )
);

-- `inline_payload` is semantic JSON and cannot represent upstream wire bytes:
-- jsonb normalizes whitespace and object-key order. Exact request/response
-- bytes use `inline_bytes` (database-hashed) or a content-addressed Storage
-- object (collector-verified; the database verifies its address, not bytes).
alter table ingest.content_blobs
  add column inline_bytes bytea;

alter table ingest.content_blobs
  drop constraint content_blobs_representation_check;
alter table ingest.content_blobs
  add constraint content_blobs_representation_check check (
    (
      storage_bucket is not null
      and storage_path is not null
      and inline_payload is null
      and inline_bytes is null
    )
    or (
      storage_bucket is null
      and storage_path is null
      and inline_payload is not null
      and inline_bytes is null
    )
    or (
      storage_bucket is null
      and storage_path is null
      and inline_payload is null
      and inline_bytes is not null
    )
  );
alter table ingest.content_blobs
  add constraint content_blobs_inline_bytes_integrity_check check (
    inline_bytes is null or (
      byte_size = octet_length(inline_bytes)
      and content_sha256 = encode(pg_catalog.sha256(inline_bytes), 'hex')
    )
  ) not valid;
alter table ingest.content_blobs
  add constraint content_blobs_canonical_json_integrity_check check (
    inline_payload is null or (
      byte_size = octet_length(convert_to(inline_payload::text, 'UTF8'))
      and content_sha256 = encode(
        pg_catalog.sha256(convert_to(inline_payload::text, 'UTF8')),
        'hex'
      )
    )
  ) not valid;
alter table ingest.content_blobs
  add column representation_kind text generated always as (
    case
      when inline_bytes is not null then 'inline_bytes'
      when inline_payload is not null then 'canonical_json'
      else 'storage_object'
    end
  ) stored;

comment on column ingest.content_blobs.inline_payload is
  'Canonical PostgreSQL jsonb value, database-hashed from jsonb::text; never the original upstream wire serialization.';
comment on column ingest.content_blobs.inline_bytes is
  'Exact inline bytes with byte_size and SHA-256 verified by database constraints.';
comment on column ingest.content_blobs.representation_kind is
  'Derived representation: inline_bytes is database-verified exact bytes; canonical_json is normalized semantic JSON; storage_object bytes are collector-verified at a database-enforced content address.';

-- Every raw upstream response is born under exactly one pending HTTP exchange.
-- NOT VALID constraints preserve migration compatibility with historical rows
-- while still enforcing the invariant for all new inserts.
alter table ingest.http_exchanges
  add constraint http_exchanges_execution_identity_key
  unique (id, run_id, source_id, endpoint_id);

alter table ingest.raw_objects
  add column http_exchange_id bigint;
alter table ingest.raw_objects
  add constraint raw_objects_http_exchange_required_check
  check (http_exchange_id is not null) not valid;
alter table ingest.raw_objects
  add constraint raw_objects_http_exchange_execution_fkey
  foreign key (http_exchange_id, run_id, source_id, endpoint_id)
  references ingest.http_exchanges(id, run_id, source_id, endpoint_id)
  not valid;
alter table ingest.raw_objects
  add constraint raw_objects_response_exchange_key
  unique (id, http_exchange_id, run_id, source_id, endpoint_id);
create unique index raw_objects_http_exchange_idx
  on ingest.raw_objects(http_exchange_id)
  where http_exchange_id is not null;

alter table ingest.http_exchanges
  add constraint http_exchanges_response_exact_exchange_fkey
  foreign key (response_raw_object_id, id, run_id, source_id, endpoint_id)
  references ingest.raw_objects(
    id, http_exchange_id, run_id, source_id, endpoint_id
  )
  not valid;

comment on column ingest.raw_objects.http_exchange_id is
  'The unique issued HTTP exchange that produced this exact raw response occurrence.';

create index http_exchanges_endpoint_started_idx
  on ingest.http_exchanges(endpoint_id, started_at desc, id desc);
create index http_exchanges_request_body_blob_idx
  on ingest.http_exchanges(request_body_blob_id)
  where request_body_blob_id is not null;

comment on column ingest.http_exchanges.request_url_redacted is
  'Credential-free HTTPS origin/path exactly matching the catalog endpoint base_url. Query parameters are stored separately in request_query_safe.';
comment on column ingest.http_exchanges.request_query_safe is
  'Flat, key-allowlisted credential-free query parameters. Signed URL parameters and credential keys are not accepted.';
comment on column ingest.http_exchanges.request_fingerprint_sha256 is
  'SHA-256 of the canonical credential-free request identity, including the request body hash when present.';
comment on column ingest.http_exchanges.request_body_blob_id is
  'Exact credential-redacted outbound request body, persisted before issuance; GET and HEAD requests have no body.';
comment on column ingest.http_exchanges.request_headers_safe is
  'Credential-free request headers only; authorization, cookies, and other secrets must be omitted or redacted.';
comment on column ingest.http_exchanges.request_metadata_safe is
  'Bounded credential-free request context only.';
comment on column ingest.http_exchanges.result_metadata_safe is
  'Bounded credential-free terminal result context only.';
comment on column ingest.http_exchanges.response_raw_object_id is
  'Exact application-visible response bytes; empty HTTP bodies use a zero-byte content blob/raw object.';
comment on column ingest.http_exchanges.outcome is
  'Issued rows begin pending and terminalize exactly once as response, transport_error, or indeterminate.';

-- Keep insertion admission clocks database-owned for the new ledger too.
create or replace function core.assign_insert_audit_clock()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  case tg_table_schema || '.' || tg_table_name
    when 'core.providers' then
      new.created_at := now(); new.updated_at := now();
    when 'core.sources' then
      new.created_at := now(); new.updated_at := now();
    when 'core.incidents' then
      new.created_at := now(); new.updated_at := now();
    when 'core.aoi_versions' then new.recorded_at := now();
    when 'core.endpoints' then new.created_at := now();
    when 'core.adapter_releases' then new.created_at := now();
    when 'core.collection_targets' then
      new.created_at := now(); new.updated_at := now();
    when 'core.collection_target_revisions' then
      new.recorded_at := now(); new.created_at := now();
    when 'core.incident_bindings' then
      new.created_at := now(); new.updated_at := now();
    when 'ingest.endpoint_state' then new.updated_at := now();
    when 'ingest.adapter_release_state' then new.updated_at := now();
    when 'ingest.collection_target_state' then new.updated_at := now();
    when 'ingest.jobs' then
      new.created_at := now(); new.updated_at := now();
    when 'ingest.runs' then
      new.started_at := now(); new.created_at := now(); new.updated_at := now();
    when 'ingest.content_blobs' then new.created_at := now();
    when 'ingest.raw_objects' then new.created_at := now();
    when 'ingest.http_exchanges' then
      new.started_at := now(); new.created_at := now();
    when 'ingest.source_revisions' then new.recorded_at := now();
    when 'ingest.global_observations' then new.ingested_at := now();
    when 'ingest.incident_relevance' then new.evaluated_at := now();
    when 'truth.events' then new.recorded_at := now();
    when 'truth.evidence' then new.recorded_at := now();
    when 'truth.assertions' then new.recorded_at := now();
    when 'truth.snapshots' then new.created_at := now();
    when 'truth.material_changes' then
      new.calculated_at := now(); new.created_at := now();
    when 'truth.publications' then new.recorded_at := now();
    when 'truth.outbox' then
      new.created_at := now(); new.updated_at := now();
    when 'truth.source_health' then
      new.checked_at := now(); new.created_at := now();
    else
      raise exception 'audit-clock trigger used on unsupported table' using errcode = '55000';
  end case;
  return new;
end;
$$;

revoke execute on function core.assign_insert_audit_clock()
  from public, anon, authenticated, service_role,
  firewatch_catalog_admin, firewatch_collector, firewatch_reconciler,
  firewatch_publisher, firewatch_dispatcher;

create trigger assign_insert_audit_clock
before insert on ingest.http_exchanges
for each row execute function core.assign_insert_audit_clock();

-- HTTP exchanges are ingestion side effects and therefore receive the same
-- live job/run lease fencing as raw objects and normalized revisions.
create or replace function ingest.require_active_run_lease()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  candidate_run_id bigint;
  candidate_job_id bigint;
begin
  if tg_table_name in ('raw_objects', 'http_exchanges', 'source_revisions') then
    candidate_run_id := new.run_id;
  elsif tg_table_name = 'global_observations' then
    select sr.run_id into candidate_run_id
    from ingest.source_revisions as sr
    where sr.id = new.source_revision_id;
  else
    raise exception 'active-run lease trigger used on unsupported table' using errcode = '55000';
  end if;

  if candidate_run_id is null then
    raise exception 'ingestion side effects require the active run lease' using errcode = '55000';
  end if;

  select r.job_id into candidate_job_id
  from ingest.runs as r
  where r.id = candidate_run_id;

  if candidate_job_id is null then
    raise exception 'ingestion side effects require the active run lease' using errcode = '55000';
  end if;

  -- Every lease path locks job -> run. Reclaim already owns the job row before
  -- its trigger closes a run, so this order prevents run/job lock inversion.
  perform 1
  from ingest.jobs as j
  where j.id = candidate_job_id
    and j.status = 'running'
    and j.lease_expires_at > now()
  for update of j;

  if not found then
    raise exception 'ingestion side effects require the active run lease' using errcode = '55000';
  end if;

  perform 1
  from ingest.runs as r
  join ingest.jobs as j on j.id = r.job_id
  where r.id = candidate_run_id
    and r.job_id = candidate_job_id
    and r.status = 'running'
    and j.status = 'running'
    and r.lease_token = j.lease_token
    and r.lease_owner = j.lease_owner
    and j.lease_expires_at > now()
  for update of r;

  if not found then
    raise exception 'ingestion side effects require the active run lease' using errcode = '55000';
  end if;
  return new;
end;
$$;

revoke execute on function ingest.require_active_run_lease()
  from public, anon, authenticated, service_role,
  firewatch_catalog_admin, firewatch_collector, firewatch_reconciler,
  firewatch_publisher, firewatch_dispatcher;

create trigger http_exchanges_require_active_run
before insert on ingest.http_exchanges
for each row execute function ingest.require_active_run_lease();

create or replace function ingest.validate_new_http_exchange()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if new.outcome <> 'pending'
    or new.completed_at is not null
    or new.http_status is not null
    or new.latency_ms is not null
    or new.response_headers_safe <> '{}'::jsonb
    or new.response_raw_object_id is not null
    or new.error_class is not null
    or new.error_detail_safe is not null
    or new.result_metadata_safe <> '{}'::jsonb
    or not ingest.http_url_is_safe(new.request_url_redacted)
    or not ingest.http_safe_map_is_allowed(new.request_query_safe, 'request_query')
    or not ingest.http_safe_map_is_allowed(new.request_headers_safe, 'request_header')
    or not ingest.http_safe_map_is_allowed(new.request_metadata_safe, 'request_metadata')
    or not exists (
      select 1
      from core.endpoints as endpoint
      where endpoint.id = new.endpoint_id
        and endpoint.source_id = new.source_id
        and new.request_url_redacted = rtrim(endpoint.base_url, '/')
    )
    or (
      new.request_body_blob_id is not null
      and not exists (
        select 1
        from ingest.content_blobs as body
        where body.id = new.request_body_blob_id
          and body.content_sha256 = new.request_body_sha256
          and body.representation_kind in ('inline_bytes', 'storage_object')
      )
    )
  then
    raise exception 'HTTP exchanges must be issued in pristine pending state'
      using errcode = '23514';
  end if;
  return new;
end;
$$;

create or replace function ingest.validate_http_exchange_transition()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if not ingest.http_url_is_safe(new.request_url_redacted)
    or not ingest.http_safe_map_is_allowed(new.request_query_safe, 'request_query')
    or not ingest.http_safe_map_is_allowed(new.request_headers_safe, 'request_header')
    or not ingest.http_safe_map_is_allowed(new.request_metadata_safe, 'request_metadata')
    or not ingest.http_safe_map_is_allowed(new.response_headers_safe, 'response_header')
    or not ingest.http_safe_map_is_allowed(new.result_metadata_safe, 'result_metadata')
    or (
      new.error_detail_safe is not null
      and not ingest.http_safe_text_is_allowed(new.error_detail_safe)
    )
  then
    raise exception 'HTTP exchange safe fields violate the credential-free allowlist'
      using errcode = '23514';
  end if;

  if old.outcome <> 'pending' then
    raise exception 'terminal HTTP exchanges are immutable'
      using errcode = '55000';
  end if;

  if new.id <> old.id
    or new.public_id <> old.public_id
    or new.contract_version <> old.contract_version
    or new.run_id <> old.run_id
    or new.source_id <> old.source_id
    or new.endpoint_id <> old.endpoint_id
    or new.request_no <> old.request_no
    or new.idempotency_key <> old.idempotency_key
    or new.request_method <> old.request_method
    or new.request_url_redacted <> old.request_url_redacted
    or new.request_query_safe <> old.request_query_safe
    or new.request_fingerprint_sha256 <> old.request_fingerprint_sha256
    or new.request_body_blob_id is distinct from old.request_body_blob_id
    or new.request_body_sha256 is distinct from old.request_body_sha256
    or new.request_headers_safe <> old.request_headers_safe
    or new.request_metadata_safe <> old.request_metadata_safe
    or new.started_at <> old.started_at
    or new.created_at <> old.created_at
  then
    raise exception 'HTTP exchange request identity is immutable after issuance'
      using errcode = '55000';
  end if;

  if new.outcome not in ('response', 'transport_error', 'indeterminate') then
    raise exception 'pending HTTP exchanges may only transition to a terminal outcome'
      using errcode = '55000';
  end if;
  return new;
end;
$$;

revoke execute on function ingest.validate_new_http_exchange()
  from public, anon, authenticated, service_role,
  firewatch_catalog_admin, firewatch_collector, firewatch_reconciler,
  firewatch_publisher, firewatch_dispatcher;
revoke execute on function ingest.validate_http_exchange_transition()
  from public, anon, authenticated, service_role,
  firewatch_catalog_admin, firewatch_collector, firewatch_reconciler,
  firewatch_publisher, firewatch_dispatcher;

create trigger http_exchanges_validate_new
before insert on ingest.http_exchanges
for each row execute function ingest.validate_new_http_exchange();

create trigger http_exchanges_validate_transition
before update on ingest.http_exchanges
for each row execute function ingest.validate_http_exchange_transition();

create trigger http_exchanges_reject_delete
before delete on ingest.http_exchanges
for each row execute function core.reject_mutation();

create or replace function ingest.validate_raw_http_exchange()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.metadata <> '{}'::jsonb then
    raise exception 'raw HTTP response metadata must use the typed exchange envelope'
      using errcode = '23514';
  end if;

  perform 1
  from ingest.http_exchanges as exchange
  join ingest.content_blobs as blob
    on blob.id = new.blob_id
    and blob.content_sha256 = new.content_sha256
  where exchange.id = new.http_exchange_id
    and exchange.run_id = new.run_id
    and exchange.source_id = new.source_id
    and exchange.endpoint_id = new.endpoint_id
    and exchange.outcome = 'pending'
    and blob.representation_kind in ('inline_bytes', 'storage_object')
  for update of exchange;

  if not found then
    raise exception 'raw HTTP responses require their pending exchange and exact-byte content'
      using errcode = '23514';
  end if;
  return new;
end;
$$;

create or replace function ingest.validate_source_revision_http_evidence()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (
    select 1
    from ingest.raw_objects as raw
    join ingest.http_exchanges as exchange
      on exchange.id = raw.http_exchange_id
      and exchange.run_id = raw.run_id
      and exchange.source_id = raw.source_id
      and exchange.endpoint_id = raw.endpoint_id
    where raw.id = new.raw_object_id
      and raw.run_id = new.run_id
      and raw.source_id = new.source_id
      and exchange.outcome = 'response'
      and exchange.response_raw_object_id = raw.id
  ) then
    raise exception 'source revisions require a terminal HTTP response exchange'
      using errcode = '23514';
  end if;
  return new;
end;
$$;

revoke execute on function ingest.validate_raw_http_exchange()
  from public, anon, authenticated, service_role,
  firewatch_catalog_admin, firewatch_collector, firewatch_reconciler,
  firewatch_publisher, firewatch_dispatcher;
revoke execute on function ingest.validate_source_revision_http_evidence()
  from public, anon, authenticated, service_role,
  firewatch_catalog_admin, firewatch_collector, firewatch_reconciler,
  firewatch_publisher, firewatch_dispatcher;

create trigger raw_objects_validate_http_exchange
before insert on ingest.raw_objects
for each row execute function ingest.validate_raw_http_exchange();

create trigger source_revisions_validate_http_exchange
before insert on ingest.source_revisions
for each row execute function ingest.validate_source_revision_http_evidence();

-- The collector cannot UPDATE the ledger directly. This is the only runtime
-- terminalization path, and it fences the write with the still-live job lease.
create or replace function ingest.finish_http_exchange(
  p_exchange_id bigint,
  p_run_id bigint,
  p_lease_token uuid,
  p_worker_id text,
  p_outcome text,
  p_http_status smallint default null,
  p_response_raw_object_id bigint default null,
  p_response_headers_safe jsonb default '{}'::jsonb,
  p_error_class text default null,
  p_error_detail_safe text default null,
  p_result_metadata_safe jsonb default '{}'::jsonb
)
returns boolean
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  did_finish boolean;
  candidate_job_id bigint;
begin
  if p_exchange_id is null
    or p_run_id is null
    or p_lease_token is null
    or p_worker_id is null
    or btrim(p_worker_id) = ''
    or p_outcome is null
    or p_outcome not in ('response', 'transport_error')
    or p_response_headers_safe is null
    or jsonb_typeof(p_response_headers_safe) <> 'object'
    or octet_length(p_response_headers_safe::text) > 16384
    or not ingest.http_safe_map_is_allowed(p_response_headers_safe, 'response_header')
    or p_result_metadata_safe is null
    or jsonb_typeof(p_result_metadata_safe) <> 'object'
    or octet_length(p_result_metadata_safe::text) > 32768
    or not ingest.http_safe_map_is_allowed(p_result_metadata_safe, 'result_metadata')
    or (p_http_status is not null and p_http_status not between 100 and 599)
    or (
      p_error_detail_safe is not null
      and (
        btrim(p_error_detail_safe) = ''
        or char_length(p_error_detail_safe) > 4096
        or not ingest.http_safe_text_is_allowed(p_error_detail_safe)
      )
    )
    or (p_error_class is not null and p_error_class not in (
      'timeout', 'authentication', 'rate_limit', 'network',
      'upstream', 'parser', 'validation', 'database'
    ))
    or (
      p_outcome = 'response'
      and (p_http_status is null or p_response_raw_object_id is null)
    )
    or (
      p_outcome = 'transport_error'
      and (
        p_http_status is not null
        or p_response_raw_object_id is not null
        or p_response_headers_safe <> '{}'::jsonb
        or p_error_class is null
      )
    )
  then
    return false;
  end if;

  select run.job_id into candidate_job_id
  from ingest.runs as run
  where run.id = p_run_id;

  if candidate_job_id is null then
    return false;
  end if;

  -- Lock job -> run -> exchange, matching issuance, run finalization, and
  -- reclaim. Reclaim already holds the job row when its trigger starts.
  perform 1
  from ingest.jobs as job
  where job.id = candidate_job_id
    and job.status = 'running'
    and job.lease_token = p_lease_token
    and job.lease_owner = p_worker_id
    and job.lease_expires_at > now()
  for update of job;

  if not found then
    return false;
  end if;

  perform 1
  from ingest.runs as run
  where run.id = p_run_id
    and run.job_id = candidate_job_id
    and run.status = 'running'
    and run.lease_token = p_lease_token
    and run.lease_owner = p_worker_id
  for update of run;

  if not found then
    return false;
  end if;

  with finished as (
    update ingest.http_exchanges as exchange
    set outcome = p_outcome,
        completed_at = now(),
        latency_ms = greatest(
          0::numeric,
          floor(extract(epoch from (now() - exchange.started_at)) * 1000)
        )::bigint,
        http_status = p_http_status,
        response_headers_safe = p_response_headers_safe,
        response_raw_object_id = p_response_raw_object_id,
        error_class = p_error_class,
        error_detail_safe = p_error_detail_safe,
        result_metadata_safe = p_result_metadata_safe
    where exchange.id = p_exchange_id
      and exchange.run_id = p_run_id
      and exchange.outcome = 'pending'
      and (
        p_outcome <> 'response'
        or exists (
          select 1
          from ingest.raw_objects as raw
          where raw.id = p_response_raw_object_id
            and raw.http_exchange_id = exchange.id
            and raw.run_id = exchange.run_id
            and raw.source_id = exchange.source_id
            and raw.endpoint_id = exchange.endpoint_id
        )
      )
      and (
        p_outcome <> 'transport_error'
        or not exists (
          select 1
          from ingest.raw_objects as raw
          where raw.http_exchange_id = exchange.id
        )
      )
    returning true as exchange_finished
  )
  select coalesce((select exchange_finished from finished), false)
    into did_finish;

  return did_finish;
end;
$$;

revoke execute on function ingest.finish_http_exchange(
  bigint, bigint, uuid, text, text, smallint, bigint, jsonb, text, text, jsonb
) from public, anon, authenticated, service_role,
  firewatch_catalog_admin, firewatch_collector, firewatch_reconciler,
  firewatch_publisher, firewatch_dispatcher;
grant execute on function ingest.finish_http_exchange(
  bigint, bigint, uuid, text, text, smallint, bigint, jsonb, text, text, jsonb
) to firewatch_collector;

-- Preserve the existing atomic run finalizer while making its lock order
-- explicit. All lease paths acquire job -> run; reclaim begins with the job
-- row already locked by the triggering UPDATE.
create or replace function ingest.finish_ingestion_run(
  p_run_id bigint,
  p_lease_token uuid,
  p_worker_id text,
  p_status text,
  p_http_status smallint default null,
  p_latency_ms integer default null,
  p_payload_sha256 text default null,
  p_raw_object_key text default null,
  p_item_count integer default 0,
  p_error_class text default null,
  p_error_detail_safe text default null,
  p_source_latest_observed_at timestamptz default null,
  p_request_count integer default 0,
  p_fetched_count integer default 0,
  p_accepted_count integer default 0,
  p_rejected_count integer default 0,
  p_duplicate_count integer default 0,
  p_cursor_before jsonb default null,
  p_cursor_after jsonb default null,
  p_request_meta jsonb default '{}'::jsonb,
  p_response_meta jsonb default '{}'::jsonb,
  p_error_meta jsonb default null,
  p_retry_at timestamptz default now()
)
returns boolean
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_job_id bigint;
  v_collection_target_id bigint;
  v_collection_target_revision_id bigint;
  v_started_at timestamptz;
  v_cursor_state jsonb;
  v_cadence interval;
  v_attempt_count integer;
  v_max_attempts integer;
begin
  if p_status is null or p_status not in ('success', 'not_modified', 'partial', 'failed')
    or p_worker_id is null or btrim(p_worker_id) = ''
    or (p_http_status is not null and p_http_status not between 100 and 599)
    or (p_latency_ms is not null and p_latency_ms < 0)
    or (p_payload_sha256 is not null and p_payload_sha256 !~ '^[a-f0-9]{64}$')
    or p_item_count is null or p_item_count < 0
    or p_request_count is null or p_request_count < 0
    or p_fetched_count is null or p_fetched_count < 0
    or p_accepted_count is null or p_accepted_count < 0
    or p_rejected_count is null or p_rejected_count < 0
    or p_duplicate_count is null or p_duplicate_count < 0
    or (p_cursor_before is not null and jsonb_typeof(p_cursor_before) <> 'object')
    or (p_cursor_after is not null and jsonb_typeof(p_cursor_after) <> 'object')
    or p_request_meta is null
    or not ingest.http_safe_map_is_allowed(p_request_meta, 'request_metadata')
    or p_response_meta is null
    or not ingest.http_safe_map_is_allowed(p_response_meta, 'result_metadata')
    or (
      p_error_meta is not null
      and not ingest.http_safe_map_is_allowed(p_error_meta, 'result_metadata')
    )
    or (
      p_error_detail_safe is not null
      and (
        btrim(p_error_detail_safe) = ''
        or char_length(p_error_detail_safe) > 4096
        or not ingest.http_safe_text_is_allowed(p_error_detail_safe)
      )
    )
    or (p_status = 'failed' and (p_retry_at is null or p_retry_at < now()))
    or (p_error_class is not null and p_error_class not in (
      'timeout', 'authentication', 'rate_limit', 'network',
      'upstream', 'parser', 'validation', 'database'
    ))
  then
    return false;
  end if;

  select run.job_id into v_job_id
  from ingest.runs as run
  where run.id = p_run_id;

  if v_job_id is null then
    return false;
  end if;

  select job.attempt_count, job.max_attempts
    into v_attempt_count, v_max_attempts
  from ingest.jobs as job
  where job.id = v_job_id
    and job.status = 'running'
    and job.lease_token = p_lease_token
    and job.lease_owner = p_worker_id
    and job.lease_expires_at > now()
  for update of job;

  if not found then
    return false;
  end if;

  select
    run.collection_target_id,
    run.collection_target_revision_id,
    run.started_at,
    state.cursor_state,
    revision.cadence
  into
    v_collection_target_id,
    v_collection_target_revision_id,
    v_started_at,
    v_cursor_state,
    v_cadence
  from ingest.runs as run
  join ingest.collection_target_state as state
    on state.collection_target_id = run.collection_target_id
    and state.collection_target_revision_id = run.collection_target_revision_id
  join core.collection_target_revisions as revision
    on revision.id = run.collection_target_revision_id
    and revision.collection_target_id = run.collection_target_id
  where run.id = p_run_id
    and run.job_id = v_job_id
    and run.status = 'running'
    and run.lease_token = p_lease_token
    and run.lease_owner = p_worker_id
  for update of run, state;

  if not found then
    return false;
  end if;

  if p_status in ('success', 'partial') then
    if jsonb_typeof(p_cursor_before) <> 'object'
      or jsonb_typeof(p_cursor_after) <> 'object'
      or v_cursor_state is distinct from p_cursor_before
    then
      return false;
    end if;
  elsif p_cursor_after is not null
    or (p_cursor_before is not null and v_cursor_state is distinct from p_cursor_before)
  then
    return false;
  end if;

  update ingest.collection_target_state as state
  set cursor_state = case
        when p_status in ('success', 'partial') then p_cursor_after
        else state.cursor_state
      end,
      last_started_at = v_started_at,
      last_succeeded_at = case
        when p_status in ('success', 'partial', 'not_modified') then now()
        else state.last_succeeded_at
      end,
      next_due_at = case
        when p_status = 'failed' and v_attempt_count < v_max_attempts then p_retry_at
        else now() + v_cadence
      end,
      consecutive_failures = case
        when p_status = 'failed' then state.consecutive_failures + 1
        else 0
      end,
      last_error = case when p_status = 'failed' then p_error_meta else null end,
      updated_at = now()
  where state.collection_target_id = v_collection_target_id
    and state.collection_target_revision_id = v_collection_target_revision_id;

  update ingest.runs as run
  set status = p_status,
      finished_at = now(),
      http_status = p_http_status,
      latency_ms = p_latency_ms,
      payload_sha256 = p_payload_sha256,
      raw_object_key = p_raw_object_key,
      item_count = p_item_count,
      error_class = p_error_class,
      error_detail_safe = p_error_detail_safe,
      source_latest_observed_at = p_source_latest_observed_at,
      request_count = p_request_count,
      fetched_count = p_fetched_count,
      accepted_count = p_accepted_count,
      rejected_count = p_rejected_count,
      duplicate_count = p_duplicate_count,
      cursor_before = p_cursor_before,
      cursor_after = p_cursor_after,
      request_meta = p_request_meta,
      response_meta = p_response_meta,
      error = p_error_meta,
      updated_at = now()
  where run.id = p_run_id;

  update ingest.jobs as job
  set status = case
        when p_status = 'failed' and v_attempt_count < v_max_attempts then 'retry'
        when p_status = 'failed' then 'failed'
        else 'succeeded'
      end,
      available_at = case
        when p_status = 'failed' and v_attempt_count < v_max_attempts then p_retry_at
        else job.available_at
      end,
      completed_at = case
        when p_status = 'failed' and v_attempt_count < v_max_attempts then null
        else now()
      end,
      lease_token = null,
      lease_owner = null,
      lease_expires_at = null,
      last_error = case when p_status = 'failed' then p_error_meta else null end,
      updated_at = now()
  where job.id = v_job_id;

  return true;
end;
$$;

revoke execute on function ingest.finish_ingestion_run(
  bigint, uuid, text, text, smallint, integer, text, text, integer, text, text,
  timestamptz, integer, integer, integer, integer, integer,
  jsonb, jsonb, jsonb, jsonb, jsonb, timestamptz
) from public, anon, authenticated, service_role,
  firewatch_catalog_admin, firewatch_collector, firewatch_reconciler,
  firewatch_publisher, firewatch_dispatcher;
grant execute on function ingest.finish_ingestion_run(
  bigint, uuid, text, text, smallint, integer, text, text, integer, text, text,
  timestamptz, integer, integer, integer, integer, integer,
  jsonb, jsonb, jsonb, jsonb, jsonb, timestamptz
) to firewatch_collector;

-- A terminal run may not claim more (or fewer) requests than its immutable
-- per-call ledger contains. This trigger covers finish_ingestion_run as well as
-- any future terminal transition path.
create or replace function ingest.require_http_exchange_count()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  recorded_request_count bigint;
  pending_request_count bigint;
  unledgered_raw_count bigint;
  unledgered_revision_count bigint;
begin
  if old.status = 'running' and new.status <> 'running' then
    select
      count(*),
      count(*) filter (where exchange.outcome = 'pending')
      into recorded_request_count, pending_request_count
    from ingest.http_exchanges as exchange
    where exchange.run_id = new.id;

    if pending_request_count > 0 then
      raise exception 'terminal ingestion run cannot contain pending HTTP exchanges'
        using errcode = '23514';
    end if;

    if new.request_count::bigint <> recorded_request_count then
      raise exception 'terminal ingestion run request_count must equal persisted HTTP exchange count'
        using errcode = '23514';
    end if;

    select count(*) into unledgered_raw_count
    from ingest.raw_objects as raw
    left join ingest.http_exchanges as exchange
      on exchange.id = raw.http_exchange_id
      and exchange.run_id = raw.run_id
      and exchange.source_id = raw.source_id
      and exchange.endpoint_id = raw.endpoint_id
    where raw.run_id = new.id
      and exchange.id is null;

    if unledgered_raw_count > 0 then
      raise exception 'terminal ingestion run cannot contain raw responses without HTTP exchanges'
        using errcode = '23514';
    end if;

    select count(*) into unledgered_revision_count
    from ingest.source_revisions as revision
    left join ingest.raw_objects as raw
      on raw.id = revision.raw_object_id
      and raw.run_id = revision.run_id
      and raw.source_id = revision.source_id
    left join ingest.http_exchanges as exchange
      on exchange.id = raw.http_exchange_id
      and exchange.run_id = raw.run_id
      and exchange.source_id = raw.source_id
      and exchange.endpoint_id = raw.endpoint_id
      and exchange.outcome = 'response'
      and exchange.response_raw_object_id = raw.id
    where revision.run_id = new.id
      and exchange.id is null;

    if unledgered_revision_count > 0 then
      raise exception 'terminal ingestion run cannot contain source revisions without terminal HTTP evidence'
        using errcode = '23514';
    end if;

    -- Persist the database-derived value after validating the caller's claim.
    new.request_count := recorded_request_count::integer;
  end if;
  return new;
end;
$$;

revoke execute on function ingest.require_http_exchange_count()
  from public, anon, authenticated, service_role,
  firewatch_catalog_admin, firewatch_collector, firewatch_reconciler,
  firewatch_publisher, firewatch_dispatcher;

create trigger runs_require_http_exchange_count
before update of status, request_count on ingest.runs
for each row execute function ingest.require_http_exchange_count();

-- Lease reclaim does not receive a caller-supplied count. Derive it from the
-- durable exchange ledger before the terminal-run invariant is evaluated.
create or replace function ingest.close_run_on_job_reclaim()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if old.status = 'running'
    and (
      new.status <> 'running'
      or new.lease_token is distinct from old.lease_token
      or new.lease_owner is distinct from old.lease_owner
    )
  then
    -- The triggering UPDATE already owns the job row. Lock every affected run
    -- in a stable order before touching its exchanges, preserving the global
    -- job -> run -> exchange acquisition order.
    perform 1
    from ingest.runs as run
    where run.job_id = old.id
      and run.status = 'running'
      and run.lease_token = old.lease_token
    order by run.id
    for update of run;

    update ingest.http_exchanges as exchange
    set outcome = 'indeterminate',
        completed_at = now(),
        latency_ms = greatest(
          0::numeric,
          floor(extract(epoch from (now() - exchange.started_at)) * 1000)
        )::bigint,
        error_class = 'database',
        error_detail_safe = 'Job lease expired or was reassigned before the HTTP exchange completed.',
        result_metadata_safe = jsonb_build_object('reason', 'job_lease_reclaimed')
    from ingest.runs as run
    where run.job_id = old.id
      and run.status = 'running'
      and run.lease_token = old.lease_token
      and exchange.run_id = run.id
      and exchange.outcome = 'pending';

    update ingest.runs as run
    set status = 'failed',
        finished_at = now(),
        request_count = (
          select count(*)::integer
          from ingest.http_exchanges as exchange
          where exchange.run_id = run.id
        ),
        error_class = 'database',
        error_detail_safe = 'Job lease expired or was reassigned.',
        updated_at = now()
    where run.job_id = old.id
      and run.status = 'running'
      and run.lease_token = old.lease_token;
  end if;
  return new;
end;
$$;

revoke execute on function ingest.close_run_on_job_reclaim()
  from public, anon, authenticated, service_role,
  firewatch_catalog_admin, firewatch_collector, firewatch_reconciler,
  firewatch_publisher, firewatch_dispatcher;

-- Private, defense-in-depth RLS. The collector can append and inspect its
-- ingestion evidence, but cannot rewrite or remove it. No Data API/client role
-- receives any access to this table.
alter table ingest.http_exchanges enable row level security;
alter table ingest.http_exchanges force row level security;

create policy firewatch_collector_read
on ingest.http_exchanges for select to firewatch_collector using (true);

create policy firewatch_collector_insert
on ingest.http_exchanges for insert to firewatch_collector
with check (outcome = 'pending');

revoke all on ingest.http_exchanges from
  public, anon, authenticated, service_role,
  firewatch_catalog_admin, firewatch_collector, firewatch_reconciler,
  firewatch_publisher, firewatch_dispatcher;
revoke all on sequence ingest.http_exchanges_id_seq from
  public, anon, authenticated, service_role,
  firewatch_catalog_admin, firewatch_collector, firewatch_reconciler,
  firewatch_publisher, firewatch_dispatcher;

grant select, insert on ingest.http_exchanges to firewatch_collector;
grant usage, select on sequence ingest.http_exchanges_id_seq to firewatch_collector;
