-- Hosted Supabase migration pushes do not execute seed.sql. Register the CMR
-- catalog here so production and preview environments receive the same
-- disabled, licensed configuration without any ad-hoc seed operation.
insert into core.providers (
  public_id, contract_version, slug, name, organization_type,
  homepage_url, jurisdiction, is_public
)
values (
  '018f0000-0000-7000-8000-000000000001', '1.1.0', 'nasa', 'NASA',
  'government', 'https://www.nasa.gov/', 'United States', true
)
on conflict (slug) do nothing;

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
  '018f0000-0000-7000-8000-000000000115',
  '1.1.0',
  (select id from core.providers where slug = 'nasa'),
  'nasa-cmr-firemask',
  'NASA CMR VIIRS FireMask Granule Catalog',
  'CMR metadata for LANCE VIIRS FireMask NRT granules. Catalog footprints describe pass coverage only; pixel anomaly state is not assessed. LANCE NRT data carry the NASA near-real-time disclaimer and must be cited without implying NASA endorsement.',
  'firemask_granule_catalog',
  'official_observation',
  'satellite_pass_metadata',
  'mixed',
  'https://cmr.earthdata.nasa.gov/search/site/docs/search/api.html',
  'https://www.earthdata.nasa.gov/engage/open-data-services-software/data-use-policy',
  'us_government_work',
  'U.S. Government Work / NASA Earthdata Data Use and Citation Guidance',
  'NASA EOSDIS Common Metadata Repository (CMR) / LANCE; acknowledge NASA and the applicable VIIRS mission data source. Near-real-time data are provided without warranty and are not for navigation or life-safety decisions.',
  'approved',
  true,
  true,
  interval '15 minutes',
  interval '90 days',
  false,
  'public',
  interval '15 minutes',
  interval '3 hours',
  false,
  true,
  '{"anomalyAssessment":"not_assessed","catalogMetadataOnly":true}'::jsonb
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
  '018f0000-0000-7000-8000-000000000215',
  '1.1.0',
  (select id from core.sources where slug = 'nasa-cmr-firemask'),
  'granules-umm-g-1-6-7',
  'CMR UMM-G 1.6.7 Granule Search',
  'dataset',
  'sensor',
  array['satellite_imagery'],
  'structured_data',
  'nasa_esdis_data_use_and_citation',
  'http_poll',
  'https://cmr.earthdata.nasa.gov/search/granules.umm_json_v1_6_7',
  'GET',
  'none',
  null,
  'official_observation',
  'satellite_pass_metadata',
  'Official CMR catalog metadata for granule temporal and spatial coverage only; pixel anomaly state is not assessed.',
  'global',
  interval '5 minutes',
  interval '3 hours',
  interval '15 minutes',
  interval '3 hours',
  15000,
  true,
  true,
  true,
  '{
    "accept":"application/vnd.nasa.cmr.umm_results+json; version=1.6.7",
    "clientId":"plomari-wildfire-tracker",
    "pagination":"CMR-Search-After",
    "provider":"LANCEMODIS",
    "requestHeaderAllowlist":["accept","client-id","x-request-id","cmr-search-after"],
    "responseFormat":"umm_json",
    "responseHeaderAllowlist":["content-type","cmr-hits","cmr-took","cmr-request-id","x-request-id","cmr-search-after","cmr-time-out","cmr-timed-out","retry-after"],
    "sortKeys":["-start_date","granule_ur"],
    "ummGVersion":"1.6.7"
  }'::jsonb,
  '{
    "identity":{"conceptId":"meta.concept-id","revisionId":"meta.revision-id"},
    "itemsPath":"items",
    "partialResponseHeaders":["cmr-time-out","cmr-timed-out"],
    "requiredFootprint":true
  }'::jsonb,
  '{
    "anomalyAssessment":"not_assessed",
    "pagination":"search_after",
    "products":["VNP14IMG_NRT","VJ114IMG_NRT","VJ214IMG_NRT"],
    "scanModes":["bootstrap","incremental","reconciliation"]
  }'::jsonb
)
on conflict (source_id, endpoint_key) do nothing;

insert into ingest.endpoint_state (endpoint_id, enabled)
select endpoint.id, false
from core.endpoints as endpoint
join core.sources as source on source.id = endpoint.source_id
where source.slug = 'nasa-cmr-firemask'
  and endpoint.endpoint_key = 'granules-umm-g-1-6-7'
on conflict (endpoint_id) do nothing;

insert into core.collection_targets (
  public_id, contract_version, source_id, endpoint_id, target_key, name,
  visibility, enabled
)
select
  '018f0000-0000-7000-8000-000000000415'::core.uuid_v7,
  '1.1.0',
  source.id,
  endpoint.id,
  'global-firemask-granules',
  'CMR global VIIRS FireMask granule catalog',
  'public',
  false
from core.sources as source
join core.endpoints as endpoint on endpoint.source_id = source.id
where source.slug = 'nasa-cmr-firemask'
  and endpoint.endpoint_key = 'granules-umm-g-1-6-7'
on conflict (endpoint_id, target_key) do nothing;

insert into core.collection_target_revisions (
  public_id, contract_version, identity_version, collection_target_id,
  endpoint_id, version_no, target_kind, configuration_sha256, scope,
  geometry_precision_source, claim_kind, operational_role, cadence,
  stale_after, enabled, request_params, effective_at
)
select
  '018f0000-0000-7000-8000-000000000515'::core.uuid_v7,
  '1.1.0',
  '2.0.0',
  target.id,
  endpoint.id,
  1,
  'global',
  '1d8dd3f510d333495f3c92ab245f6f1883a6cccb2e5323c0c2c17f832cd4f199',
  'global',
  'not_applicable',
  'satellite_pass_metadata',
  'context',
  interval '5 minutes',
  interval '3 hours',
  false,
  '{
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
  }'::jsonb,
  timestamptz '2026-07-30 00:00:00+00'
from core.collection_targets as target
join core.endpoints as endpoint on endpoint.id = target.endpoint_id
join core.sources as source on source.id = target.source_id
where source.slug = 'nasa-cmr-firemask'
  and endpoint.endpoint_key = 'granules-umm-g-1-6-7'
  and target.target_key = 'global-firemask-granules'
on conflict (collection_target_id, version_no) do nothing;

insert into ingest.collection_target_state (
  collection_target_revision_id, collection_target_id
)
select revision.id, revision.collection_target_id
from core.collection_target_revisions as revision
where revision.public_id = '018f0000-0000-7000-8000-000000000515'
on conflict (collection_target_revision_id) do nothing;

do $$
begin
  if not exists (
    select 1
    from core.sources as source
    join core.providers as provider on provider.id = source.provider_id
    where source.public_id = '018f0000-0000-7000-8000-000000000115'
      and source.slug = 'nasa-cmr-firemask'
      and provider.slug = 'nasa'
      and source.default_evidence_class = 'satellite_pass_metadata'
      and source.license_code = 'us_government_work'
      and source.license_status = 'approved'
      and source.commercial_use_allowed is true
      and source.redistribution_allowed is true
      and source.terms_url = 'https://www.earthdata.nasa.gov/engage/open-data-services-software/data-use-policy'
      and source.enabled is false
      and source.is_public is true
      and source.metadata = '{"anomalyAssessment":"not_assessed","catalogMetadataOnly":true}'::jsonb
  ) then
    raise exception 'conflicting NASA CMR source catalog identity or license policy'
      using errcode = '23514';
  end if;

  if not exists (
    select 1
    from core.endpoints as endpoint
    join core.sources as source on source.id = endpoint.source_id
    join ingest.endpoint_state as state on state.endpoint_id = endpoint.id
    where endpoint.public_id = '018f0000-0000-7000-8000-000000000215'
      and source.slug = 'nasa-cmr-firemask'
      and endpoint.endpoint_key = 'granules-umm-g-1-6-7'
      and endpoint.base_url = 'https://cmr.earthdata.nasa.gov/search/granules.umm_json_v1_6_7'
      and endpoint.auth_mode = 'none'
      and endpoint.credential_ref is null
      and endpoint.poll_interval = interval '5 minutes'
      and endpoint.supports_cursor
      and endpoint.supports_backfill
      and endpoint.request_template->>'pagination' = 'CMR-Search-After'
      and endpoint.request_template->'responseHeaderAllowlist'
        @> '["cmr-time-out","cmr-timed-out","x-request-id"]'::jsonb
      and state.enabled is false
  ) then
    raise exception 'conflicting NASA CMR endpoint catalog identity or activation state'
      using errcode = '23514';
  end if;

  if not exists (
    select 1
    from core.collection_targets as target
    join core.collection_target_revisions as revision
      on revision.collection_target_id = target.id
    join core.endpoints as endpoint on endpoint.id = target.endpoint_id
    join core.sources as source on source.id = target.source_id
    join ingest.collection_target_state as state
      on state.collection_target_revision_id = revision.id
      and state.collection_target_id = target.id
    where target.public_id = '018f0000-0000-7000-8000-000000000415'
      and revision.public_id = '018f0000-0000-7000-8000-000000000515'
      and source.slug = 'nasa-cmr-firemask'
      and endpoint.endpoint_key = 'granules-umm-g-1-6-7'
      and target.target_key = 'global-firemask-granules'
      and target.visibility = 'public'
      and target.enabled is false
      and revision.version_no = 1
      and revision.configuration_sha256 = '1d8dd3f510d333495f3c92ab245f6f1883a6cccb2e5323c0c2c17f832cd4f199'
      and revision.cadence = interval '5 minutes'
      and revision.stale_after = interval '3 hours'
      and revision.enabled is false
      and revision.request_params->>'incrementalOverlapMinutes' = '10'
      and revision.request_params->>'maximumPagesPerProduct' = '20'
      and revision.request_params->'sortKeys'
        = '["-start_date","granule_ur"]'::jsonb
  ) then
    raise exception 'conflicting NASA CMR target catalog identity or disabled revision'
      using errcode = '23514';
  end if;

  if exists (
    select 1
    from core.adapter_releases as adapter
    join core.sources as source on source.id = adapter.source_id
    where source.slug = 'nasa-cmr-firemask'
  ) then
    raise exception 'CMR bootstrap must not create or adopt an adapter release'
      using errcode = '23514';
  end if;
end;
$$;

-- Deliberately no adapter release or operational activation. Those require a
-- real artifact digest, git commit, and least-privileged deployment identity.
