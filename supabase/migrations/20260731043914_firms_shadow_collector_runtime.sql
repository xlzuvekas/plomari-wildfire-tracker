-- Disabled-by-default NASA FIRMS shadow collector runtime.
--
-- This migration installs an inert server-only runtime contract. It creates no
-- cron job and activates no source, endpoint, target, revision, adapter, or
-- product. Operators must separately review the provider terms, provision a
-- dedicated least-privilege login and named Edge secret, and explicitly flip
-- every catalog gate before the collector can claim a job.
--
-- A successful four-product query proves only that four bounded explicit-date
-- responses were persisted and parsed. It does not prove satellite coverage,
-- sensor assessability, no fire, incident resolution, or an all-clear.

-- Preserve every parser reason, rather than collapsing a rejected occurrence
-- to the coarse operational category already present in the foundation.
alter table ingest.firms_response_rows
  add column source_row_number integer,
  add column rejection_reasons text[] not null default '{}'::text[];

alter table ingest.firms_response_rows
  add constraint firms_response_rows_source_row_number_check check (
    source_row_number = item_index + 2
  ),
  add constraint firms_response_rows_rejection_reasons_check check (
    (disposition = 'accepted' and cardinality(rejection_reasons) = 0)
    or (
      disposition = 'rejected'
      and cardinality(rejection_reasons) > 0
      and rejection_reasons <@ array[
        'column-count-mismatch',
        'invalid-coordinate',
        'outside-request-area',
        'invalid-acquisition-time',
        'outside-request-date-range',
        'satellite-mismatch',
        'instrument-mismatch',
        'invalid-confidence',
        'invalid-version',
        'invalid-measurement',
        'invalid-day-night',
        'persistence-contract-mismatch',
        'identity-collision'
      ]::text[]
    )
  );

alter table ingest.firms_response_rows
  alter column source_row_number set not null;

alter table ingest.firms_query_product_results
  add column failure_code text;

alter table ingest.firms_query_product_results
  add constraint firms_query_product_results_failure_code_check check (
    (outcome = 'complete' and failure_code is null)
    or (
      outcome <> 'complete'
      and failure_code in (
        'deadline', 'timeout', 'network', 'upstream',
        'response_too_large', 'parser', 'validation', 'database',
        'schema_rejection', 'parser_response_too_large',
        'parser_invalid_encoding', 'parser_invalid_csv',
        'parser_invalid_header'
      )
    )
  );

insert into core.adapter_releases (
  public_id, contract_version, source_id, release_no, version_label,
  artifact_digest, git_commit, schema_version, released_at,
  capabilities, config_schema
)
select
  '018f0000-0000-7000-8000-000000000701'::core.uuid_v7,
  '1.1.0', source.id, 1, 'firms-shadow-runtime@1.0.0',
  -- SHA-256 of the LC_ALL=C path-sorted SHA-256 manifest for the FIRMS
  -- boundary, collector, and collect-firms Edge Function files.
  '5c607d72fa1c21180bd64ec846d42f9ebae16603d6647f5c5023103d596fd404',
  null, 'firms-area-csv-shadow-v1',
  timestamptz '2026-07-31 00:00:00+00',
  '{
    "collection":"shadow",
    "credentialPersistence":"forbidden",
    "dateRequestMode":"explicit_starting_on",
    "negativeAssessment":false,
    "products":[
      "MODIS_NRT",
      "VIIRS_NOAA20_NRT",
      "VIIRS_NOAA21_NRT",
      "VIIRS_SNPP_NRT"
    ],
    "responseFormat":"csv",
    "sensorAssessability":"unknown"
  }'::jsonb,
  '{
    "additionalProperties":false,
    "required":["area","dateFrom","dayCount"],
    "type":"object"
  }'::jsonb
from core.sources as source
where source.slug = 'nasa-firms'
on conflict (source_id, release_no) do nothing;

insert into ingest.adapter_release_state (adapter_release_id, enabled)
select adapter.id, false
from core.adapter_releases as adapter
where adapter.public_id = '018f0000-0000-7000-8000-000000000701'
on conflict (adapter_release_id) do nothing;

insert into core.collection_target_revisions (
  public_id, contract_version, identity_version, collection_target_id,
  endpoint_id, version_no, previous_revision_id, target_kind,
  configuration_sha256, scope, geometry_precision_source, claim_kind,
  operational_role, cadence, stale_after, enabled, request_params,
  effective_at
)
select
  '018f0000-0000-7000-8000-000000000702'::core.uuid_v7,
  '1.1.0', '2.0.0', prior.collection_target_id, prior.endpoint_id,
  2, prior.id, 'dataset',
  'c4ef36952530d631b7435cb48fab6a133405fa307a1a8c594f4f07d13ff22bfd',
  'global', 'not_applicable', 'thermal_detection', 'discovery',
  interval '15 minutes', interval '3 hours', false,
  '{
    "dateRequestMode":"explicit_starting_on",
    "dayRangeMaximum":5,
    "maximumAreaSquareDegrees":100,
    "maximumLatitudeSpanDegrees":10,
    "maximumLongitudeSpanDegrees":10,
    "maximumResponseBytesPerProduct":2000000,
    "maximumTotalResponseBytes":8000000,
    "products":[
      "MODIS_NRT",
      "VIIRS_NOAA20_NRT",
      "VIIRS_NOAA21_NRT",
      "VIIRS_SNPP_NRT"
    ],
    "requestTimeoutMs":15000,
    "responseFormat":"csv"
  }'::jsonb,
  timestamptz '2026-07-31 00:00:00+00'
from core.collection_target_revisions as prior
where prior.public_id = '018f0000-0000-7000-8000-000000000501'
on conflict (collection_target_id, version_no) do nothing;

insert into ingest.collection_target_state (
  collection_target_revision_id, collection_target_id
)
select revision.id, revision.collection_target_id
from core.collection_target_revisions as revision
where revision.public_id = '018f0000-0000-7000-8000-000000000702'
on conflict (collection_target_revision_id) do nothing;

-- Exact durable job-input validation. The key never appears in this object;
-- only credential-free plan metadata is admissible.
create or replace function ingest.firms_shadow_job_input_is_valid_v1(
  p_input jsonb
)
returns boolean
language plpgsql
immutable
strict
security invoker
set search_path = ''
as $$
declare
  plan jsonb;
  area jsonb;
  scheduled_for timestamptz;
  date_from date;
  date_to date;
  day_count integer;
  west_value numeric;
  south_value numeric;
  east_value numeric;
  north_value numeric;
begin
  if jsonb_typeof(p_input) <> 'object'
    or (select count(*) from jsonb_object_keys(p_input)) <> 2
    or not p_input ?& array['collector','plan']::text[]
    or p_input->>'collector' <> 'firms_shadow'
    or jsonb_typeof(p_input->'plan') <> 'object'
  then
    return false;
  end if;
  plan := p_input->'plan';
  if (select count(*) from jsonb_object_keys(plan)) <> 13
    or not plan ?& array[
        'area','areaToken','coverage','dateFrom','dateRequestMode','dateTo',
        'dayCount','kind','negativeAssessmentEligible','planKey','products',
        'scheduledFor','sensorAssessability'
      ]::text[]
    or plan->>'kind' <> 'firms-shadow-plan-v1'
    or plan->>'dateRequestMode' <> 'explicit-starting-on'
    or plan->>'coverage' <> 'requested-bbox-only'
    or plan->>'sensorAssessability' <> 'unknown'
    or plan->'negativeAssessmentEligible' <> 'false'::jsonb
    or plan->'products' <> '[
      "MODIS_NRT","VIIRS_NOAA20_NRT","VIIRS_NOAA21_NRT","VIIRS_SNPP_NRT"
    ]'::jsonb
    or jsonb_typeof(plan->'area') <> 'object'
  then
    return false;
  end if;
  area := plan->'area';
  if (select count(*) from jsonb_object_keys(area)) <> 4
    or not area ?& array['east','north','south','west']::text[]
    or plan->>'areaToken' is null
    or not ingest.firms_area_token_is_valid_v1(plan->>'areaToken')
    or plan->>'dateFrom' !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
    or plan->>'dateTo' !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
    or plan->>'scheduledFor'
      !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{3}Z$'
    or plan->>'dayCount' !~ '^[1-5]$'
  then
    return false;
  end if;
  begin
    west_value := (area->>'west')::numeric;
    south_value := (area->>'south')::numeric;
    east_value := (area->>'east')::numeric;
    north_value := (area->>'north')::numeric;
    date_from := (plan->>'dateFrom')::date;
    date_to := (plan->>'dateTo')::date;
    day_count := (plan->>'dayCount')::integer;
    scheduled_for := (plan->>'scheduledFor')::timestamptz;
  exception when others then
    return false;
  end;
  return ingest.firms_area_token_matches_v1(
      plan->>'areaToken', west_value, south_value, east_value, north_value
    )
    and east_value - west_value <= 10
    and north_value - south_value <= 10
    and (east_value - west_value) * (north_value - south_value) <= 100
    and date_to = date_from + (day_count - 1)
    and date_to <= (scheduled_for at time zone 'UTC')::date
    and plan->>'planKey' = concat_ws(
      ':', 'firms-shadow-v1', plan->>'areaToken', date_from::text, day_count::text
    );
end;
$$;

revoke execute on function ingest.firms_shadow_job_input_is_valid_v1(jsonb)
  from public, anon, authenticated, service_role,
  firewatch_catalog_admin, firewatch_collector, firewatch_reconciler,
  firewatch_publisher, firewatch_dispatcher;
grant execute on function ingest.firms_shadow_job_input_is_valid_v1(jsonb)
  to firewatch_collector;

create or replace function ingest.claim_firms_collection_job_exact(
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
    and job.status in ('pending', 'retry')
    and job.attempt_count < job.max_attempts
    and job.max_attempts = 3
    and job.available_at <= now()
    and ingest.firms_shadow_job_input_is_valid_v1(job.input)
    and job.scheduled_for = (job.input->'plan'->>'scheduledFor')::timestamptz
    and p_job_id is not null
    and p_worker_id is not null
    and btrim(p_worker_id) <> ''
    and char_length(p_worker_id) <= 200
    and p_lease_for > interval '0 seconds'
    and p_lease_for <= interval '150 seconds'
    and source.id = job.source_id
    and source.slug = 'nasa-firms'
    and source.enabled
    and source.license_status = 'approved'
    and source.commercial_use_allowed is true
    and source.redistribution_allowed is true
    and endpoint.id = job.endpoint_id
    and endpoint.source_id = source.id
    and endpoint.endpoint_key = 'area-csv'
    and endpoint.base_url =
      'https://firms.modaps.eosdis.nasa.gov/api/area/csv'
    and endpoint.http_method = 'GET'
    and endpoint.auth_mode = 'path_secret'
    and endpoint.credential_ref = 'FIRMS_MAP_KEY'
    and endpoint.timeout_ms = 15000
    and endpoint.supports_bbox
    and endpoint.supports_backfill
    and not endpoint.supports_cursor
    and endpoint_state.endpoint_id = endpoint.id
    and endpoint_state.enabled
    and endpoint_state.paused_reason is null
    and target.id = job.collection_target_id
    and target.endpoint_id = endpoint.id
    and target.source_id = source.id
    and target.target_key = 'global-discovery'
    and target.visibility = 'restricted'
    and target.enabled
    and revision.id = job.collection_target_revision_id
    and revision.collection_target_id = target.id
    and revision.endpoint_id = endpoint.id
    and revision.version_no >= 2
    and revision.enabled
    and revision.effective_at <= now()
    and revision.target_kind = 'dataset'
    and revision.scope = 'global'
    and revision.geometry_precision_source = 'not_applicable'
    and revision.claim_kind = 'thermal_detection'
    and revision.operational_role = 'discovery'
    and revision.cadence = interval '15 minutes'
    and revision.stale_after = interval '3 hours'
    and revision.request_params = '{
      "dateRequestMode":"explicit_starting_on",
      "dayRangeMaximum":5,
      "maximumAreaSquareDegrees":100,
      "maximumLatitudeSpanDegrees":10,
      "maximumLongitudeSpanDegrees":10,
      "maximumResponseBytesPerProduct":2000000,
      "maximumTotalResponseBytes":8000000,
      "products":[
        "MODIS_NRT","VIIRS_NOAA20_NRT","VIIRS_NOAA21_NRT","VIIRS_SNPP_NRT"
      ],
      "requestTimeoutMs":15000,
      "responseFormat":"csv"
    }'::jsonb
    and adapter.id = job.adapter_release_id
    and adapter.source_id = source.id
    and adapter.public_id = '018f0000-0000-7000-8000-000000000701'
    and adapter.release_no = 1
    and adapter.schema_version = 'firms-area-csv-shadow-v1'
    and adapter.capabilities = '{
      "collection":"shadow",
      "credentialPersistence":"forbidden",
      "dateRequestMode":"explicit_starting_on",
      "negativeAssessment":false,
      "products":[
        "MODIS_NRT","VIIRS_NOAA20_NRT","VIIRS_NOAA21_NRT","VIIRS_SNPP_NRT"
      ],
      "responseFormat":"csv",
      "sensorAssessability":"unknown"
    }'::jsonb
    and adapter.config_schema = '{
      "additionalProperties":false,
      "required":["area","dateFrom","dayCount"],
      "type":"object"
    }'::jsonb
    and adapter_state.adapter_release_id = adapter.id
    and adapter_state.enabled
    and adapter_state.retired_at is null
    and (select count(*) from core.firms_products as product
         where product.source_id = source.id
           and product.enabled
           and product.license_status = 'approved'
           and not product.assessment_enabled) = 4
    and not exists (
      select 1 from core.firms_products as product
      where product.source_id = source.id
        and product.product_key not in (
          'MODIS_NRT', 'VIIRS_NOAA20_NRT',
          'VIIRS_NOAA21_NRT', 'VIIRS_SNPP_NRT'
        )
    )
    and not exists (
      select 1 from core.collection_target_revisions as newer
      where newer.collection_target_id = revision.collection_target_id
        and newer.effective_at <= now()
        and (newer.effective_at > revision.effective_at
          or (newer.effective_at = revision.effective_at
            and newer.version_no > revision.version_no))
    )
    and not exists (
      select 1 from core.adapter_releases as newer_adapter
      join ingest.adapter_release_state as newer_state
        on newer_state.adapter_release_id = newer_adapter.id
      where newer_adapter.source_id = adapter.source_id
        and newer_adapter.release_no > adapter.release_no
        and newer_state.enabled and newer_state.retired_at is null
    )
  returning job.*;
$$;

revoke execute on function ingest.claim_firms_collection_job_exact(
  bigint, text, interval
) from public, anon, authenticated, service_role,
  firewatch_catalog_admin, firewatch_collector, firewatch_reconciler,
  firewatch_publisher, firewatch_dispatcher;
grant execute on function ingest.claim_firms_collection_job_exact(
  bigint, text, interval
) to firewatch_collector;

comment on function ingest.claim_firms_collection_job_exact(
  bigint, text, interval
) is
  'Claims only a named bounded FIRMS shadow job after every source, license, product, revision, adapter, and lease gate is explicitly enabled.';

create or replace function ingest.abandon_pending_firms_http_exchanges(
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
      'deadline', 'timeout', 'network', 'upstream',
      'response_too_large', 'parser', 'validation', 'database'
    )
  then
    raise exception 'invalid FIRMS exchange-abandon request'
      using errcode = '22023';
  end if;

  safe_error_class := case
    when p_reason in ('deadline', 'timeout') then 'timeout'
    when p_reason = 'network' then 'network'
    when p_reason = 'upstream' then 'upstream'
    when p_reason = 'parser' then 'parser'
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
    and source.slug = 'nasa-firms'
    and endpoint.endpoint_key = 'area-csv'
    and target.target_key = 'global-discovery';

  if candidate_job_id is null then
    raise exception 'FIRMS run identity did not resolve'
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
    raise exception 'FIRMS exchange abandonment requires the active job lease'
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
    raise exception 'FIRMS exchange abandonment requires the active run lease'
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

revoke execute on function ingest.abandon_pending_firms_http_exchanges(
  bigint, uuid, text, text
) from public, anon, authenticated, service_role,
  firewatch_catalog_admin, firewatch_collector, firewatch_reconciler,
  firewatch_publisher, firewatch_dispatcher;
grant execute on function ingest.abandon_pending_firms_http_exchanges(
  bigint, uuid, text, text
) to firewatch_collector;

comment on function ingest.abandon_pending_firms_http_exchanges(
  bigint, uuid, text, text
) is
  'Lease-fenced terminalization for FIRMS issuance rows whose response could not be durably completed.';

create or replace function ingest.reap_expired_firms_collection_job(
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
  candidate_attempt_count integer;
  candidate_max_attempts integer;
  v_request_count integer;
  v_returned_count integer;
  v_accepted_count integer;
  v_rejected_count integer;
  v_new_detail_count integer;
  v_duplicate_count integer;
  v_failure_count integer;
begin
  if p_health_public_id is null then
    raise exception 'FIRMS reaper requires a health public identifier'
      using errcode = '22023';
  end if;

  select
    job.id, job.lease_token, job.source_id, job.endpoint_id,
    job.collection_target_id, job.collection_target_revision_id,
    job.attempt_count, job.max_attempts
  into
    candidate_job_id, candidate_lease_token, candidate_source_id,
    candidate_endpoint_id, candidate_target_id,
    candidate_target_revision_id, candidate_attempt_count,
    candidate_max_attempts
  from ingest.jobs as job
  join core.sources as source
    on source.id = job.source_id and source.slug = 'nasa-firms'
  join core.endpoints as endpoint
    on endpoint.id = job.endpoint_id and endpoint.source_id = source.id
   and endpoint.endpoint_key = 'area-csv'
  join core.collection_targets as target
    on target.id = job.collection_target_id and target.source_id = source.id
   and target.endpoint_id = endpoint.id and target.target_key = 'global-discovery'
  join core.collection_target_revisions as revision
    on revision.id = job.collection_target_revision_id
   and revision.collection_target_id = target.id
   and revision.version_no >= 2
   and revision.request_params = '{
      "dateRequestMode":"explicit_starting_on",
      "dayRangeMaximum":5,
      "maximumAreaSquareDegrees":100,
      "maximumLatitudeSpanDegrees":10,
      "maximumLongitudeSpanDegrees":10,
      "maximumResponseBytesPerProduct":2000000,
      "maximumTotalResponseBytes":8000000,
      "products":[
        "MODIS_NRT","VIIRS_NOAA20_NRT","VIIRS_NOAA21_NRT","VIIRS_SNPP_NRT"
      ],
      "requestTimeoutMs":15000,
      "responseFormat":"csv"
    }'::jsonb
  join core.adapter_releases as adapter
    on adapter.id = job.adapter_release_id and adapter.source_id = source.id
   and adapter.schema_version = 'firms-area-csv-shadow-v1'
  where job.status = 'running'
    and job.lease_expires_at <= now()
    and job.attempt_count <= job.max_attempts
    and job.max_attempts = 3
    and ingest.firms_shadow_job_input_is_valid_v1(job.input)
    and exists (
      select 1 from ingest.runs as run
      where run.job_id = job.id and run.status = 'running'
        and run.lease_token = job.lease_token
    )
  order by job.lease_expires_at, job.id
  for update of job skip locked
  limit 1;

  if not found then return null; end if;

  select run.id, run.started_at
    into candidate_run_id, candidate_started_at
  from ingest.runs as run
  where run.job_id = candidate_job_id
    and run.status = 'running'
    and run.lease_token = candidate_lease_token
  order by run.id
  for update of run;
  if not found then
    raise exception 'expired FIRMS job lost its running run'
      using errcode = '55000';
  end if;

  -- The established reclaim trigger closes the run and every pending exchange
  -- while this function holds the job row, preserving the job -> run -> HTTP
  -- lock order.
  update ingest.jobs as job
  set status = case
        when candidate_attempt_count < candidate_max_attempts then 'retry'
        else 'failed'
      end,
      available_at = case
        when candidate_attempt_count < candidate_max_attempts
          then now() + interval '5 minutes'
        else job.available_at
      end,
      completed_at = case
        when candidate_attempt_count < candidate_max_attempts then null
        else now()
      end,
      lease_token = null,
      lease_owner = null,
      lease_expires_at = null,
      last_error = jsonb_build_object(
        'class', 'database',
        'reason', 'collector_lease_expired',
        'terminal', candidate_attempt_count >= candidate_max_attempts
      ),
      updated_at = now()
  where job.id = candidate_job_id
    and job.status = 'running'
    and job.lease_token = candidate_lease_token
    and job.lease_expires_at <= now();
  if not found then
    raise exception 'expired FIRMS job changed while being reaped'
      using errcode = '55000';
  end if;

  select
    (select count(*)::integer from ingest.http_exchanges as exchange
      where exchange.run_id = candidate_run_id),
    (select count(*)::integer from ingest.firms_response_rows as response_row
      where response_row.run_id = candidate_run_id),
    (select count(*)::integer from ingest.firms_response_rows as response_row
      where response_row.run_id = candidate_run_id
        and response_row.disposition = 'accepted'),
    (select count(*)::integer from ingest.firms_response_rows as response_row
      where response_row.run_id = candidate_run_id
        and response_row.disposition = 'rejected'),
    (select count(*)::integer from ingest.source_revisions as revision
      where revision.run_id = candidate_run_id)
  into v_request_count, v_returned_count, v_accepted_count,
    v_rejected_count, v_new_detail_count;

  v_duplicate_count := v_accepted_count - v_new_detail_count;
  if v_duplicate_count < 0
    or v_returned_count <> v_accepted_count + v_rejected_count
  then
    raise exception 'expired FIRMS run occurrence counts are inconsistent'
      using errcode = '23514';
  end if;

  update ingest.runs as run
  set item_count = v_returned_count,
      fetched_count = v_returned_count,
      accepted_count = v_new_detail_count,
      rejected_count = v_rejected_count,
      duplicate_count = v_duplicate_count,
      cursor_after = null,
      request_meta = jsonb_build_object(
        'operation', 'firms_area_csv_shadow', 'scope', 'bounded_area'
      ),
      response_meta = jsonb_build_object(
        'coverage', 'requested_bbox_only',
        'negative_assessment_eligible', false,
        'request_count', v_request_count,
        'sensor_assessability', 'unknown'
      ),
      error = jsonb_build_object(
        'class', 'database',
        'reason', 'collector_lease_expired',
        'terminal', candidate_attempt_count >= candidate_max_attempts
      ),
      updated_at = now()
  where run.id = candidate_run_id
    and run.status = 'failed'
    and run.finished_at is not null;
  if not found then
    raise exception 'expired FIRMS run was not closed by the reclaim trigger'
      using errcode = '55000';
  end if;

  update ingest.collection_target_state as state
  set last_started_at = candidate_started_at,
      next_due_at = now() + interval '5 minutes',
      consecutive_failures = state.consecutive_failures + 1,
      last_error = jsonb_build_object(
        'class', 'database',
        'reason', 'collector_lease_expired',
        'terminal', candidate_attempt_count >= candidate_max_attempts
      ),
      updated_at = now()
  where state.collection_target_id = candidate_target_id
    and state.collection_target_revision_id = candidate_target_revision_id
  returning state.consecutive_failures into v_failure_count;
  if v_failure_count is null then
    raise exception 'expired FIRMS target state did not resolve'
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
    'firms-health-reaped:' || candidate_job_id::text || ':'
      || candidate_attempt_count::text,
    'failed', 'closed', 'restricted', now(), state.last_succeeded_at,
    v_failure_count, 'database',
    least(2147483647::numeric, greatest(0::numeric,
      floor(extract(epoch from (run.finished_at - run.started_at)) * 1000)
    ))::integer,
    1, null, v_returned_count, v_rejected_count,
    jsonb_build_object(
      'anomalyAssessment', 'not_assessed',
      'failure', jsonb_build_object(
        'class', 'database',
        'reason', 'collector_lease_expired'
      ),
      'negativeAssessmentEligible', false,
      'sensorAssessability', 'unknown'
    )
  from ingest.runs as run
  join ingest.collection_target_state as state
    on state.collection_target_id = run.collection_target_id
   and state.collection_target_revision_id = run.collection_target_revision_id
  where run.id = candidate_run_id
    and run.status = 'failed'
    and run.finished_at is not null;
  if not found then
    raise exception 'expired FIRMS run health sample was not inserted'
      using errcode = '55000';
  end if;
  return candidate_run_id;
end;
$$;

revoke execute on function ingest.reap_expired_firms_collection_job(
  core.uuid_v7
) from public, anon, authenticated, service_role,
  firewatch_catalog_admin, firewatch_collector, firewatch_reconciler,
  firewatch_publisher, firewatch_dispatcher;
grant execute on function ingest.reap_expired_firms_collection_job(
  core.uuid_v7
) to firewatch_collector;

comment on function ingest.reap_expired_firms_collection_job(core.uuid_v7) is
  'Atomically closes one expired FIRMS shadow execution, retaining bounded retry state and restricted failed health evidence.';

do $$
begin
  if not exists (
    select 1
    from core.sources as source
    join core.endpoints as endpoint on endpoint.source_id = source.id
    join ingest.endpoint_state as endpoint_state
      on endpoint_state.endpoint_id = endpoint.id
    join core.collection_targets as target
      on target.source_id = source.id and target.endpoint_id = endpoint.id
    join core.collection_target_revisions as revision
      on revision.collection_target_id = target.id
    join ingest.collection_target_state as target_state
      on target_state.collection_target_revision_id = revision.id
     and target_state.collection_target_id = target.id
    join core.adapter_releases as adapter on adapter.source_id = source.id
    join ingest.adapter_release_state as adapter_state
      on adapter_state.adapter_release_id = adapter.id
    where source.slug = 'nasa-firms'
      and source.license_status = 'unreviewed'
      and not source.enabled and not source.is_public
      and endpoint.endpoint_key = 'area-csv'
      and not endpoint_state.enabled
      and target.target_key = 'global-discovery'
      and target.visibility = 'restricted' and not target.enabled
      and revision.public_id = '018f0000-0000-7000-8000-000000000702'
      and revision.version_no = 2 and not revision.enabled
      and target_state.cursor_state = '{}'::jsonb
      and target_state.last_enqueued_at is null
      and target_state.last_started_at is null
      and target_state.last_succeeded_at is null
      and target_state.next_due_at is null
      and adapter.public_id = '018f0000-0000-7000-8000-000000000701'
      and adapter.schema_version = 'firms-area-csv-shadow-v1'
      and not adapter_state.enabled and adapter_state.retired_at is null
  ) then
    raise exception 'FIRMS shadow runtime must install in a wholly disabled state'
      using errcode = '23514';
  end if;

  if (select count(*) from core.firms_products as product
      join core.sources as source on source.id = product.source_id
      where source.slug = 'nasa-firms'
        and product.license_status = 'unreviewed'
        and not product.enabled and not product.assessment_enabled) <> 4
  then
    raise exception 'FIRMS shadow runtime requires four disabled unreviewed products'
      using errcode = '23514';
  end if;
end;
$$;
