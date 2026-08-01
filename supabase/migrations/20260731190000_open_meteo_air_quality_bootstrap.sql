-- Open-Meteo Air Quality source registration (issue #43 work package A,
-- superseding PR #19's request-time route). Hosted migration pushes do not
-- execute seed.sql, so the provider insert is idempotent and the source and
-- endpoint register here for every environment.
--
-- Everything ships disabled. No collection target, no revision, no adapter
-- release, and no schedule are created: target geometry belongs to the
-- jurisdiction-profile work and activation requires a real adapter artifact
-- digest and reviewed license terms.
--
-- Semantics: Open-Meteo air quality is a MODEL product, never an on-site
-- measurement. Pollutant fields (PM2.5, PM10, NO2, O3, AOD) and provider
-- indexes (European AQI, US AQI) are stored as separate fields; a provider
-- index is never relabeled as a pollutant concentration.
insert into core.providers (
  public_id, contract_version, slug, name, organization_type,
  homepage_url, jurisdiction, is_public
)
values (
  '018f0000-0000-7000-8000-000000000004', '1.1.0', 'open-meteo', 'Open-Meteo',
  'commercial', 'https://open-meteo.com/', 'Global', true
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
  '018f0000-0000-7000-8000-000000000117',
  '1.1.0',
  (select id from core.providers where slug = 'open-meteo'),
  'open-meteo-air-quality',
  'Open-Meteo Air Quality Model',
  'Modeled atmospheric-composition point conditions (CAMS-based). Pollutant fields are preserved individually and labeled modeled; provider AQ indexes remain provider indexes. Never an on-site measurement.',
  'air_quality_model',
  'modeled',
  'modeled_air_quality',
  'context',
  'https://open-meteo.com/en/docs/air-quality-api',
  'https://open-meteo.com/en/terms',
  'cc_by_4_0',
  'CC BY 4.0 attribution / Open-Meteo non-commercial API terms',
  'Air-quality model data by Open-Meteo.com (CAMS). Modeled values; not an on-site measurement.',
  'unreviewed',
  false,
  true,
  interval '15 minutes',
  interval '90 days',
  false,
  'public',
  interval '1 hour',
  interval '6 hours',
  false,
  true,
  '{"basis":"modeled","indexesAreProviderIndexes":true,"pollutantFieldsPreserved":true}'::jsonb
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
  '018f0000-0000-7000-8000-000000000217',
  '1.1.0',
  (select id from core.sources where slug = 'open-meteo-air-quality'),
  'air-quality-current-v1',
  'Open-Meteo Air Quality Current Conditions',
  'model',
  'model',
  array['weather_model'],
  'derived_model',
  'open_meteo_api_terms_cc_by_4_0',
  'http_poll',
  'https://air-quality-api.open-meteo.com/v1/air-quality',
  'GET',
  'none',
  null,
  'modeled',
  'modeled_air_quality',
  'Modeled atmospheric composition at requested coordinates only; not a measurement network and not an official air-quality authority.',
  'global',
  interval '15 minutes',
  interval '1 hour',
  interval '1 hour',
  interval '6 hours',
  9000,
  false,
  false,
  false,
  '{
    "accept":"application/json",
    "current":["pm2_5","pm10","nitrogen_dioxide","ozone","aerosol_optical_depth","european_aqi","us_aqi"],
    "requestHeaderAllowlist":["accept","x-request-id"],
    "requestQueryAllowlist":["latitude","longitude","current","timezone"],
    "responseHeaderAllowlist":["cache-control","content-length","content-type","date"],
    "timezone":"UTC"
  }'::jsonb,
  '{
    "modelTimeFormat":"YYYY-MM-DDTHH:mm",
    "requiredUtcOffsetSeconds":0,
    "pollutantFields":["pm2_5","pm10","nitrogen_dioxide","ozone","aerosol_optical_depth"],
    "providerIndexFields":["european_aqi","us_aqi"]
  }'::jsonb,
  '{
    "basis":"modeled",
    "batching":"one-request-per-target",
    "targetConfiguration":"jurisdiction-profile"
  }'::jsonb
)
on conflict (source_id, endpoint_key) do nothing;

insert into ingest.endpoint_state (endpoint_id, enabled)
select endpoint.id, false
from core.endpoints as endpoint
join core.sources as source on source.id = endpoint.source_id
where source.slug = 'open-meteo-air-quality'
  and endpoint.endpoint_key = 'air-quality-current-v1'
on conflict (endpoint_id) do nothing;

do $$
begin
  if not exists (
    select 1
    from core.sources as source
    join core.providers as provider on provider.id = source.provider_id
    where source.public_id = '018f0000-0000-7000-8000-000000000117'
      and source.slug = 'open-meteo-air-quality'
      and provider.slug = 'open-meteo'
      and source.default_trust_class = 'modeled'
      and source.default_evidence_class = 'modeled_air_quality'
      and source.license_status = 'unreviewed'
      and source.commercial_use_allowed is false
      and source.enabled is false
      and source.is_public is true
  ) then
    raise exception 'conflicting Open-Meteo air-quality source identity or license state'
      using errcode = '23514';
  end if;

  if not exists (
    select 1
    from core.endpoints as endpoint
    join core.sources as source on source.id = endpoint.source_id
    join ingest.endpoint_state as state on state.endpoint_id = endpoint.id
    where endpoint.public_id = '018f0000-0000-7000-8000-000000000217'
      and source.slug = 'open-meteo-air-quality'
      and endpoint.endpoint_key = 'air-quality-current-v1'
      and endpoint.base_url = 'https://air-quality-api.open-meteo.com/v1/air-quality'
      and endpoint.auth_mode = 'none'
      and endpoint.credential_ref is null
      and endpoint.trust_class = 'modeled'
      and endpoint.request_template->>'timezone' = 'UTC'
      and endpoint.response_contract->>'requiredUtcOffsetSeconds' = '0'
      and state.enabled is false
  ) then
    raise exception 'conflicting Open-Meteo air-quality endpoint identity or activation state'
      using errcode = '23514';
  end if;

  if exists (
    select 1
    from core.collection_targets as target
    join core.sources as source on source.id = target.source_id
    where source.slug = 'open-meteo-air-quality'
  ) then
    raise exception 'air-quality bootstrap must not create collection targets'
      using errcode = '23514';
  end if;

  if exists (
    select 1
    from core.adapter_releases as adapter
    join core.sources as source on source.id = adapter.source_id
    where source.slug = 'open-meteo-air-quality'
  ) then
    raise exception 'air-quality bootstrap must not create or adopt an adapter release'
      using errcode = '23514';
  end if;
end;
$$;

-- Deliberately no collection target, adapter release, or activation. Targets
-- arrive with jurisdiction profiles; activation requires a reviewed license
-- decision and a real adapter artifact digest.
