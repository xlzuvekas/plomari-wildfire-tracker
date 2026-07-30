-- Persisted NASA CMR FireMask catalog metadata.
--
-- CMR proves that a catalog granule covers a place and time. It does not prove
-- that a thermal anomaly was or was not present in that granule. Consequently:
--   * pass metadata is stored as satellite_imagery/satellite_pass_metadata;
--   * public rows always say anomaly_assessment = not_assessed;
--   * valid-empty is derived from an exact PostGIS intersection plus a current,
--     complete scan lineage, never from a fabricated "no anomaly" observation.

-- Incremental CMR searches use updated_since. Keep the positive evidence
-- allowlist explicit rather than permitting arbitrary caller-supplied query
-- fields in the durable HTTP ledger.
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
      'content-encoding',
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

-- A source may publish a real boundary without publishing a defensible metric
-- accuracy. Preserve that distinction instead of inventing a metre value.
do $$
declare
  precision_constraint name;
begin
  select constraint_row.conname
  into strict precision_constraint
  from pg_constraint as constraint_row
  where constraint_row.conrelid = 'ingest.global_observations'::regclass
    and constraint_row.contype = 'c'
    and pg_get_constraintdef(constraint_row.oid) ilike '%geometry_precision_source%'
    and pg_get_constraintdef(constraint_row.oid) ilike '%geom is null%';

  execute format(
    'alter table ingest.global_observations drop constraint %I',
    precision_constraint
  );
end;
$$;

alter table ingest.global_observations
  add constraint global_observations_geometry_precision_presence_check check (
    (geom is null and geometry_precision_m is null
      and geometry_precision_source = 'not_applicable')
    or (
      geom is not null
      and (
        (geometry_precision_m is not null
          and geometry_precision_source in ('declared', 'estimated'))
        or (geometry_precision_m is null
          and geometry_precision_source = 'not_applicable')
      )
    )
  );

create table ingest.cmr_granule_details (
  observation_cursor bigint primary key
    references ingest.global_observations(cursor),
  catalog_granule_id text not null
    check (catalog_granule_id ~ '^G[0-9]+-[A-Za-z0-9_-]+$'),
  catalog_collection_id text not null
    check (catalog_collection_id ~ '^C[0-9]+-[A-Za-z0-9_-]+$'),
  cmr_revision_id bigint not null check (cmr_revision_id > 0),
  umm_g_version text not null check (umm_g_version = '1.6.7'),
  product text not null check (product in (
    'VNP14IMG_NRT', 'VJ114IMG_NRT', 'VJ214IMG_NRT'
  )),
  product_version text not null check (product_version = '2'),
  satellite text not null check (satellite in (
    'Suomi-NPP', 'NOAA-20', 'NOAA-21'
  )),
  sensor text not null check (sensor = 'VIIRS'),
  observed_to timestamptz not null,
  produced_at timestamptz,
  cataloged_at timestamptz not null,
  day_night text not null check (day_night in (
    'day', 'night', 'both', 'unknown'
  )),
  constraint cmr_granule_details_revision_key
    unique (catalog_granule_id, cmr_revision_id),
  constraint cmr_granule_details_product_platform_check check (
    (product = 'VNP14IMG_NRT' and satellite = 'Suomi-NPP')
    or (product = 'VJ114IMG_NRT' and satellite = 'NOAA-20')
    or (product = 'VJ214IMG_NRT' and satellite = 'NOAA-21')
  )
);

create index cmr_granule_details_product_cataloged_idx
  on ingest.cmr_granule_details(
    product, cataloged_at desc, observation_cursor desc
  );
create index cmr_granule_details_observed_to_cursor_idx
  on ingest.cmr_granule_details(observed_to desc, observation_cursor);

create or replace function ingest.validate_cmr_granule_detail()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  observation_record record;
begin
  select
    o.observation_kind,
    o.evidence_class,
    o.observed_at,
    o.observed_precision,
    o.published_at,
    o.modified_at,
    o.valid_from,
    o.valid_to,
    o.trust_class,
    o.visibility,
    o.confidence,
    o.severity,
    o.expires_at,
    o.geom,
    o.geometry_precision_m,
    o.geometry_precision_source,
    o.validation_state,
    o.validation_reasons,
    o.quality_flags,
    s.slug as source_slug,
    r.status as run_status,
    r.lease_token as run_lease_token,
    r.lease_owner as run_lease_owner,
    j.status as job_status,
    j.lease_token as job_lease_token,
    j.lease_owner as job_lease_owner,
    j.lease_expires_at
  into observation_record
  from ingest.global_observations as o
  join core.sources as s on s.id = o.source_id
  join ingest.source_revisions as revision on revision.id = o.source_revision_id
  join ingest.runs as r on r.id = revision.run_id
  join ingest.jobs as j on j.id = r.job_id
  where o.cursor = new.observation_cursor;

  if not found then
    raise exception 'CMR detail requires an existing observation'
      using errcode = '23503';
  end if;

  if observation_record.source_slug <> 'nasa-cmr-firemask'
    or observation_record.observation_kind <> 'satellite_imagery'
    or observation_record.evidence_class <> 'satellite_pass_metadata'
  then
    raise exception 'CMR detail must reference NASA CMR satellite pass metadata'
      using errcode = '23514';
  end if;

  if observation_record.observed_precision <> 'exact'
    or observation_record.observed_at is null
    or new.observed_to < observation_record.observed_at
    or observation_record.valid_from is distinct from observation_record.observed_at
    or observation_record.valid_to is distinct from new.observed_to
    or observation_record.published_at is distinct from new.produced_at
    or observation_record.modified_at is distinct from new.cataloged_at
  then
    raise exception 'CMR detail timestamps must match the normalized observation'
      using errcode = '23514';
  end if;

  if observation_record.trust_class <> 'official_observation'
    or observation_record.visibility <> 'public'
    or observation_record.confidence is not null
    or observation_record.severity is not null
    or observation_record.expires_at is not null
    or not observation_record.quality_flags @> array[
      'catalog_metadata_only', 'anomaly_not_assessed'
    ]::text[]
  then
    raise exception 'CMR observations must retain metadata-only, anomaly-not-assessed semantics'
      using errcode = '23514';
  end if;

  if observation_record.validation_state = 'accepted' and (
    observation_record.geom is null
    or extensions.st_geometrytype(observation_record.geom)
      not in ('ST_Polygon', 'ST_MultiPolygon')
    or observation_record.geometry_precision_m is not null
    or observation_record.geometry_precision_source <> 'not_applicable'
  ) then
    raise exception 'accepted CMR pass metadata requires its catalog Polygon or MultiPolygon footprint without fabricated metric accuracy'
      using errcode = '23514';
  end if;

  if observation_record.validation_state <> 'accepted'
    and observation_record.geom is null
    and not observation_record.validation_reasons @> array['invalid_geometry']::text[]
  then
    raise exception 'CMR metadata without a usable footprint must be quarantined for invalid geometry'
      using errcode = '23514';
  end if;

  if observation_record.run_status <> 'running'
    or observation_record.job_status <> 'running'
    or observation_record.run_lease_token is distinct from observation_record.job_lease_token
    or observation_record.run_lease_owner is distinct from observation_record.job_lease_owner
    or observation_record.lease_expires_at <= now()
  then
    raise exception 'CMR detail insertion requires the active run lease'
      using errcode = '55000';
  end if;

  return new;
end;
$$;

revoke execute on function ingest.validate_cmr_granule_detail()
  from public, anon, authenticated, service_role,
  firewatch_catalog_admin, firewatch_collector, firewatch_reconciler,
  firewatch_publisher, firewatch_dispatcher;

create trigger cmr_granule_details_validate
before insert on ingest.cmr_granule_details
for each row execute function ingest.validate_cmr_granule_detail();

create trigger cmr_granule_details_reject_mutation
before update or delete on ingest.cmr_granule_details
for each row execute function core.reject_mutation();

-- The observation and its typed CMR detail are one atomic normalized fact. A
-- deferred constraint lets the collector insert the parent first without ever
-- committing an accepted or quarantined CMR observation that lacks its detail.
create or replace function ingest.require_cmr_granule_detail()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if exists (
    select 1
    from core.sources as source
    where source.id = new.source_id
      and source.slug = 'nasa-cmr-firemask'
  ) and not exists (
    select 1
    from ingest.cmr_granule_details as detail
    where detail.observation_cursor = new.cursor
  ) then
    raise exception 'NASA CMR observations require a typed CMR granule detail in the same transaction'
      using errcode = '23514';
  end if;
  return null;
end;
$$;

revoke execute on function ingest.require_cmr_granule_detail()
  from public, anon, authenticated, service_role,
  firewatch_catalog_admin, firewatch_collector, firewatch_reconciler,
  firewatch_publisher, firewatch_dispatcher;

create constraint trigger global_observations_require_cmr_granule_detail
after insert on ingest.global_observations
deferrable initially deferred
for each row execute function ingest.require_cmr_granule_detail();

-- Global observation identity is deduplicated across runs, but every harvest
-- still needs its own immutable proof that the exact response contained that
-- typed granule. A later replay can therefore authorize an observation first
-- normalized by a failed run without mutating or duplicating the observation.
create table ingest.cmr_granule_occurrences (
  run_id bigint not null references ingest.runs(id),
  http_exchange_id bigint not null references ingest.http_exchanges(id),
  item_index integer not null check (item_index between 0 and 199),
  observation_cursor bigint not null
    references ingest.global_observations(cursor),
  product text not null check (product in (
    'VNP14IMG_NRT', 'VJ114IMG_NRT', 'VJ214IMG_NRT'
  )),
  catalog_granule_id text not null
    check (catalog_granule_id ~ '^G[0-9]+-[A-Za-z0-9_-]+$'),
  cmr_revision_id bigint not null check (cmr_revision_id > 0),
  lease_token uuid not null,
  lease_owner text not null check (btrim(lease_owner) <> ''),
  recorded_at timestamptz not null default now(),
  primary key (run_id, http_exchange_id, item_index),
  constraint cmr_granule_occurrences_run_observation_key
    unique (run_id, observation_cursor)
);

create index cmr_granule_occurrences_observation_run_idx
  on ingest.cmr_granule_occurrences(observation_cursor, run_id);
create index cmr_granule_occurrences_run_product_idx
  on ingest.cmr_granule_occurrences(
    run_id, product, http_exchange_id, item_index
  );
create index cmr_granule_occurrences_exchange_idx
  on ingest.cmr_granule_occurrences(http_exchange_id, item_index);

create or replace function ingest.validate_cmr_granule_occurrence()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  occurrence_context record;
begin
  select
    run.status as run_status,
    run.source_id as run_source_id,
    run.lease_token as run_lease_token,
    run.lease_owner as run_lease_owner,
    job.status as job_status,
    job.lease_token as job_lease_token,
    job.lease_owner as job_lease_owner,
    job.lease_expires_at,
    source.slug as source_slug,
    exchange.run_id as exchange_run_id,
    exchange.outcome as exchange_outcome,
    exchange.http_status,
    exchange.response_raw_object_id,
    exchange.request_metadata_safe->>'product' as exchange_product,
    observation.source_id as observation_source_id,
    observation.validation_state,
    observation.observation_kind,
    observation.evidence_class,
    detail.product as detail_product,
    detail.catalog_granule_id as detail_catalog_granule_id,
    detail.cmr_revision_id as detail_cmr_revision_id
  into occurrence_context
  from ingest.runs as run
  join ingest.jobs as job on job.id = run.job_id
  join core.sources as source on source.id = run.source_id
  join ingest.http_exchanges as exchange
    on exchange.id = new.http_exchange_id
  join ingest.global_observations as observation
    on observation.cursor = new.observation_cursor
  join ingest.cmr_granule_details as detail
    on detail.observation_cursor = observation.cursor
  where run.id = new.run_id;

  if not found
    or occurrence_context.source_slug <> 'nasa-cmr-firemask'
    or occurrence_context.exchange_run_id is distinct from new.run_id
    or occurrence_context.exchange_product is distinct from new.product
    or occurrence_context.exchange_outcome is distinct from 'response'
    or occurrence_context.http_status is distinct from 200
    or occurrence_context.response_raw_object_id is null
    or occurrence_context.observation_source_id
      is distinct from occurrence_context.run_source_id
    or occurrence_context.validation_state <> 'accepted'
    or occurrence_context.observation_kind <> 'satellite_imagery'
    or occurrence_context.evidence_class <> 'satellite_pass_metadata'
    or occurrence_context.detail_product is distinct from new.product
    or occurrence_context.detail_catalog_granule_id
      is distinct from new.catalog_granule_id
    or occurrence_context.detail_cmr_revision_id
      is distinct from new.cmr_revision_id
  then
    raise exception 'CMR occurrence must match its accepted typed granule and successful durable product response'
      using errcode = '23514';
  end if;

  if occurrence_context.run_status <> 'running'
    or occurrence_context.job_status <> 'running'
    or new.lease_token is distinct from occurrence_context.run_lease_token
    or new.lease_token is distinct from occurrence_context.job_lease_token
    or new.lease_owner is distinct from occurrence_context.run_lease_owner
    or new.lease_owner is distinct from occurrence_context.job_lease_owner
    or occurrence_context.lease_expires_at <= now()
  then
    raise exception 'CMR occurrence insertion requires the active fenced run lease'
      using errcode = '55000';
  end if;

  new.recorded_at := now();
  return new;
end;
$$;

revoke execute on function ingest.validate_cmr_granule_occurrence()
  from public, anon, authenticated, service_role,
  firewatch_catalog_admin, firewatch_collector, firewatch_reconciler,
  firewatch_publisher, firewatch_dispatcher;

create trigger cmr_granule_occurrences_validate
before insert on ingest.cmr_granule_occurrences
for each row execute function ingest.validate_cmr_granule_occurrence();

create trigger cmr_granule_occurrences_reject_mutation
before update or delete on ingest.cmr_granule_occurrences
for each row execute function core.reject_mutation();

-- A malformed item is evidence too. It remains attached to the exact response
-- occurrence, but is never promoted to a source revision or observation.
create table ingest.cmr_rejections (
  run_id bigint not null references ingest.runs(id),
  http_exchange_id bigint not null references ingest.http_exchanges(id),
  item_index integer not null check (item_index between 0 and 199),
  product text not null check (product in (
    'VNP14IMG_NRT', 'VJ114IMG_NRT', 'VJ214IMG_NRT'
  )),
  catalog_granule_id text check (
    catalog_granule_id is null
    or catalog_granule_id ~ '^G[0-9]+-[A-Za-z0-9_-]+$'
  ),
  cmr_revision_id bigint check (cmr_revision_id is null or cmr_revision_id > 0),
  reason text not null check (
    reason = btrim(reason)
    and char_length(reason) between 1 and 512
    and reason !~ '[[:cntrl:]]'
  ),
  lease_token uuid not null,
  lease_owner text not null check (btrim(lease_owner) <> ''),
  created_at timestamptz not null default now(),
  primary key (run_id, http_exchange_id, item_index)
);

create index cmr_rejections_exchange_idx
  on ingest.cmr_rejections(http_exchange_id, item_index);

create or replace function ingest.validate_cmr_rejection()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  rejection_context record;
begin
  select
    run.status as run_status,
    run.lease_token as run_lease_token,
    run.lease_owner as run_lease_owner,
    job.status as job_status,
    job.lease_token as job_lease_token,
    job.lease_owner as job_lease_owner,
    job.lease_expires_at,
    source.slug as source_slug,
    exchange.run_id as exchange_run_id,
    exchange.outcome as exchange_outcome,
    exchange.http_status,
    exchange.response_raw_object_id,
    exchange.request_metadata_safe->>'product' as exchange_product
  into rejection_context
  from ingest.runs as run
  join ingest.jobs as job on job.id = run.job_id
  join core.sources as source on source.id = run.source_id
  join ingest.http_exchanges as exchange
    on exchange.id = new.http_exchange_id
  where run.id = new.run_id;

  if not found
    or rejection_context.source_slug <> 'nasa-cmr-firemask'
    or rejection_context.exchange_run_id is distinct from new.run_id
    or rejection_context.exchange_product is distinct from new.product
    or rejection_context.exchange_outcome is distinct from 'response'
    or rejection_context.http_status is distinct from 200
    or rejection_context.response_raw_object_id is null
  then
    raise exception 'CMR rejection must reference its successful durable product response'
      using errcode = '23514';
  end if;

  if rejection_context.run_status <> 'running'
    or rejection_context.job_status <> 'running'
    or new.lease_token is distinct from rejection_context.run_lease_token
    or new.lease_token is distinct from rejection_context.job_lease_token
    or new.lease_owner is distinct from rejection_context.run_lease_owner
    or new.lease_owner is distinct from rejection_context.job_lease_owner
    or rejection_context.lease_expires_at <= now()
  then
    raise exception 'CMR rejection insertion requires the active fenced run lease'
      using errcode = '55000';
  end if;

  return new;
end;
$$;

revoke execute on function ingest.validate_cmr_rejection()
  from public, anon, authenticated, service_role,
  firewatch_catalog_admin, firewatch_collector, firewatch_reconciler,
  firewatch_publisher, firewatch_dispatcher;

create trigger cmr_rejections_validate
before insert on ingest.cmr_rejections
for each row execute function ingest.validate_cmr_rejection();

create trigger cmr_rejections_reject_mutation
before update or delete on ingest.cmr_rejections
for each row execute function core.reject_mutation();

create table ingest.cmr_scan_completions (
  health_cursor bigint primary key references truth.source_health(cursor),
  run_id bigint not null unique references ingest.runs(id),
  scan_kind text not null check (scan_kind in (
    'bootstrap', 'incremental', 'reconciliation'
  )),
  requested_from timestamptz not null,
  requested_to timestamptz not null,
  watermark_from timestamptz,
  updated_since timestamptz,
  watermark_to timestamptz not null,
  predecessor_health_cursor bigint unique
    references ingest.cmr_scan_completions(health_cursor),
  baseline_health_cursor bigint not null
    references ingest.cmr_scan_completions(health_cursor),
  continuous_coverage_from timestamptz not null,
  continuous_coverage_to timestamptz not null,
  lineage_depth bigint not null check (lineage_depth >= 0),
  completed_products text[] not null,
  page_count integer not null check (page_count >= 3),
  upstream_hit_count bigint not null check (upstream_hit_count >= 0),
  accepted_granule_count bigint not null check (accepted_granule_count >= 0),
  freshness_deadline timestamptz not null,
  constraint cmr_scan_completions_requested_window_check
    check (requested_to > requested_from),
  constraint cmr_scan_completions_watermark_check
    check (
      watermark_to >= requested_from
      and watermark_to <= requested_to
      and (watermark_from is null or watermark_from <= watermark_to)
    ),
  constraint cmr_scan_completions_coverage_check
    check (
      continuous_coverage_to > continuous_coverage_from
      and continuous_coverage_from <= requested_from
      and continuous_coverage_to >= requested_to
    ),
  constraint cmr_scan_completions_products_check check (
    completed_products = array[
      'VJ114IMG_NRT', 'VJ214IMG_NRT', 'VNP14IMG_NRT'
    ]::text[]
  )
);

create index cmr_scan_completions_coverage_idx
  on ingest.cmr_scan_completions(
    continuous_coverage_to desc,
    continuous_coverage_from,
    health_cursor desc
  );
create index cmr_scan_completions_baseline_health_idx
  on ingest.cmr_scan_completions(baseline_health_cursor, health_cursor);

create or replace function ingest.validate_cmr_scan_completion()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  scan_record record;
  prior_record record;
begin
  select
    health.source_id,
    health.endpoint_id,
    health.collection_target_id,
    health.collection_target_revision_id,
    health.run_id as health_run_id,
    health.status as health_status,
    health.visibility as health_visibility,
    health.checked_at,
    health.last_success_at,
    health.latest_source_observed_at,
    health.error_class,
    health.geographic_completeness,
    health.record_count,
    health.schema_failure_count,
    source.slug as source_slug,
    endpoint.endpoint_key,
    target.target_key,
    revision.stale_after,
    run.status as run_status,
    run.started_at,
    run.finished_at,
    run.request_count,
    run.fetched_count,
    run.accepted_count,
    run.rejected_count,
    run.duplicate_count
  into scan_record
  from truth.source_health as health
  join core.sources as source on source.id = health.source_id
  join core.endpoints as endpoint on endpoint.id = health.endpoint_id
  join core.collection_targets as target
    on target.id = health.collection_target_id
  join core.collection_target_revisions as revision
    on revision.id = health.collection_target_revision_id
  join ingest.runs as run on run.id = health.run_id
  where health.cursor = new.health_cursor;

  if not found then
    raise exception 'CMR scan completion requires source health linked to a run'
      using errcode = '23503';
  end if;

  if scan_record.source_slug <> 'nasa-cmr-firemask'
    or scan_record.endpoint_key <> 'granules-umm-g-1-6-7'
    or scan_record.target_key <> 'global-firemask-granules'
    or scan_record.health_run_id is distinct from new.run_id
  then
    raise exception 'CMR scan completion must reference the global NASA CMR target run'
      using errcode = '23514';
  end if;

  if scan_record.health_status <> 'healthy'
    or scan_record.health_visibility <> 'public'
    or scan_record.last_success_at is distinct from scan_record.checked_at
    or scan_record.error_class is not null
    or scan_record.geographic_completeness is distinct from 1::numeric
    or scan_record.schema_failure_count <> 0
    or scan_record.run_status <> 'success'
    or scan_record.finished_at is null
    or scan_record.finished_at > scan_record.checked_at
    or scan_record.rejected_count <> 0
    or exists (
      select 1
      from ingest.cmr_rejections as rejection
      where rejection.run_id = new.run_id
    )
    or exists (
      select 1
      from ingest.cmr_granule_details as detail
      join ingest.global_observations as observation
        on observation.cursor = detail.observation_cursor
      join ingest.source_revisions as revision
        on revision.id = observation.source_revision_id
      where revision.run_id = new.run_id
        and observation.validation_state <> 'accepted'
    )
  then
    raise exception 'CMR completion requires a healthy, public, geographically complete successful run'
      using errcode = '23514';
  end if;

  if new.page_count <> scan_record.request_count
    or new.upstream_hit_count <> scan_record.fetched_count
    or new.accepted_granule_count
      <> scan_record.accepted_count + scan_record.duplicate_count
    or scan_record.record_count is distinct from new.accepted_granule_count
    or (
      select count(*)
      from ingest.cmr_granule_occurrences as occurrence
      where occurrence.run_id = new.run_id
    ) is distinct from new.accepted_granule_count
  then
    raise exception 'CMR completion counts must match the durable run, health, and occurrence ledgers'
      using errcode = '23514';
  end if;

  if new.requested_to > scan_record.started_at + interval '5 minutes'
    or scan_record.checked_at < new.requested_to
    or (
      scan_record.latest_source_observed_at is not null
      and (
        scan_record.latest_source_observed_at < new.requested_from
        or scan_record.latest_source_observed_at > new.requested_to
      )
    )
  then
    raise exception 'CMR completion window must match the run acquisition window'
      using errcode = '23514';
  end if;

  if new.watermark_to is distinct from new.requested_to - interval '10 minutes' then
    raise exception 'CMR completion replay watermark must retain the configured ten-minute publication lag'
      using errcode = '23514';
  end if;

  if new.scan_kind in ('bootstrap', 'reconciliation') then
    if new.predecessor_health_cursor is not null
      or new.watermark_from is not null
      or new.updated_since is not null
    then
      raise exception 'CMR bootstrap/reconciliation scans start a new complete lineage'
        using errcode = '23514';
    end if;

    new.baseline_health_cursor := new.health_cursor;
    new.continuous_coverage_from := new.requested_from;
    new.continuous_coverage_to := new.requested_to;
    new.lineage_depth := 0;
  else
    if new.predecessor_health_cursor is null
      or new.watermark_from is null
      or new.updated_since is distinct from new.watermark_from
    then
      raise exception 'CMR incremental scans require a predecessor, exact continuity query watermark, and lagged replay watermark'
        using errcode = '23514';
    end if;

    select
      predecessor.baseline_health_cursor,
      predecessor.continuous_coverage_from,
      predecessor.continuous_coverage_to,
      predecessor.watermark_to,
      predecessor.lineage_depth,
      prior_health.collection_target_id,
      prior_health.collection_target_revision_id
    into prior_record
    from ingest.cmr_scan_completions as predecessor
    join truth.source_health as prior_health
      on prior_health.cursor = predecessor.health_cursor
    where predecessor.health_cursor = new.predecessor_health_cursor;

    if not found
      or prior_record.collection_target_id <> scan_record.collection_target_id
      or prior_record.collection_target_revision_id
        <> scan_record.collection_target_revision_id
      or new.requested_from > prior_record.continuous_coverage_to
      or new.requested_to <= prior_record.continuous_coverage_to
      or new.watermark_from is distinct from prior_record.watermark_to
    then
      raise exception 'CMR incremental scan must extend an uninterrupted same-revision lineage'
        using errcode = '23514';
    end if;

    new.baseline_health_cursor := prior_record.baseline_health_cursor;
    new.continuous_coverage_from := prior_record.continuous_coverage_from;
    new.continuous_coverage_to := new.requested_to;
    new.lineage_depth := prior_record.lineage_depth + 1;
  end if;

  new.freshness_deadline := scan_record.checked_at + scan_record.stale_after;
  return new;
end;
$$;

revoke execute on function ingest.validate_cmr_scan_completion()
  from public, anon, authenticated, service_role,
  firewatch_catalog_admin, firewatch_collector, firewatch_reconciler,
  firewatch_publisher, firewatch_dispatcher;

create trigger cmr_scan_completions_validate
before insert on ingest.cmr_scan_completions
for each row execute function ingest.validate_cmr_scan_completion();

create trigger cmr_scan_completions_reject_mutation
before update or delete on ingest.cmr_scan_completions
for each row execute function core.reject_mutation();

-- One row per required product makes a successful run insufficient on its
-- own: every product must have a complete terminal page chain backed by the
-- generic per-request HTTP evidence ledger.
create table ingest.cmr_scan_product_completions (
  health_cursor bigint not null
    references ingest.cmr_scan_completions(health_cursor),
  product text not null check (product in (
    'VNP14IMG_NRT', 'VJ114IMG_NRT', 'VJ214IMG_NRT'
  )),
  page_count integer not null check (page_count between 1 and 20),
  upstream_hit_count bigint not null check (upstream_hit_count >= 0),
  accepted_granule_count bigint not null check (accepted_granule_count >= 0),
  primary key (health_cursor, product),
  constraint cmr_scan_product_completions_accounting_check
    check (accepted_granule_count = upstream_hit_count)
);

create or replace function ingest.validate_cmr_scan_product_completion()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  scan_record record;
  exchange_record record;
  expected_page integer := 0;
  stable_query jsonb;
  prior_response_cursor text;
  response_cursor text;
  is_terminal boolean;
  terminal_value text;
  partial_value text;
  truncated_value text;
  temporal_value text;
  temporal_from timestamptz;
  temporal_to timestamptz;
  parsed_updated_since timestamptz;
  provider_request_id text;
  occurrence_count bigint;
  timestamp_pattern constant text :=
    '^[0-9]{4}-[0-9]{2}-[0-9]{2}[T ][0-2][0-9]:[0-5][0-9]:[0-5][0-9](\.[0-9]{1,6})?(Z|[+-][0-2][0-9](:?[0-5][0-9])?)$';
begin
  select
    completion.run_id,
    completion.scan_kind,
    completion.requested_from,
    completion.requested_to,
    completion.watermark_from,
    completion.updated_since
  into scan_record
  from ingest.cmr_scan_completions as completion
  where completion.health_cursor = new.health_cursor;

  if not found then
    raise exception 'CMR product completion requires its scan completion'
      using errcode = '23503';
  end if;

  for exchange_record in
    select exchange.*
    from ingest.http_exchanges as exchange
    where exchange.run_id = scan_record.run_id
      and exchange.request_metadata_safe->>'product' = new.product
    order by exchange.request_no
  loop
    expected_page := expected_page + 1;
    response_cursor := nullif(
      exchange_record.response_headers_safe->>'cmr-search-after',
      ''
    );
    provider_request_id := coalesce(
      nullif(exchange_record.response_headers_safe->>'cmr-request-id', ''),
      nullif(exchange_record.response_headers_safe->>'x-request-id', '')
    );
    terminal_value := lower(coalesce(
      exchange_record.result_metadata_safe->>'terminal', ''
    ));
    partial_value := lower(coalesce(
      exchange_record.result_metadata_safe->>'partial', ''
    ));
    truncated_value := lower(coalesce(
      exchange_record.result_metadata_safe->>'truncated', ''
    ));
    is_terminal := terminal_value = 'true';

    if exchange_record.request_metadata_safe->>'page'
        is distinct from expected_page::text
      or exchange_record.request_metadata_safe->>'page_size'
        is distinct from '200'
      or exchange_record.request_metadata_safe->>'product'
        is distinct from new.product
      or exchange_record.request_metadata_safe->>'scope'
        is distinct from 'global'
      or exchange_record.request_query_safe->>'page_size'
        is distinct from '200'
      or exchange_record.outcome is distinct from 'response'
      or exchange_record.http_status is distinct from 200
      or exchange_record.response_raw_object_id is null
      or lower(coalesce(
        exchange_record.response_headers_safe->>'cmr-time-out', 'false'
      )) not in ('true', 'false')
      or lower(coalesce(
        exchange_record.response_headers_safe->>'cmr-time-out', 'false'
      )) = 'true'
      or lower(coalesce(
        exchange_record.response_headers_safe->>'cmr-timed-out', 'false'
      )) not in ('true', 'false')
      or lower(coalesce(
        exchange_record.response_headers_safe->>'cmr-timed-out', 'false'
      )) = 'true'
      or terminal_value not in ('true', 'false')
      or partial_value is distinct from 'false'
      or truncated_value is distinct from 'false'
      or coalesce(
        exchange_record.result_metadata_safe->>'response_body_bytes', ''
      ) !~ '^(0|[1-9][0-9]*)$'
      or exchange_record.request_query_safe->>'provider'
        is distinct from 'LANCEMODIS'
      or exchange_record.request_query_safe->>'short_name'
        is distinct from new.product
      or exchange_record.request_query_safe->>'version' is distinct from '2'
      or exchange_record.request_query_safe->'sort_key[]'
        is distinct from '["-start_date", "granule_ur"]'::jsonb
      or exchange_record.response_headers_safe->>'cmr-hits'
        is distinct from new.upstream_hit_count::text
      or provider_request_id is null
      or exchange_record.result_metadata_safe->>'provider_request_id'
        is distinct from provider_request_id
    then
      raise exception 'CMR product page is not a successful complete response in the stable query envelope'
        using errcode = '23514';
    end if;

    temporal_value := exchange_record.request_query_safe->>'temporal';
    if temporal_value is null
      or split_part(temporal_value, ',', 1) !~ timestamp_pattern
      or split_part(temporal_value, ',', 2) !~ timestamp_pattern
      or split_part(temporal_value, ',', 3) <> ''
    then
      raise exception 'CMR product page temporal query must match the recorded scan window'
        using errcode = '23514';
    end if;

    begin
      temporal_from := split_part(temporal_value, ',', 1)::timestamptz;
      temporal_to := split_part(temporal_value, ',', 2)::timestamptz;
    exception
      when invalid_datetime_format or datetime_field_overflow then
        raise exception 'CMR product page temporal query must match the recorded scan window'
          using errcode = '23514';
    end;

    if temporal_from is distinct from scan_record.requested_from
      or temporal_to is distinct from scan_record.requested_to
    then
      raise exception 'CMR product page temporal query must match the recorded scan window'
        using errcode = '23514';
    end if;

    if scan_record.scan_kind = 'incremental' then
      if coalesce(
        exchange_record.request_query_safe->>'updated_since', ''
      ) !~ timestamp_pattern
      then
        raise exception 'CMR incremental page must use the persisted overlap watermark'
          using errcode = '23514';
      end if;

      begin
        parsed_updated_since := (
          exchange_record.request_query_safe->>'updated_since'
        )::timestamptz;
      exception
        when invalid_datetime_format or datetime_field_overflow then
          raise exception 'CMR incremental page must use the persisted overlap watermark'
            using errcode = '23514';
      end;

      if parsed_updated_since is distinct from scan_record.updated_since then
        raise exception 'CMR incremental page must use the persisted overlap watermark'
          using errcode = '23514';
      end if;
    elsif exchange_record.request_query_safe ? 'updated_since' then
      raise exception 'CMR baseline pages must not claim an incremental watermark'
        using errcode = '23514';
    end if;

    if stable_query is null then
      stable_query := exchange_record.request_query_safe
        - 'page' - 'page_num' - 'search_after';
    elsif stable_query is distinct from (
      exchange_record.request_query_safe
        - 'page' - 'page_num' - 'search_after'
    ) then
      raise exception 'CMR product pagination changed its stable query envelope'
        using errcode = '23514';
    end if;

    if expected_page = 1 then
      if exchange_record.request_headers_safe ? 'cmr-search-after' then
        raise exception 'CMR product page one must not provide a search-after cursor'
          using errcode = '23514';
      end if;
    elsif exchange_record.request_headers_safe->>'cmr-search-after'
      is distinct from prior_response_cursor
    then
      raise exception 'CMR product page must continue the prior response search-after cursor'
        using errcode = '23514';
    end if;

    if expected_page < new.page_count then
      if response_cursor is null or is_terminal then
        raise exception 'nonterminal CMR product pages must provide their next cursor'
          using errcode = '23514';
      end if;
    elsif expected_page = new.page_count then
      if response_cursor is not null or not is_terminal then
        raise exception 'terminal CMR product page must exhaust search-after pagination'
          using errcode = '23514';
      end if;
    else
      raise exception 'CMR product page chain exceeds its declared page count'
        using errcode = '23514';
    end if;

    prior_response_cursor := response_cursor;
  end loop;

  if expected_page <> new.page_count then
    raise exception 'CMR product completion page count does not match durable HTTP exchanges'
      using errcode = '23514';
  end if;

  select count(*)
  into occurrence_count
  from ingest.cmr_granule_occurrences as occurrence
  where occurrence.run_id = scan_record.run_id
    and occurrence.product = new.product;

  if occurrence_count is distinct from new.accepted_granule_count then
    raise exception 'CMR product accepted count must match its durable run occurrences'
      using errcode = '23514';
  end if;

  return new;
end;
$$;

revoke execute on function ingest.validate_cmr_scan_product_completion()
  from public, anon, authenticated, service_role,
  firewatch_catalog_admin, firewatch_collector, firewatch_reconciler,
  firewatch_publisher, firewatch_dispatcher;

create trigger cmr_scan_product_completions_validate
before insert on ingest.cmr_scan_product_completions
for each row execute function ingest.validate_cmr_scan_product_completion();

create trigger cmr_scan_product_completions_reject_mutation
before update or delete on ingest.cmr_scan_product_completions
for each row execute function core.reject_mutation();

create or replace function ingest.require_complete_cmr_product_set()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  product_rows integer;
  product_names text[];
  total_pages bigint;
  total_hits bigint;
  total_accepted bigint;
begin
  select
    count(*)::integer,
    array_agg(product order by product),
    sum(page_count),
    sum(upstream_hit_count),
    sum(accepted_granule_count)
  into
    product_rows,
    product_names,
    total_pages,
    total_hits,
    total_accepted
  from ingest.cmr_scan_product_completions
  where health_cursor = new.health_cursor;

  if product_rows <> 3
    or product_names is distinct from new.completed_products
    or total_pages is distinct from new.page_count::bigint
    or total_hits is distinct from new.upstream_hit_count
    or total_accepted is distinct from new.accepted_granule_count
  then
    raise exception 'CMR completion requires all three product page chains and matching aggregate counts'
      using errcode = '23514';
  end if;

  return null;
end;
$$;

revoke execute on function ingest.require_complete_cmr_product_set()
  from public, anon, authenticated, service_role,
  firewatch_catalog_admin, firewatch_collector, firewatch_reconciler,
  firewatch_publisher, firewatch_dispatcher;

create constraint trigger cmr_scan_completions_require_product_set
after insert on ingest.cmr_scan_completions
deferrable initially deferred
for each row execute function ingest.require_complete_cmr_product_set();

-- Normalization happens page by page, before a global harvest is known to be
-- complete. This non-exposed ownership boundary prevents an accepted early
-- page from becoming public if a later page or product fails.
create or replace function ingest.cmr_observation_is_publishable(
  p_observation_cursor bigint
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from ingest.global_observations as observation
    join core.sources as source on source.id = observation.source_id
    join ingest.cmr_granule_occurrences as occurrence
      on occurrence.observation_cursor = observation.cursor
    join ingest.cmr_scan_completions as completion
      on completion.run_id = occurrence.run_id
    join truth.source_health as health
      on health.cursor = completion.health_cursor
      and health.run_id = completion.run_id
    where observation.cursor = p_observation_cursor
      and source.slug = 'nasa-cmr-firemask'
      and health.status = 'healthy'
      and health.visibility = 'public'
      and health.last_success_at is not null
      and health.error_class is null
      and health.geographic_completeness = 1
      and health.schema_failure_count = 0
  );
$$;

revoke execute on function ingest.cmr_observation_is_publishable(bigint)
  from public, firewatch_catalog_admin, firewatch_collector,
  firewatch_reconciler, firewatch_publisher, firewatch_dispatcher;
grant execute on function ingest.cmr_observation_is_publishable(bigint)
  to anon, authenticated, service_role;

drop policy global_observations_public_read on ingest.global_observations;
create policy global_observations_public_read
on ingest.global_observations for select
to anon, authenticated
using (
  visibility = 'public'
  and trust_class <> 'synthetic'
  and validation_state = 'accepted'
  and exists (
    select 1
    from core.sources as source
    join core.providers as provider on provider.id = source.provider_id
    where source.id = global_observations.source_id
      and source.is_public
      and provider.is_public
      and source.sensitivity = 'public'
      and source.license_status = 'approved'
      and source.redistribution_allowed is true
      and (
        source.slug <> 'nasa-cmr-firemask'
        or ingest.cmr_observation_is_publishable(
          global_observations.cursor
        )
      )
  )
);

alter table ingest.cmr_granule_details enable row level security;
alter table ingest.cmr_granule_details force row level security;
alter table ingest.cmr_granule_occurrences enable row level security;
alter table ingest.cmr_granule_occurrences force row level security;
alter table ingest.cmr_rejections enable row level security;
alter table ingest.cmr_rejections force row level security;
alter table ingest.cmr_scan_completions enable row level security;
alter table ingest.cmr_scan_completions force row level security;
alter table ingest.cmr_scan_product_completions enable row level security;
alter table ingest.cmr_scan_product_completions force row level security;

revoke all on ingest.cmr_granule_details, ingest.cmr_granule_occurrences,
  ingest.cmr_rejections,
  ingest.cmr_scan_completions,
  ingest.cmr_scan_product_completions
  from public, anon, authenticated, service_role,
  firewatch_catalog_admin, firewatch_collector, firewatch_reconciler,
  firewatch_publisher, firewatch_dispatcher;

create policy cmr_granule_details_collector_read
on ingest.cmr_granule_details for select
to firewatch_collector
using (true);

create policy cmr_granule_details_collector_insert
on ingest.cmr_granule_details for insert
to firewatch_collector
with check (true);

create policy cmr_granule_occurrences_collector_read
on ingest.cmr_granule_occurrences for select
to firewatch_collector
using (true);

create policy cmr_granule_occurrences_collector_insert
on ingest.cmr_granule_occurrences for insert
to firewatch_collector
with check (true);

create policy cmr_rejections_collector_read
on ingest.cmr_rejections for select
to firewatch_collector
using (true);

create policy cmr_rejections_collector_insert
on ingest.cmr_rejections for insert
to firewatch_collector
with check (true);

create policy cmr_scan_completions_collector_read
on ingest.cmr_scan_completions for select
to firewatch_collector
using (true);

create policy cmr_scan_completions_collector_insert
on ingest.cmr_scan_completions for insert
to firewatch_collector
with check (true);

create policy cmr_scan_product_completions_collector_read
on ingest.cmr_scan_product_completions for select
to firewatch_collector
using (true);

create policy cmr_scan_product_completions_collector_insert
on ingest.cmr_scan_product_completions for insert
to firewatch_collector
with check (true);

create policy cmr_granule_details_public_read
on ingest.cmr_granule_details for select
to anon, authenticated
using (
  exists (
    select 1
    from ingest.global_observations as observation
    join core.sources as source on source.id = observation.source_id
    join core.providers as provider on provider.id = source.provider_id
    where observation.cursor = cmr_granule_details.observation_cursor
      and source.slug = 'nasa-cmr-firemask'
      and observation.observation_kind = 'satellite_imagery'
      and observation.evidence_class = 'satellite_pass_metadata'
      and observation.visibility = 'public'
      and observation.trust_class <> 'synthetic'
      and observation.validation_state = 'accepted'
      and source.is_public
      and provider.is_public
      and source.sensitivity = 'public'
      and source.license_status = 'approved'
      and source.redistribution_allowed is true
      and ingest.cmr_observation_is_publishable(
        observation.cursor
      )
  )
);

create policy cmr_scan_completions_public_read
on ingest.cmr_scan_completions for select
to anon, authenticated
using (
  exists (
    select 1
    from truth.source_health as health
    join core.sources as source on source.id = health.source_id
    join core.providers as provider on provider.id = source.provider_id
    join core.collection_targets as target
      on target.id = health.collection_target_id
    where health.cursor = cmr_scan_completions.health_cursor
      and health.visibility = 'public'
      and core.is_current_collection_target_revision(
        health.collection_target_id,
        health.collection_target_revision_id,
        now()
      )
      and source.slug = 'nasa-cmr-firemask'
      and source.is_public
      and provider.is_public
      and source.sensitivity = 'public'
      and source.license_status = 'approved'
      and source.redistribution_allowed is true
      and target.visibility = 'public'
  )
);

create policy cmr_collection_target_revisions_public_read
on core.collection_target_revisions for select
to anon, authenticated
using (
  core.is_current_collection_target_revision(
    collection_target_id,
    id,
    now()
  )
  and exists (
    select 1
    from core.collection_targets as target
    join core.sources as source on source.id = target.source_id
    join core.providers as provider on provider.id = source.provider_id
    where target.id = collection_target_revisions.collection_target_id
      and target.visibility = 'public'
      and source.slug = 'nasa-cmr-firemask'
      and source.is_public
      and provider.is_public
      and source.sensitivity = 'public'
      and source.license_status = 'approved'
      and source.redistribution_allowed is true
  )
);

grant select, insert on
  ingest.cmr_granule_details,
  ingest.cmr_granule_occurrences,
  ingest.cmr_rejections,
  ingest.cmr_scan_completions,
  ingest.cmr_scan_product_completions
to firewatch_collector;

-- Security-invoker projections receive only the typed public fields they use.
grant select (
  observation_cursor, catalog_granule_id, catalog_collection_id,
  cmr_revision_id, umm_g_version, product, product_version, satellite, sensor,
  observed_to, produced_at, cataloged_at, day_night
) on ingest.cmr_granule_details to anon, authenticated, service_role;

grant select (
  health_cursor, scan_kind, requested_from, requested_to, watermark_from,
  updated_since, watermark_to, predecessor_health_cursor, baseline_health_cursor,
  continuous_coverage_from, continuous_coverage_to, lineage_depth,
  completed_products, page_count, upstream_hit_count,
  accepted_granule_count, freshness_deadline
) on ingest.cmr_scan_completions to anon, authenticated, service_role;

grant select (
  id, public_id, collection_target_id, version_no, stale_after, enabled
) on core.collection_target_revisions to anon, authenticated, service_role;

create view api.satellite_passes
with (security_invoker = true, security_barrier = true)
as
select
  observation.public_id::uuid as observation_id,
  observation.contract_version,
  observation.identity_version,
  source.public_id::uuid as source_id,
  source.slug as source_slug,
  detail.catalog_granule_id,
  detail.catalog_collection_id,
  detail.cmr_revision_id,
  detail.umm_g_version,
  detail.product,
  detail.product_version,
  detail.satellite,
  detail.sensor,
  observation.observed_at as observed_from,
  detail.observed_to,
  detail.produced_at,
  detail.cataloged_at,
  observation.retrieved_at,
  detail.day_night,
  extensions.st_asgeojson(observation.geom, 6)::jsonb as footprint_geojson,
  observation.geometry_precision_m,
  observation.geometry_precision_source,
  'cmr_catalog_metadata'::text as footprint_basis,
  'not_assessed'::text as anomaly_assessment
from ingest.cmr_granule_details as detail
join ingest.global_observations as observation
  on observation.cursor = detail.observation_cursor
join core.sources as source on source.id = observation.source_id
join core.providers as provider on provider.id = source.provider_id
where source.slug = 'nasa-cmr-firemask'
  and observation.observation_kind = 'satellite_imagery'
  and observation.evidence_class = 'satellite_pass_metadata'
  and observation.visibility = 'public'
  and observation.validation_state = 'accepted'
  and observation.trust_class <> 'synthetic'
  and source.is_public
  and provider.is_public
  and source.sensitivity = 'public'
  and source.license_status = 'approved'
  and source.redistribution_allowed is true
  and ingest.cmr_observation_is_publishable(
    observation.cursor
  )
  and not exists (
    select 1
    from ingest.cmr_granule_details as newer
    join ingest.global_observations as newer_observation
      on newer_observation.cursor = newer.observation_cursor
    where newer.catalog_granule_id = detail.catalog_granule_id
      and newer.cmr_revision_id > detail.cmr_revision_id
      and ingest.cmr_observation_is_publishable(
        newer_observation.cursor
      )
  );

create view api.satellite_scan_status
with (security_invoker = true, security_barrier = true)
as
select
  source.public_id::uuid as source_id,
  source.slug as source_slug,
  target.public_id::uuid as collection_target_id,
  target_revision.public_id::uuid as collection_target_revision_id,
  latest_health.public_id::uuid as health_id,
  coalesce(
    latest_health.status,
    case
      when not source.enabled or not target.enabled or not target_revision.enabled
        then 'disabled'
      else 'unconfigured'
    end
  ) as health_status,
  completion_health.public_id::uuid as scan_health_id,
  completion.scan_kind,
  completion.requested_from,
  completion.requested_to,
  completion.watermark_from,
  completion.updated_since,
  completion.watermark_to,
  predecessor_health.public_id::uuid as predecessor_health_id,
  baseline_health.public_id::uuid as baseline_health_id,
  completion.continuous_coverage_from,
  completion.continuous_coverage_to,
  completion.lineage_depth,
  completion.completed_products,
  completion.page_count,
  completion.upstream_hit_count,
  completion.accepted_granule_count,
  latest_health.checked_at,
  latest_health.last_success_at,
  latest_health.latest_source_observed_at,
  completion_health.checked_at as scan_checked_at,
  latest_health.geographic_completeness,
  latest_health.schema_failure_count,
  completion.freshness_deadline,
  case
    when not source.enabled or not target.enabled or not target_revision.enabled
      then 'disabled'
    when latest_health.cursor is null then 'unconfigured'
    when completion.health_cursor = latest_health.cursor
      and latest_health.status = 'healthy'
      and completion.freshness_deadline >= now()
      then 'complete_current'
    when completion.health_cursor = latest_health.cursor
      and latest_health.status = 'healthy'
      then 'complete_stale'
    when latest_health.status = 'healthy'
      then 'partial'
    else 'unavailable'
  end as coverage_status,
  coalesce((
    source.enabled
    and target.enabled
    and target_revision.enabled
    and latest_health.status = 'healthy'
    and completion.health_cursor = latest_health.cursor
    and completion.freshness_deadline >= now()
    and latest_health.geographic_completeness = 1
    and latest_health.schema_failure_count = 0
  ), false) as is_current,
  'not_assessed'::text as anomaly_assessment
from core.collection_targets as target
join core.sources as source on source.id = target.source_id
join core.providers as provider on provider.id = source.provider_id
join core.collection_target_revisions as target_revision
  on target_revision.collection_target_id = target.id
  and core.is_current_collection_target_revision(
    target_revision.collection_target_id,
    target_revision.id,
    now()
  )
left join lateral (
  select
    health.cursor,
    health.public_id,
    health.status,
    health.checked_at,
    health.last_success_at,
    health.latest_source_observed_at,
    health.geographic_completeness,
    health.schema_failure_count
  from truth.source_health as health
  where health.collection_target_id = target.id
    and health.visibility = 'public'
    and core.is_current_collection_target_revision(
      health.collection_target_id,
      health.collection_target_revision_id,
      now()
    )
  order by health.checked_at desc, health.cursor desc
  limit 1
) as latest_health on true
left join lateral (
  select
    scan.health_cursor,
    scan.scan_kind,
    scan.requested_from,
    scan.requested_to,
    scan.watermark_from,
    scan.updated_since,
    scan.watermark_to,
    scan.predecessor_health_cursor,
    scan.baseline_health_cursor,
    scan.continuous_coverage_from,
    scan.continuous_coverage_to,
    scan.lineage_depth,
    scan.completed_products,
    scan.page_count,
    scan.upstream_hit_count,
    scan.accepted_granule_count,
    scan.freshness_deadline
  from ingest.cmr_scan_completions as scan
  join truth.source_health as health on health.cursor = scan.health_cursor
  where health.collection_target_id = target.id
    and health.visibility = 'public'
    and core.is_current_collection_target_revision(
      health.collection_target_id,
      health.collection_target_revision_id,
      now()
    )
  order by health.checked_at desc, scan.health_cursor desc
  limit 1
) as completion on true
left join truth.source_health as completion_health
  on completion_health.cursor = completion.health_cursor
left join truth.source_health as predecessor_health
  on predecessor_health.cursor = completion.predecessor_health_cursor
left join truth.source_health as baseline_health
  on baseline_health.cursor = completion.baseline_health_cursor
where source.slug = 'nasa-cmr-firemask'
  and source.is_public
  and provider.is_public
  and source.sensitivity = 'public'
  and source.license_status = 'approved'
  and source.redistribution_allowed is true
  and target.visibility = 'public';

create or replace function api.satellite_scan_status_for_window(
  p_observed_from timestamptz,
  p_observed_to timestamptz
)
returns table (
  source_id uuid,
  source_slug text,
  collection_target_id uuid,
  collection_target_revision_id uuid,
  health_id uuid,
  health_status text,
  scan_health_id uuid,
  scan_kind text,
  requested_from timestamptz,
  requested_to timestamptz,
  watermark_from timestamptz,
  updated_since timestamptz,
  watermark_to timestamptz,
  predecessor_health_id uuid,
  baseline_health_id uuid,
  continuous_coverage_from timestamptz,
  continuous_coverage_to timestamptz,
  lineage_depth bigint,
  completed_products text[],
  page_count integer,
  upstream_hit_count bigint,
  accepted_granule_count bigint,
  checked_at timestamptz,
  last_success_at timestamptz,
  latest_source_observed_at timestamptz,
  scan_checked_at timestamptz,
  geographic_completeness numeric,
  schema_failure_count integer,
  freshness_deadline timestamptz,
  coverage_status text,
  is_current boolean,
  covers_requested_window boolean,
  valid_empty_eligible boolean,
  anomaly_assessment text
)
language plpgsql
stable
security invoker
set search_path = ''
as $$
begin
  if p_observed_from is null
    or p_observed_to is null
    or p_observed_to <= p_observed_from
    or p_observed_to - p_observed_from > interval '36 hours'
    or p_observed_to > now() + interval '5 minutes'
  then
    raise exception 'satellite scan window must be nonempty, at most 36 hours, and not in the future'
      using errcode = '22023';
  end if;

  return query
  select
    status.source_id,
    status.source_slug,
    status.collection_target_id,
    status.collection_target_revision_id,
    status.health_id,
    status.health_status,
    status.scan_health_id,
    status.scan_kind,
    status.requested_from,
    status.requested_to,
    status.watermark_from,
    status.updated_since,
    status.watermark_to,
    status.predecessor_health_id,
    status.baseline_health_id,
    status.continuous_coverage_from,
    status.continuous_coverage_to,
    status.lineage_depth,
    status.completed_products,
    status.page_count,
    status.upstream_hit_count,
    status.accepted_granule_count,
    status.checked_at,
    status.last_success_at,
    status.latest_source_observed_at,
    status.scan_checked_at,
    status.geographic_completeness,
    status.schema_failure_count,
    status.freshness_deadline,
    status.coverage_status,
    status.is_current,
    coalesce((
      status.continuous_coverage_from <= p_observed_from
      and status.continuous_coverage_to >= p_observed_to
    ), false) as covers_requested_window,
    coalesce((
      status.is_current
      and status.continuous_coverage_from <= p_observed_from
      and status.continuous_coverage_to >= p_observed_to
    ), false) as valid_empty_eligible,
    status.anomaly_assessment
  from api.satellite_scan_status as status;
end;
$$;

create or replace function api.satellite_passes_for_cell(
  p_z integer,
  p_x integer,
  p_y integer,
  p_observed_from timestamptz,
  p_observed_to timestamptz default now(),
  p_limit integer default 200
)
returns table (
  observation_id uuid,
  contract_version text,
  identity_version text,
  source_id uuid,
  source_slug text,
  catalog_granule_id text,
  catalog_collection_id text,
  cmr_revision_id bigint,
  umm_g_version text,
  product text,
  product_version text,
  satellite text,
  sensor text,
  observed_from timestamptz,
  observed_to timestamptz,
  produced_at timestamptz,
  cataloged_at timestamptz,
  retrieved_at timestamptz,
  day_night text,
  footprint_geojson jsonb,
  geometry_precision_m numeric,
  geometry_precision_source text,
  footprint_basis text,
  anomaly_assessment text,
  spatial_relationship text
)
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  cell_geom extensions.geometry(Polygon, 4326);
  cell_count integer;
begin
  if p_z is null or p_z < 7 or p_z > 11 then
    raise exception 'Web Mercator cell zoom must be between 7 and 11'
      using errcode = '22023';
  end if;

  cell_count := (1 << p_z);
  if p_x is null or p_y is null
    or p_x < 0 or p_x >= cell_count
    or p_y < 0 or p_y >= cell_count
  then
    raise exception 'Web Mercator cell coordinates are outside the zoom grid'
      using errcode = '22023';
  end if;

  if p_observed_from is null
    or p_observed_to is null
    or p_observed_to <= p_observed_from
    or p_observed_to - p_observed_from > interval '36 hours'
    or p_observed_to > now() + interval '5 minutes'
  then
    raise exception 'satellite pass window must be nonempty, at most 36 hours, and not in the future'
      using errcode = '22023';
  end if;

  if p_limit is null or p_limit < 1 or p_limit > 500 then
    raise exception 'satellite pass result limit must be between 1 and 500'
      using errcode = '22023';
  end if;

  cell_geom := extensions.st_transform(
    extensions.st_tileenvelope(p_z, p_x, p_y),
    4326
  );

  return query
  select
    observation.public_id::uuid,
    observation.contract_version,
    observation.identity_version,
    source.public_id::uuid,
    source.slug,
    detail.catalog_granule_id,
    detail.catalog_collection_id,
    detail.cmr_revision_id,
    detail.umm_g_version,
    detail.product,
    detail.product_version,
    detail.satellite,
    detail.sensor,
    observation.observed_at,
    detail.observed_to,
    detail.produced_at,
    detail.cataloged_at,
    observation.retrieved_at,
    detail.day_night,
    extensions.st_asgeojson(observation.geom, 6)::jsonb,
    observation.geometry_precision_m,
    observation.geometry_precision_source,
    'cmr_catalog_metadata'::text,
    'not_assessed'::text,
    'catalog_footprint_intersection'::text
  from ingest.cmr_granule_details as detail
  join ingest.global_observations as observation
    on observation.cursor = detail.observation_cursor
  join core.sources as source on source.id = observation.source_id
  join core.providers as provider on provider.id = source.provider_id
  where source.slug = 'nasa-cmr-firemask'
    and observation.observation_kind = 'satellite_imagery'
    and observation.evidence_class = 'satellite_pass_metadata'
    and observation.visibility = 'public'
    and observation.validation_state = 'accepted'
    and observation.trust_class <> 'synthetic'
    and source.is_public
    and provider.is_public
    and source.sensitivity = 'public'
    and source.license_status = 'approved'
    and source.redistribution_allowed is true
    and ingest.cmr_observation_is_publishable(
      observation.cursor
    )
    and detail.observed_to >= p_observed_from
    and observation.observed_at <= p_observed_to
    and observation.geom operator(extensions.&&) cell_geom
    and extensions.st_intersects(observation.geom, cell_geom)
    and not exists (
      select 1
      from ingest.cmr_granule_details as newer
      join ingest.global_observations as newer_observation
        on newer_observation.cursor = newer.observation_cursor
      where newer.catalog_granule_id = detail.catalog_granule_id
        and newer.cmr_revision_id > detail.cmr_revision_id
        and ingest.cmr_observation_is_publishable(
          newer_observation.cursor
        )
    )
  order by
    observation.observed_at desc,
    detail.catalog_granule_id,
    detail.cmr_revision_id desc
  limit p_limit;
end;
$$;

revoke execute on function api.satellite_scan_status_for_window(
  timestamptz, timestamptz
) from public, firewatch_catalog_admin, firewatch_collector,
  firewatch_reconciler, firewatch_publisher, firewatch_dispatcher;
revoke execute on function api.satellite_passes_for_cell(
  integer, integer, integer, timestamptz, timestamptz, integer
) from public, firewatch_catalog_admin, firewatch_collector,
  firewatch_reconciler, firewatch_publisher, firewatch_dispatcher;

grant execute on function api.satellite_scan_status_for_window(
  timestamptz, timestamptz
) to anon, authenticated, service_role;
grant execute on function api.satellite_passes_for_cell(
  integer, integer, integer, timestamptz, timestamptz, integer
) to anon, authenticated, service_role;

revoke all on api.satellite_passes, api.satellite_scan_status from public;
grant select on api.satellite_passes, api.satellite_scan_status
  to anon, authenticated, service_role;

comment on table ingest.cmr_granule_details is
  'Typed 1:1 NASA CMR UMM-G granule metadata. The linked global observation carries the actual catalog footprint; anomaly state is never inferred.';
comment on table ingest.cmr_granule_occurrences is
  'Immutable per-run proof that an exact terminal CMR response contained an accepted typed granule. Replays can authorize a globally deduplicated observation without mutation.';
comment on table ingest.cmr_rejections is
  'Immutable item-level CMR parser or validation rejection evidence, fenced to the exact run lease and successful HTTP response; never an observation.';
comment on table ingest.cmr_scan_completions is
  'Complete global CMR scan lineage. Incremental rows must continuously extend a bootstrap or reconciliation baseline; partial scans have no row.';
comment on table ingest.cmr_scan_product_completions is
  'Per-product proof that every persisted CMR page completed without timeout, truncation, pagination cap, or HTTP failure.';
comment on view api.satellite_passes is
  'Latest public CMR granule revisions with catalog-footprint GeoJSON and anomaly_assessment=not_assessed.';
comment on view api.satellite_scan_status is
  'Latest CMR health and last complete continuous scan lineage. A status row alone never proves a local empty result.';
comment on function api.satellite_scan_status_for_window(timestamptz, timestamptz) is
  'Determines whether the latest current complete CMR lineage covers an exact requested time window.';
comment on function api.satellite_passes_for_cell(integer, integer, integer, timestamptz, timestamptz, integer) is
  'Returns bounded exact PostGIS intersections for a canonical coarse Web Mercator cell (zoom 7 through 11).';

notify pgrst, 'reload schema';
