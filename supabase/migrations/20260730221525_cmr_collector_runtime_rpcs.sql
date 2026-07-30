-- Narrow lease operations required by the server-only NASA CMR collector.
-- The generic queue claimer intentionally chooses the next job globally; this
-- exact variant prevents a scheduled CMR invocation from stealing unrelated
-- work after it inserts its deterministic job identity.

-- Keep the database evidence allowlist aligned with the shared recorded-fetch
-- contract. NASA CMR incremental scans require updated_since, and CMR has used
-- both timeout header spellings. This replaces the already-applied validator;
-- historical migrations remain immutable.
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
      'cmr-search-after', 'cmr-time-out', 'cmr-timed-out', 'cmr-took',
      'content-encoding', 'content-language', 'content-length',
      'content-range', 'content-type', 'date', 'etag', 'expires',
      'last-modified', 'retry-after', 'traceparent', 'vary',
      'x-ratelimit-limit', 'x-ratelimit-remaining', 'x-ratelimit-reset',
      'x-request-id'
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
      'tweet.fields', 'units', 'updated_since', 'version', 'wind_speed_unit'
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
      for element in
        select item.value
        from jsonb_array_elements(entry.value) as item
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

revoke execute on function ingest.http_safe_map_is_allowed(jsonb, text)
  from public, anon, authenticated, service_role,
  firewatch_catalog_admin, firewatch_collector, firewatch_reconciler,
  firewatch_publisher, firewatch_dispatcher;
grant execute on function ingest.http_safe_map_is_allowed(jsonb, text)
  to firewatch_collector;

create or replace function ingest.claim_cmr_collection_job_exact(
  p_job_id bigint,
  p_worker_id text,
  p_lease_for interval default interval '150 seconds'
)
returns setof ingest.jobs
language sql
volatile
security definer
set search_path = ''
as $$
  update ingest.jobs as job
  set status = 'running',
      attempt_count = job.attempt_count + 1,
      lease_token = gen_random_uuid(),
      lease_owner = p_worker_id,
      lease_expires_at = now() + p_lease_for,
      claimed_at = now(),
      updated_at = now()
  from core.sources as source,
       core.endpoints as endpoint,
       ingest.endpoint_state as endpoint_state,
       core.collection_targets as target,
       core.collection_target_revisions as revision,
       core.adapter_releases as adapter,
       ingest.adapter_release_state as adapter_state
  where job.id = p_job_id
    and job.status = 'pending'
    and job.attempt_count = 0
    and job.max_attempts = 1
    and job.available_at <= now()
    and p_job_id is not null
    and p_worker_id is not null
    and btrim(p_worker_id) <> ''
    and char_length(p_worker_id) <= 200
    and p_lease_for > interval '0 seconds'
    and p_lease_for <= interval '150 seconds'
    and source.id = job.source_id
    and source.slug = 'nasa-cmr-firemask'
    and source.enabled
    and source.license_status = 'approved'
    and source.redistribution_allowed is true
    and endpoint.id = job.endpoint_id
    and endpoint.source_id = source.id
    and endpoint.endpoint_key = 'granules-umm-g-1-6-7'
    and endpoint.base_url =
      'https://cmr.earthdata.nasa.gov/search/granules.umm_json_v1_6_7'
    and endpoint.http_method = 'GET'
    and endpoint.auth_mode = 'none'
    and endpoint.credential_ref is null
    and endpoint.poll_interval = interval '5 minutes'
    and endpoint.supports_cursor
    and endpoint.supports_backfill
    and endpoint_state.endpoint_id = endpoint.id
    and endpoint_state.enabled
    and endpoint_state.paused_reason is null
    and target.id = job.collection_target_id
    and target.endpoint_id = endpoint.id
    and target.source_id = source.id
    and target.target_key = 'global-firemask-granules'
    and target.enabled
    and revision.id = job.collection_target_revision_id
    and revision.collection_target_id = target.id
    and revision.endpoint_id = endpoint.id
    and revision.enabled
    and revision.effective_at <= now()
    and revision.target_kind = 'global'
    and revision.scope = 'global'
    and revision.geometry_precision_source = 'not_applicable'
    and revision.claim_kind = 'satellite_pass_metadata'
    and revision.operational_role = 'context'
    and revision.cadence = interval '5 minutes'
    and revision.stale_after = interval '3 hours'
    and revision.request_params = '{
      "bootstrapLookbackHours":36,
      "incrementalOverlapMinutes":10,
      "maximumPagesPerProduct":20,
      "pageSize":200,
      "products":[
        {"satellite":"Suomi-NPP","shortName":"VNP14IMG_NRT","version":"2"},
        {"satellite":"NOAA-20","shortName":"VJ114IMG_NRT","version":"2"},
        {"satellite":"NOAA-21","shortName":"VJ214IMG_NRT","version":"2"}
      ],
      "provider":"LANCEMODIS",
      "reconciliationIntervalHours":24,
      "responseFormat":"umm_json",
      "sortKeys":["-start_date","granule_ur"]
    }'::jsonb
    and adapter.id = job.adapter_release_id
    and adapter.source_id = source.id
    and adapter.schema_version = 'cmr-umm-g-1.6.7-pass-v1'
    and adapter.capabilities = '{
      "anomalyAssessment":"not_assessed",
      "catalogMetadataOnly":true,
      "pagination":"CMR-Search-After",
      "products":["VNP14IMG_NRT","VJ114IMG_NRT","VJ214IMG_NRT"],
      "ummGVersion":"1.6.7"
    }'::jsonb
    and adapter.config_schema = '{}'::jsonb
    and adapter_state.adapter_release_id = adapter.id
    and adapter_state.enabled
    and adapter_state.retired_at is null
    and not exists (
      select 1
      from core.collection_target_revisions as newer
      where newer.collection_target_id = revision.collection_target_id
        and newer.effective_at <= now()
        and (
          newer.effective_at > revision.effective_at
          or (
            newer.effective_at = revision.effective_at
            and newer.version_no > revision.version_no
          )
        )
    )
    and not exists (
      select 1
      from core.adapter_releases as newer_adapter
      join ingest.adapter_release_state as newer_state
        on newer_state.adapter_release_id = newer_adapter.id
      where newer_adapter.source_id = adapter.source_id
        and newer_adapter.release_no > adapter.release_no
        and newer_state.enabled
        and newer_state.retired_at is null
    )
  returning job.*;
$$;

revoke execute on function ingest.claim_cmr_collection_job_exact(
  bigint, text, interval
) from public, anon, authenticated, service_role,
  firewatch_catalog_admin, firewatch_collector, firewatch_reconciler,
  firewatch_publisher, firewatch_dispatcher;
grant execute on function ingest.claim_cmr_collection_job_exact(
  bigint, text, interval
) to firewatch_collector;

comment on function ingest.claim_cmr_collection_job_exact(
  bigint, text, interval
) is
  'Atomically claims only the named pristine one-attempt NASA CMR job; it never selects unrelated queue work.';

-- A response body that exceeds its evidence cap, or a database error while
-- capturing it, leaves a previously committed issuance row. Before the run may
-- fail, those rows are closed as indeterminate. This function is deliberately
-- CMR-only, lease-fenced, bounded, and unable to rewrite terminal exchanges.
create or replace function ingest.abandon_pending_cmr_http_exchanges(
  p_run_id bigint,
  p_lease_token uuid,
  p_worker_id text,
  p_reason text
)
returns integer
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  candidate_job_id bigint;
  abandoned_count integer;
  safe_error_class text;
begin
  if p_run_id is null
    or p_lease_token is null
    or p_worker_id is null
    or btrim(p_worker_id) = ''
    or char_length(p_worker_id) > 200
    or p_reason is null
    or p_reason not in (
      'deadline', 'page_limit', 'byte_limit', 'timeout', 'network',
      'redirect', 'rate_limit', 'upstream', 'provider_timeout',
      'invalid_headers', 'invalid_response', 'pagination_drift', 'database'
    )
  then
    raise exception 'invalid CMR exchange-abandon request'
      using errcode = '22023';
  end if;

  safe_error_class := case
    when p_reason in ('deadline', 'timeout') then 'timeout'
    when p_reason = 'rate_limit' then 'rate_limit'
    when p_reason = 'network' then 'network'
    when p_reason in ('redirect', 'upstream', 'provider_timeout') then 'upstream'
    when p_reason = 'database' then 'database'
    else 'validation'
  end;

  select run.job_id into candidate_job_id
  from ingest.runs as run
  join core.sources as source on source.id = run.source_id
  join core.endpoints as endpoint on endpoint.id = run.endpoint_id
  join core.collection_targets as target
    on target.id = run.collection_target_id
  where run.id = p_run_id
    and source.slug = 'nasa-cmr-firemask'
    and endpoint.endpoint_key = 'granules-umm-g-1-6-7'
    and target.target_key = 'global-firemask-granules';

  if candidate_job_id is null then
    raise exception 'CMR run identity did not resolve'
      using errcode = '55000';
  end if;

  perform 1
  from ingest.jobs as job
  where job.id = candidate_job_id
    and job.status = 'running'
    and job.lease_token = p_lease_token
    and job.lease_owner = p_worker_id
    and job.lease_expires_at > now()
  for update of job;

  if not found then
    raise exception 'CMR exchange abandonment requires the active job lease'
      using errcode = '55000';
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
    raise exception 'CMR exchange abandonment requires the active run lease'
      using errcode = '55000';
  end if;

  update ingest.http_exchanges as exchange
  set outcome = 'indeterminate',
      completed_at = now(),
      latency_ms = greatest(
        0::numeric,
        floor(extract(epoch from (now() - exchange.started_at)) * 1000)
      )::bigint,
      error_class = safe_error_class,
      error_detail_safe =
        'Collector failed before the issued response could be durably completed.',
      result_metadata_safe = jsonb_build_object('reason', p_reason)
  where exchange.run_id = p_run_id
    and exchange.outcome = 'pending';

  get diagnostics abandoned_count = row_count;
  return abandoned_count;
end;
$$;

revoke execute on function ingest.abandon_pending_cmr_http_exchanges(
  bigint, uuid, text, text
) from public, anon, authenticated, service_role,
  firewatch_catalog_admin, firewatch_collector, firewatch_reconciler,
  firewatch_publisher, firewatch_dispatcher;
grant execute on function ingest.abandon_pending_cmr_http_exchanges(
  bigint, uuid, text, text
) to firewatch_collector;

comment on function ingest.abandon_pending_cmr_http_exchanges(
  bigint, uuid, text, text
) is
  'Lease-fenced fail-closed terminalization for CMR issuance rows whose exact response could not be persisted.';

-- A hard Edge-runtime stop cannot execute the application failure finalizer.
-- Reap exactly one expired, terminal-attempt CMR job at the start of the next
-- invocation. The existing jobs_close_run_on_reclaim trigger closes pending
-- HTTP evidence and the running run while this function owns the job row. The
-- remaining CMR accounting, target-state failure, and public health sample are
-- then committed in the same transaction. No unrelated queue work is touched.
create or replace function ingest.reap_expired_cmr_collection_job(
  p_health_public_id core.uuid_v7
)
returns bigint
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  candidate_job_id bigint;
  candidate_lease_token uuid;
  candidate_source_id bigint;
  candidate_endpoint_id bigint;
  candidate_target_id bigint;
  candidate_target_revision_id bigint;
  candidate_run_id bigint;
  candidate_started_at timestamptz;
  v_request_count integer;
  v_occurrence_count integer;
  v_accepted_count integer;
  v_rejected_count integer;
  v_duplicate_count integer;
  v_failure_count integer;
begin
  if p_health_public_id is null then
    raise exception 'CMR reaper requires a health public identifier'
      using errcode = '22023';
  end if;

  select
    job.id,
    job.lease_token,
    job.source_id,
    job.endpoint_id,
    job.collection_target_id,
    job.collection_target_revision_id
  into
    candidate_job_id,
    candidate_lease_token,
    candidate_source_id,
    candidate_endpoint_id,
    candidate_target_id,
    candidate_target_revision_id
  from ingest.jobs as job
  join core.sources as source
    on source.id = job.source_id
   and source.slug = 'nasa-cmr-firemask'
  join core.endpoints as endpoint
    on endpoint.id = job.endpoint_id
   and endpoint.source_id = source.id
   and endpoint.endpoint_key = 'granules-umm-g-1-6-7'
  join core.collection_targets as target
    on target.id = job.collection_target_id
   and target.source_id = source.id
   and target.endpoint_id = endpoint.id
   and target.target_key = 'global-firemask-granules'
  where job.status = 'running'
    and job.lease_expires_at <= now()
    and job.attempt_count >= job.max_attempts
    and job.max_attempts = 1
    and exists (
      select 1
      from ingest.runs as run
      where run.job_id = job.id
        and run.status = 'running'
        and run.lease_token = job.lease_token
    )
  order by job.lease_expires_at, job.id
  for update of job skip locked
  limit 1;

  if not found then
    return null;
  end if;

  select run.id, run.started_at
    into candidate_run_id, candidate_started_at
  from ingest.runs as run
  where run.job_id = candidate_job_id
    and run.status = 'running'
    and run.lease_token = candidate_lease_token
  order by run.id
  for update of run;

  if not found then
    raise exception 'expired CMR job lost its running run'
      using errcode = '55000';
  end if;

  -- This transition invokes jobs_close_run_on_reclaim. That trigger follows
  -- the established job -> run -> exchange lock order and derives the exact
  -- HTTP request count before making the run terminal.
  update ingest.jobs as job
  set status = 'failed',
      completed_at = now(),
      lease_token = null,
      lease_owner = null,
      lease_expires_at = null,
      last_error = jsonb_build_object(
        'class', 'database',
        'reason', 'collector_lease_expired',
        'terminal', true
      ),
      updated_at = now()
  where job.id = candidate_job_id
    and job.status = 'running'
    and job.lease_token = candidate_lease_token
    and job.lease_expires_at <= now();

  if not found then
    raise exception 'expired CMR job changed while being reaped'
      using errcode = '55000';
  end if;

  select
    (select count(*)::integer
       from ingest.http_exchanges as exchange
       where exchange.run_id = candidate_run_id),
    (select count(*)::integer
       from ingest.cmr_granule_occurrences as occurrence
       where occurrence.run_id = candidate_run_id),
    (select count(*)::integer
       from ingest.source_revisions as revision
       where revision.run_id = candidate_run_id),
    (select count(*)::integer
       from ingest.cmr_rejections as rejection
       where rejection.run_id = candidate_run_id)
  into v_request_count, v_occurrence_count, v_accepted_count, v_rejected_count;

  v_duplicate_count := v_occurrence_count - v_accepted_count;
  if v_duplicate_count < 0 then
    raise exception 'expired CMR run occurrence counts are inconsistent'
      using errcode = '23514';
  end if;

  update ingest.runs as run
  set item_count = v_occurrence_count + v_rejected_count,
      fetched_count = v_occurrence_count + v_rejected_count,
      accepted_count = v_accepted_count,
      rejected_count = v_rejected_count,
      duplicate_count = v_duplicate_count,
      cursor_after = null,
      request_meta = jsonb_build_object(
        'operation', 'cmr_firemask_catalog',
        'scope', 'global'
      ),
      response_meta = jsonb_build_object('page_count', v_request_count),
      error = jsonb_build_object(
        'class', 'database',
        'reason', 'collector_lease_expired',
        'terminal', true
      ),
      updated_at = now()
  where run.id = candidate_run_id
    and run.status = 'failed'
    and run.finished_at is not null;

  if not found then
    raise exception 'expired CMR run was not closed by the reclaim trigger'
      using errcode = '55000';
  end if;

  update ingest.collection_target_state as state
  set last_started_at = candidate_started_at,
      next_due_at = now() + revision.cadence,
      consecutive_failures = state.consecutive_failures + 1,
      last_error = jsonb_build_object(
        'class', 'database',
        'reason', 'collector_lease_expired',
        'terminal', true
      ),
      updated_at = now()
  from core.collection_target_revisions as revision
  where state.collection_target_id = candidate_target_id
    and state.collection_target_revision_id = candidate_target_revision_id
    and revision.id = state.collection_target_revision_id
    and revision.collection_target_id = state.collection_target_id
  returning state.consecutive_failures into v_failure_count;

  if v_failure_count is null then
    raise exception 'expired CMR run target state did not resolve'
      using errcode = '55000';
  end if;

  insert into truth.source_health (
    public_id, contract_version, source_id, endpoint_id,
    collection_target_id, collection_target_revision_id, run_id,
    idempotency_key, status, circuit_state, visibility,
    checked_at, last_success_at, consecutive_failures, error_class,
    fetch_latency_ms, error_rate, geographic_completeness,
    record_count, schema_failure_count, details
  )
  select
    p_health_public_id, '1.1.0', candidate_source_id, candidate_endpoint_id,
    candidate_target_id, candidate_target_revision_id, run.id,
    'cmr-health-reaped:' || candidate_job_id::text,
    'failed', 'closed', 'public', now(), state.last_succeeded_at,
    v_failure_count, 'database',
    least(
      2147483647::numeric,
      greatest(
        0::numeric,
        floor(extract(epoch from (run.finished_at - run.started_at)) * 1000)
      )
    )::integer,
    1, null, v_occurrence_count, v_rejected_count,
    jsonb_build_object(
      'anomalyAssessment', 'not_assessed',
      'catalogMetadataOnly', true,
      'failure', jsonb_build_object(
        'class', 'database',
        'reason', 'collector_lease_expired'
      )
    )
  from ingest.runs as run
  join ingest.collection_target_state as state
    on state.collection_target_id = run.collection_target_id
   and state.collection_target_revision_id = run.collection_target_revision_id
  where run.id = candidate_run_id
    and run.status = 'failed'
    and run.finished_at is not null;

  if not found then
    raise exception 'expired CMR run health sample was not inserted'
      using errcode = '55000';
  end if;

  return candidate_run_id;
end;
$$;

revoke execute on function ingest.reap_expired_cmr_collection_job(core.uuid_v7)
  from public, anon, authenticated, service_role,
  firewatch_catalog_admin, firewatch_collector, firewatch_reconciler,
  firewatch_publisher, firewatch_dispatcher;
grant execute on function ingest.reap_expired_cmr_collection_job(core.uuid_v7)
  to firewatch_collector;

comment on function ingest.reap_expired_cmr_collection_job(core.uuid_v7) is
  'Atomically terminalizes one expired final-attempt NASA CMR execution and appends its failed public health sample.';
