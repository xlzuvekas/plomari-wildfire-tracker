-- FIRMS persistence foundation.
--
-- This migration is deliberately inert. It registers the upstream catalog and
-- the four reviewed FIRMS products, but leaves every activation switch off and
-- every license gate unreviewed. It adds private append-only evidence tables;
-- it does not create a collector, schedule, public view, credential, or API.
--
-- FIRMS rows are satellite thermal-pixel observations. They are not flame
-- locations, incident confirmations, perimeters, severity, containment,
-- protective guidance, or an all-clear. Scan/track are reported pixel
-- dimensions without source-supplied orientation, so the database stores the
-- reported centroid and dimensions and never invents a pixel polygon.
--
-- A terminal, schema-clean, four-product request set proves only that those
-- API requests completed. Neither an empty FIRMS response nor a CMR catalog
-- footprint proves unobscured / assessable sensing. For that reason the first
-- assessment contract intentionally has no negative state: only detected,
-- awaiting_later_assessment, and unknown can be recorded.

-- The FIRMS map key occupies an upstream URL path segment. Cataloging it as a
-- query secret would make durable request-redaction semantics false.
alter table core.endpoints
  drop constraint endpoints_auth_mode_check;
alter table core.endpoints
  add constraint endpoints_auth_mode_check check (
    auth_mode in (
      'none', 'path_secret', 'query_secret', 'header_secret', 'oauth2',
      'signed_request'
    )
  );

-- PR #47 adds the canonical issuance instant to the credential-free request
-- metadata. The generic HTTP ledger rejects unreviewed safe-map keys at its
-- table boundary, so admit only this additional scalar key while retaining the
-- existing flat-map, key, value, and credential-leak guards.
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
      'attempt', 'cache_mode', 'collection', 'cursor_kind', 'issued_at',
      'operation', 'page', 'page_size', 'product', 'scope'
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
        select item.value from jsonb_array_elements(entry.value) as item
      loop
        if jsonb_typeof(element) not in (
          'string', 'number', 'boolean', 'null'
        ) then
          return false;
        end if;
        if jsonb_typeof(element) = 'string' then
          scalar_text := element #>> '{}';
          if not ingest.http_safe_text_is_allowed(scalar_text) then
            return false;
          end if;
        end if;
      end loop;
    elsif jsonb_typeof(entry.value) not in (
      'string', 'number', 'boolean', 'null'
    ) then
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

insert into core.providers (
  public_id, contract_version, slug, name, organization_type,
  homepage_url, jurisdiction, is_public
)
values (
  '018f0000-0000-7000-8000-000000000001', '1.1.0', 'nasa', 'NASA',
  'government', 'https://www.nasa.gov/', 'United States', true
)
on conflict (slug) do nothing;

-- One early hosted bootstrap ran seed.sql before this migration existed. That
-- produced the exact disabled catalog identity below with legacy public,
-- query-secret metadata, but no jobs, runs, evidence, adapter, or target state.
-- Adopt only that complete inert shape. Any partial, active, or otherwise
-- different collision remains untouched and is rejected by the terminal
-- canonical-identity assertion later in this migration.
do $$
declare
  legacy_source_id bigint;
  legacy_endpoint_id bigint;
  legacy_target_id bigint;
begin
  select source.id, endpoint.id, target.id
  into legacy_source_id, legacy_endpoint_id, legacy_target_id
  from core.providers as provider
  join core.sources as source on source.provider_id = provider.id
  join core.endpoints as endpoint on endpoint.source_id = source.id
  join ingest.endpoint_state as endpoint_state
    on endpoint_state.endpoint_id = endpoint.id
  join core.collection_targets as target
    on target.source_id = source.id
    and target.endpoint_id = endpoint.id
  join core.collection_target_revisions as revision
    on revision.collection_target_id = target.id
    and revision.endpoint_id = endpoint.id
  where provider.public_id = '018f0000-0000-7000-8000-000000000001'
    and provider.slug = 'nasa'
    and provider.contract_version = '1.1.0'
    and provider.name = 'NASA'
    and provider.organization_type = 'government'
    and provider.homepage_url = 'https://www.nasa.gov/'
    and provider.jurisdiction = 'United States'
    and provider.is_public
    and provider.metadata = '{}'::jsonb
    and source.public_id = '018f0000-0000-7000-8000-000000000101'
    and source.contract_version = '1.1.0'
    and source.slug = 'nasa-firms'
    and source.name = 'NASA FIRMS Active Fire Data'
    and source.description =
      'Satellite thermal detections; detections are observations, not confirmed wildfire incidents.'
    and source.product_family = 'active_fire'
    and source.default_trust_class = 'official_observation'
    and source.default_evidence_class = 'thermal_detection'
    and source.operational_scope = 'mixed'
    and source.homepage_url = 'https://firms.modaps.eosdis.nasa.gov/'
    and source.terms_url =
      'https://firms.modaps.eosdis.nasa.gov/content/academy/data_api/firms_api_use.html'
    and source.license_code = 'provider_terms'
    and source.license_name is null
    and source.attribution_text is null
    and source.license_status = 'unreviewed'
    and source.commercial_use_allowed is null
    and source.redistribution_allowed is null
    and source.cache_ttl is null
    and source.retention_limit is null
    and not source.contains_personal_data
    and source.sensitivity = 'public'
    and source.default_freshness = interval '15 minutes'
    and source.default_max_staleness = interval '3 hours'
    and not source.enabled
    and source.is_public
    and source.metadata = '{}'::jsonb
    and endpoint.public_id = '018f0000-0000-7000-8000-000000000201'
    and endpoint.contract_version = '1.1.0'
    and endpoint.endpoint_key = 'area-csv'
    and endpoint.name = 'FIRMS Area CSV API'
    and endpoint.endpoint_kind = 'dataset'
    and endpoint.source_kind = 'sensor'
    and endpoint.authority_scopes = array['thermal_anomaly']::text[]
    and endpoint.content_policy = 'structured_data'
    and endpoint.license_policy = 'provider_terms'
    and endpoint.transport = 'http_poll'
    and endpoint.base_url =
      'https://firms.modaps.eosdis.nasa.gov/api/area/csv'
    and endpoint.http_method = 'GET'
    and endpoint.auth_mode = 'query_secret'
    and endpoint.credential_ref = 'FIRMS_MAP_KEY'
    and endpoint.trust_class = 'official_observation'
    and endpoint.evidence_class = 'thermal_detection'
    and endpoint.authoritativeness_scope =
      'Satellite thermal anomaly observation only; not incident confirmation or severity.'
    and endpoint.coverage_scope = 'global'
    and endpoint.coverage_geom is null
    and endpoint.coverage_geog is null
    and endpoint.poll_interval = interval '15 minutes'
    and endpoint.expected_source_latency = interval '3 hours'
    and endpoint.freshness = interval '15 minutes'
    and endpoint.max_staleness = interval '3 hours'
    and endpoint.timeout_ms = 15000
    and endpoint.rate_limit_per_minute is null
    and endpoint.priority = 100
    and endpoint.supports_bbox
    and not endpoint.supports_cursor
    and endpoint.supports_backfill
    and endpoint.request_template = '{
      "credential_parameter":"map_key",
      "products":["VIIRS_SNPP_NRT","VIIRS_NOAA20_NRT","VIIRS_NOAA21_NRT","MODIS_NRT"]
    }'::jsonb
    and endpoint.response_contract = '{}'::jsonb
    and endpoint.capabilities = '{}'::jsonb
    and not endpoint_state.enabled
    and endpoint_state.paused_reason is null
    and endpoint_state.consecutive_failures = 0
    and endpoint_state.next_due_at is null
    and target.public_id = '018f0000-0000-7000-8000-000000000401'
    and target.contract_version = '1.1.0'
    and target.target_key = 'global-discovery'
    and target.name = 'FIRMS global discovery'
    and target.incident_id is null
    and target.visibility = 'public'
    and not target.enabled
    and revision.public_id = '018f0000-0000-7000-8000-000000000501'
    and revision.contract_version = '1.1.0'
    and revision.identity_version = '2.0.0'
    and revision.version_no = 1
    and revision.previous_revision_id is null
    and revision.target_kind = 'dataset'
    and revision.configuration_sha256 =
      '309a06db9800af00eedc364890a3e29348ae18973f72ac348d7b36bac5ab52f2'
    and revision.scope = 'global'
    and revision.incident_id is null
    and revision.aoi_version_id is null
    and revision.target_geom is null
    and revision.target_geog is null
    and revision.geometry_precision_m is null
    and revision.geometry_precision_source = 'not_applicable'
    and revision.claim_kind = 'thermal_detection'
    and revision.operational_role = 'discovery'
    and revision.cadence = interval '15 minutes'
    and revision.stale_after = interval '3 hours'
    and revision.priority = 100
    and revision.trust_class_override is null
    and not revision.enabled
    and revision.request_params = '{}'::jsonb
    and revision.effective_at = timestamptz '2026-07-30 00:00:00+00'
    and not exists (
      select 1
      from ingest.collection_target_state as target_state
      where target_state.collection_target_revision_id = revision.id
    )
    and (select count(*) from core.endpoints as candidate_endpoint
      where candidate_endpoint.source_id = source.id) = 1
    and (select count(*) from core.collection_targets as candidate_target
      where candidate_target.source_id = source.id) = 1
    and (select count(*) from core.collection_target_revisions as candidate_revision
      where candidate_revision.collection_target_id = target.id) = 1
    and not exists (
      select 1 from core.incident_bindings as binding
      where binding.collection_target_id = target.id
    )
    and not exists (
      select 1 from core.adapter_releases as adapter
      where adapter.source_id = source.id
    )
    and not exists (
      select 1 from ingest.jobs as job where job.source_id = source.id
    )
    and not exists (
      select 1 from ingest.runs as run where run.source_id = source.id
    )
    and not exists (
      select 1 from ingest.http_exchanges as exchange
      where exchange.source_id = source.id
    )
    and not exists (
      select 1 from ingest.raw_objects as raw where raw.source_id = source.id
    )
    and not exists (
      select 1 from ingest.source_revisions as source_revision
      where source_revision.source_id = source.id
    )
    and not exists (
      select 1 from ingest.global_observations as observation
      where observation.source_id = source.id
    )
    and not exists (
      select 1 from truth.source_health as health
      where health.source_id = source.id
    )
  for update of provider, source, endpoint, endpoint_state, target, revision;

  if legacy_source_id is not null then
    if not exists (
      select 1
      from pg_catalog.pg_trigger as candidate_trigger
      where candidate_trigger.tgrelid = 'core.endpoints'::regclass
        and candidate_trigger.tgname = 'endpoints_reject_mutation'
        and candidate_trigger.tgenabled = 'O'
        and not candidate_trigger.tgisinternal
    ) then
      raise exception 'FIRMS legacy adoption requires the endpoint immutability trigger'
        using errcode = '55000';
    end if;

    update core.sources
    set
      description =
        'Satellite thermal-pixel detections. A detection is not a confirmed wildfire incident, perimeter, flame location, severity, official status, protective instruction, containment statement, or all-clear.',
      license_name = 'NASA FIRMS terms require review before activation',
      attribution_text =
        'NASA FIRMS; retain product, platform, acquisition time, and thermal-pixel limitations.',
      sensitivity = 'restricted',
      is_public = false,
      metadata = '{
        "activation":"license_review_required",
        "anomalyAssessment":"disabled",
        "credentialPersistence":"forbidden",
        "thermalPixelNotFirePerimeter":true
      }'::jsonb
    where id = legacy_source_id;

    -- Endpoint identity is normally immutable. The exact inert legacy seed row
    -- above is the sole exception: disable its rejection trigger only inside
    -- this migration transaction, update the selected row, and restore the
    -- trigger before any later statement can proceed. A migration error rolls
    -- both the row update and trigger DDL back together.
    execute 'alter table core.endpoints disable trigger endpoints_reject_mutation';

    update core.endpoints
    set
      license_policy = 'provider_terms_unreviewed',
      auth_mode = 'path_secret',
      authoritativeness_scope =
        'Satellite thermal-pixel observations only; no incident, severity, official-status, protective-action, containment, or all-clear authority.',
      request_template = '{
        "credentialLocation":"path_segment_not_persisted",
        "credentialRef":"FIRMS_MAP_KEY",
        "products":["VIIRS_SNPP_NRT","VIIRS_NOAA20_NRT","VIIRS_NOAA21_NRT","MODIS_NRT"],
        "redactedRequestUrl":"catalog_base_url_only"
      }'::jsonb,
      response_contract = '{
        "format":"csv",
        "itemIdentity":"firms-detection-v1",
        "orientationField":null,
        "scanTrackMeaning":"reported_pixel_dimensions_km"
      }'::jsonb,
      capabilities = '{
        "assessment":"persistence_only",
        "negativeAssessment":false,
        "pagination":"none"
      }'::jsonb
    where id = legacy_endpoint_id;

    execute 'alter table core.endpoints enable trigger endpoints_reject_mutation';

    update ingest.endpoint_state
    set paused_reason = 'license_review_and_adapter_release_required'
    where endpoint_id = legacy_endpoint_id;

    update core.collection_targets
    set visibility = 'restricted'
    where id = legacy_target_id;
  end if;
end;
$$;

-- Hosted migration pushes do not execute seed.sql. Register the source here,
-- restricted and unlicensed, so production cannot silently rely on local seed.
insert into core.sources (
  public_id, contract_version, provider_id, slug, name, description,
  product_family, default_trust_class, default_evidence_class,
  operational_scope, homepage_url, terms_url, license_code, license_name,
  attribution_text, license_status, commercial_use_allowed,
  redistribution_allowed, cache_ttl, retention_limit, contains_personal_data,
  sensitivity, default_freshness, default_max_staleness, enabled, is_public,
  metadata
)
values (
  '018f0000-0000-7000-8000-000000000101',
  '1.1.0',
  (select id from core.providers where slug = 'nasa'),
  'nasa-firms',
  'NASA FIRMS Active Fire Data',
  'Satellite thermal-pixel detections. A detection is not a confirmed wildfire incident, perimeter, flame location, severity, official status, protective instruction, containment statement, or all-clear.',
  'active_fire',
  'official_observation',
  'thermal_detection',
  'mixed',
  'https://firms.modaps.eosdis.nasa.gov/',
  'https://firms.modaps.eosdis.nasa.gov/content/academy/data_api/firms_api_use.html',
  'provider_terms',
  'NASA FIRMS terms require review before activation',
  'NASA FIRMS; retain product, platform, acquisition time, and thermal-pixel limitations.',
  'unreviewed',
  null,
  null,
  null,
  null,
  false,
  'restricted',
  interval '15 minutes',
  interval '3 hours',
  false,
  false,
  '{
    "activation":"license_review_required",
    "anomalyAssessment":"disabled",
    "credentialPersistence":"forbidden",
    "thermalPixelNotFirePerimeter":true
  }'::jsonb
)
on conflict (slug) do nothing;

insert into core.endpoints (
  public_id, contract_version, source_id, endpoint_key, name, endpoint_kind,
  source_kind, authority_scopes, content_policy, license_policy, transport,
  base_url, http_method, auth_mode, credential_ref, trust_class,
  evidence_class, authoritativeness_scope, coverage_scope, poll_interval,
  expected_source_latency, freshness, max_staleness, timeout_ms,
  supports_bbox, supports_cursor, supports_backfill, request_template,
  response_contract, capabilities
)
values (
  '018f0000-0000-7000-8000-000000000201',
  '1.1.0',
  (select id from core.sources where slug = 'nasa-firms'),
  'area-csv',
  'FIRMS Area CSV API',
  'dataset',
  'sensor',
  array['thermal_anomaly'],
  'structured_data',
  'provider_terms_unreviewed',
  'http_poll',
  'https://firms.modaps.eosdis.nasa.gov/api/area/csv',
  'GET',
  'path_secret',
  'FIRMS_MAP_KEY',
  'official_observation',
  'thermal_detection',
  'Satellite thermal-pixel observations only; no incident, severity, official-status, protective-action, containment, or all-clear authority.',
  'global',
  interval '15 minutes',
  interval '3 hours',
  interval '15 minutes',
  interval '3 hours',
  15000,
  true,
  false,
  true,
  '{
    "credentialLocation":"path_segment_not_persisted",
    "credentialRef":"FIRMS_MAP_KEY",
    "products":["VIIRS_SNPP_NRT","VIIRS_NOAA20_NRT","VIIRS_NOAA21_NRT","MODIS_NRT"],
    "redactedRequestUrl":"catalog_base_url_only"
  }'::jsonb,
  '{
    "format":"csv",
    "itemIdentity":"firms-detection-v1",
    "orientationField":null,
    "scanTrackMeaning":"reported_pixel_dimensions_km"
  }'::jsonb,
  '{
    "assessment":"persistence_only",
    "negativeAssessment":false,
    "pagination":"none"
  }'::jsonb
)
on conflict (source_id, endpoint_key) do nothing;

insert into ingest.endpoint_state (endpoint_id, enabled, paused_reason)
select endpoint.id, false, 'license_review_and_adapter_release_required'
from core.endpoints as endpoint
join core.sources as source on source.id = endpoint.source_id
where source.slug = 'nasa-firms'
  and endpoint.endpoint_key = 'area-csv'
on conflict (endpoint_id) do nothing;

insert into core.collection_targets (
  public_id, contract_version, source_id, endpoint_id, target_key, name,
  visibility, enabled
)
select
  '018f0000-0000-7000-8000-000000000401'::core.uuid_v7,
  '1.1.0',
  source.id,
  endpoint.id,
  'global-discovery',
  'FIRMS global discovery',
  'restricted',
  false
from core.sources as source
join core.endpoints as endpoint on endpoint.source_id = source.id
where source.slug = 'nasa-firms'
  and endpoint.endpoint_key = 'area-csv'
on conflict (endpoint_id, target_key) do nothing;

-- Keep the reviewed identity-v2 hash already used by seed.sql. The empty
-- request_params object is intentional: there is no deployable adapter/config.
insert into core.collection_target_revisions (
  public_id, contract_version, identity_version, collection_target_id,
  endpoint_id, version_no, target_kind, configuration_sha256, scope,
  geometry_precision_source, claim_kind, operational_role, cadence,
  stale_after, enabled, request_params, effective_at
)
select
  '018f0000-0000-7000-8000-000000000501'::core.uuid_v7,
  '1.1.0',
  '2.0.0',
  target.id,
  endpoint.id,
  1,
  'dataset',
  '309a06db9800af00eedc364890a3e29348ae18973f72ac348d7b36bac5ab52f2',
  'global',
  'not_applicable',
  'thermal_detection',
  'discovery',
  interval '15 minutes',
  interval '3 hours',
  false,
  '{}'::jsonb,
  timestamptz '2026-07-30 00:00:00+00'
from core.collection_targets as target
join core.endpoints as endpoint on endpoint.id = target.endpoint_id
join core.sources as source on source.id = target.source_id
where source.slug = 'nasa-firms'
  and endpoint.endpoint_key = 'area-csv'
  and target.target_key = 'global-discovery'
on conflict (collection_target_id, version_no) do nothing;

insert into ingest.collection_target_state (
  collection_target_revision_id, collection_target_id
)
select revision.id, revision.collection_target_id
from core.collection_target_revisions as revision
where revision.public_id = '018f0000-0000-7000-8000-000000000501'
on conflict (collection_target_revision_id) do nothing;

-- Operational product state is mutable; product/platform identity is not.
create table core.firms_products (
  id bigint generated always as identity primary key,
  public_id core.uuid_v7 not null unique,
  contract_version text not null check (contract_version = '1.1.0'),
  source_id bigint not null references core.sources(id),
  product_key text not null unique check (product_key in (
    'VIIRS_SNPP_NRT', 'VIIRS_NOAA20_NRT', 'VIIRS_NOAA21_NRT', 'MODIS_NRT'
  )),
  instrument text not null check (instrument in ('VIIRS', 'MODIS')),
  allowed_satellites text[] not null check (cardinality(allowed_satellites) > 0),
  allowed_source_codes text[] not null check (cardinality(allowed_source_codes) > 0),
  confidence_encoding text not null check (
    confidence_encoding in ('viirs_class', 'modis_percent')
  ),
  parser_contract text not null check (parser_contract in (
    'firms-area-csv-viirs-v1', 'firms-area-csv-modis-v1'
  )),
  cmr_product text check (cmr_product is null or cmr_product in (
    'VNP14IMG_NRT', 'VJ114IMG_NRT', 'VJ214IMG_NRT'
  )),
  license_status text not null default 'unreviewed' check (
    license_status in ('unreviewed', 'approved', 'restricted', 'rejected')
  ),
  enabled boolean not null default false,
  assessment_enabled boolean not null default false,
  limitations text[] not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint firms_products_id_source_product_key
    unique (id, source_id, product_key),
  constraint firms_products_activation_check check (
    not enabled
    or license_status = 'approved'
  ),
  constraint firms_products_assessment_activation_check check (
    not assessment_enabled
    or (enabled and license_status = 'approved')
  ),
  constraint firms_products_limitations_check check (
    limitations @> array[
      'thermal_pixel_not_flame_location',
      'not_incident_confirmation',
      'pixel_orientation_not_source_supplied'
    ]::text[]
  ),
  constraint firms_products_platform_contract_check check (
    (product_key = 'VIIRS_SNPP_NRT'
      and instrument = 'VIIRS'
      and allowed_satellites = array['Suomi-NPP']::text[]
      and allowed_source_codes = array['N']::text[]
      and confidence_encoding = 'viirs_class'
      and parser_contract = 'firms-area-csv-viirs-v1'
      and cmr_product = 'VNP14IMG_NRT')
    or (product_key = 'VIIRS_NOAA20_NRT'
      and instrument = 'VIIRS'
      and allowed_satellites = array['NOAA-20']::text[]
      and allowed_source_codes = array['N20']::text[]
      and confidence_encoding = 'viirs_class'
      and parser_contract = 'firms-area-csv-viirs-v1'
      and cmr_product = 'VJ114IMG_NRT')
    or (product_key = 'VIIRS_NOAA21_NRT'
      and instrument = 'VIIRS'
      and allowed_satellites = array['NOAA-21']::text[]
      and allowed_source_codes = array['N21']::text[]
      and confidence_encoding = 'viirs_class'
      and parser_contract = 'firms-area-csv-viirs-v1'
      and cmr_product = 'VJ214IMG_NRT')
    or (product_key = 'MODIS_NRT'
      and instrument = 'MODIS'
      and allowed_satellites = array['Aqua','Terra']::text[]
      and allowed_source_codes = array['A','T']::text[]
      and confidence_encoding = 'modis_percent'
      and parser_contract = 'firms-area-csv-modis-v1'
      and cmr_product is null)
  )
);

create index firms_products_source_enabled_idx
  on core.firms_products(source_id, product_key)
  where enabled;
create index firms_products_source_id_idx
  on core.firms_products(source_id);

create or replace function core.validate_firms_product_update()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if new.public_id <> old.public_id
    or new.contract_version <> old.contract_version
    or new.source_id <> old.source_id
    or new.product_key <> old.product_key
    or new.instrument <> old.instrument
    or new.allowed_satellites <> old.allowed_satellites
    or new.allowed_source_codes <> old.allowed_source_codes
    or new.confidence_encoding <> old.confidence_encoding
    or new.parser_contract <> old.parser_contract
    or new.cmr_product is distinct from old.cmr_product
    or new.limitations <> old.limitations
    or new.created_at <> old.created_at
  then
    raise exception 'FIRMS product identity and limitations are immutable'
      using errcode = '55000';
  end if;

  if (new.enabled or new.assessment_enabled) and not exists (
    select 1
    from core.sources as source
    where source.id = new.source_id
      and source.slug = 'nasa-firms'
      and source.enabled
      and source.license_status = 'approved'
  ) then
    raise exception 'FIRMS product activation requires the approved, enabled source'
      using errcode = '23514';
  end if;

  return new;
end;
$$;

create or replace function core.assign_firms_product_insert_clock()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if not exists (
    select 1
    from core.sources as source
    where source.id = new.source_id
      and source.slug = 'nasa-firms'
      and (
        (not new.enabled and not new.assessment_enabled)
        or (source.enabled and source.license_status = 'approved')
      )
  ) then
    raise exception 'FIRMS products must belong to the reviewed NASA FIRMS source and pass activation gates'
      using errcode = '23514';
  end if;

  new.created_at := now();
  new.updated_at := now();
  return new;
end;
$$;

revoke execute on function core.assign_firms_product_insert_clock()
  from public, anon, authenticated, service_role,
  firewatch_catalog_admin, firewatch_collector, firewatch_reconciler,
  firewatch_publisher, firewatch_dispatcher;

create trigger firms_products_assign_insert_clock
before insert on core.firms_products
for each row execute function core.assign_firms_product_insert_clock();

create or replace function ingest.firms_issued_at_token_is_valid_v1(
  p_issued_at text
)
returns boolean
language plpgsql
immutable
strict
security invoker
set search_path = ''
as $$
declare
  parsed_issued_at timestamptz;
begin
  if p_issued_at !~
    '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{3}Z$'
  then
    return false;
  end if;

  begin
    parsed_issued_at := p_issued_at::timestamptz;
  exception when others then
    return false;
  end;

  return to_char(
    parsed_issued_at at time zone 'UTC',
    'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
  ) = p_issued_at;
end;
$$;

revoke execute on function ingest.firms_issued_at_token_is_valid_v1(text)
  from public, anon, authenticated, service_role,
  firewatch_catalog_admin, firewatch_collector, firewatch_reconciler,
  firewatch_publisher, firewatch_dispatcher;
grant execute on function ingest.firms_issued_at_token_is_valid_v1(text)
  to firewatch_collector, firewatch_reconciler;

create or replace function ingest.firms_detection_is_within_request_v1(
  p_area text,
  p_date text,
  p_latitude numeric,
  p_longitude numeric,
  p_acquired_date date
)
returns boolean
language plpgsql
immutable
strict
security invoker
set search_path = ''
as $$
declare
  parts text[];
  part text;
  date_from date;
  day_count integer;
begin
  parts := string_to_array(p_area, ',');
  if cardinality(parts) <> 4
    or p_date !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}/[1-5]$'
  then
    return false;
  end if;

  foreach part in array parts loop
    if part !~ '^-?(0|[1-9][0-9]{0,2})\.[0-9]{6}$'
      or part ~ '^-0\.0{6}$'
    then
      return false;
    end if;
  end loop;

  begin
    date_from := split_part(p_date, '/', 1)::date;
    day_count := split_part(p_date, '/', 2)::integer;
  exception when others then
    return false;
  end;

  return parts[1]::numeric between -180 and 180
    and parts[3]::numeric between -180 and 180
    and parts[2]::numeric between -90 and 90
    and parts[4]::numeric between -90 and 90
    and parts[1]::numeric < parts[3]::numeric
    and parts[2]::numeric < parts[4]::numeric
    and p_longitude between parts[1]::numeric and parts[3]::numeric
    and p_latitude between parts[2]::numeric and parts[4]::numeric
    and p_acquired_date between date_from and date_from + (day_count - 1);
end;
$$;

revoke execute on function ingest.firms_detection_is_within_request_v1(
  text, text, numeric, numeric, date
) from public, anon, authenticated, service_role,
  firewatch_catalog_admin, firewatch_collector, firewatch_reconciler,
  firewatch_publisher, firewatch_dispatcher;
grant execute on function ingest.firms_detection_is_within_request_v1(
  text, text, numeric, numeric, date
) to firewatch_collector, firewatch_reconciler;

-- Every response row is an immutable occurrence. A later run may append a new
-- occurrence for an already-known observation; only the exact row position in
-- one response is unique. This preserves replay/retrieval lineage.
create table ingest.firms_response_rows (
  run_id bigint not null references ingest.runs(id),
  http_exchange_id bigint not null references ingest.http_exchanges(id),
  item_index integer not null check (item_index >= 0),
  source_id bigint not null references core.sources(id),
  product_id bigint not null,
  product_key text not null,
  disposition text not null check (disposition in ('accepted', 'rejected')),
  detection_detail_id bigint,
  observation_cursor bigint references ingest.global_observations(cursor),
  row_fingerprint_sha256 text not null check (
    row_fingerprint_sha256 ~ '^[a-f0-9]{64}$'
  ),
  rejection_code text check (rejection_code is null or rejection_code in (
    'invalid_column_count',
    'invalid_header_contract',
    'invalid_product_platform',
    'invalid_timestamp',
    'invalid_coordinate',
    'invalid_scan_track',
    'invalid_confidence',
    'invalid_measurement',
    'identity_collision',
    'provenance_mismatch',
    'unsupported_schema'
  )),
  lease_token uuid not null,
  lease_owner text not null check (btrim(lease_owner) <> ''),
  recorded_at timestamptz not null default now(),
  primary key (run_id, http_exchange_id, item_index),
  constraint firms_response_rows_product_fkey
    foreign key (product_id, source_id, product_key)
    references core.firms_products(id, source_id, product_key),
  constraint firms_response_rows_disposition_shape_check check (
    (disposition = 'accepted'
      and detection_detail_id is not null
      and observation_cursor is not null
      and rejection_code is null)
    or (disposition = 'rejected'
      and detection_detail_id is null
      and observation_cursor is null
      and rejection_code is not null)
  )
);

create index firms_response_rows_exchange_item_idx
  on ingest.firms_response_rows(http_exchange_id, item_index);
create index firms_response_rows_run_product_disposition_idx
  on ingest.firms_response_rows(run_id, product_id, disposition);
create index firms_response_rows_observation_run_idx
  on ingest.firms_response_rows(observation_cursor, run_id)
  where disposition = 'accepted';
create index firms_response_rows_detection_detail_idx
  on ingest.firms_response_rows(detection_detail_id)
  where detection_detail_id is not null;
create index firms_response_rows_source_id_idx
  on ingest.firms_response_rows(source_id);
create index firms_response_rows_product_id_idx
  on ingest.firms_response_rows(product_id);

create or replace function ingest.validate_firms_response_row()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  context_record record;
begin
  select
    run.status as run_status,
    run.source_id as run_source_id,
    run.endpoint_id as run_endpoint_id,
    run.lease_token as run_lease_token,
    run.lease_owner as run_lease_owner,
    job.status as job_status,
    job.lease_token as job_lease_token,
    job.lease_owner as job_lease_owner,
    job.lease_expires_at,
    source.slug as source_slug,
    endpoint.endpoint_key,
    endpoint.base_url,
    exchange.run_id as exchange_run_id,
    exchange.source_id as exchange_source_id,
    exchange.endpoint_id as exchange_endpoint_id,
    exchange.request_method,
    exchange.request_url_redacted,
    exchange.request_body_blob_id,
    exchange.request_query_safe,
    exchange.request_headers_safe,
    exchange.request_metadata_safe,
    exchange.outcome as exchange_outcome,
    exchange.http_status,
    exchange.response_raw_object_id,
    detail.observation_cursor as detail_observation_cursor,
    detail.product_id as detail_product_id,
    detail.product_key as detail_product_key,
    detail.source_id as detail_source_id,
    detail.latitude as detail_latitude,
    detail.longitude as detail_longitude,
    detail.acquired_date as detail_acquired_date
  into context_record
  from ingest.runs as run
  join ingest.jobs as job on job.id = run.job_id
  join core.sources as source on source.id = run.source_id
  join core.endpoints as endpoint on endpoint.id = run.endpoint_id
  join ingest.http_exchanges as exchange on exchange.id = new.http_exchange_id
  left join ingest.firms_detection_details as detail
    on detail.id = new.detection_detail_id
  where run.id = new.run_id;

  if not found
    or context_record.source_slug <> 'nasa-firms'
    or context_record.endpoint_key <> 'area-csv'
    or context_record.exchange_run_id is distinct from new.run_id
    or context_record.exchange_source_id is distinct from new.source_id
    or context_record.exchange_endpoint_id is distinct from context_record.run_endpoint_id
    or context_record.run_source_id is distinct from new.source_id
    or context_record.request_method <> 'GET'
    or context_record.request_url_redacted is distinct from context_record.base_url
    or context_record.request_body_blob_id is not null
    or (
      select count(*)
      from jsonb_object_keys(context_record.request_query_safe)
    ) <> 3
    or context_record.request_query_safe->>'product' is distinct from new.product_key
    or context_record.request_query_safe->>'date' is null
    or context_record.request_query_safe->>'date'
      !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}/[1-5]$'
    or ingest.firms_area_token_is_valid_v1(
      context_record.request_query_safe->>'area'
    ) is not true
    or context_record.request_headers_safe <> '{"accept":"text/csv"}'::jsonb
    or context_record.request_metadata_safe <> jsonb_build_object(
      'issued_at', context_record.request_metadata_safe->>'issued_at',
      'operation', 'firms-area-csv',
      'product', new.product_key,
      'scope', 'geographic-area'
    )
    or ingest.firms_issued_at_token_is_valid_v1(
      context_record.request_metadata_safe->>'issued_at'
    ) is not true
    or context_record.exchange_outcome <> 'response'
    or context_record.http_status <> 200
    or context_record.response_raw_object_id is null
  then
    raise exception 'FIRMS response row requires its exact successful credential-free response evidence'
      using errcode = '23514';
  end if;

  if new.disposition = 'accepted' and (
    context_record.detail_observation_cursor is distinct from new.observation_cursor
    or context_record.detail_product_id is distinct from new.product_id
    or context_record.detail_product_key is distinct from new.product_key
    or context_record.detail_source_id is distinct from new.source_id
    or ingest.firms_detection_is_within_request_v1(
      context_record.request_query_safe->>'area',
      context_record.request_query_safe->>'date',
      context_record.detail_latitude,
      context_record.detail_longitude,
      context_record.detail_acquired_date
    ) is not true
  ) then
    raise exception 'accepted FIRMS response row must resolve inside its issued AOI/date envelope'
      using errcode = '23514';
  end if;

  if context_record.run_status <> 'running'
    or context_record.job_status <> 'running'
    or new.lease_token is distinct from context_record.run_lease_token
    or new.lease_token is distinct from context_record.job_lease_token
    or new.lease_owner is distinct from context_record.run_lease_owner
    or new.lease_owner is distinct from context_record.job_lease_owner
    or context_record.lease_expires_at <= now()
  then
    raise exception 'FIRMS response row insertion requires the active fenced run lease'
      using errcode = '55000';
  end if;

  new.recorded_at := now();
  return new;
end;
$$;

revoke execute on function ingest.validate_firms_response_row()
  from public, anon, authenticated, service_role,
  firewatch_catalog_admin, firewatch_collector, firewatch_reconciler,
  firewatch_publisher, firewatch_dispatcher;

create trigger firms_response_rows_validate
before insert on ingest.firms_response_rows
for each row execute function ingest.validate_firms_response_row();

create trigger firms_response_rows_reject_mutation
before update or delete on ingest.firms_response_rows
for each row execute function core.reject_mutation();

create or replace function ingest.firms_source_satellite_code_v1(
  p_product_key text,
  p_satellite_raw text
)
returns text
language sql
immutable
strict
security invoker
set search_path = ''
as $$
  select case
    when p_product_key = 'VIIRS_SNPP_NRT'
      and upper(btrim(p_satellite_raw)) in (
        'N', 'SNPP', 'S-NPP', 'SUOMI-NPP'
      ) then 'N'
    when p_product_key = 'VIIRS_NOAA20_NRT'
      and upper(btrim(p_satellite_raw)) in ('N20', 'NOAA-20') then 'N20'
    when p_product_key = 'VIIRS_NOAA21_NRT'
      and upper(btrim(p_satellite_raw)) in ('N21', 'NOAA-21') then 'N21'
    when p_product_key = 'MODIS_NRT'
      and upper(btrim(p_satellite_raw)) in ('A', 'AQUA') then 'A'
    when p_product_key = 'MODIS_NRT'
      and upper(btrim(p_satellite_raw)) in ('T', 'TERRA') then 'T'
    else null
  end;
$$;

revoke execute on function ingest.firms_source_satellite_code_v1(text, text)
  from public, anon, authenticated, service_role,
  firewatch_catalog_admin, firewatch_collector, firewatch_reconciler,
  firewatch_publisher, firewatch_dispatcher;
grant execute on function ingest.firms_source_satellite_code_v1(text, text)
  to firewatch_collector, firewatch_reconciler;

create or replace function ingest.firms_detection_identity_v1(
  p_product_key text,
  p_satellite text,
  p_acquired_at timestamptz,
  p_latitude numeric,
  p_longitude numeric
)
returns text
language sql
immutable
strict
security invoker
set search_path = ''
as $$
  select encode(
    pg_catalog.sha256(
      convert_to(
        concat_ws(
          '|',
          'firms-detection-v1',
          p_product_key,
          p_satellite,
          extract(epoch from p_acquired_at)::numeric(20,6)::text,
          p_latitude::numeric(9,6)::text,
          p_longitude::numeric(10,6)::text
        ),
        'UTF8'
      )
    ),
    'hex'
  );
$$;

revoke execute on function ingest.firms_detection_identity_v1(
  text, text, timestamptz, numeric, numeric
) from public, anon, authenticated, service_role,
  firewatch_catalog_admin, firewatch_collector, firewatch_reconciler,
  firewatch_publisher, firewatch_dispatcher;
grant execute on function ingest.firms_detection_identity_v1(
  text, text, timestamptz, numeric, numeric
) to firewatch_collector, firewatch_reconciler;

create table ingest.firms_detection_details (
  id bigint generated always as identity primary key,
  public_id core.uuid_v7 not null unique,
  contract_version text not null check (contract_version = '1.1.0'),
  identity_version text not null check (identity_version = 'firms-detection-v1'),
  normalized_content_sha256 text not null check (
    normalized_content_sha256 ~ '^[a-f0-9]{64}$'
  ),
  observation_cursor bigint not null unique
    references ingest.global_observations(cursor),
  source_revision_id bigint not null,
  source_id bigint not null references core.sources(id),
  product_id bigint not null,
  product_key text not null,
  satellite text not null check (satellite in (
    'Suomi-NPP', 'NOAA-20', 'NOAA-21', 'Aqua', 'Terra'
  )),
  source_satellite_raw text not null check (
    source_satellite_raw = btrim(source_satellite_raw)
    and char_length(source_satellite_raw) between 1 and 32
  ),
  source_satellite_code text generated always as (
    ingest.firms_source_satellite_code_v1(
      product_key,
      source_satellite_raw
    )
  ) stored,
  instrument text not null check (instrument in ('VIIRS', 'MODIS')),
  acquired_at timestamptz not null,
  acquired_date date not null,
  acquired_time_utc time(0) not null,
  source_time_precision text not null check (source_time_precision = 'minute'),
  latitude numeric(9,6) not null check (latitude between -90 and 90),
  longitude numeric(10,6) not null check (longitude between -180 and 180),
  centroid_geom extensions.geometry(Point, 4326)
    generated always as (
      extensions.st_setsrid(
        extensions.st_makepoint(
          longitude::double precision,
          latitude::double precision
        ),
        4326
      )
    ) stored,
  centroid_geog extensions.geography(Point, 4326)
    generated always as (
      extensions.st_setsrid(
        extensions.st_makepoint(
          longitude::double precision,
          latitude::double precision
        ),
        4326
      )::extensions.geography
    ) stored,
  scan_km numeric(8,3) not null check (scan_km > 0 and scan_km <= 20),
  track_km numeric(8,3) not null check (track_km > 0 and track_km <= 20),
  modeled_support_radius_m numeric(14,3)
    generated always as (
      (
        sqrt(
          power(scan_km::double precision, 2)
          + power(track_km::double precision, 2)
        ) * 500
      )::numeric(14,3)
    ) stored,
  spatial_support_method text not null check (
    spatial_support_method = 'centroid_with_circumscribed_radius_v1'
  ),
  footprint_orientation_deg numeric(7,3),
  confidence_class text check (confidence_class in ('low', 'nominal', 'high')),
  confidence_percent numeric(5,2) check (
    confidence_percent is null or confidence_percent between 0 and 100
  ),
  brightness_primary_k numeric(7,2) not null check (
    brightness_primary_k between 100 and 1000
  ),
  brightness_secondary_k numeric(7,2) not null check (
    brightness_secondary_k between 100 and 1000
  ),
  brightness_contract text not null check (
    brightness_contract in ('viirs_bright_ti4_ti5', 'modis_brightness_t31')
  ),
  frp_mw numeric(12,3) not null check (frp_mw >= 0),
  day_night text not null check (day_night in ('day', 'night')),
  source_dataset_version text not null check (
    btrim(source_dataset_version) <> ''
    and char_length(source_dataset_version) <= 128
  ),
  source_row_contract text not null check (
    source_row_contract in ('firms-area-csv-viirs-v1', 'firms-area-csv-modis-v1')
  ),
  published_at timestamptz,
  retrieved_at timestamptz not null,
  version_no bigint not null check (version_no > 0),
  previous_detail_id bigint,
  original_detail_id bigint not null,
  detection_identity_sha256 text generated always as (
    ingest.firms_detection_identity_v1(
      product_key, satellite, acquired_at, latitude, longitude
    )
  ) stored,
  limitations text[] not null,
  recorded_at timestamptz not null default now(),
  constraint firms_detection_details_product_fkey
    foreign key (product_id, source_id, product_key)
    references core.firms_products(id, source_id, product_key),
  constraint firms_detection_details_source_satellite_code_check check (
    source_satellite_code is not null
    and source_satellite_code in ('N', 'N20', 'N21', 'A', 'T')
  ),
  constraint firms_detection_details_source_revision_fkey
    foreign key (source_revision_id, source_id)
    references ingest.source_revisions(id, source_id),
  constraint firms_detection_details_identity_version_key
    unique (product_id, detection_identity_sha256, version_no),
  constraint firms_detection_details_identity_content_key
    unique (product_id, detection_identity_sha256, normalized_content_sha256),
  constraint firms_detection_details_chain_identity_key
    unique (id, source_id, product_id, detection_identity_sha256),
  constraint firms_detection_details_previous_once_key unique (previous_detail_id),
  constraint firms_detection_details_previous_fkey
    foreign key (
      previous_detail_id, source_id, product_id, detection_identity_sha256
    ) references ingest.firms_detection_details(
      id, source_id, product_id, detection_identity_sha256
    ),
  constraint firms_detection_details_original_fkey
    foreign key (
      original_detail_id, source_id, product_id, detection_identity_sha256
    ) references ingest.firms_detection_details(
      id, source_id, product_id, detection_identity_sha256
    ),
  constraint firms_detection_details_time_raw_check check (
    acquired_date = (acquired_at at time zone 'UTC')::date
    and acquired_time_utc = (acquired_at at time zone 'UTC')::time(0)
    and extract(second from acquired_at) = 0
    and retrieved_at >= acquired_at
    and (published_at is null or retrieved_at >= published_at)
    and recorded_at >= retrieved_at
  ),
  constraint firms_detection_details_confidence_shape_check check (
    (confidence_class is not null and confidence_percent is null)
    or (confidence_class is null and confidence_percent is not null)
  ),
  constraint firms_detection_details_spatial_honesty_check check (
    footprint_orientation_deg is null
    and spatial_support_method = 'centroid_with_circumscribed_radius_v1'
  ),
  constraint firms_detection_details_chain_shape_check check (
    (version_no = 1
      and previous_detail_id is null
      and original_detail_id = id)
    or (version_no > 1
      and previous_detail_id is not null
      and original_detail_id <> id)
  ),
  constraint firms_detection_details_limitations_check check (
    limitations @> array[
      'thermal_pixel_not_flame_location',
      'not_incident_confirmation',
      'pixel_orientation_not_source_supplied',
      'modeled_support_is_not_pixel_footprint',
      'source_time_precision_minute',
      'not_official_status',
      'not_protective_guidance',
      'not_all_clear'
    ]::text[]
  )
);

create index firms_detection_details_product_acquired_idx
  on ingest.firms_detection_details(product_id, acquired_at desc, id desc);
create index firms_detection_details_source_revision_idx
  on ingest.firms_detection_details(source_revision_id);
create index firms_detection_details_source_acquired_idx
  on ingest.firms_detection_details(source_id, acquired_at desc, id desc);
create index firms_detection_details_original_version_idx
  on ingest.firms_detection_details(
    original_detail_id, version_no desc, id desc
  );
create index firms_detection_details_centroid_geom_gist
  on ingest.firms_detection_details using gist(centroid_geom);
create index firms_detection_details_centroid_geog_gist
  on ingest.firms_detection_details using gist(centroid_geog);

comment on column ingest.firms_detection_details.centroid_geom is
  'Source-reported thermal-pixel centroid. It is not a flame location.';
comment on column ingest.firms_detection_details.scan_km is
  'Source-reported scan dimension in kilometres; orientation is not supplied.';
comment on column ingest.firms_detection_details.track_km is
  'Source-reported track dimension in kilometres; orientation is not supplied.';
comment on column ingest.firms_detection_details.modeled_support_radius_m is
  'Half-diagonal of reported scan/track dimensions. A conservative modeled support radius, never a source-reported pixel polygon.';
comment on column ingest.firms_detection_details.source_satellite_raw is
  'Exact trimmed satelliteRaw value from the validated CSV row; it remains the source evidence token.';
comment on column ingest.firms_detection_details.source_satellite_code is
  'Product-aware canonical code generated by the database from source_satellite_raw, never supplied independently by the collector.';
comment on column ingest.firms_detection_details.retrieved_at is
  'Exact retrieval instant from the immutable raw HTTP response occurrence joined through source_revision_id.';

create or replace function ingest.validate_firms_detection_detail()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  product_record record;
  observation_record record;
  revision_record record;
  previous_record record;
  computed_identity text;
  computed_centroid extensions.geometry;
  computed_support_radius_m numeric(14,3);
  computed_source_satellite_code text;
  computed_satellite text;
begin
  if new.version_no = 1 and new.original_detail_id is null then
    new.original_detail_id := new.id;
  end if;

  computed_identity := ingest.firms_detection_identity_v1(
    new.product_key,
    new.satellite,
    new.acquired_at,
    new.latitude,
    new.longitude
  );
  computed_centroid := extensions.st_setsrid(
    extensions.st_makepoint(
      new.longitude::double precision,
      new.latitude::double precision
    ),
    4326
  );
  computed_support_radius_m := (
    sqrt(
      power(new.scan_km::double precision, 2)
      + power(new.track_km::double precision, 2)
    ) * 500
  )::numeric(14,3);
  computed_source_satellite_code := ingest.firms_source_satellite_code_v1(
    new.product_key,
    new.source_satellite_raw
  );
  computed_satellite := case computed_source_satellite_code
    when 'N' then 'Suomi-NPP'
    when 'N20' then 'NOAA-20'
    when 'N21' then 'NOAA-21'
    when 'A' then 'Aqua'
    when 'T' then 'Terra'
    else null
  end;

  select product.*
    into product_record
  from core.firms_products as product
  where product.id = new.product_id
    and product.source_id = new.source_id
    and product.product_key = new.product_key;

  if not found
    or new.instrument is distinct from product_record.instrument
    or not (new.satellite = any(product_record.allowed_satellites))
    or computed_source_satellite_code is null
    or not (
      computed_source_satellite_code = any(product_record.allowed_source_codes)
    )
    or new.satellite is distinct from computed_satellite
    or (product_record.confidence_encoding = 'viirs_class' and (
      new.confidence_class is null
      or new.confidence_percent is not null
      or new.brightness_contract <> 'viirs_bright_ti4_ti5'
      or new.source_row_contract <> product_record.parser_contract
    ))
    or (product_record.confidence_encoding = 'modis_percent' and (
      new.confidence_class is not null
      or new.confidence_percent is null
      or new.brightness_contract <> 'modis_brightness_t31'
      or new.source_row_contract <> product_record.parser_contract
    ))
  then
    raise exception 'FIRMS detail product/platform/row contract mismatch'
      using errcode = '23514';
  end if;

  select
    observation.source_id,
    observation.source_revision_id,
    observation.source_record_key,
    observation.observation_kind,
    observation.observed_at,
    observation.observed_precision,
    observation.effective_precision,
    observation.published_at,
    observation.published_precision,
    observation.modified_precision,
    observation.retrieved_at,
    observation.trust_class,
    observation.evidence_class,
    observation.visibility,
    observation.confidence,
    observation.severity,
    observation.geom,
    observation.geometry_precision_m,
    observation.geometry_precision_source,
    observation.validation_state,
    observation.validation_reasons,
    observation.properties,
    observation.quality_flags,
    source.slug as source_slug
  into observation_record
  from ingest.global_observations as observation
  join core.sources as source on source.id = observation.source_id
  where observation.cursor = new.observation_cursor;

  if not found
    or observation_record.source_slug <> 'nasa-firms'
    or observation_record.source_id is distinct from new.source_id
    or observation_record.source_revision_id is distinct from new.source_revision_id
    or observation_record.source_record_key
      is distinct from 'firms:' || computed_identity
    or observation_record.observation_kind <> 'thermal_anomaly'
    or observation_record.evidence_class <> 'thermal_detection'
    or observation_record.observed_precision <> 'exact'
    or observation_record.observed_at is distinct from new.acquired_at
    or observation_record.effective_precision <> 'unknown'
    or observation_record.modified_precision <> 'unknown'
    or observation_record.retrieved_at is distinct from new.retrieved_at
    or observation_record.trust_class <> 'official_observation'
    or observation_record.visibility <> 'restricted'
    or observation_record.confidence is not null
    or observation_record.severity is not null
    or observation_record.geom is null
    or not extensions.st_equals(
      observation_record.geom,
      computed_centroid
    )
    or observation_record.geometry_precision_m
      is distinct from computed_support_radius_m
    or observation_record.geometry_precision_source <> 'estimated'
    or observation_record.validation_state <> 'accepted'
    or cardinality(observation_record.validation_reasons) <> 0
    or observation_record.properties <> '{}'::jsonb
    or not observation_record.quality_flags @> array[
      'thermal_pixel_not_flame_location',
      'not_incident_confirmation',
      'pixel_orientation_not_source_supplied',
      'modeled_support_is_not_pixel_footprint',
      'source_time_precision_minute',
      'not_official_status',
      'not_protective_guidance',
      'not_all_clear'
    ]::text[]
  then
    raise exception 'FIRMS detail must match its restricted typed observation'
      using errcode = '23514';
  end if;

  if (new.published_at is null and (
      observation_record.published_precision <> 'unknown'
      or observation_record.published_at is not null
    ))
    or (new.published_at is not null and (
      observation_record.published_precision <> 'exact'
      or observation_record.published_at is distinct from new.published_at
    ))
  then
    raise exception 'FIRMS publication time must preserve exact or unknown precision'
      using errcode = '23514';
  end if;

  select
    revision.source_id,
    revision.source_record_key,
    revision.revision_no,
    revision.previous_revision_id,
    revision.content_sha256,
    revision.observed_at,
    revision.observed_precision,
    revision.published_at,
    revision.published_precision,
    revision.retrieved_at,
    revision.geom,
    revision.is_tombstone,
    raw.retrieved_at as raw_retrieved_at
  into revision_record
  from ingest.source_revisions as revision
  join ingest.raw_objects as raw
    on raw.id = revision.raw_object_id
    and raw.run_id = revision.run_id
    and raw.source_id = revision.source_id
  where revision.id = new.source_revision_id;

  if not found
    or revision_record.source_id is distinct from new.source_id
    or revision_record.source_record_key
      is distinct from 'firms:' || computed_identity
    or revision_record.revision_no is distinct from new.version_no
    or revision_record.content_sha256 is distinct from new.normalized_content_sha256
    or revision_record.observed_precision <> 'exact'
    or revision_record.observed_at is distinct from new.acquired_at
    or revision_record.retrieved_at is distinct from new.retrieved_at
    or revision_record.raw_retrieved_at is distinct from new.retrieved_at
    or revision_record.geom is null
    or not extensions.st_equals(revision_record.geom, computed_centroid)
    or revision_record.is_tombstone
  then
    raise exception 'FIRMS detail must match its immutable source revision'
      using errcode = '23514';
  end if;

  if (new.published_at is null and (
      revision_record.published_precision <> 'unknown'
      or revision_record.published_at is not null
    ))
    or (new.published_at is not null and (
      revision_record.published_precision <> 'exact'
      or revision_record.published_at is distinct from new.published_at
    ))
  then
    raise exception 'FIRMS source revision publication precision mismatch'
      using errcode = '23514';
  end if;

  if new.version_no = 1 then
    if revision_record.previous_revision_id is not null then
      raise exception 'first FIRMS detail must use the first source revision'
        using errcode = '23514';
    end if;
  else
    select previous.*
      into previous_record
    from ingest.firms_detection_details as previous
    where previous.id = new.previous_detail_id;

    if not found
      or previous_record.version_no + 1 <> new.version_no
      or previous_record.original_detail_id <> new.original_detail_id
      or revision_record.previous_revision_id
        is distinct from previous_record.source_revision_id
      or new.retrieved_at < previous_record.retrieved_at
    then
      raise exception 'FIRMS detail revision must extend one immutable identity chain'
        using errcode = '23514';
    end if;
  end if;

  new.recorded_at := now();
  return new;
end;
$$;

revoke execute on function ingest.validate_firms_detection_detail()
  from public, anon, authenticated, service_role,
  firewatch_catalog_admin, firewatch_collector, firewatch_reconciler,
  firewatch_publisher, firewatch_dispatcher;

create trigger firms_detection_details_validate
before insert on ingest.firms_detection_details
for each row execute function ingest.validate_firms_detection_detail();

create trigger firms_detection_details_reject_mutation
before update or delete on ingest.firms_detection_details
for each row execute function core.reject_mutation();

alter table ingest.firms_detection_details
  add constraint firms_detection_details_id_source_product_key
  unique (id, source_id, product_id);

alter table ingest.firms_response_rows
  add constraint firms_response_rows_detection_fkey
  foreign key (detection_detail_id, source_id, product_id)
  references ingest.firms_detection_details(id, source_id, product_id);

-- A NASA FIRMS observation and its typed detail must commit atomically.
create or replace function ingest.require_firms_detection_detail()
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
      and source.slug = 'nasa-firms'
  ) and not exists (
    select 1
    from ingest.firms_detection_details as detail
    where detail.observation_cursor = new.cursor
  ) then
    raise exception 'NASA FIRMS observations require a typed detection detail in the same transaction'
      using errcode = '23514';
  end if;
  return null;
end;
$$;

revoke execute on function ingest.require_firms_detection_detail()
  from public, anon, authenticated, service_role,
  firewatch_catalog_admin, firewatch_collector, firewatch_reconciler,
  firewatch_publisher, firewatch_dispatcher;

create constraint trigger global_observations_require_firms_detection_detail
after insert on ingest.global_observations
deferrable initially deferred
for each row execute function ingest.require_firms_detection_detail();

revoke execute on function core.validate_firms_product_update()
  from public, anon, authenticated, service_role,
  firewatch_catalog_admin, firewatch_collector, firewatch_reconciler,
  firewatch_publisher, firewatch_dispatcher;

create trigger firms_products_validate_update
before update on core.firms_products
for each row execute function core.validate_firms_product_update();

create trigger firms_products_touch_updated_at
before update on core.firms_products
for each row execute function core.touch_updated_at();

create trigger firms_products_reject_delete
before delete on core.firms_products
for each row execute function core.reject_mutation();

insert into core.firms_products (
  public_id, contract_version, source_id, product_key, instrument,
  allowed_satellites, allowed_source_codes, confidence_encoding,
  parser_contract, cmr_product, license_status, enabled, assessment_enabled,
  limitations
)
select
  seed.public_id::core.uuid_v7,
  '1.1.0',
  source.id,
  seed.product_key,
  seed.instrument,
  seed.allowed_satellites,
  seed.allowed_source_codes,
  seed.confidence_encoding,
  seed.parser_contract,
  seed.cmr_product,
  'unreviewed',
  false,
  false,
  array[
    'thermal_pixel_not_flame_location',
    'not_incident_confirmation',
    'pixel_orientation_not_source_supplied',
    'scan_track_are_reported_dimensions',
    'source_time_precision_minute'
  ]::text[]
from (
  values
    ('018f0000-0000-7000-8000-000000000601'::uuid,
      'VIIRS_SNPP_NRT', 'VIIRS', array['Suomi-NPP']::text[],
      array['N']::text[], 'viirs_class', 'firms-area-csv-viirs-v1',
      'VNP14IMG_NRT'),
    ('018f0000-0000-7000-8000-000000000602'::uuid,
      'VIIRS_NOAA20_NRT', 'VIIRS', array['NOAA-20']::text[],
      array['N20']::text[], 'viirs_class', 'firms-area-csv-viirs-v1',
      'VJ114IMG_NRT'),
    ('018f0000-0000-7000-8000-000000000603'::uuid,
      'VIIRS_NOAA21_NRT', 'VIIRS', array['NOAA-21']::text[],
      array['N21']::text[], 'viirs_class', 'firms-area-csv-viirs-v1',
      'VJ214IMG_NRT'),
    ('018f0000-0000-7000-8000-000000000604'::uuid,
      'MODIS_NRT', 'MODIS', array['Aqua','Terra']::text[],
      array['A','T']::text[], 'modis_percent', 'firms-area-csv-modis-v1',
      null)
) as seed(
  public_id, product_key, instrument, allowed_satellites,
  allowed_source_codes, confidence_encoding, parser_contract, cmr_product
)
join core.sources as source on source.slug = 'nasa-firms'
on conflict (product_key) do nothing;

do $$
begin
  if not exists (
    select 1
    from core.providers as provider
    join core.sources as source on source.provider_id = provider.id
    join core.endpoints as endpoint on endpoint.source_id = source.id
    join ingest.endpoint_state as endpoint_state
      on endpoint_state.endpoint_id = endpoint.id
    join core.collection_targets as target
      on target.endpoint_id = endpoint.id
      and target.source_id = source.id
    join core.collection_target_revisions as revision
      on revision.collection_target_id = target.id
      and revision.endpoint_id = endpoint.id
    join ingest.collection_target_state as target_state
      on target_state.collection_target_revision_id = revision.id
      and target_state.collection_target_id = target.id
    where provider.public_id = '018f0000-0000-7000-8000-000000000001'
      and provider.slug = 'nasa'
      and provider.contract_version = '1.1.0'
      and provider.name = 'NASA'
      and provider.organization_type = 'government'
      and provider.homepage_url = 'https://www.nasa.gov/'
      and provider.jurisdiction = 'United States'
      and provider.is_public
      and provider.metadata = '{}'::jsonb
      and source.public_id = '018f0000-0000-7000-8000-000000000101'
      and source.contract_version = '1.1.0'
      and source.slug = 'nasa-firms'
      and source.name = 'NASA FIRMS Active Fire Data'
      and source.description =
        'Satellite thermal-pixel detections. A detection is not a confirmed wildfire incident, perimeter, flame location, severity, official status, protective instruction, containment statement, or all-clear.'
      and source.product_family = 'active_fire'
      and source.default_trust_class = 'official_observation'
      and source.default_evidence_class = 'thermal_detection'
      and source.operational_scope = 'mixed'
      and source.homepage_url = 'https://firms.modaps.eosdis.nasa.gov/'
      and source.terms_url =
        'https://firms.modaps.eosdis.nasa.gov/content/academy/data_api/firms_api_use.html'
      and source.license_code = 'provider_terms'
      and source.license_name =
        'NASA FIRMS terms require review before activation'
      and source.attribution_text =
        'NASA FIRMS; retain product, platform, acquisition time, and thermal-pixel limitations.'
      and source.license_status = 'unreviewed'
      and source.commercial_use_allowed is null
      and source.redistribution_allowed is null
      and source.cache_ttl is null
      and source.retention_limit is null
      and not source.contains_personal_data
      and source.sensitivity = 'restricted'
      and source.default_freshness = interval '15 minutes'
      and source.default_max_staleness = interval '3 hours'
      and not source.enabled
      and not source.is_public
      and source.metadata = '{
        "activation":"license_review_required",
        "anomalyAssessment":"disabled",
        "credentialPersistence":"forbidden",
        "thermalPixelNotFirePerimeter":true
      }'::jsonb
      and endpoint.public_id = '018f0000-0000-7000-8000-000000000201'
      and endpoint.contract_version = '1.1.0'
      and endpoint.endpoint_key = 'area-csv'
      and endpoint.name = 'FIRMS Area CSV API'
      and endpoint.endpoint_kind = 'dataset'
      and endpoint.source_kind = 'sensor'
      and endpoint.authority_scopes = array['thermal_anomaly']::text[]
      and endpoint.content_policy = 'structured_data'
      and endpoint.license_policy = 'provider_terms_unreviewed'
      and endpoint.transport = 'http_poll'
      and endpoint.auth_mode = 'path_secret'
      and endpoint.credential_ref = 'FIRMS_MAP_KEY'
      and endpoint.base_url = 'https://firms.modaps.eosdis.nasa.gov/api/area/csv'
      and endpoint.http_method = 'GET'
      and endpoint.trust_class = 'official_observation'
      and endpoint.evidence_class = 'thermal_detection'
      and endpoint.authoritativeness_scope =
        'Satellite thermal-pixel observations only; no incident, severity, official-status, protective-action, containment, or all-clear authority.'
      and endpoint.coverage_scope = 'global'
      and endpoint.coverage_geom is null
      and endpoint.coverage_geog is null
      and endpoint.poll_interval = interval '15 minutes'
      and endpoint.expected_source_latency = interval '3 hours'
      and endpoint.freshness = interval '15 minutes'
      and endpoint.max_staleness = interval '3 hours'
      and endpoint.timeout_ms = 15000
      and endpoint.rate_limit_per_minute is null
      and endpoint.priority = 100
      and endpoint.supports_bbox
      and not endpoint.supports_cursor
      and endpoint.supports_backfill
      and endpoint.request_template = '{
        "credentialLocation":"path_segment_not_persisted",
        "credentialRef":"FIRMS_MAP_KEY",
        "products":["VIIRS_SNPP_NRT","VIIRS_NOAA20_NRT","VIIRS_NOAA21_NRT","MODIS_NRT"],
        "redactedRequestUrl":"catalog_base_url_only"
      }'::jsonb
      and endpoint.response_contract = '{
        "format":"csv",
        "itemIdentity":"firms-detection-v1",
        "orientationField":null,
        "scanTrackMeaning":"reported_pixel_dimensions_km"
      }'::jsonb
      and endpoint.capabilities = '{
        "assessment":"persistence_only",
        "negativeAssessment":false,
        "pagination":"none"
      }'::jsonb
      and not endpoint_state.enabled
      and endpoint_state.paused_reason =
        'license_review_and_adapter_release_required'
      and endpoint_state.consecutive_failures = 0
      and endpoint_state.next_due_at is null
      and target.public_id = '018f0000-0000-7000-8000-000000000401'
      and target.contract_version = '1.1.0'
      and target.target_key = 'global-discovery'
      and target.name = 'FIRMS global discovery'
      and target.incident_id is null
      and target.visibility = 'restricted'
      and not target.enabled
      and revision.public_id = '018f0000-0000-7000-8000-000000000501'
      and revision.contract_version = '1.1.0'
      and revision.identity_version = '2.0.0'
      and revision.version_no = 1
      and revision.previous_revision_id is null
      and revision.target_kind = 'dataset'
      and revision.configuration_sha256 = '309a06db9800af00eedc364890a3e29348ae18973f72ac348d7b36bac5ab52f2'
      and revision.scope = 'global'
      and revision.incident_id is null
      and revision.aoi_version_id is null
      and revision.target_geom is null
      and revision.target_geog is null
      and revision.geometry_precision_m is null
      and revision.geometry_precision_source = 'not_applicable'
      and revision.claim_kind = 'thermal_detection'
      and revision.operational_role = 'discovery'
      and revision.cadence = interval '15 minutes'
      and revision.stale_after = interval '3 hours'
      and revision.priority = 100
      and revision.trust_class_override is null
      and revision.request_params = '{}'::jsonb
      and not revision.enabled
      and revision.effective_at = timestamptz '2026-07-30 00:00:00+00'
      and target_state.cursor_state = '{}'::jsonb
      and target_state.last_enqueued_at is null
      and target_state.last_started_at is null
      and target_state.last_succeeded_at is null
      and target_state.next_due_at is null
      and target_state.consecutive_failures = 0
      and target_state.last_error is null
      and (select count(*) from core.endpoints as candidate_endpoint
        where candidate_endpoint.source_id = source.id) = 1
      and (select count(*) from core.collection_targets as candidate_target
        where candidate_target.source_id = source.id) = 1
      and (select count(*)
        from core.collection_target_revisions as candidate_revision
        where candidate_revision.collection_target_id = target.id) = 1
      and not exists (
        select 1 from core.incident_bindings as binding
        where binding.collection_target_id = target.id
      )
  ) then
    raise exception 'conflicting FIRMS source, endpoint, or target bootstrap identity'
      using errcode = '23514';
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_trigger as candidate_trigger
    where candidate_trigger.tgrelid = 'core.endpoints'::regclass
      and candidate_trigger.tgname = 'endpoints_reject_mutation'
      and candidate_trigger.tgenabled = 'O'
      and not candidate_trigger.tgisinternal
  ) then
    raise exception 'FIRMS bootstrap requires endpoint immutability enforcement'
      using errcode = '55000';
  end if;

  if (select count(*)
      from core.firms_products
      where source_id = (select id from core.sources where slug = 'nasa-firms')) <> 4
    or exists (
      select 1
      from core.firms_products as product
      where product.source_id = (
        select id from core.sources where slug = 'nasa-firms'
      )
        and (
          product.license_status <> 'unreviewed'
          or product.enabled
          or product.assessment_enabled
        )
    )
  then
    raise exception 'FIRMS bootstrap requires exactly four disabled, unreviewed products'
      using errcode = '23514';
  end if;

  if exists (
    select 1
    from core.adapter_releases as adapter
    join core.sources as source on source.id = adapter.source_id
    where source.slug = 'nasa-firms'
  ) then
    raise exception 'FIRMS bootstrap must not create or adopt an adapter release'
      using errcode = '23514';
  end if;
end;
$$;

create or replace function ingest.firms_area_logical_request_sha256_v1(
  p_base_url text,
  p_product_key text,
  p_west numeric,
  p_south numeric,
  p_east numeric,
  p_north numeric,
  p_date_from date,
  p_day_count integer
)
returns text
language sql
immutable
strict
security invoker
set search_path = ''
as $$
  select encode(
    pg_catalog.sha256(
      convert_to(
        concat_ws(
          '|',
          'firms-area-request-v1',
          'GET',
          p_base_url,
          p_product_key,
          p_west::numeric(10,6)::text,
          p_south::numeric(9,6)::text,
          p_east::numeric(10,6)::text,
          p_north::numeric(9,6)::text,
          (p_date_from - date '1970-01-01')::text,
          p_day_count::text
        ),
        'UTF8'
      )
    ),
    'hex'
  );
$$;

revoke execute on function ingest.firms_area_logical_request_sha256_v1(
  text, text, numeric, numeric, numeric, numeric, date, integer
) from public, anon, authenticated, service_role,
  firewatch_catalog_admin, firewatch_collector, firewatch_reconciler,
  firewatch_publisher, firewatch_dispatcher;
grant execute on function ingest.firms_area_logical_request_sha256_v1(
  text, text, numeric, numeric, numeric, numeric, date, integer
) to firewatch_collector, firewatch_reconciler;

-- #47 freezes the issued logical path area as fixed-six-decimal
-- west,south,east,north text. Persistence rejects negative zero, extra
-- precision/rounding collisions, and compares the parsed values to the typed
-- numeric request envelope before admitting completion evidence.
create or replace function ingest.firms_area_token_is_valid_v1(p_area text)
returns boolean
language plpgsql
immutable
strict
security invoker
set search_path = ''
as $$
declare
  parts text[];
  part text;
  west_value numeric;
  south_value numeric;
  east_value numeric;
  north_value numeric;
begin
  parts := string_to_array(p_area, ',');
  if cardinality(parts) <> 4 then
    return false;
  end if;

  foreach part in array parts loop
    if part !~ '^-?(0|[1-9][0-9]{0,2})\.[0-9]{6}$'
      or part ~ '^-0\.0{6}$'
    then
      return false;
    end if;
  end loop;

  west_value := parts[1]::numeric;
  south_value := parts[2]::numeric;
  east_value := parts[3]::numeric;
  north_value := parts[4]::numeric;

  return west_value between -180 and 180
    and east_value between -180 and 180
    and south_value between -90 and 90
    and north_value between -90 and 90
    and west_value < east_value
    and south_value < north_value;
end;
$$;

create or replace function ingest.firms_area_token_matches_v1(
  p_area text,
  p_west numeric,
  p_south numeric,
  p_east numeric,
  p_north numeric
)
returns boolean
language plpgsql
immutable
strict
security invoker
set search_path = ''
as $$
begin
  if not ingest.firms_area_token_is_valid_v1(p_area) then
    return false;
  end if;

  return split_part(p_area, ',', 1)::numeric = p_west
    and split_part(p_area, ',', 2)::numeric = p_south
    and split_part(p_area, ',', 3)::numeric = p_east
    and split_part(p_area, ',', 4)::numeric = p_north;
end;
$$;

revoke execute on function ingest.firms_area_token_is_valid_v1(text),
  ingest.firms_area_token_matches_v1(text, numeric, numeric, numeric, numeric)
  from public, anon, authenticated, service_role,
  firewatch_catalog_admin, firewatch_collector, firewatch_reconciler,
  firewatch_publisher, firewatch_dispatcher;
grant execute on function ingest.firms_area_token_is_valid_v1(text),
  ingest.firms_area_token_matches_v1(text, numeric, numeric, numeric, numeric)
  to firewatch_collector, firewatch_reconciler;

create table ingest.firms_query_product_results (
  id bigint generated always as identity primary key,
  public_id core.uuid_v7 not null unique,
  contract_version text not null check (contract_version = '1.1.0'),
  run_id bigint not null references ingest.runs(id),
  http_exchange_id bigint not null unique references ingest.http_exchanges(id),
  response_raw_object_id bigint,
  response_content_sha256 text check (
    response_content_sha256 is null
    or response_content_sha256 ~ '^[a-f0-9]{64}$'
  ),
  response_retrieved_at timestamptz,
  source_id bigint not null references core.sources(id),
  endpoint_id bigint not null references core.endpoints(id),
  product_id bigint not null,
  product_key text not null,
  west numeric(10,6) not null check (west between -180 and 180),
  south numeric(9,6) not null check (south between -90 and 90),
  east numeric(10,6) not null check (east between -180 and 180),
  north numeric(9,6) not null check (north between -90 and 90),
  requested_bbox_geom extensions.geometry(Polygon, 4326)
    generated always as (
      extensions.st_makeenvelope(
        west::double precision,
        south::double precision,
        east::double precision,
        north::double precision,
        4326
      )
    ) stored,
  requested_bbox_geog extensions.geography(Polygon, 4326)
    generated always as (
      extensions.st_makeenvelope(
        west::double precision,
        south::double precision,
        east::double precision,
        north::double precision,
        4326
      )::extensions.geography
    ) stored,
  date_from date not null,
  day_count integer not null check (day_count between 1 and 5),
  date_to date not null,
  date_request_mode text not null check (date_request_mode = 'explicit_starting_on'),
  issued_at timestamptz not null,
  logical_request_sha256 text not null check (
    logical_request_sha256 ~ '^[a-f0-9]{64}$'
  ),
  http_request_fingerprint_sha256 text not null check (
    http_request_fingerprint_sha256 ~ '^[a-f0-9]{64}$'
  ),
  parser_contract text not null check (parser_contract in (
    'firms-area-csv-viirs-v1', 'firms-area-csv-modis-v1'
  )),
  outcome text not null check (outcome in ('complete', 'partial', 'failed')),
  returned_row_count bigint not null check (returned_row_count >= 0),
  accepted_row_count bigint not null check (accepted_row_count >= 0),
  rejected_row_count bigint not null check (rejected_row_count >= 0),
  schema_rejection_count bigint not null check (schema_rejection_count >= 0),
  lineage_gap_count bigint not null check (lineage_gap_count >= 0),
  completed_at timestamptz not null,
  lease_token uuid not null,
  lease_owner text not null check (btrim(lease_owner) <> ''),
  recorded_at timestamptz not null default now(),
  constraint firms_query_product_results_run_product_key
    unique (run_id, product_id),
  constraint firms_query_product_results_product_fkey
    foreign key (product_id, source_id, product_key)
    references core.firms_products(id, source_id, product_key),
  constraint firms_query_product_results_response_raw_fkey
    foreign key (
      response_raw_object_id, http_exchange_id, run_id, source_id, endpoint_id
    ) references ingest.raw_objects(
      id, http_exchange_id, run_id, source_id, endpoint_id
    ),
  constraint firms_query_product_results_bbox_check check (
    west < east and south < north
  ),
  constraint firms_query_product_results_explicit_date_check check (
    date_to = date_from + (day_count - 1)
  ),
  constraint firms_query_product_results_accounting_check check (
    returned_row_count = accepted_row_count + rejected_row_count
    and schema_rejection_count = rejected_row_count
  ),
  constraint firms_query_product_results_complete_shape_check check (
    outcome <> 'complete'
    or (rejected_row_count = 0
      and schema_rejection_count = 0
      and lineage_gap_count = 0)
  ),
  constraint firms_query_product_results_response_occurrence_shape_check check (
    (
      response_raw_object_id is null
      and response_content_sha256 is null
      and response_retrieved_at is null
      and outcome = 'failed'
    )
    or (
      response_raw_object_id is not null
      and response_content_sha256 is not null
      and response_retrieved_at is not null
    )
  ),
  constraint firms_query_product_results_recorded_time_check check (
    issued_at <= coalesce(response_retrieved_at, completed_at)
    and (response_retrieved_at is null
      or response_retrieved_at <= completed_at)
    and completed_at <= recorded_at
  )
);

create index firms_query_product_results_product_completed_idx
  on ingest.firms_query_product_results(product_id, completed_at desc, id desc);
create index firms_query_product_results_run_outcome_idx
  on ingest.firms_query_product_results(run_id, outcome, product_id);
create index firms_query_product_results_endpoint_idx
  on ingest.firms_query_product_results(endpoint_id);
create index firms_query_product_results_source_id_idx
  on ingest.firms_query_product_results(source_id);
create index firms_query_product_results_response_raw_idx
  on ingest.firms_query_product_results(response_raw_object_id)
  where response_raw_object_id is not null;
create index firms_query_product_results_bbox_geom_gist
  on ingest.firms_query_product_results using gist(requested_bbox_geom);
create index firms_query_product_results_bbox_geog_gist
  on ingest.firms_query_product_results using gist(requested_bbox_geog);

comment on column ingest.firms_query_product_results.date_request_mode is
  'Only explicit YYYY-MM-DD/N starting-on requests qualify. Rolling N-day requests remain generic HTTP evidence and cannot create this row.';
comment on column ingest.firms_query_product_results.requested_bbox_geom is
  'Requested API bounding box, not proof of satellite coverage or sensor assessability.';
comment on column ingest.firms_query_product_results.logical_request_sha256 is
  'FIRMS-specific credential-free logical request identity. It is distinct from the generic HTTP evidence-ledger fingerprint.';
comment on column ingest.firms_query_product_results.http_request_fingerprint_sha256 is
  'Exact generic HTTP evidence-ledger fingerprint copied from the bound immutable exchange; never recomputed with FIRMS-specific serialization.';
comment on column ingest.firms_query_product_results.response_raw_object_id is
  'Exact response occurrence joined to the same exchange/run/source/endpoint; replay must also verify response_content_sha256 and response_retrieved_at against that immutable raw object.';
comment on column ingest.firms_query_product_results.accepted_row_count is
  'Accepted immutable response-row occurrences. This contract does not claim whether each occurrence created a new detail or matched an existing detail.';

create or replace function ingest.validate_firms_query_product_result()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  context_record record;
  accepted_count bigint;
  rejected_count bigint;
  expected_parser_contract text;
  expected_logical_request_sha256 text;
begin
  select
    run.status as run_status,
    run.source_id as run_source_id,
    run.endpoint_id as run_endpoint_id,
    run.lease_token as run_lease_token,
    run.lease_owner as run_lease_owner,
    job.status as job_status,
    job.lease_token as job_lease_token,
    job.lease_owner as job_lease_owner,
    job.lease_expires_at,
    source.slug as source_slug,
    endpoint.endpoint_key,
    endpoint.base_url,
    exchange.run_id as exchange_run_id,
    exchange.source_id as exchange_source_id,
    exchange.endpoint_id as exchange_endpoint_id,
    exchange.request_method,
    exchange.request_url_redacted,
    exchange.request_fingerprint_sha256 as exchange_fingerprint,
    exchange.request_body_blob_id,
    exchange.request_query_safe,
    exchange.request_headers_safe,
    exchange.request_metadata_safe,
    exchange.outcome as exchange_outcome,
    exchange.http_status,
    exchange.completed_at as exchange_completed_at,
    exchange.response_raw_object_id,
    exchange.response_headers_safe,
    exchange.result_metadata_safe,
    raw.content_sha256 as response_content_sha256,
    raw.retrieved_at as response_retrieved_at,
    product.instrument,
    product.parser_contract as product_parser_contract,
    product.enabled as product_enabled,
    product.license_status as product_license_status
  into context_record
  from ingest.runs as run
  join ingest.jobs as job on job.id = run.job_id
  join core.sources as source on source.id = run.source_id
  join core.endpoints as endpoint on endpoint.id = run.endpoint_id
  join ingest.http_exchanges as exchange on exchange.id = new.http_exchange_id
  left join ingest.raw_objects as raw
    on raw.id = exchange.response_raw_object_id
    and raw.http_exchange_id = exchange.id
    and raw.run_id = exchange.run_id
    and raw.source_id = exchange.source_id
    and raw.endpoint_id = exchange.endpoint_id
  join core.firms_products as product
    on product.id = new.product_id
    and product.source_id = new.source_id
    and product.product_key = new.product_key
  where run.id = new.run_id;

  if not found then
    raise exception 'FIRMS product result requires its run, exchange, and product'
      using errcode = '23503';
  end if;

  expected_parser_contract := context_record.product_parser_contract;
  expected_logical_request_sha256 :=
    ingest.firms_area_logical_request_sha256_v1(
      context_record.base_url,
      new.product_key,
      new.west,
      new.south,
      new.east,
      new.north,
      new.date_from,
      new.day_count
    );

  if context_record.source_slug <> 'nasa-firms'
    or context_record.endpoint_key <> 'area-csv'
    or context_record.run_source_id is distinct from new.source_id
    or context_record.run_endpoint_id is distinct from new.endpoint_id
    or context_record.exchange_run_id is distinct from new.run_id
    or context_record.exchange_source_id is distinct from new.source_id
    or context_record.exchange_endpoint_id is distinct from new.endpoint_id
    or context_record.request_method <> 'GET'
    or context_record.request_url_redacted is distinct from context_record.base_url
    or context_record.request_body_blob_id is not null
    or context_record.request_query_safe <> jsonb_build_object(
      'area', concat_ws(
        ',',
        new.west::numeric(10,6)::text,
        new.south::numeric(9,6)::text,
        new.east::numeric(10,6)::text,
        new.north::numeric(9,6)::text
      ),
      'date', new.date_from::text || '/' || new.day_count::text,
      'product', new.product_key
    )
    or not ingest.firms_area_token_matches_v1(
      context_record.request_query_safe->>'area',
      new.west,
      new.south,
      new.east,
      new.north
    )
    or context_record.request_headers_safe <> '{"accept":"text/csv"}'::jsonb
    or context_record.request_metadata_safe <> jsonb_build_object(
      'issued_at', to_char(
        new.issued_at at time zone 'UTC',
        'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
      ),
      'operation', 'firms-area-csv',
      'product', new.product_key,
      'scope', 'geographic-area'
    )
    or new.issued_at <> date_trunc('milliseconds', new.issued_at)
    or new.http_request_fingerprint_sha256
      is distinct from context_record.exchange_fingerprint
    or new.logical_request_sha256
      is distinct from expected_logical_request_sha256
    or new.parser_contract is distinct from expected_parser_contract
    or not context_record.product_enabled
    or context_record.product_license_status <> 'approved'
  then
    raise exception 'FIRMS product result request/product contract mismatch'
      using errcode = '23514';
  end if;

  if new.outcome in ('complete', 'partial') and (
    context_record.exchange_outcome <> 'response'
    or context_record.http_status <> 200
    or context_record.response_raw_object_id is null
    or context_record.exchange_completed_at is distinct from new.completed_at
    or split_part(
      lower(coalesce(context_record.response_headers_safe->>'content-type', '')),
      ';',
      1
    ) <> 'text/csv'
  ) then
    raise exception 'processable FIRMS product result requires an exact terminal 200/raw response'
      using errcode = '23514';
  end if;

  if new.outcome = 'complete'
    and context_record.result_metadata_safe <> '{
      "partial":false,
      "terminal":true,
      "truncated":false
    }'::jsonb
  then
    raise exception 'complete FIRMS product result requires complete transport metadata'
      using errcode = '23514';
  end if;

  if new.outcome <> 'complete'
    and context_record.exchange_completed_at is distinct from new.completed_at
  then
    raise exception 'FIRMS product result completion time must match its HTTP exchange'
      using errcode = '23514';
  end if;

  if context_record.response_raw_object_id
      is distinct from new.response_raw_object_id
    or context_record.response_content_sha256
      is distinct from new.response_content_sha256
    or context_record.response_retrieved_at
      is distinct from new.response_retrieved_at
  then
    raise exception 'FIRMS product result must bind the exact durable response occurrence receipt'
      using errcode = '23514';
  end if;

  select
    count(*) filter (where response_row.disposition = 'accepted'),
    count(*) filter (where response_row.disposition = 'rejected')
  into accepted_count, rejected_count
  from ingest.firms_response_rows as response_row
  where response_row.run_id = new.run_id
    and response_row.http_exchange_id = new.http_exchange_id
    and response_row.product_id = new.product_id;

  if accepted_count is distinct from new.accepted_row_count
    or rejected_count is distinct from new.rejected_row_count
    or accepted_count + rejected_count is distinct from new.returned_row_count
  then
    raise exception 'FIRMS product result counts must match immutable response rows'
      using errcode = '23514';
  end if;

  if context_record.run_status <> 'running'
    or context_record.job_status <> 'running'
    or new.lease_token is distinct from context_record.run_lease_token
    or new.lease_token is distinct from context_record.job_lease_token
    or new.lease_owner is distinct from context_record.run_lease_owner
    or new.lease_owner is distinct from context_record.job_lease_owner
    or context_record.lease_expires_at <= now()
  then
    raise exception 'FIRMS product result insertion requires the active fenced run lease'
      using errcode = '55000';
  end if;

  new.recorded_at := now();
  return new;
end;
$$;

revoke execute on function ingest.validate_firms_query_product_result()
  from public, anon, authenticated, service_role,
  firewatch_catalog_admin, firewatch_collector, firewatch_reconciler,
  firewatch_publisher, firewatch_dispatcher;

create trigger firms_query_product_results_validate
before insert on ingest.firms_query_product_results
for each row execute function ingest.validate_firms_query_product_result();

create trigger firms_query_product_results_reject_mutation
before update or delete on ingest.firms_query_product_results
for each row execute function core.reject_mutation();

create table ingest.firms_query_completions (
  health_cursor bigint primary key references truth.source_health(cursor),
  run_id bigint not null unique references ingest.runs(id),
  source_id bigint not null references core.sources(id),
  endpoint_id bigint not null references core.endpoints(id),
  collection_target_id bigint not null references core.collection_targets(id),
  collection_target_revision_id bigint not null
    references core.collection_target_revisions(id),
  west numeric(10,6) not null check (west between -180 and 180),
  south numeric(9,6) not null check (south between -90 and 90),
  east numeric(10,6) not null check (east between -180 and 180),
  north numeric(9,6) not null check (north between -90 and 90),
  requested_bbox_geom extensions.geometry(Polygon, 4326)
    generated always as (
      extensions.st_makeenvelope(
        west::double precision,
        south::double precision,
        east::double precision,
        north::double precision,
        4326
      )
    ) stored,
  requested_bbox_geog extensions.geography(Polygon, 4326)
    generated always as (
      extensions.st_makeenvelope(
        west::double precision,
        south::double precision,
        east::double precision,
        north::double precision,
        4326
      )::extensions.geography
    ) stored,
  date_from date not null,
  day_count integer not null check (day_count between 1 and 5),
  date_to date not null,
  date_request_mode text not null check (date_request_mode = 'explicit_starting_on'),
  completed_products text[] not null,
  request_count integer not null check (request_count = 4),
  returned_row_count bigint not null check (returned_row_count >= 0),
  accepted_row_count bigint not null check (accepted_row_count >= 0),
  schema_rejection_count bigint not null check (schema_rejection_count = 0),
  lineage_gap_count bigint not null check (lineage_gap_count = 0),
  api_returned_zero_rows boolean generated always as (
    returned_row_count = 0
  ) stored,
  request_coverage_kind text not null check (
    request_coverage_kind = 'requested_bbox_only'
  ),
  sensor_assessability text not null check (sensor_assessability = 'unknown'),
  negative_assessment_eligible boolean generated always as (false) stored,
  known_at timestamptz not null,
  freshness_deadline timestamptz not null,
  limitations text[] not null,
  recorded_at timestamptz not null default now(),
  constraint firms_query_completions_bbox_check check (
    west < east and south < north
  ),
  constraint firms_query_completions_explicit_date_check check (
    date_to = date_from + (day_count - 1)
  ),
  constraint firms_query_completions_products_check check (
    completed_products = array[
      'MODIS_NRT',
      'VIIRS_NOAA20_NRT',
      'VIIRS_NOAA21_NRT',
      'VIIRS_SNPP_NRT'
    ]::text[]
  ),
  constraint firms_query_completions_accounting_check check (
    returned_row_count = accepted_row_count
  ),
  constraint firms_query_completions_time_check check (
    freshness_deadline > known_at and known_at <= recorded_at
  ),
  constraint firms_query_completions_limitations_check check (
    limitations @> array[
      'requested_bbox_is_not_satellite_coverage',
      'sensor_assessability_unknown',
      'empty_response_is_not_all_clear',
      'cmr_catalog_metadata_does_not_assess_anomalies',
      'not_official_status',
      'not_protective_guidance',
      'not_incident_resolution'
    ]::text[]
  )
);

create index firms_query_completions_source_freshness_idx
  on ingest.firms_query_completions(
    source_id, freshness_deadline desc, health_cursor desc
  );
create index firms_query_completions_target_revision_idx
  on ingest.firms_query_completions(collection_target_revision_id);
create index firms_query_completions_endpoint_idx
  on ingest.firms_query_completions(endpoint_id);
create index firms_query_completions_target_idx
  on ingest.firms_query_completions(collection_target_id);
create index firms_query_completions_bbox_geom_gist
  on ingest.firms_query_completions using gist(requested_bbox_geom);
create index firms_query_completions_bbox_geog_gist
  on ingest.firms_query_completions using gist(requested_bbox_geog);

comment on column ingest.firms_query_completions.api_returned_zero_rows is
  'All four explicit-date API calls returned zero rows. This is request evidence only, not proof of unobscured sensing, no fire, incident resolution, or an all-clear.';
comment on column ingest.firms_query_completions.negative_assessment_eligible is
  'Always false in contract 1.1.0: cloud/obscuration and sensor-assessability evidence are not yet persisted.';

create or replace function ingest.validate_firms_query_completion()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  completion_context record;
begin
  select
    health.source_id as health_source_id,
    health.endpoint_id as health_endpoint_id,
    health.collection_target_id as health_target_id,
    health.collection_target_revision_id as health_revision_id,
    health.run_id as health_run_id,
    health.status as health_status,
    health.visibility as health_visibility,
    health.checked_at,
    health.last_success_at,
    health.error_class,
    health.geographic_completeness,
    health.record_count,
    health.schema_failure_count,
    run.status as run_status,
    run.finished_at,
    run.request_count as run_request_count,
    run.fetched_count,
    run.accepted_count,
    run.rejected_count,
    run.duplicate_count,
    source.slug as source_slug,
    source.enabled as source_enabled,
    source.license_status as source_license_status,
    endpoint.endpoint_key,
    endpoint_state.enabled as endpoint_enabled,
    target.enabled as target_enabled,
    target.visibility as target_visibility,
    revision.enabled as revision_enabled,
    revision.stale_after
  into completion_context
  from truth.source_health as health
  join ingest.runs as run on run.id = health.run_id
  join core.sources as source on source.id = health.source_id
  join core.endpoints as endpoint on endpoint.id = health.endpoint_id
  join ingest.endpoint_state as endpoint_state
    on endpoint_state.endpoint_id = endpoint.id
  join core.collection_targets as target
    on target.id = health.collection_target_id
  join core.collection_target_revisions as revision
    on revision.id = health.collection_target_revision_id
  where health.cursor = new.health_cursor;

  if not found then
    raise exception 'FIRMS completion requires source health linked to its run'
      using errcode = '23503';
  end if;

  if completion_context.source_slug <> 'nasa-firms'
    or completion_context.endpoint_key <> 'area-csv'
    or completion_context.health_source_id is distinct from new.source_id
    or completion_context.health_endpoint_id is distinct from new.endpoint_id
    or completion_context.health_target_id is distinct from new.collection_target_id
    or completion_context.health_revision_id
      is distinct from new.collection_target_revision_id
    or completion_context.health_run_id is distinct from new.run_id
    or not completion_context.source_enabled
    or completion_context.source_license_status <> 'approved'
    or not completion_context.endpoint_enabled
    or not completion_context.target_enabled
    or completion_context.target_visibility <> 'restricted'
    or not completion_context.revision_enabled
  then
    raise exception 'FIRMS completion requires one active, approved restricted target configuration'
      using errcode = '23514';
  end if;

  if completion_context.health_status <> 'healthy'
    or completion_context.health_visibility <> 'restricted'
    or completion_context.last_success_at
      is distinct from completion_context.checked_at
    or completion_context.error_class is not null
    or completion_context.geographic_completeness is distinct from 1::numeric
    or completion_context.schema_failure_count <> 0
    or completion_context.run_status <> 'success'
    or completion_context.finished_at is null
    or completion_context.finished_at > completion_context.checked_at
    or completion_context.run_request_count <> 4
    or completion_context.fetched_count <> new.returned_row_count
    or completion_context.accepted_count + completion_context.duplicate_count
      <> new.accepted_row_count
    or completion_context.rejected_count <> 0
    or completion_context.record_count is distinct from new.returned_row_count
  then
    raise exception 'FIRMS completion requires healthy, complete, schema-clean run accounting'
      using errcode = '23514';
  end if;

  if new.known_at is distinct from completion_context.checked_at
    or new.freshness_deadline
      is distinct from completion_context.checked_at + completion_context.stale_after
  then
    raise exception 'FIRMS completion knowledge and freshness clocks must derive from source health'
      using errcode = '23514';
  end if;

  if (
    select count(*)
    from core.firms_products as product
    where product.source_id = new.source_id
      and product.enabled
      and product.license_status = 'approved'
  ) <> 4 then
    raise exception 'FIRMS completion requires all four licensed products enabled'
      using errcode = '23514';
  end if;

  new.recorded_at := now();
  return new;
end;
$$;

revoke execute on function ingest.validate_firms_query_completion()
  from public, anon, authenticated, service_role,
  firewatch_catalog_admin, firewatch_collector, firewatch_reconciler,
  firewatch_publisher, firewatch_dispatcher;

create trigger firms_query_completions_validate
before insert on ingest.firms_query_completions
for each row execute function ingest.validate_firms_query_completion();

create or replace function ingest.require_complete_firms_product_set()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  result_rows integer;
  product_names text[];
  returned_rows bigint;
  accepted_rows bigint;
  exchange_rows integer;
begin
  select
    count(*)::integer,
    array_agg(result.product_key order by result.product_key),
    sum(result.returned_row_count),
    sum(result.accepted_row_count)
  into
    result_rows,
    product_names,
    returned_rows,
    accepted_rows
  from ingest.firms_query_product_results as result
  where result.run_id = new.run_id
    and result.source_id = new.source_id
    and result.endpoint_id = new.endpoint_id
    and result.outcome = 'complete'
    and result.west = new.west
    and result.south = new.south
    and result.east = new.east
    and result.north = new.north
    and result.date_from = new.date_from
    and result.date_to = new.date_to
    and result.day_count = new.day_count
    and result.date_request_mode = new.date_request_mode
    and result.schema_rejection_count = 0
    and result.lineage_gap_count = 0
    and result.completed_at <= new.known_at;

  select count(*)::integer
    into exchange_rows
  from ingest.http_exchanges as exchange
  where exchange.run_id = new.run_id;

  if result_rows <> 4
    or product_names is distinct from new.completed_products
    or returned_rows is distinct from new.returned_row_count
    or accepted_rows is distinct from new.accepted_row_count
    or exchange_rows <> 4
    or exists (
      select 1
      from ingest.http_exchanges as exchange
      where exchange.run_id = new.run_id
        and not exists (
          select 1
          from ingest.firms_query_product_results as result
          where result.run_id = new.run_id
            and result.http_exchange_id = exchange.id
        )
    )
    or exists (
      select 1
      from ingest.firms_response_rows as response_row
      where response_row.run_id = new.run_id
        and response_row.disposition = 'rejected'
    )
  then
    raise exception 'FIRMS completion requires all four exact product responses and matching immutable counts'
      using errcode = '23514';
  end if;

  return null;
end;
$$;

revoke execute on function ingest.require_complete_firms_product_set()
  from public, anon, authenticated, service_role,
  firewatch_catalog_admin, firewatch_collector, firewatch_reconciler,
  firewatch_publisher, firewatch_dispatcher;

create constraint trigger firms_query_completions_require_product_set
after insert on ingest.firms_query_completions
deferrable initially deferred
for each row execute function ingest.require_complete_firms_product_set();

create trigger firms_query_completions_reject_mutation
before update or delete on ingest.firms_query_completions
for each row execute function core.reject_mutation();

create table truth.thermal_anomaly_assessments (
  cursor bigint generated always as identity primary key,
  public_id core.uuid_v7 not null unique,
  contract_version text not null check (contract_version = '1.1.0'),
  original_detection_id bigint not null
    references ingest.firms_detection_details(id),
  basis_detection_id bigint not null
    references ingest.firms_detection_details(id),
  version_no bigint not null check (version_no > 0),
  previous_assessment_cursor bigint unique
    references truth.thermal_anomaly_assessments(cursor),
  assessment_state text not null check (assessment_state in (
    'detected', 'awaiting_later_assessment', 'unknown'
  )),
  reason_code text not null check (reason_code in (
    'firms_detection_observed',
    'awaiting_later_complete_pass',
    'cmr_coverage_only_anomaly_not_assessed',
    'sensor_assessability_unknown',
    'firms_response_incomplete',
    'firms_response_stale',
    'firms_source_unconfigured',
    'schema_or_lineage_gap',
    'operator_withheld'
  )),
  firms_completion_health_cursor bigint
    references ingest.firms_query_completions(health_cursor),
  cmr_observation_cursor bigint
    references ingest.global_observations(cursor),
  failed_product_result_id bigint
    references ingest.firms_query_product_results(id),
  rule_id text not null check (
    rule_id ~ '^[a-z0-9]+([._-][a-z0-9]+)*$'
  ),
  rule_version text not null check (
    rule_version ~ '^[0-9]+\.[0-9]+\.[0-9]+$'
  ),
  as_of timestamptz not null,
  known_at timestamptz not null,
  claim_kind text not null check (
    claim_kind = 'thermal_anomaly_observation_only'
  ),
  operational_effect text not null check (operational_effect = 'none'),
  notification_eligible boolean generated always as (false) stored,
  official_status_eligible boolean generated always as (false) stored,
  protective_action_eligible boolean generated always as (false) stored,
  incident_resolution_eligible boolean generated always as (false) stored,
  limitations text[] not null,
  recorded_at timestamptz not null default now(),
  constraint thermal_anomaly_assessments_detection_version_key
    unique (original_detection_id, version_no),
  constraint thermal_anomaly_assessments_time_check check (
    as_of <= known_at and known_at <= recorded_at
  ),
  constraint thermal_anomaly_assessments_chain_shape_check check (
    (version_no = 1 and previous_assessment_cursor is null)
    or (version_no > 1 and previous_assessment_cursor is not null)
  ),
  constraint thermal_anomaly_assessments_state_shape_check check (
    (assessment_state = 'detected'
      and reason_code = 'firms_detection_observed'
      and firms_completion_health_cursor is null
      and cmr_observation_cursor is null
      and failed_product_result_id is null)
    or (assessment_state = 'awaiting_later_assessment'
      and reason_code in (
        'awaiting_later_complete_pass',
        'cmr_coverage_only_anomaly_not_assessed',
        'sensor_assessability_unknown'
      )
      and failed_product_result_id is null)
    or (assessment_state = 'unknown'
      and reason_code in (
        'sensor_assessability_unknown',
        'firms_response_incomplete',
        'firms_response_stale',
        'firms_source_unconfigured',
        'schema_or_lineage_gap',
        'operator_withheld'
      ))
  ),
  constraint thermal_anomaly_assessments_cmr_semantics_check check (
    (reason_code = 'cmr_coverage_only_anomaly_not_assessed'
      and cmr_observation_cursor is not null)
    or (reason_code <> 'cmr_coverage_only_anomaly_not_assessed'
      and cmr_observation_cursor is null)
  ),
  constraint thermal_anomaly_assessments_failed_result_check check (
    (reason_code in (
        'firms_response_incomplete',
        'schema_or_lineage_gap'
      ) and failed_product_result_id is not null)
    or (reason_code not in (
        'firms_response_incomplete',
        'schema_or_lineage_gap'
      ) and failed_product_result_id is null)
  ),
  constraint thermal_anomaly_assessments_completion_check check (
    (reason_code in ('sensor_assessability_unknown', 'firms_response_stale')
      and firms_completion_health_cursor is not null)
    or (reason_code not in (
        'sensor_assessability_unknown', 'firms_response_stale'
      ) and firms_completion_health_cursor is null)
  ),
  constraint thermal_anomaly_assessments_limitations_check check (
    limitations @> array[
      'thermal_detection_not_incident_confirmation',
      'cmr_catalog_metadata_does_not_assess_anomalies',
      'sensor_assessability_unknown',
      'not_official_status',
      'not_protective_guidance',
      'not_containment_statement',
      'not_incident_resolution',
      'not_all_clear'
    ]::text[]
  )
);

create index thermal_anomaly_assessments_detection_as_of_idx
  on truth.thermal_anomaly_assessments(
    original_detection_id, as_of desc, version_no desc, cursor desc
  );
create index thermal_anomaly_assessments_state_known_idx
  on truth.thermal_anomaly_assessments(
    assessment_state, known_at desc, cursor desc
  );
create index thermal_anomaly_assessments_basis_detection_idx
  on truth.thermal_anomaly_assessments(basis_detection_id);
create index thermal_anomaly_assessments_completion_idx
  on truth.thermal_anomaly_assessments(firms_completion_health_cursor)
  where firms_completion_health_cursor is not null;
create index thermal_anomaly_assessments_cmr_observation_idx
  on truth.thermal_anomaly_assessments(cmr_observation_cursor)
  where cmr_observation_cursor is not null;
create index thermal_anomaly_assessments_failed_result_idx
  on truth.thermal_anomaly_assessments(failed_product_result_id)
  where failed_product_result_id is not null;

comment on table truth.thermal_anomaly_assessments is
  'Private append-only lifecycle for one immutable FIRMS detection. Contract 1.1.0 deliberately has no negative/resolved/all-clear state because unobscured sensor assessability is not yet proven.';

create or replace function truth.validate_thermal_anomaly_assessment()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  original_record record;
  basis_record record;
  previous_record record;
  failed_result_record record;
  completion_record record;
begin
  select
    detail.id,
    detail.original_detail_id,
    detail.version_no,
    detail.source_id,
    detail.product_id,
    detail.product_key,
    detail.acquired_at,
    detail.retrieved_at,
    detail.centroid_geog,
    detail.modeled_support_radius_m,
    product.assessment_enabled,
    product.cmr_product
  into original_record
  from ingest.firms_detection_details as detail
  join core.firms_products as product on product.id = detail.product_id
  where detail.id = new.original_detection_id;

  if not found
    or original_record.version_no <> 1
    or original_record.original_detail_id <> original_record.id
    or not original_record.assessment_enabled
  then
    raise exception 'assessment requires an assessment-enabled original FIRMS detection'
      using errcode = '23514';
  end if;

  select
    detail.id,
    detail.original_detail_id,
    detail.source_id,
    detail.product_id,
    detail.product_key,
    detail.acquired_at,
    detail.retrieved_at,
    detail.centroid_geog,
    detail.modeled_support_radius_m
  into basis_record
  from ingest.firms_detection_details as detail
  where detail.id = new.basis_detection_id;

  if not found
    or basis_record.original_detail_id <> new.original_detection_id
    or basis_record.source_id <> original_record.source_id
    or basis_record.product_id <> original_record.product_id
    or new.as_of < basis_record.acquired_at
    or new.known_at < basis_record.retrieved_at
  then
    raise exception 'assessment basis must be a known revision of the original detection'
      using errcode = '23514';
  end if;

  if new.version_no = 1 then
    if new.assessment_state <> 'detected'
      or new.basis_detection_id <> new.original_detection_id
    then
      raise exception 'first assessment records the original FIRMS detection'
        using errcode = '23514';
    end if;
  else
    select assessment.*
      into previous_record
    from truth.thermal_anomaly_assessments as assessment
    where assessment.cursor = new.previous_assessment_cursor;

    if not found
      or previous_record.original_detection_id <> new.original_detection_id
      or previous_record.version_no + 1 <> new.version_no
      or new.as_of < previous_record.as_of
      or new.known_at < previous_record.known_at
    then
      raise exception 'assessment must extend one monotonic detection lifecycle'
        using errcode = '23514';
    end if;
  end if;

  if new.firms_completion_health_cursor is not null then
    select
      completion.source_id,
      completion.known_at,
      completion.freshness_deadline,
      completion.negative_assessment_eligible,
      completion.sensor_assessability,
      completion.requested_bbox_geom,
      completion.date_to
    into completion_record
    from ingest.firms_query_completions as completion
    where completion.health_cursor = new.firms_completion_health_cursor
      and completion.source_id = original_record.source_id;

    if not found
      or completion_record.known_at > new.known_at
      or completion_record.negative_assessment_eligible
      or completion_record.sensor_assessability <> 'unknown'
      or completion_record.date_to
        < (basis_record.acquired_at at time zone 'UTC')::date
      or not extensions.st_covers(
        completion_record.requested_bbox_geom,
        extensions.st_buffer(
          basis_record.centroid_geog,
          basis_record.modeled_support_radius_m
        )::extensions.geometry
      )
      or (new.reason_code = 'firms_response_stale'
        and completion_record.freshness_deadline > new.known_at)
      or (new.reason_code = 'sensor_assessability_unknown'
        and completion_record.freshness_deadline <= new.known_at)
    then
      raise exception 'assessment FIRMS completion must match its fresh sensor-unknown or stale reason'
        using errcode = '23514';
    end if;
  end if;

  if new.failed_product_result_id is not null then
    select
      result.source_id,
      result.outcome,
      result.schema_rejection_count,
      result.lineage_gap_count,
      result.requested_bbox_geom,
      result.date_to,
      result.recorded_at
      into failed_result_record
    from ingest.firms_query_product_results as result
    where result.id = new.failed_product_result_id;

    if not found
      or failed_result_record.source_id <> original_record.source_id
      or failed_result_record.outcome = 'complete'
      or failed_result_record.recorded_at > new.known_at
      or failed_result_record.date_to
        < (basis_record.acquired_at at time zone 'UTC')::date
      or not extensions.st_covers(
        failed_result_record.requested_bbox_geom,
        extensions.st_buffer(
          basis_record.centroid_geog,
          basis_record.modeled_support_radius_m
        )::extensions.geometry
      )
      or (new.reason_code = 'schema_or_lineage_gap'
        and failed_result_record.schema_rejection_count = 0
        and failed_result_record.lineage_gap_count = 0)
    then
      raise exception 'unknown assessment may reference only a known incomplete FIRMS result'
        using errcode = '23514';
    end if;
  end if;

  if new.cmr_observation_cursor is not null then
    if original_record.cmr_product is null
      or not exists (
        select 1
        from ingest.global_observations as observation
        join core.sources as source on source.id = observation.source_id
        join ingest.cmr_granule_details as detail
          on detail.observation_cursor = observation.cursor
        join ingest.cmr_granule_occurrences as occurrence
          on occurrence.observation_cursor = observation.cursor
        join ingest.cmr_scan_completions as completion
          on completion.run_id = occurrence.run_id
        join truth.source_health as health
          on health.cursor = completion.health_cursor
          and health.run_id = completion.run_id
        where observation.cursor = new.cmr_observation_cursor
          and source.slug = 'nasa-cmr-firemask'
          and detail.product = original_record.cmr_product
          and detail.observed_to > basis_record.acquired_at
          and detail.observed_to <= new.as_of
          and observation.ingested_at <= new.known_at
          and observation.validation_state = 'accepted'
          and observation.observation_kind = 'satellite_imagery'
          and observation.evidence_class = 'satellite_pass_metadata'
          and observation.quality_flags @> array[
            'catalog_metadata_only', 'anomaly_not_assessed'
          ]::text[]
          and observation.geom is not null
          and extensions.st_covers(
            observation.geom,
            extensions.st_buffer(
              basis_record.centroid_geog,
              basis_record.modeled_support_radius_m
            )::extensions.geometry
          )
          and health.status = 'healthy'
          and health.error_class is null
          and health.schema_failure_count = 0
      )
    then
      raise exception 'CMR context must be a later complete same-platform catalog pass covering modeled support'
        using errcode = '23514';
    end if;
  end if;

  new.recorded_at := now();
  return new;
end;
$$;

revoke execute on function truth.validate_thermal_anomaly_assessment()
  from public, anon, authenticated, service_role,
  firewatch_catalog_admin, firewatch_collector, firewatch_reconciler,
  firewatch_publisher, firewatch_dispatcher;

create trigger thermal_anomaly_assessments_validate
before insert on truth.thermal_anomaly_assessments
for each row execute function truth.validate_thermal_anomaly_assessment();

create trigger thermal_anomaly_assessments_reject_mutation
before update or delete on truth.thermal_anomaly_assessments
for each row execute function core.reject_mutation();

-- Private capability boundary. No service-role shortcut and no public view.
alter table core.firms_products enable row level security;
alter table core.firms_products force row level security;
alter table ingest.firms_detection_details enable row level security;
alter table ingest.firms_detection_details force row level security;
alter table ingest.firms_response_rows enable row level security;
alter table ingest.firms_response_rows force row level security;
alter table ingest.firms_query_product_results enable row level security;
alter table ingest.firms_query_product_results force row level security;
alter table ingest.firms_query_completions enable row level security;
alter table ingest.firms_query_completions force row level security;
alter table truth.thermal_anomaly_assessments enable row level security;
alter table truth.thermal_anomaly_assessments force row level security;

revoke all on core.firms_products
  from public, anon, authenticated, service_role,
  firewatch_catalog_admin, firewatch_collector, firewatch_reconciler,
  firewatch_publisher, firewatch_dispatcher;
revoke all on ingest.firms_detection_details,
  ingest.firms_response_rows,
  ingest.firms_query_product_results,
  ingest.firms_query_completions
  from public, anon, authenticated, service_role,
  firewatch_catalog_admin, firewatch_collector, firewatch_reconciler,
  firewatch_publisher, firewatch_dispatcher;
revoke all on truth.thermal_anomaly_assessments
  from public, anon, authenticated, service_role,
  firewatch_catalog_admin, firewatch_collector, firewatch_reconciler,
  firewatch_publisher, firewatch_dispatcher;

revoke all on sequence core.firms_products_id_seq,
  ingest.firms_detection_details_id_seq,
  ingest.firms_query_product_results_id_seq,
  truth.thermal_anomaly_assessments_cursor_seq
  from public, anon, authenticated, service_role,
  firewatch_catalog_admin, firewatch_collector, firewatch_reconciler,
  firewatch_publisher, firewatch_dispatcher;

create policy firms_products_catalog_admin_all
on core.firms_products for all to firewatch_catalog_admin
using (true) with check (true);
create policy firms_products_collector_read
on core.firms_products for select to firewatch_collector using (true);
create policy firms_products_reconciler_read
on core.firms_products for select to firewatch_reconciler using (true);

create policy firms_detection_details_collector_read
on ingest.firms_detection_details for select to firewatch_collector using (true);
create policy firms_detection_details_collector_insert
on ingest.firms_detection_details for insert to firewatch_collector
with check (true);
create policy firms_detection_details_reconciler_read
on ingest.firms_detection_details for select to firewatch_reconciler using (true);

create policy firms_response_rows_collector_read
on ingest.firms_response_rows for select to firewatch_collector using (true);
create policy firms_response_rows_collector_insert
on ingest.firms_response_rows for insert to firewatch_collector with check (true);
create policy firms_response_rows_reconciler_read
on ingest.firms_response_rows for select to firewatch_reconciler using (true);

create policy firms_query_product_results_collector_read
on ingest.firms_query_product_results for select to firewatch_collector using (true);
create policy firms_query_product_results_collector_insert
on ingest.firms_query_product_results for insert to firewatch_collector
with check (true);
create policy firms_query_product_results_reconciler_read
on ingest.firms_query_product_results for select to firewatch_reconciler using (true);

create policy firms_query_completions_collector_read
on ingest.firms_query_completions for select to firewatch_collector using (true);
create policy firms_query_completions_collector_insert
on ingest.firms_query_completions for insert to firewatch_collector with check (true);
create policy firms_query_completions_reconciler_read
on ingest.firms_query_completions for select to firewatch_reconciler using (true);

create policy thermal_anomaly_assessments_reconciler_read
on truth.thermal_anomaly_assessments for select to firewatch_reconciler using (true);
create policy thermal_anomaly_assessments_reconciler_insert
on truth.thermal_anomaly_assessments for insert to firewatch_reconciler
with check (true);

grant select, insert, update on core.firms_products to firewatch_catalog_admin;
grant select on core.firms_products to firewatch_collector, firewatch_reconciler;
grant usage, select on sequence core.firms_products_id_seq
  to firewatch_catalog_admin;

grant select, insert on ingest.firms_detection_details,
  ingest.firms_response_rows,
  ingest.firms_query_product_results,
  ingest.firms_query_completions
  to firewatch_collector;
grant select on ingest.firms_detection_details,
  ingest.firms_response_rows,
  ingest.firms_query_product_results,
  ingest.firms_query_completions
  to firewatch_reconciler;
grant usage, select on sequence ingest.firms_detection_details_id_seq,
  ingest.firms_query_product_results_id_seq
  to firewatch_collector;

grant select, insert on truth.thermal_anomaly_assessments
  to firewatch_reconciler;
grant usage, select on sequence truth.thermal_anomaly_assessments_cursor_seq
  to firewatch_reconciler;
