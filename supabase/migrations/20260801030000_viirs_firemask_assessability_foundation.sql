-- Private VIIRS Collection 2 FireMask assessability foundation.
--
-- This migration deliberately creates no Earthdata asset source, endpoint,
-- adapter, target, RPC, schedule, or public projection. Asset insertion is
-- rejected until a later reviewed migration creates and activates the exact
-- `nasa-earthdata-viirs-firemask-assets` lineage. Nothing here can resolve an
-- incident, suppress a FIRMS detection, notify a user, or assert an all-clear.

-- The current CMR collector parses this distinction but legacy persistence did
-- not retain it. Keep legacy rows null and therefore ineligible; a later
-- collector revision must append the exact source on newly ingested revisions.
alter table ingest.cmr_granule_details
  add column footprint_source text
  constraint cmr_granule_details_footprint_source_check check (
    footprint_source in ('umm-g-gpolygon', 'umm-g-bounding-rectangle')
  );

comment on column ingest.cmr_granule_details.footprint_source is
  'Exact UMM-G horizontal geometry encoding. Null means legacy provenance was not persisted and is ineligible for FireMask assessability.';

create table core.viirs_firemask_product_profiles (
  public_id core.uuid_v7 not null unique,
  contract_version text not null check (contract_version = '0.1.0-internal'),
  firms_product_id bigint not null unique,
  firms_source_id bigint not null,
  firms_product text primary key check (firms_product in (
    'VIIRS_SNPP_NRT', 'VIIRS_NOAA20_NRT', 'VIIRS_NOAA21_NRT'
  )),
  firms_product_key text generated always as (firms_product) stored,
  firemask_product text not null unique check (firemask_product in (
    'VNP14IMG', 'VJ114IMG', 'VJ214IMG'
  )),
  geolocation_product text not null unique check (geolocation_product in (
    'VNP03IMG', 'VJ103IMG', 'VJ203IMG'
  )),
  cmr_catalog_product text not null unique check (cmr_catalog_product in (
    'VNP14IMG_NRT', 'VJ114IMG_NRT', 'VJ214IMG_NRT'
  )),
  platform text not null unique check (platform in (
    'Suomi-NPP', 'NOAA-20', 'NOAA-21'
  )),
  satellite text generated always as (platform) stored,
  firemask_collection_file_version text not null check (
    firemask_collection_file_version = '002'
  ),
  geolocation_collection_file_version text not null check (
    geolocation_collection_file_version in ('002', '021')
  ),
  firemask_geolocation_attribute_name text generated always as (
    geolocation_product
  ) stored,
  assessment_enabled boolean generated always as (false) stored,
  limitations text[] not null check (limitations @> array[
    'internal_evidence_only',
    'cmr_catalog_metadata_not_pixel_assessment',
    'product_profile_not_activation',
    'not_negative_assessment',
    'not_incident_resolution',
    'not_all_clear'
  ]::text[]),
  created_at timestamptz not null default now(),
  constraint viirs_firemask_product_profiles_firms_registry_fkey
    foreign key (firms_product_id, firms_source_id, firms_product)
    references core.firms_products(id, source_id, product_key),
  constraint viirs_firemask_product_profiles_exact_pair_check check (
    (firms_product = 'VIIRS_SNPP_NRT'
      and firemask_product = 'VNP14IMG'
      and geolocation_product = 'VNP03IMG'
      and cmr_catalog_product = 'VNP14IMG_NRT'
      and platform = 'Suomi-NPP'
      and firemask_collection_file_version = '002'
      and geolocation_collection_file_version = '002')
    or (firms_product = 'VIIRS_NOAA20_NRT'
      and firemask_product = 'VJ114IMG'
      and geolocation_product = 'VJ103IMG'
      and cmr_catalog_product = 'VJ114IMG_NRT'
      and platform = 'NOAA-20'
      and firemask_collection_file_version = '002'
      and geolocation_collection_file_version = '021')
    or (firms_product = 'VIIRS_NOAA21_NRT'
      and firemask_product = 'VJ214IMG'
      and geolocation_product = 'VJ203IMG'
      and cmr_catalog_product = 'VJ214IMG_NRT'
      and platform = 'NOAA-21'
      and firemask_collection_file_version = '002'
      and geolocation_collection_file_version = '021')
  )
);

insert into core.viirs_firemask_product_profiles (
  public_id, contract_version, firms_product_id, firms_source_id,
  firms_product, firemask_product, geolocation_product,
  cmr_catalog_product, platform, firemask_collection_file_version,
  geolocation_collection_file_version, limitations
)
select
  mapping.public_id::core.uuid_v7,
  '0.1.0-internal',
  product.id,
  product.source_id,
  product.product_key,
  mapping.firemask_product,
  mapping.geolocation_product,
  mapping.cmr_catalog_product,
  mapping.platform,
  mapping.firemask_collection_file_version,
  mapping.geolocation_collection_file_version,
  array[
    'internal_evidence_only',
    'cmr_catalog_metadata_not_pixel_assessment',
    'product_profile_not_activation',
    'not_negative_assessment',
    'not_incident_resolution',
    'not_all_clear'
  ]::text[]
from (values
  ('018f0000-0000-7000-8000-000000000601',
    'VIIRS_SNPP_NRT', 'VNP14IMG', 'VNP03IMG', 'VNP14IMG_NRT', 'Suomi-NPP',
    '002', '002'),
  ('018f0000-0000-7000-8000-000000000602',
    'VIIRS_NOAA20_NRT', 'VJ114IMG', 'VJ103IMG', 'VJ114IMG_NRT', 'NOAA-20',
    '002', '021'),
  ('018f0000-0000-7000-8000-000000000603',
    'VIIRS_NOAA21_NRT', 'VJ214IMG', 'VJ203IMG', 'VJ214IMG_NRT', 'NOAA-21',
    '002', '021')
) as mapping(
  public_id, firms_product, firemask_product, geolocation_product,
  cmr_catalog_product, platform, firemask_collection_file_version,
  geolocation_collection_file_version
)
join core.firms_products as product
  on product.product_key = mapping.firms_product;

do $$
begin
  if (select count(*) from core.viirs_firemask_product_profiles) <> 3 then
    raise exception 'VIIRS FireMask foundation requires all three reviewed FIRMS product profiles'
      using errcode = '23514';
  end if;
end;
$$;

create index viirs_firemask_product_profiles_firms_source_idx
  on core.viirs_firemask_product_profiles(firms_source_id, firms_product);

create trigger viirs_firemask_product_profiles_reject_mutation
before update or delete on core.viirs_firemask_product_profiles
for each row execute function core.reject_mutation();

comment on table core.viirs_firemask_product_profiles is
  'Immutable reviewed VIIRS/FIRMS/FireMask/geolocation mappings. assessment_enabled is generated false until a later activation migration changes the contract.';

create table ingest.viirs_firemask_asset_pairs (
  id bigint generated always as identity primary key,
  public_id core.uuid_v7 not null unique,
  contract_version text not null check (contract_version = '0.1.0-internal'),
  firms_product text not null
    references core.viirs_firemask_product_profiles(firms_product),
  firemask_product text not null,
  geolocation_product text not null,
  platform text not null,
  cmr_observation_cursor bigint not null
    references ingest.cmr_granule_details(observation_cursor),
  cmr_catalog_granule_id text not null
    check (cmr_catalog_granule_id ~ '^G[0-9]+-[A-Za-z0-9_-]+$'),
  cmr_footprint_source text not null
  constraint viirs_firemask_asset_pairs_cmr_footprint_source_check check (
    cmr_footprint_source = 'umm-g-gpolygon'
  ),
  firemask_local_granule_id text not null check (
    btrim(firemask_local_granule_id) <> ''
    and char_length(firemask_local_granule_id) <= 512
  ),
  geolocation_local_granule_id text not null check (
    btrim(geolocation_local_granule_id) <> ''
    and char_length(geolocation_local_granule_id) <= 512
  ),
  firemask_input_pointer text not null check (
    btrim(firemask_input_pointer) <> ''
    and char_length(firemask_input_pointer) <= 8192
  ),
  firemask_geolocation_attribute_name text generated always as (
    geolocation_product
  ) stored,
  firemask_geolocation_attribute_value text not null check (
    btrim(firemask_geolocation_attribute_value) <> ''
    and char_length(firemask_geolocation_attribute_value) <= 512
  ),
  firemask_collection_file_version text not null check (
    firemask_collection_file_version = '002'
  ),
  geolocation_collection_file_version text not null check (
    geolocation_collection_file_version in ('002', '021')
  ),
  firemask_observed_from timestamptz not null,
  firemask_observed_to timestamptz not null,
  geolocation_observed_from timestamptz not null,
  geolocation_observed_to timestamptz not null,
  firemask_algorithm_version text not null check (
    btrim(firemask_algorithm_version) <> ''
    and char_length(firemask_algorithm_version) <= 128
  ),
  firemask_pge_version text not null check (
    btrim(firemask_pge_version) <> ''
    and char_length(firemask_pge_version) <= 128
  ),
  firemask_process_version text not null check (
    btrim(firemask_process_version) <> ''
    and char_length(firemask_process_version) <= 128
  ),
  geolocation_pge_version text not null check (
    btrim(geolocation_pge_version) <> ''
    and char_length(geolocation_pge_version) <= 128
  ),
  geolocation_process_version text not null check (
    btrim(geolocation_process_version) <> ''
    and char_length(geolocation_process_version) <= 128
  ),
  geolocation_coordinate_storage_type text not null
    constraint viirs_firemask_asset_pairs_coordinate_storage_type_check check (
      geolocation_coordinate_storage_type = 'float32'
  ),
  geolocation_latitude_fill_value double precision not null check (
    geolocation_latitude_fill_value not in (
      'NaN'::double precision,
      'Infinity'::double precision,
      '-Infinity'::double precision
    )
  ),
  geolocation_longitude_fill_value double precision not null check (
    geolocation_longitude_fill_value not in (
      'NaN'::double precision,
      'Infinity'::double precision,
      '-Infinity'::double precision
    )
  ),
  geolocation_latitude_fill_ieee754_hex text not null,
  geolocation_longitude_fill_ieee754_hex text not null,
  source_id bigint not null references core.sources(id),
  endpoint_id bigint not null,
  run_id bigint not null,
  adapter_release_id bigint not null,
  firemask_http_exchange_id bigint not null,
  firemask_raw_object_id bigint not null unique,
  firemask_content_sha256 text not null check (
    firemask_content_sha256 ~ '^[a-f0-9]{64}$'
  ),
  geolocation_http_exchange_id bigint not null,
  geolocation_raw_object_id bigint not null unique,
  geolocation_content_sha256 text not null check (
    geolocation_content_sha256 ~ '^[a-f0-9]{64}$'
  ),
  lease_token uuid not null,
  lease_owner text not null check (btrim(lease_owner) <> ''),
  known_at timestamptz not null,
  limitations text[] not null check (limitations @> array[
    'internal_evidence_only',
    'exact_firemask_geolocation_pair',
    'raw_asset_bytes_private',
    'source_declared_fill_values_persisted',
    'cmr_catalog_metadata_not_pixel_assessment',
    'pair_is_not_negative_assessment',
    'not_official_status',
    'not_protective_guidance',
    'not_incident_resolution',
    'not_all_clear'
  ]::text[]),
  recorded_at timestamptz not null default now(),
  constraint viirs_firemask_asset_pairs_exact_identity_key unique (
    cmr_observation_cursor, firms_product,
    firemask_local_granule_id, geolocation_local_granule_id,
    firemask_content_sha256, geolocation_content_sha256
  ),
  constraint viirs_firemask_asset_pairs_distinct_raw_check check (
    firemask_raw_object_id <> geolocation_raw_object_id
    and firemask_http_exchange_id <> geolocation_http_exchange_id
    and firemask_content_sha256 <> geolocation_content_sha256
  ),
  constraint viirs_firemask_asset_pairs_geolocation_attribute_check check (
    firemask_geolocation_attribute_value = geolocation_local_granule_id
  ),
  constraint viirs_firemask_asset_pairs_local_ids_check check (
    firemask_local_granule_id
      ~ '^[A-Z0-9]+\.A[0-9]{7}\.[0-9]{4}\.[0-9]{3}\.[0-9]{13}\.nc$'
    and geolocation_local_granule_id
      ~ '^[A-Z0-9]+\.A[0-9]{7}\.[0-9]{4}\.[0-9]{3}\.[0-9]{13}\.nc$'
    and pg_catalog.split_part(firemask_local_granule_id, '.', 1)
      = firemask_product
    and pg_catalog.split_part(geolocation_local_granule_id, '.', 1)
      = geolocation_product
    and pg_catalog.split_part(firemask_local_granule_id, '.', 4)
      = firemask_collection_file_version
    and pg_catalog.split_part(geolocation_local_granule_id, '.', 4)
      = geolocation_collection_file_version
    and pg_catalog.split_part(firemask_local_granule_id, '.', 2)
      = 'A' || pg_catalog.to_char(
        firemask_observed_from at time zone 'UTC', 'YYYYDDD'
      )
    and pg_catalog.split_part(geolocation_local_granule_id, '.', 2)
      = 'A' || pg_catalog.to_char(
        geolocation_observed_from at time zone 'UTC', 'YYYYDDD'
      )
    and pg_catalog.split_part(firemask_local_granule_id, '.', 3)
      = pg_catalog.to_char(
        firemask_observed_from at time zone 'UTC', 'HH24MI'
      )
    and pg_catalog.split_part(geolocation_local_granule_id, '.', 3)
      = pg_catalog.to_char(
        geolocation_observed_from at time zone 'UTC', 'HH24MI'
      )
    and pg_catalog.split_part(firemask_local_granule_id, '.', 2)
      = pg_catalog.split_part(geolocation_local_granule_id, '.', 2)
    and pg_catalog.split_part(firemask_local_granule_id, '.', 3)
      = pg_catalog.split_part(geolocation_local_granule_id, '.', 3)
  ),
  constraint viirs_firemask_asset_pairs_fill_bits_check check (
    geolocation_latitude_fill_ieee754_hex ~ '^[a-f0-9]{8}$'
    and geolocation_longitude_fill_ieee754_hex ~ '^[a-f0-9]{8}$'
    and geolocation_latitude_fill_value =
      geolocation_latitude_fill_value::real::double precision
    and geolocation_longitude_fill_value =
      geolocation_longitude_fill_value::real::double precision
    and geolocation_latitude_fill_ieee754_hex = pg_catalog.encode(
      pg_catalog.float4send(geolocation_latitude_fill_value::real), 'hex'
    )
    and geolocation_longitude_fill_ieee754_hex = pg_catalog.encode(
      pg_catalog.float4send(geolocation_longitude_fill_value::real), 'hex'
    )
  ),
  constraint viirs_firemask_asset_pairs_intervals_check check (
    firemask_observed_to >= firemask_observed_from
    and geolocation_observed_to >= geolocation_observed_from
    and firemask_observed_from = geolocation_observed_from
    and firemask_observed_to = geolocation_observed_to
    and firemask_observed_to <= known_at
    and geolocation_observed_to <= known_at
  ),
  constraint viirs_firemask_asset_pairs_recorded_check check (
    known_at <= recorded_at
  ),
  constraint viirs_firemask_asset_pairs_run_adapter_fkey
    foreign key (run_id, source_id, adapter_release_id)
    references ingest.runs(id, source_id, adapter_release_id),
  constraint viirs_firemask_asset_pairs_endpoint_source_fkey
    foreign key (endpoint_id, source_id)
    references core.endpoints(id, source_id),
  constraint viirs_firemask_asset_pairs_firemask_raw_fkey
    foreign key (
      firemask_raw_object_id, firemask_http_exchange_id,
      run_id, source_id, endpoint_id
    ) references ingest.raw_objects(
      id, http_exchange_id, run_id, source_id, endpoint_id
    ),
  constraint viirs_firemask_asset_pairs_geolocation_raw_fkey
    foreign key (
      geolocation_raw_object_id, geolocation_http_exchange_id,
      run_id, source_id, endpoint_id
    ) references ingest.raw_objects(
      id, http_exchange_id, run_id, source_id, endpoint_id
    )
);

create index viirs_firemask_asset_pairs_firms_product_idx
  on ingest.viirs_firemask_asset_pairs(firms_product);
create index viirs_firemask_asset_pairs_source_idx
  on ingest.viirs_firemask_asset_pairs(source_id);
create index viirs_firemask_asset_pairs_run_adapter_idx
  on ingest.viirs_firemask_asset_pairs(run_id, source_id, adapter_release_id);
create index viirs_firemask_asset_pairs_endpoint_source_idx
  on ingest.viirs_firemask_asset_pairs(endpoint_id, source_id);
create index viirs_firemask_asset_pairs_observed_idx
  on ingest.viirs_firemask_asset_pairs(
    firemask_observed_to desc, cmr_observation_cursor desc
  );

create or replace function ingest.validate_viirs_firemask_asset_pair()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  profile_record record;
  context_record record;
begin
  -- Server-owned evidence time: callers cannot backdate immutable pairs.
  new.recorded_at := clock_timestamp();

  select
    profile.firemask_product as expected_firemask_product,
    profile.geolocation_product as expected_geolocation_product,
    profile.platform as expected_platform,
    profile.cmr_catalog_product as expected_cmr_product,
    profile.firemask_collection_file_version
      as expected_firemask_collection_file_version,
    profile.geolocation_collection_file_version
      as expected_geolocation_collection_file_version,
    profile.assessment_enabled
  into profile_record
  from core.viirs_firemask_product_profiles as profile
  where profile.firms_product = new.firms_product;

  if not found then
    raise exception 'VIIRS asset pair requires a reviewed FIRMS product profile'
      using errcode = '23514';
  end if;

  -- Contract 0.1 is a hard schema gate, not an operational toggle. This check
  -- deliberately precedes every external-lineage lookup so it remains a
  -- behaviorally testable fail-closed boundary.
  if not profile_record.assessment_enabled then
    raise exception 'VIIRS asset collection is disabled in contract 0.1.0-internal'
      using errcode = '55000';
  end if;

  select
    detail.catalog_granule_id,
    detail.footprint_source as cmr_footprint_source,
    detail.product as cmr_product,
    detail.product_version as cmr_product_version,
    detail.satellite as cmr_platform,
    detail.observed_to as cmr_observed_to,
    cmr_observation.observed_at as cmr_observed_from,
    cmr_observation.ingested_at as cmr_known_at,
    cmr_observation.validation_state as cmr_validation_state,
    cmr_observation.geom as cmr_coverage_geom,
    cmr_source.slug as cmr_source_slug,
    asset_source.slug as asset_source_slug,
    asset_source.enabled as asset_source_enabled,
    asset_source.license_status as asset_license_status,
    asset_source.sensitivity as asset_sensitivity,
    asset_source.is_public as asset_source_is_public,
    adapter.schema_version as adapter_schema_version,
    run.status as run_status,
    run.lease_token as run_lease_token,
    run.lease_owner as run_lease_owner,
    job.status as job_status,
    job.lease_token as job_lease_token,
    job.lease_owner as job_lease_owner,
    job.lease_expires_at,
    fire_raw.content_sha256 as fire_raw_sha256,
    fire_raw.source_observed_at as fire_raw_observed_at,
    fire_raw.retrieved_at as fire_raw_retrieved_at,
    geo_raw.content_sha256 as geo_raw_sha256,
    geo_raw.source_observed_at as geo_raw_observed_at,
    geo_raw.retrieved_at as geo_raw_retrieved_at,
    fire_exchange.outcome as fire_exchange_outcome,
    fire_exchange.http_status as fire_http_status,
    fire_exchange.response_raw_object_id as fire_response_raw_object_id,
    fire_exchange.completed_at as fire_exchange_completed_at,
    geo_exchange.outcome as geo_exchange_outcome,
    geo_exchange.http_status as geo_http_status,
    geo_exchange.response_raw_object_id as geo_response_raw_object_id,
    geo_exchange.completed_at as geo_exchange_completed_at
  into context_record
  from ingest.cmr_granule_details as detail
  join ingest.global_observations as cmr_observation
    on cmr_observation.cursor = detail.observation_cursor
  join core.sources as cmr_source
    on cmr_source.id = cmr_observation.source_id
  join core.sources as asset_source on asset_source.id = new.source_id
  join ingest.runs as run
    on run.id = new.run_id
    and run.source_id = new.source_id
    and run.endpoint_id = new.endpoint_id
    and run.adapter_release_id = new.adapter_release_id
  join ingest.jobs as job on job.id = run.job_id
  join core.adapter_releases as adapter
    on adapter.id = new.adapter_release_id
    and adapter.source_id = new.source_id
  join ingest.raw_objects as fire_raw
    on fire_raw.id = new.firemask_raw_object_id
  join ingest.raw_objects as geo_raw
    on geo_raw.id = new.geolocation_raw_object_id
  join ingest.http_exchanges as fire_exchange
    on fire_exchange.id = new.firemask_http_exchange_id
  join ingest.http_exchanges as geo_exchange
    on geo_exchange.id = new.geolocation_http_exchange_id
  where detail.observation_cursor = new.cmr_observation_cursor;

  if not found then
    raise exception 'VIIRS asset pair requires complete reviewed product, CMR, run, raw-object, and exchange lineage'
      using errcode = '23514';
  end if;

  if new.firemask_product is distinct from profile_record.expected_firemask_product
    or new.geolocation_product is distinct from profile_record.expected_geolocation_product
    or new.platform is distinct from profile_record.expected_platform
    or context_record.cmr_product
      is distinct from profile_record.expected_cmr_product
    or context_record.cmr_product_version is distinct from '2'
    or context_record.cmr_platform is distinct from new.platform
    or context_record.cmr_footprint_source
      is distinct from new.cmr_footprint_source
    or new.cmr_footprint_source is distinct from 'umm-g-gpolygon'
    or new.firemask_collection_file_version
      is distinct from profile_record.expected_firemask_collection_file_version
    or new.geolocation_collection_file_version
      is distinct from profile_record.expected_geolocation_collection_file_version
    or new.firemask_geolocation_attribute_value
      is distinct from new.geolocation_local_granule_id
  then
    raise exception 'VIIRS FireMask, geolocation, FIRMS, platform, GPolygon footprint, collection-file, and dedicated geolocation-attribute contract mismatch'
      using errcode = '23514';
  end if;

  if context_record.cmr_source_slug is distinct from 'nasa-cmr-firemask'
    or context_record.cmr_validation_state is distinct from 'accepted'
    or context_record.cmr_coverage_geom is null
    or context_record.catalog_granule_id is distinct from new.cmr_catalog_granule_id
    or context_record.cmr_observed_from is distinct from new.firemask_observed_from
    or context_record.cmr_observed_to is distinct from new.firemask_observed_to
    or new.geolocation_observed_from is distinct from new.firemask_observed_from
    or new.geolocation_observed_to is distinct from new.firemask_observed_to
    or context_record.cmr_known_at > new.known_at
  then
    raise exception 'VIIRS asset observation interval must exactly match accepted CMR granule coverage metadata'
      using errcode = '23514';
  end if;

  -- This source intentionally does not exist in this migration. A later,
  -- reviewed source/endpoint/adapter migration is the only activation path.
  if context_record.asset_source_slug
      is distinct from 'nasa-earthdata-viirs-firemask-assets'
    or context_record.asset_source_enabled is distinct from true
    or context_record.asset_license_status is distinct from 'approved'
    or context_record.asset_sensitivity is distinct from 'restricted'
    or context_record.asset_source_is_public is distinct from false
    or context_record.adapter_schema_version
      is distinct from 'viirs-c2-firemask-asset-pair-v1'
  then
    raise exception 'VIIRS asset ingestion source is absent, disabled, or unreviewed'
      using errcode = '55000';
  end if;

  if context_record.fire_raw_sha256 is distinct from new.firemask_content_sha256
    or context_record.geo_raw_sha256 is distinct from new.geolocation_content_sha256
    or context_record.fire_raw_observed_at is distinct from new.firemask_observed_from
    or context_record.geo_raw_observed_at is distinct from new.geolocation_observed_from
    or context_record.fire_exchange_outcome is distinct from 'response'
    or context_record.geo_exchange_outcome is distinct from 'response'
    or context_record.fire_http_status is null
    or context_record.fire_http_status not between 200 and 299
    or context_record.geo_http_status is null
    or context_record.geo_http_status not between 200 and 299
    or context_record.fire_response_raw_object_id
      is distinct from new.firemask_raw_object_id
    or context_record.geo_response_raw_object_id
      is distinct from new.geolocation_raw_object_id
    or context_record.fire_raw_retrieved_at is null
    or context_record.geo_raw_retrieved_at is null
    or context_record.fire_exchange_completed_at is null
    or context_record.geo_exchange_completed_at is null
    or greatest(
      context_record.fire_raw_retrieved_at,
      context_record.geo_raw_retrieved_at,
      context_record.fire_exchange_completed_at,
      context_record.geo_exchange_completed_at
    ) > new.known_at
  then
    raise exception 'VIIRS asset pair hashes, observation times, or terminal raw response lineage mismatch'
      using errcode = '23514';
  end if;

  if context_record.run_status is distinct from 'running'
    or context_record.job_status is distinct from 'running'
    or new.lease_token is distinct from context_record.run_lease_token
    or new.lease_token is distinct from context_record.job_lease_token
    or new.lease_owner is distinct from context_record.run_lease_owner
    or new.lease_owner is distinct from context_record.job_lease_owner
    or context_record.lease_expires_at is null
    or context_record.lease_expires_at <= clock_timestamp()
  then
    raise exception 'VIIRS asset pair insertion requires the active fenced collector lease'
      using errcode = '55000';
  end if;

  return new;
end;
$$;

revoke execute on function ingest.validate_viirs_firemask_asset_pair()
  from public, anon, authenticated, service_role,
  firewatch_catalog_admin, firewatch_collector, firewatch_reconciler,
  firewatch_publisher, firewatch_dispatcher;

create trigger viirs_firemask_asset_pairs_validate
before insert on ingest.viirs_firemask_asset_pairs
for each row execute function ingest.validate_viirs_firemask_asset_pair();

create trigger viirs_firemask_asset_pairs_reject_mutation
before update or delete on ingest.viirs_firemask_asset_pairs
for each row execute function core.reject_mutation();

comment on table ingest.viirs_firemask_asset_pairs is
  'Immutable, exact FireMask/geolocation response pair. No source catalog is created here, so the validator fails closed until a later reviewed Earthdata ingestion migration.';

create or replace function truth.viirs_firemask_no_firemask_class_candidate_is_eligible_v1(
  p_intersecting_pixel_count bigint,
  p_water_pixel_count bigint,
  p_land_pixel_count bigint,
  p_invalid_geolocation_pixel_count bigint,
  p_non_nominal_qa_pixel_count bigint,
  p_complete_support_coverage boolean
)
returns boolean
language sql
immutable
strict
parallel safe
security invoker
set search_path = ''
as $$
  select
    p_intersecting_pixel_count > 0
    and p_invalid_geolocation_pixel_count = 0
    and p_non_nominal_qa_pixel_count = 0
    and p_water_pixel_count + p_land_pixel_count
      = p_intersecting_pixel_count
    and p_complete_support_coverage;
$$;

revoke execute on function truth.viirs_firemask_no_firemask_class_candidate_is_eligible_v1(
  bigint, bigint, bigint, bigint, bigint, boolean
) from public, anon, authenticated, service_role,
  firewatch_catalog_admin, firewatch_collector, firewatch_reconciler,
  firewatch_publisher, firewatch_dispatcher;

-- WGS84 longitude/latitude is not a globally valid planar topology surface,
-- and the deployed PostGIS geography cover predicate has a south-pole edge
-- case. Project both operands into one local gnomonic CRS centered on the
-- server-owned FIRMS detection before validating topology and coverage.
-- Projection or topology failures reject the write closed.
create or replace function truth.viirs_firemask_geography_covers_locally_v1(
  p_covering extensions.geography,
  p_covered extensions.geography,
  p_anchor extensions.geography
)
returns boolean
language plpgsql
stable
strict
parallel safe
security invoker
set search_path = ''
as $$
declare
  anchor_geom extensions.geometry;
  covering_geom extensions.geometry;
  covered_geom extensions.geometry;
  local_gnomonic_crs text;
begin
  anchor_geom := p_anchor::extensions.geometry;

  if extensions.st_srid(p_covering::extensions.geometry) <> 4326
    or extensions.st_srid(p_covered::extensions.geometry) <> 4326
    or extensions.st_srid(anchor_geom) <> 4326
    or extensions.st_isempty(p_covering::extensions.geometry)
    or extensions.st_isempty(p_covered::extensions.geometry)
    or extensions.st_isempty(anchor_geom)
    or extensions.st_geometrytype(p_covering::extensions.geometry)
      not in ('ST_Polygon', 'ST_MultiPolygon')
    or extensions.st_geometrytype(p_covered::extensions.geometry)
      not in ('ST_Polygon', 'ST_MultiPolygon')
    or extensions.st_geometrytype(anchor_geom) <> 'ST_Point'
  then
    return false;
  end if;

  local_gnomonic_crs := pg_catalog.format(
    '+proj=gnom +R=6371008.8 +lat_0=%s +lon_0=%s +units=m +no_defs +type=crs',
    extensions.st_y(anchor_geom),
    extensions.st_x(anchor_geom)
  );

  -- Use the schema-qualified PostGIS transform primitive with an explicit
  -- WGS84 source CRS. The public text overload queries spatial_ref_sys by an
  -- unqualified name, which is unsafe under a hardened empty search path.
  -- Geography polygon edges are spherical great-circle arcs. A spherical
  -- gnomonic projection maps those arcs to straight lines without expanding
  -- broad, coarse CMR footprints into thousands of vertices.
  covering_geom := extensions.postgis_transform_geometry(
    p_covering::extensions.geometry,
    '+proj=longlat +R=6371008.8 +no_defs +type=crs',
    local_gnomonic_crs,
    0
  );
  covered_geom := extensions.postgis_transform_geometry(
    p_covered::extensions.geometry,
    '+proj=longlat +R=6371008.8 +no_defs +type=crs',
    local_gnomonic_crs,
    0
  );

  -- RFC 7946 footprints commonly split at +/-180 into valid polygon parts.
  -- Those parts meet on one projected seam, making the raw MultiPolygon
  -- invalid even though its spherical union is sound. Reject any malformed
  -- component first, then dissolve only component seams/overlap.
  if exists (
    select 1
    from extensions.st_dump(covering_geom) as component
    where extensions.st_geometrytype(component.geom) <> 'ST_Polygon'
      or not extensions.st_isvalid(component.geom)
  ) or exists (
    select 1
    from extensions.st_dump(covered_geom) as component
    where extensions.st_geometrytype(component.geom) <> 'ST_Polygon'
      or not extensions.st_isvalid(component.geom)
  )
  then
    return false;
  end if;

  covering_geom := extensions.st_unaryunion(covering_geom);
  covered_geom := extensions.st_unaryunion(covered_geom);

  if extensions.st_isempty(covering_geom)
    or extensions.st_isempty(covered_geom)
    or extensions.st_geometrytype(covering_geom)
      not in ('ST_Polygon', 'ST_MultiPolygon')
    or extensions.st_geometrytype(covered_geom)
      not in ('ST_Polygon', 'ST_MultiPolygon')
    or not extensions.st_isvalid(covering_geom)
    or not extensions.st_isvalid(covered_geom)
  then
    return false;
  end if;

  return extensions.st_covers(covering_geom, covered_geom);
exception
  when others then
    return false;
end;
$$;

revoke execute on function truth.viirs_firemask_geography_covers_locally_v1(
  extensions.geography, extensions.geography, extensions.geography
) from public, anon, authenticated, service_role,
  firewatch_catalog_admin, firewatch_collector, firewatch_reconciler,
  firewatch_publisher, firewatch_dispatcher;

create or replace function truth.viirs_firemask_geography_is_locally_valid_v1(
  p_geography extensions.geography,
  p_anchor extensions.geography
)
returns boolean
language sql
stable
strict
parallel safe
security invoker
set search_path = ''
as $$
  select truth.viirs_firemask_geography_covers_locally_v1(
    p_geography,
    p_geography,
    p_anchor
  );
$$;

revoke execute on function truth.viirs_firemask_geography_is_locally_valid_v1(
  extensions.geography, extensions.geography
) from public, anon, authenticated, service_role,
  firewatch_catalog_admin, firewatch_collector, firewatch_reconciler,
  firewatch_publisher, firewatch_dispatcher;

create table truth.viirs_firemask_support_assessments (
  cursor bigint generated always as identity primary key,
  public_id core.uuid_v7 not null unique,
  contract_version text not null check (contract_version = '0.1.0-internal'),
  original_detection_id bigint not null
    references ingest.firms_detection_details(id),
  asset_pair_id bigint not null
    references ingest.viirs_firemask_asset_pairs(id),
  rule_id text not null check (
    rule_id = 'viirs-c2-firemask-assessability'
  ),
  rule_version text not null check (rule_version = '0.1.0'),
  as_of timestamptz not null,
  known_at timestamptz not null,
  intersecting_pixel_count bigint not null check (
    intersecting_pixel_count between 0 and 100000
  ),
  mask_class_0_count bigint not null check (mask_class_0_count >= 0),
  mask_class_1_count bigint not null check (mask_class_1_count >= 0),
  mask_class_2_count bigint not null check (mask_class_2_count >= 0),
  mask_class_3_count bigint not null check (mask_class_3_count >= 0),
  mask_class_4_count bigint not null check (mask_class_4_count >= 0),
  mask_class_5_count bigint not null check (mask_class_5_count >= 0),
  mask_class_6_count bigint not null check (mask_class_6_count >= 0),
  mask_class_7_count bigint not null check (mask_class_7_count >= 0),
  mask_class_8_count bigint not null check (mask_class_8_count >= 0),
  mask_class_9_count bigint not null check (mask_class_9_count >= 0),
  invalid_geolocation_pixel_count bigint not null check (
    invalid_geolocation_pixel_count >= 0
    and invalid_geolocation_pixel_count <= intersecting_pixel_count
  ),
  non_nominal_qa_pixel_count bigint not null check (
    non_nominal_qa_pixel_count >= 0
    and non_nominal_qa_pixel_count <= intersecting_pixel_count
  ),
  algorithm_qa_rejection_mask integer generated always as (127) stored,
  geolocation_invalid_mask integer generated always as (7) stored,
  qa_rule_id text generated always as (
    'viirs-c2-firemask-input-and-geolocation-qa'::text
  ) stored,
  qa_rule_version text generated always as ('0.1.0'::text) stored,
  coordinate_validity_rule text generated always as (
    'finite_wgs84_not_declared_fill_v1'::text
  ) stored,
  canonical_modeled_support_geog extensions.geography(Geometry, 4326) not null,
  support_coverage_method text generated always as (
    'geolocated_pixel_union_covers_modeled_support_v1'::text
  ) stored,
  assessed_pixel_coverage_geog extensions.geography(Geometry, 4326),
  -- Server-owned by the BEFORE INSERT validator. Generated outcome columns
  -- reuse this single global-safe geography coverage proof.
  complete_modeled_support_coverage boolean not null default false,
  fire_pixel_count bigint generated always as (
    mask_class_7_count + mask_class_8_count + mask_class_9_count
  ) stored,
  internal_candidate_eligible boolean generated always as (
    truth.viirs_firemask_no_firemask_class_candidate_is_eligible_v1(
      intersecting_pixel_count,
      mask_class_3_count,
      mask_class_5_count,
      invalid_geolocation_pixel_count,
      non_nominal_qa_pixel_count,
      complete_modeled_support_coverage
    )
  ) stored,
  outcome text generated always as (
    case
      when mask_class_7_count + mask_class_8_count + mask_class_9_count > 0
        then 'fire_returned'
      when truth.viirs_firemask_no_firemask_class_candidate_is_eligible_v1(
        intersecting_pixel_count,
        mask_class_3_count,
        mask_class_5_count,
        invalid_geolocation_pixel_count,
        non_nominal_qa_pixel_count,
        complete_modeled_support_coverage
      )
        then 'no_firemask_class_candidate'
      else 'indeterminate'
    end
  ) stored,
  indeterminate_reasons text[] generated always as (
    case
      when mask_class_7_count + mask_class_8_count + mask_class_9_count > 0
        then '{}'::text[]
      else array_remove(array[
        case when intersecting_pixel_count = 0
          then 'no_intersecting_pixels' end,
        case when invalid_geolocation_pixel_count > 0
          then 'invalid_geolocation' end,
        case when non_nominal_qa_pixel_count > 0
          then 'non_nominal_qa' end,
        case when mask_class_0_count > 0
          then 'class_0_not_processed' end,
        case when mask_class_1_count > 0
          then 'class_1_bowtie_deleted' end,
        case when mask_class_2_count > 0
          then 'class_2_sun_glint' end,
        case when mask_class_4_count > 0
          then 'class_4_cloud' end,
        case when mask_class_6_count > 0
          then 'class_6_unclassified' end,
        case when not complete_modeled_support_coverage
          then 'incomplete_modeled_support_coverage' end
      ], null)
    end
  ) stored,
  negative_assessment_eligible boolean generated always as (false) stored,
  notification_eligible boolean generated always as (false) stored,
  official_status_eligible boolean generated always as (false) stored,
  protective_action_eligible boolean generated always as (false) stored,
  incident_resolution_eligible boolean generated always as (false) stored,
  all_clear_eligible boolean generated always as (false) stored,
  limitations text[] not null check (limitations @> array[
    'internal_evidence_only',
    'candidate_only_not_a_negative_assessment',
    'thermal_pixel_not_fire_perimeter',
    'not_official_status',
    'not_protective_guidance',
    'not_notification',
    'not_incident_resolution',
    'not_all_clear'
  ]::text[]),
  recorded_at timestamptz not null default now(),
  constraint viirs_firemask_support_assessments_evidence_key
    unique (original_detection_id, asset_pair_id, rule_id, rule_version),
  constraint viirs_firemask_support_assessments_time_check check (
    as_of <= known_at and known_at <= recorded_at
  ),
  constraint viirs_firemask_support_assessments_accounting_check check (
    mask_class_0_count + mask_class_1_count + mask_class_2_count
      + mask_class_3_count + mask_class_4_count + mask_class_5_count
      + mask_class_6_count + mask_class_7_count + mask_class_8_count
      + mask_class_9_count = intersecting_pixel_count
  ),
  constraint viirs_firemask_support_assessments_geography_check check (
    not extensions.st_isempty(
      canonical_modeled_support_geog::extensions.geometry
    )
    and extensions.st_geometrytype(
      canonical_modeled_support_geog::extensions.geometry
    )
      in ('ST_Polygon', 'ST_MultiPolygon')
    and (
      assessed_pixel_coverage_geog is null
      or (
        not extensions.st_isempty(
          assessed_pixel_coverage_geog::extensions.geometry
        )
        and extensions.st_geometrytype(
          assessed_pixel_coverage_geog::extensions.geometry
        )
          in ('ST_Polygon', 'ST_MultiPolygon')
      )
    )
  )
);

create index viirs_firemask_support_assessments_original_idx
  on truth.viirs_firemask_support_assessments(
    original_detection_id, as_of desc, cursor desc
  );
-- Explicit child-side FK index for pair deletion/retention checks and joins.
create index viirs_firemask_support_assessments_asset_pair_idx
  on truth.viirs_firemask_support_assessments(asset_pair_id);
create index viirs_firemask_support_assessments_outcome_idx
  on truth.viirs_firemask_support_assessments(outcome, known_at desc, cursor desc);
create index viirs_firemask_support_assessments_support_geog_gist
  on truth.viirs_firemask_support_assessments
  using gist(canonical_modeled_support_geog);

create or replace function truth.validate_viirs_firemask_support_assessment()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  context_record record;
  canonical_support extensions.geography;
begin
  -- Server-owned evidence time: callers cannot backdate immutable assessments.
  new.recorded_at := clock_timestamp();

  select
    detection.id as detection_id,
    detection.original_detail_id,
    detection.version_no as detection_version_no,
    detection.product_key as detection_product,
    detection.satellite as detection_platform,
    detection.acquired_at,
    detection.recorded_at as detection_recorded_at,
    detection.centroid_geog,
    detection.modeled_support_radius_m,
    firms_product.assessment_enabled as firms_assessment_enabled,
    profile.assessment_enabled as profile_assessment_enabled,
    pair.firms_product as pair_product,
    pair.platform as pair_platform,
    pair.cmr_footprint_source as pair_cmr_footprint_source,
    pair.cmr_observation_cursor,
    pair.firemask_observed_from,
    pair.firemask_observed_to,
    pair.known_at as pair_known_at,
    pair.recorded_at as pair_recorded_at,
    cmr_detail.footprint_source as cmr_footprint_source,
    cmr_observation.geom as cmr_coverage_geom,
    cmr_observation.validation_state as cmr_validation_state
  into context_record
  from ingest.firms_detection_details as detection
  join core.firms_products as firms_product
    on firms_product.id = detection.product_id
  join ingest.viirs_firemask_asset_pairs as pair
    on pair.id = new.asset_pair_id
  join core.viirs_firemask_product_profiles as profile
    on profile.firms_product = pair.firms_product
  join ingest.cmr_granule_details as cmr_detail
    on cmr_detail.observation_cursor = pair.cmr_observation_cursor
  join ingest.global_observations as cmr_observation
    on cmr_observation.cursor = pair.cmr_observation_cursor
  where detection.id = new.original_detection_id;

  if not found
    or context_record.original_detail_id is distinct from context_record.detection_id
    or context_record.detection_version_no is distinct from 1
    or context_record.detection_product is distinct from context_record.pair_product
    or context_record.detection_platform is distinct from context_record.pair_platform
  then
    raise exception 'VIIRS support assessment requires the exact original FIRMS detection and same-platform asset pair'
      using errcode = '23514';
  end if;

  if not context_record.firms_assessment_enabled
    or not context_record.profile_assessment_enabled
  then
    raise exception 'VIIRS support assessment is disabled pending a later reviewed activation migration'
      using errcode = '55000';
  end if;

  if context_record.firemask_observed_from
      < context_record.acquired_at + interval '1 minute'
    or new.as_of is distinct from context_record.firemask_observed_to
    or context_record.pair_known_at > new.known_at
    or context_record.pair_recorded_at > new.known_at
    or context_record.detection_recorded_at > new.known_at
    or new.known_at > new.recorded_at
  then
    raise exception 'VIIRS support assessment requires a later pass and a knowledge cutoff after immutable detection and pair recording'
      using errcode = '23514';
  end if;

  canonical_support := extensions.st_buffer(
    context_record.centroid_geog,
    context_record.modeled_support_radius_m
  );
  -- The canonical operand is always server-derived. Storing geography directly
  -- avoids invalid planar casts for buffers that cross the antimeridian.
  new.canonical_modeled_support_geog := canonical_support;

  if context_record.cmr_validation_state is distinct from 'accepted'
    or context_record.cmr_coverage_geom is null
    or context_record.pair_cmr_footprint_source
      is distinct from 'umm-g-gpolygon'
    or context_record.cmr_footprint_source
      is distinct from context_record.pair_cmr_footprint_source
    or not truth.viirs_firemask_geography_covers_locally_v1(
      context_record.cmr_coverage_geom::extensions.geography,
      canonical_support,
      context_record.centroid_geog
    )
  then
    raise exception 'explicitly persisted CMR UMM-G GPolygon footprint must cover the complete canonical modeled support'
      using errcode = '23514';
  end if;

  if new.assessed_pixel_coverage_geog is not null
    and not truth.viirs_firemask_geography_is_locally_valid_v1(
      new.assessed_pixel_coverage_geog,
      context_record.centroid_geog
    )
  then
    raise exception 'assessed pixel coverage must be a locally valid nonempty Polygon or MultiPolygon geography in EPSG:4326'
      using errcode = '23514';
  end if;

  new.complete_modeled_support_coverage := coalesce(
    truth.viirs_firemask_geography_covers_locally_v1(
      new.assessed_pixel_coverage_geog,
      canonical_support,
      context_record.centroid_geog
    ),
    false
  );

  return new;
end;
$$;

revoke execute on function truth.validate_viirs_firemask_support_assessment()
  from public, anon, authenticated, service_role,
  firewatch_catalog_admin, firewatch_collector, firewatch_reconciler,
  firewatch_publisher, firewatch_dispatcher;

create trigger viirs_firemask_support_assessments_validate
before insert on truth.viirs_firemask_support_assessments
for each row execute function truth.validate_viirs_firemask_support_assessment();

create trigger viirs_firemask_support_assessments_reject_mutation
before update or delete on truth.viirs_firemask_support_assessments
for each row execute function core.reject_mutation();

comment on table truth.viirs_firemask_support_assessments is
  'Private immutable pass-bounded pixel evidence. no_firemask_class_candidate remains internal; every safety/authority/negative gate is generated false.';

alter table core.viirs_firemask_product_profiles enable row level security;
alter table core.viirs_firemask_product_profiles force row level security;
alter table ingest.viirs_firemask_asset_pairs enable row level security;
alter table ingest.viirs_firemask_asset_pairs force row level security;
alter table truth.viirs_firemask_support_assessments enable row level security;
alter table truth.viirs_firemask_support_assessments force row level security;

revoke all on core.viirs_firemask_product_profiles,
  ingest.viirs_firemask_asset_pairs,
  truth.viirs_firemask_support_assessments
  from public, anon, authenticated, service_role,
  firewatch_catalog_admin, firewatch_collector, firewatch_reconciler,
  firewatch_publisher, firewatch_dispatcher;

revoke all on sequence ingest.viirs_firemask_asset_pairs_id_seq,
  truth.viirs_firemask_support_assessments_cursor_seq
  from public, anon, authenticated, service_role,
  firewatch_catalog_admin, firewatch_collector, firewatch_reconciler,
  firewatch_publisher, firewatch_dispatcher;

create policy viirs_firemask_profiles_collector_read
on core.viirs_firemask_product_profiles for select
to firewatch_collector using (true);
create policy viirs_firemask_profiles_reconciler_read
on core.viirs_firemask_product_profiles for select
to firewatch_reconciler using (true);

create policy viirs_firemask_asset_pairs_collector_read
on ingest.viirs_firemask_asset_pairs for select
to firewatch_collector using (true);
create policy viirs_firemask_asset_pairs_collector_insert
on ingest.viirs_firemask_asset_pairs for insert
to firewatch_collector with check (true);
create policy viirs_firemask_asset_pairs_reconciler_read
on ingest.viirs_firemask_asset_pairs for select
to firewatch_reconciler using (true);

create policy viirs_firemask_support_assessments_reconciler_read
on truth.viirs_firemask_support_assessments for select
to firewatch_reconciler using (true);
create policy viirs_firemask_support_assessments_reconciler_insert
on truth.viirs_firemask_support_assessments for insert
to firewatch_reconciler with check (true);

grant select on core.viirs_firemask_product_profiles
  to firewatch_collector, firewatch_reconciler;
grant select, insert on ingest.viirs_firemask_asset_pairs
  to firewatch_collector;
grant select on ingest.viirs_firemask_asset_pairs
  to firewatch_reconciler;
grant usage, select on sequence ingest.viirs_firemask_asset_pairs_id_seq
  to firewatch_collector;
grant select, insert on truth.viirs_firemask_support_assessments
  to firewatch_reconciler;
grant usage, select on sequence truth.viirs_firemask_support_assessments_cursor_seq
  to firewatch_reconciler;
grant execute on function truth.viirs_firemask_no_firemask_class_candidate_is_eligible_v1(
  bigint, bigint, bigint, bigint, bigint, boolean
) to firewatch_reconciler;
