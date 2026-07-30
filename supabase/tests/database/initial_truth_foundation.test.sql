begin;

-- The pgTAP runner is deliberately not a production workload identity. Grant
-- capabilities only inside this rolled-back test transaction so SET LOCAL ROLE
-- exercises the exact RLS and function boundaries.
grant firewatch_catalog_admin, firewatch_collector, firewatch_reconciler,
  firewatch_publisher, firewatch_dispatcher to postgres;

create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public, pg_catalog;

select no_plan();

select has_extension('postgis', 'PostGIS is installed');
select has_schema('core', 'core schema exists');
select has_schema('ingest', 'ingest schema exists');
select has_schema('truth', 'truth schema exists');
select has_schema('api', 'api schema exists');

select has_table('core', 'providers', 'provider identity is separate from source products');
select has_table('core', 'incidents', 'incident catalog exists');
select has_table('core', 'aoi_versions', 'immutable AOI versions exist');
select has_table('core', 'sources', 'source product catalog exists');
select has_table('core', 'endpoints', 'endpoint catalog exists');
select has_table('core', 'adapter_releases', 'adapter release chain exists');
select has_table('core', 'collection_targets', 'collection target catalog exists');
select has_table('core', 'collection_target_revisions', 'immutable collection target revisions exist');
select has_table('core', 'incident_bindings', 'incident target bindings exist');

select has_table('ingest', 'endpoint_state', 'endpoint operational state is private');
select has_table('ingest', 'adapter_release_state', 'adapter operational state is private');
select has_table('ingest', 'collection_target_state', 'mutable collection state is outside core');
select has_table('ingest', 'jobs', 'ingestion job queue exists');
select has_table('ingest', 'runs', 'ingestion run ledger exists');
select has_table('ingest', 'content_blobs', 'content-addressed blob identity exists');
select has_table('ingest', 'raw_objects', 'raw object ledger exists');
select has_table('ingest', 'source_revisions', 'source revision chain exists');
select has_table('ingest', 'global_observations', 'global observation ledger exists');
select has_table('ingest', 'incident_relevance', 'incident relevance ledger exists');

select has_table('truth', 'events', 'truth event ledger exists');
select has_table('truth', 'evidence', 'truth evidence ledger exists');
select has_table('truth', 'assertions', 'truth assertion ledger exists');
select has_table('truth', 'snapshots', 'truth snapshot chain exists');
select has_table('truth', 'material_changes', 'material change ledger exists');
select has_table('truth', 'publications', 'append-only publication ledger exists');
select has_table('truth', 'outbox', 'outbox queue exists');
select has_table('truth', 'source_health', 'source health ledger exists');

select has_view('api', 'source_catalog', 'public source catalog projection exists');
select has_view('api', 'incidents', 'public incident projection exists');
select has_view('api', 'incident_observations', 'public observation projection exists');
select has_view('api', 'incident_timeline', 'public timeline projection exists');
select has_view('api', 'incident_truth', 'public truth projection exists');
select has_view('api', 'incident_changes', 'public changes projection exists');
select has_view('api', 'source_health', 'public source-health projection exists');

select ok(
  (select bool_and(c.relrowsecurity and c.relforcerowsecurity)
   from pg_class as c
   join pg_namespace as n on n.oid = c.relnamespace
   where n.nspname in ('core', 'ingest', 'truth') and c.relkind = 'r'),
  'all application tables have enabled and forced RLS'
);

select ok(
  not has_table_privilege('anon', 'core.incidents', 'INSERT')
  and not has_table_privilege('authenticated', 'core.incidents', 'INSERT'),
  'client roles cannot write private catalog tables'
);

select ok(
  has_table_privilege('anon', 'api.incidents', 'SELECT')
  and has_table_privilege('authenticated', 'api.incidents', 'SELECT'),
  'client roles can read curated API projections'
);

select ok(
  (select column_default is null
   from information_schema.columns
   where table_schema = 'core' and table_name = 'incidents' and column_name = 'public_id'),
  'public IDs are application supplied rather than random database UUIDs'
);

select ok(
  (select is_nullable = 'YES'
   from information_schema.columns
   where table_schema = 'ingest' and table_name = 'global_observations' and column_name = 'observed_at'),
  'unknown source observation instants remain nullable'
);

select has_column('ingest', 'global_observations', 'observed_precision', 'observation time precision is structured');
select has_column('ingest', 'global_observations', 'effective_precision', 'effective time precision is structured');
select has_column('ingest', 'source_revisions', 'identity_version', 'source revision identity algorithm is durable');
select has_column('ingest', 'global_observations', 'identity_version', 'observation identity algorithm is durable');
select has_column('core', 'collection_target_revisions', 'configuration_sha256', 'target revision hash is durable');
select has_column('core', 'collection_target_revisions', 'endpoint_id', 'target revision endpoint provenance is durable');
select has_column('truth', 'snapshots', 'identity_version', 'snapshot hash identity algorithm is durable');
select has_column('truth', 'material_changes', 'rule_id', 'material changes identify their rule');
select has_column('truth', 'material_changes', 'rule_version', 'material changes identify the rule version');
select has_column('truth', 'source_health', 'collection_target_id', 'health is target-specific');
select hasnt_column('truth', 'snapshots', 'confidence', 'truth snapshots do not collapse quality into one score');
select hasnt_column('truth', 'events', 'publication_status', 'event publication is not a mutable row field');
select hasnt_column('truth', 'snapshots', 'publication_status', 'snapshot publication is not a mutable row field');
select hasnt_column('truth', 'material_changes', 'publication_status', 'change publication is not a mutable row field');
select hasnt_column('api', 'incident_observations', 'properties', 'public observations omit free-form properties');
select hasnt_column('api', 'incident_timeline', 'payload', 'public timeline omits event detail JSON');
select hasnt_column('api', 'incident_truth', 'state', 'public truth omits free-form snapshot state');
select hasnt_column('api', 'incident_changes', 'change_data', 'public changes omit free-form change JSON');
select has_column('api', 'incidents', 'lifecycle', 'incident API names editorial lifecycle explicitly');
select has_column('api', 'incidents', 'official_status', 'incident API exposes separately evidence-gated official status');
select hasnt_column('api', 'incidents', 'status', 'ambiguous incident status is not part of the API contract');

select is(
  (select count(*) from core.sources where slug in (
    'nasa-firms', 'nasa-eonet', 'nasa-gibs', 'gdacs-alerts', 'open-meteo-weather',
    'noaa-nws-alerts', 'noaa-metar', 'hellenic-fire-service-updates',
    'greece-civil-protection-alerts', 'effis', 'gwis', 'meteoalarm', 'inforcyl', 'infoca'
  )),
  14::bigint,
  'seed includes the reviewed global, Greek, European, and Spanish source catalog'
);

select ok(
  (select bool_and(not enabled and license_status = 'unreviewed')
   from core.sources
   where slug in (
     'nasa-firms', 'nasa-eonet', 'nasa-gibs', 'gdacs-alerts', 'open-meteo-weather',
     'noaa-nws-alerts', 'noaa-metar', 'hellenic-fire-service-updates',
     'greece-civil-protection-alerts', 'effis', 'gwis', 'meteoalarm', 'inforcyl', 'infoca'
   )),
  'seeded sources remain disabled and license-unreviewed'
);

select is(
  (select configuration_sha256
   from core.collection_target_revisions
   where public_id = '018f0000-0000-7000-8000-000000000501'),
  '309a06db9800af00eedc364890a3e29348ae18973f72ac348d7b36bac5ab52f2',
  'FIRMS target seed uses the reviewed canonical identity-v2 configuration hash'
);

select ok(
  (select bool_and(contract_version = '1.1.0' and identity_version = '2.0.0')
   from core.collection_target_revisions
   where public_id::text like '018f0000-0000-7000-8000-0000000005%'),
  'seeded target revisions distinguish contract 1.1.0 from identity algorithm 2.0.0'
);

select ok(to_regclass('ingest.jobs_ready_idx') is not null, 'job queue has a partial claim index');
select ok(to_regclass('truth.outbox_ready_idx') is not null, 'outbox has a partial claim index');
select ok(to_regclass('ingest.global_observations_geom_gist') is not null, 'observations have a GiST geometry index');
select ok(to_regclass('ingest.global_observations_geog_gist') is not null, 'observations have a GiST geography index');

select ok(
  (select relkind = 'r' from pg_class where oid = 'ingest.global_observations'::regclass),
  'initial observation ledger is deliberately unpartitioned'
);

insert into core.providers (
  public_id, contract_version, slug, name, organization_type, is_public
)
values (
  '018f0000-0000-7000-8000-000000009001', '1.1.0', 'test-provider', 'Test Provider', 'unknown', true
);

insert into core.sources (
  public_id,
  contract_version,
  provider_id,
  slug,
  name,
  product_family,
  default_trust_class,
  default_evidence_class,
  operational_scope,
  enabled,
  is_public
)
select
  '018f0000-0000-7000-8000-000000009002',
  '1.1.0',
  p.id,
  'test-source',
  'Test Source',
  'test',
  'official_observation',
  'test_observation',
  'context',
  false,
  true
from core.providers as p
where p.slug = 'test-provider';

insert into core.incidents (
  public_id, contract_version, slug, name, status, visibility
)
values
  ('018f0000-0000-7000-8000-000000009003', '1.1.0', 'test-public-incident', 'Test Public Incident', 'active', 'public'),
  ('018f0000-0000-7000-8000-000000009004', '1.1.0', 'test-internal-incident', 'Test Internal Incident', 'monitoring', 'internal');

update core.incidents
set status = 'closed'
where slug = 'test-public-incident';

set local role anon;

select ok(
  (select lifecycle = 'closed' and official_status is null
   from api.incidents where slug = 'test-public-incident'),
  'catalog lifecycle changes cannot synthesize an official wildfire status'
);

reset role;

update core.incidents
set status = 'active'
where slug = 'test-public-incident';

insert into core.aoi_versions (
  public_id, contract_version, incident_id, version_no, effective_at, geom
)
select
  '018f0000-0000-7000-8000-000000009005',
  '1.1.0',
  i.id,
  1,
  timestamptz '2026-07-30 00:00:00+00',
  extensions.st_multi(extensions.st_geomfromtext('POLYGON((26.9 39.0,27.1 39.0,27.1 39.2,26.9 39.2,26.9 39.0))', 4326))
from core.incidents as i
where i.slug = 'test-public-incident';

select throws_ok(
  $$update core.aoi_versions set change_reason = 'rewrite' where public_id = '018f0000-0000-7000-8000-000000009005'$$,
  '55000',
  'core.aoi_versions rows are immutable; append a successor revision',
  'AOI versions reject updates'
);

select throws_ok(
  $$delete from core.aoi_versions where public_id = '018f0000-0000-7000-8000-000000009005'$$,
  '55000',
  'core.aoi_versions rows are immutable; append a successor revision',
  'AOI versions reject deletes'
);

select throws_ok(
  $$update core.endpoints set name = 'rewritten endpoint' where public_id = '018f0000-0000-7000-8000-000000000201'$$,
  '55000',
  'core.endpoints rows are immutable; append a successor revision',
  'endpoint request provenance rejects in-place updates'
);

select throws_ok(
  $$update core.collection_target_revisions set request_params = '{"changed":true}' where public_id = '018f0000-0000-7000-8000-000000000501'$$,
  '55000',
  'core.collection_target_revisions rows are immutable; append a successor revision',
  'target revision hash provenance rejects in-place updates'
);

select ok(
  not has_table_privilege('service_role', 'core.sources', 'INSERT')
  and not has_table_privilege('service_role', 'ingest.global_observations', 'INSERT')
  and not has_table_privilege('service_role', 'truth.events', 'INSERT')
  and not has_table_privilege('service_role', 'truth.publications', 'INSERT')
  and not has_table_privilege('service_role', 'truth.outbox', 'INSERT')
  and not has_table_privilege('service_role', 'ingest.jobs', 'UPDATE')
  and not has_table_privilege('service_role', 'truth.outbox', 'UPDATE'),
  'managed service role cannot mutate any private application boundary'
);

select ok(
  (select bool_and(
     not rolcanlogin
     and not rolsuper
     and not rolcreatedb
     and not rolcreaterole
     and not rolreplication
     and not rolbypassrls
   )
   from pg_roles
   where rolname in (
     'firewatch_catalog_admin', 'firewatch_collector', 'firewatch_reconciler',
     'firewatch_publisher', 'firewatch_dispatcher'
   ))
  and (select bool_and(not rolinherit)
       from pg_roles
       where rolname in (
         'firewatch_catalog_admin', 'firewatch_reconciler',
         'firewatch_publisher', 'firewatch_dispatcher'
       ))
  and not pg_has_role('service_role', 'firewatch_catalog_admin', 'member')
  and not pg_has_role('service_role', 'firewatch_collector', 'member')
  and not pg_has_role('service_role', 'firewatch_reconciler', 'member')
  and not pg_has_role('service_role', 'firewatch_publisher', 'member')
  and not pg_has_role('service_role', 'firewatch_dispatcher', 'member'),
  'capability roles retain safe attributes and service_role inherits none'
);

select ok(
  not has_table_privilege('firewatch_collector', 'truth.publications', 'INSERT')
  and not has_table_privilege('firewatch_collector', 'truth.outbox', 'INSERT')
  and not has_table_privilege('firewatch_collector', 'ingest.collection_target_state', 'UPDATE')
  and not has_table_privilege('firewatch_reconciler', 'truth.publications', 'INSERT')
  and not has_table_privilege('firewatch_publisher', 'core.sources', 'UPDATE')
  and not has_table_privilege('firewatch_publisher', 'ingest.global_observations', 'INSERT')
  and not has_table_privilege('firewatch_publisher', 'truth.events', 'INSERT')
  and not has_table_privilege('firewatch_dispatcher', 'truth.publications', 'INSERT'),
  'collector, reconciler, publisher, and dispatcher capabilities do not overlap writes'
);

select ok(
  not has_column_privilege('anon', 'ingest.global_observations', 'properties', 'SELECT')
  and not has_column_privilege('anon', 'ingest.incident_relevance', 'rationale', 'SELECT')
  and not has_column_privilege('anon', 'truth.events', 'payload', 'SELECT')
  and not has_column_privilege('anon', 'truth.events', 'actor_ref', 'SELECT')
  and not has_column_privilege('anon', 'truth.snapshots', 'state', 'SELECT')
  and not has_column_privilege('anon', 'truth.material_changes', 'change_data', 'SELECT')
  and not has_column_privilege('anon', 'truth.material_changes', 'protective_action', 'SELECT')
  and not has_column_privilege('anon', 'truth.publications', 'reason', 'SELECT')
  and not has_column_privilege('anon', 'truth.source_health', 'details', 'SELECT'),
  'client base-column grants exclude private and free-form data'
);

select ok(
  (select public is false from storage.buckets where id = 'raw-evidence')
  and has_table_privilege('firewatch_collector', 'storage.objects', 'SELECT')
  and has_table_privilege('firewatch_collector', 'storage.objects', 'INSERT')
  and pg_has_role('authenticator', 'firewatch_collector', 'member')
  and pg_has_role('firewatch_collector', 'anon', 'member')
  and (select rolinherit from pg_roles where rolname = 'firewatch_collector'),
  'raw evidence bucket is private and wired to the collector Storage JWT role'
);

select ok(
  exists (
    select 1 from pg_policies
    where schemaname = 'storage' and tablename = 'objects'
      and policyname = 'firewatch_collector_raw_evidence_select'
      and cmd = 'SELECT'
      and roles = array['firewatch_collector']::name[]
      and qual = '(bucket_id = ''raw-evidence''::text)'
  )
  and exists (
    select 1 from pg_policies
    where schemaname = 'storage' and tablename = 'objects'
      and policyname = 'firewatch_collector_raw_evidence_insert'
      and cmd = 'INSERT'
      and roles = array['firewatch_collector']::name[]
      and with_check like '%bucket_id = ''raw-evidence''::text%'
      and with_check like '%^sha256/[a-f0-9]{2}/[a-f0-9]{64}$%'
  )
  and not exists (
    select 1 from pg_policies
    where schemaname = 'storage' and tablename = 'objects'
      and 'firewatch_collector' = any(roles)
      and cmd in ('UPDATE', 'DELETE')
  ),
  'collector Storage policies are exact-path SELECT/INSERT only'
);

set local role firewatch_collector;

insert into storage.objects (bucket_id, name)
values ('raw-evidence', 'sha256/aa/' || repeat('a', 64));

update storage.objects
set name = 'sha256/bb/' || repeat('b', 64)
where bucket_id = 'raw-evidence'
  and name = 'sha256/aa/' || repeat('a', 64);

select is(
  (select count(*) from storage.objects
   where bucket_id = 'raw-evidence'
     and name = 'sha256/aa/' || repeat('a', 64)),
  1::bigint,
  'collector overwrite attempt leaves the original raw evidence object unchanged'
);

select is(
  (select count(*) from storage.objects
   where bucket_id = 'raw-evidence'
     and name = 'sha256/bb/' || repeat('b', 64)),
  0::bigint,
  'collector overwrite attempt cannot create a replacement object'
);

select throws_ok(
  $$
    delete from storage.objects
    where bucket_id = 'raw-evidence'
      and name = 'sha256/aa/' || repeat('a', 64)
  $$,
  '42501',
  'Direct deletion from storage tables is not allowed. Use the Storage API instead.',
  'managed Storage trigger rejects direct raw evidence deletion'
);

select is(
  (select count(*) from storage.objects
   where bucket_id = 'raw-evidence'
     and name = 'sha256/aa/' || repeat('a', 64)),
  1::bigint,
  'collector deletion attempt leaves the raw evidence object unchanged'
);

reset role;

select throws_ok(
  $$
    insert into ingest.content_blobs (
      public_id, contract_version, identity_version, content_sha256,
      content_type, byte_size, storage_bucket, storage_path
    ) values (
      '018f0000-0000-7000-8000-000000009057', '1.1.0', '2.0.0',
      repeat('7', 64), 'application/json', 2, 'raw-evidence',
      'sha256/ff/' || repeat('7', 64)
    )
  $$,
  '23514',
  'new row for relation "content_blobs" violates check constraint "content_blobs_storage_path_check"',
  'external content blob path must be derived from its SHA-256'
);

select throws_ok(
  $$
    insert into ingest.content_blobs (
      public_id, contract_version, identity_version, content_sha256,
      content_type, byte_size, storage_bucket, storage_path
    ) values (
      '018f0000-0000-7000-8000-000000009058', '1.1.0', '2.0.0',
      repeat('8', 64), 'application/json', 2, 'raw-evidence',
      'sha256/88/' || repeat('8', 64)
    )
  $$,
  '23503',
  'external content blob requires the pre-existing content-addressed Storage object',
  'external content blob cannot reference an object that was never uploaded'
);

insert into truth.events (
  public_id,
  contract_version,
  incident_id,
  idempotency_key,
  event_type,
  actor_kind,
  lifecycle,
  verification_state,
  current_summary_en,
  translation_state,
  reconciliation_version,
  visibility,
  payload
)
select
  '018f0000-0000-7000-8000-000000009006',
  '1.1.0',
  i.id,
  'test-unbacked-protective-event',
  'protective_instruction',
  'system',
  'active',
  'official',
  'Unbacked test instruction',
  'complete',
  'test-reconciliation-1',
  'public',
  '{"instructionKind":"evacuate","actionText":"Test only","originalLanguage":"en","originExplicit":false,"destinationExplicit":false,"affectedAreaExplicit":false}'::jsonb
from core.incidents as i
where i.slug = 'test-public-incident';

insert into truth.events (
  public_id, contract_version, incident_id, idempotency_key, event_type,
  actor_kind, lifecycle, verification_state, current_summary_en,
  translation_state, reconciliation_version, visibility, payload
)
select
  '018f0000-0000-7000-8000-000000009055',
  '1.1.0',
  i.id,
  'test-unbacked-ended-event',
  'official_status_transition',
  'system',
  'active',
  'official',
  'Unbacked ended state',
  'complete',
  'test-reconciliation-1',
  'public',
  '{"fromStatus":"in_progress","toStatus":"ended"}'::jsonb
from core.incidents as i
where i.slug = 'test-public-incident';

set local role firewatch_publisher;

select throws_ok(
  $$
    insert into truth.publications (
      public_id, contract_version, incident_id, event_cursor,
      idempotency_key, action, actor_kind, action_at
    )
    select
      '018f0000-0000-7000-8000-000000009007',
      '1.1.0',
      e.incident_id,
      e.cursor,
      'test-unbacked-protective-publication',
      'publish',
      'system',
      now()
    from truth.events as e
    where e.public_id = '018f0000-0000-7000-8000-000000009006'
  $$,
  '23514',
  'protective instruction lacks accepted authoritative provenance',
  'publisher cannot self-label and publish an unbacked protective instruction'
);

select throws_ok(
  $$
    insert into truth.publications (
      public_id, contract_version, incident_id, event_cursor,
      idempotency_key, action, actor_kind, action_at
    )
    select
      '018f0000-0000-7000-8000-000000009056',
      '1.1.0',
      e.incident_id,
      e.cursor,
      'test-unbacked-ended-publication',
      'publish',
      'system',
      now()
    from truth.events as e
    where e.public_id = '018f0000-0000-7000-8000-000000009055'
  $$,
  '23514',
  'official status transition lacks accepted authoritative provenance',
  'publisher cannot publish an evidence-free ended transition'
);

reset role;

-- Build a complete accepted/evidence-backed chain whose endpoint is deliberately
-- not an official-status endpoint. The generic gate must pass while the
-- claim-specific authority overlay rejects publication.
update core.providers
set organization_type = 'government'
where slug = 'test-provider';

update core.sources
set default_trust_class = 'authoritative',
    license_status = 'approved',
    redistribution_allowed = true,
    enabled = true
where slug = 'test-source';

insert into core.endpoints (
  public_id, contract_version, source_id, endpoint_key, name, endpoint_kind,
  source_kind, authority_scopes, content_policy, license_policy, transport,
  base_url, http_method, trust_class, evidence_class, coverage_scope,
  freshness, max_staleness
)
select
  '018f0000-0000-7000-8000-000000009010', '1.1.0', s.id,
  'nonofficial-status', 'Non-official status endpoint', 'feed', 'publisher',
  array['incident_status'], 'structured_data', 'provider_terms', 'http_poll',
  'https://example.test/status', 'GET', 'authoritative',
  'authority_incident_update', 'national', interval '5 minutes', interval '30 minutes'
from core.sources as s where s.slug = 'test-source';

insert into ingest.endpoint_state (endpoint_id, enabled)
select id, true from core.endpoints
where public_id = '018f0000-0000-7000-8000-000000009010';

insert into core.adapter_releases (
  public_id, contract_version, source_id, release_no, version_label,
  artifact_digest, schema_version, released_at
)
select
  '018f0000-0000-7000-8000-000000009011', '1.1.0', s.id, 1,
  'test-nonofficial-1', repeat('1', 64), '1.0.0', now() - interval '30 minutes'
from core.sources as s where s.slug = 'test-source';

insert into ingest.adapter_release_state (adapter_release_id, enabled)
select id, true from core.adapter_releases
where public_id = '018f0000-0000-7000-8000-000000009011';

insert into core.collection_targets (
  public_id, contract_version, source_id, endpoint_id, target_key, name,
  incident_id, visibility, enabled
)
select
  '018f0000-0000-7000-8000-000000009012', '1.1.0', s.id, ep.id,
  'test-incident-status', 'Test incident status', i.id, 'internal', true
from core.sources as s
join core.endpoints as ep on ep.source_id = s.id and ep.endpoint_key = 'nonofficial-status'
cross join core.incidents as i
where s.slug = 'test-source' and i.slug = 'test-public-incident';

insert into core.collection_target_revisions (
  public_id, contract_version, identity_version, collection_target_id,
  endpoint_id, version_no, target_kind, configuration_sha256, scope,
  incident_id, claim_kind, operational_role, cadence, stale_after, enabled,
  effective_at, recorded_at
)
select
  '018f0000-0000-7000-8000-000000009013', '1.1.0', '2.0.0', t.id,
  t.endpoint_id, 1, 'feed', repeat('2', 64), 'incident', t.incident_id,
  'official_status', 'operations', interval '5 minutes', interval '30 minutes',
  true, now() - interval '25 minutes', now() - interval '25 minutes'
from core.collection_targets as t
where t.public_id = '018f0000-0000-7000-8000-000000009012';

insert into ingest.collection_target_state (
  collection_target_revision_id, collection_target_id
)
select revision.id, revision.collection_target_id
from core.collection_target_revisions as revision
where revision.public_id = '018f0000-0000-7000-8000-000000009013';

insert into ingest.jobs (
  public_id, contract_version, source_id, endpoint_id, collection_target_id,
  collection_target_revision_id, adapter_release_id, idempotency_key
)
select
  '018f0000-0000-7000-8000-000000009067', '1.1.0', target.source_id,
  target.endpoint_id, target.id, revision.id, adapter.id,
  'test-disabled-configuration-job'
from core.collection_targets as target
join core.collection_target_revisions as revision
  on revision.collection_target_id = target.id
join core.adapter_releases as adapter on adapter.source_id = target.source_id
where target.public_id = '018f0000-0000-7000-8000-000000009012'
  and revision.public_id = '018f0000-0000-7000-8000-000000009013'
  and adapter.public_id = '018f0000-0000-7000-8000-000000009011';

update ingest.endpoint_state
set enabled = false
where endpoint_id = (
  select id from core.endpoints
  where public_id = '018f0000-0000-7000-8000-000000009010'
);

set local role firewatch_collector;

select is(
  (select count(*) from ingest.claim_collection_job('test-disabled-worker')),
  0::bigint,
  'a disabled collection configuration cannot be claimed'
);

reset role;

select is(
  (select status from ingest.jobs
   where public_id = '018f0000-0000-7000-8000-000000009067'),
  'cancelled',
  'claiming atomically cancels queued work for disabled configuration'
);

update ingest.endpoint_state
set enabled = true
where endpoint_id = (
  select id from core.endpoints
  where public_id = '018f0000-0000-7000-8000-000000009010'
);

set local role firewatch_collector;

select throws_ok(
  $$
    insert into ingest.jobs (
      public_id, contract_version, source_id, endpoint_id,
      collection_target_id, collection_target_revision_id,
      adapter_release_id, idempotency_key, status, attempt_count,
      lease_token, lease_owner, lease_expires_at, claimed_at
    )
    select
      '018f0000-0000-7000-8000-000000009066', '1.1.0', t.source_id,
      t.endpoint_id, t.id, tr.id, ar.id, 'test-self-leased-job', 'running', 1,
      '00000000-0000-4000-8000-000000009066'::uuid, 'forged-worker',
      now() + interval '1 hour', now()
    from core.collection_targets as t
    join core.collection_target_revisions as tr on tr.collection_target_id = t.id
    join core.adapter_releases as ar on ar.source_id = t.source_id
    where t.public_id = '018f0000-0000-7000-8000-000000009012'
      and tr.public_id = '018f0000-0000-7000-8000-000000009013'
      and ar.public_id = '018f0000-0000-7000-8000-000000009011'
  $$,
  '23514',
  'collection jobs must be inserted in pristine pending state',
  'collector cannot mint a running job and self-assign its lease'
);

reset role;

insert into ingest.jobs (
  public_id, contract_version, source_id, endpoint_id, collection_target_id,
  collection_target_revision_id, adapter_release_id, idempotency_key, status,
  attempt_count, lease_token, lease_owner, lease_expires_at, claimed_at,
  created_at, updated_at
)
select
  '018f0000-0000-7000-8000-000000009014', '1.1.0', t.source_id,
  t.endpoint_id, t.id, tr.id, ar.id, 'test-nonofficial-job', 'pending', 0,
  null::uuid, null::text, null::timestamptz, null::timestamptz,
  now() - interval '20 minutes', now() - interval '20 minutes'
from core.collection_targets as t
join core.collection_target_revisions as tr on tr.collection_target_id = t.id
join core.adapter_releases as ar on ar.source_id = t.source_id
where t.public_id = '018f0000-0000-7000-8000-000000009012'
  and tr.public_id = '018f0000-0000-7000-8000-000000009013'
  and ar.public_id = '018f0000-0000-7000-8000-000000009011';

select lives_ok(
  $$select * from ingest.claim_collection_job('test-collector', interval '1 hour')$$,
  'non-official fixture job receives its lease only through the claim function'
);

insert into ingest.runs (
  public_id, contract_version, job_id, source_id, endpoint_id,
  collection_target_id, collection_target_revision_id, adapter_release_id,
  lease_token, lease_owner, attempt_no, status, started_at, collector_version,
  created_at, updated_at
)
select
  '018f0000-0000-7000-8000-000000009015', '1.1.0', j.id, j.source_id,
  j.endpoint_id, j.collection_target_id, j.collection_target_revision_id,
  j.adapter_release_id, j.lease_token, j.lease_owner, 1, 'running',
  now() - interval '19 minutes', 'test-collector-1',
  now() - interval '19 minutes', now() - interval '19 minutes'
from ingest.jobs as j
where j.public_id = '018f0000-0000-7000-8000-000000009014';

insert into ingest.content_blobs (
  public_id, contract_version, identity_version, content_sha256, content_type,
  byte_size, inline_bytes, created_at
)
select
  '018f0000-0000-7000-8000-000000009016', '1.1.0', '2.0.0',
  encode(pg_catalog.sha256(payload.bytes), 'hex'), 'application/json',
  octet_length(payload.bytes), payload.bytes, now() - interval '18 minutes'
from (values (convert_to('{}', 'UTF8'))) as payload(bytes);

insert into ingest.http_exchanges (
  public_id, contract_version, run_id, source_id, endpoint_id, request_no,
  idempotency_key, request_method, request_url_redacted,
  request_fingerprint_sha256
)
select
  '018f0000-0000-7000-8000-000000009901', '1.1.0', run.id,
  run.source_id, run.endpoint_id, 1, 'test-nonofficial-http-1', 'GET',
  'https://example.test/status', repeat('a', 64)
from ingest.runs as run
where run.public_id = '018f0000-0000-7000-8000-000000009015';

insert into ingest.raw_objects (
  public_id, contract_version, source_id, endpoint_id, run_id, blob_id,
  content_sha256, idempotency_key, retrieved_at, created_at, http_exchange_id
)
select
  '018f0000-0000-7000-8000-000000009017', '1.1.0', r.source_id,
  r.endpoint_id, r.id, b.id, b.content_sha256, 'test-nonofficial-raw',
  now() - interval '18 minutes', now() - interval '18 minutes', exchange.id
from ingest.runs as r
join ingest.http_exchanges as exchange on exchange.run_id = r.id
cross join ingest.content_blobs as b
where r.public_id = '018f0000-0000-7000-8000-000000009015'
  and exchange.public_id = '018f0000-0000-7000-8000-000000009901'
  and b.public_id = '018f0000-0000-7000-8000-000000009016';

set local role firewatch_collector;

select ok(
  (
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
    where exchange.public_id = '018f0000-0000-7000-8000-000000009901'
      and raw.public_id = '018f0000-0000-7000-8000-000000009017'
  ),
  'non-official fixture terminalizes its issued HTTP response through the lease-fenced function'
);

reset role;

insert into ingest.source_revisions (
  public_id, contract_version, identity_version, source_id, source_record_key,
  revision_no, run_id, raw_object_id, adapter_release_id, idempotency_key,
  content_sha256, schema_version, observed_at, observed_precision, retrieved_at,
  raw_payload, canonical_data, recorded_at
)
select
  '018f0000-0000-7000-8000-000000009018', '1.1.0', '2.0.0', r.source_id,
  'nonofficial-status-record', 1, r.id, ro.id, r.adapter_release_id,
  'test-nonofficial-revision', ro.content_sha256, '1.0.0',
  now() - interval '17 minutes', 'exact', now() - interval '17 minutes',
  '{}'::jsonb, '{}'::jsonb, now() - interval '17 minutes'
from ingest.runs as r
join ingest.raw_objects as ro on ro.run_id = r.id
where r.public_id = '018f0000-0000-7000-8000-000000009015';

insert into ingest.global_observations (
  public_id, contract_version, identity_version, source_id, source_revision_id,
  idempotency_key, observation_kind, source_record_key, observed_at,
  observed_precision, effective_at, effective_precision, retrieved_at,
  trust_class, evidence_class, visibility, validation_state, ingested_at
)
select
  '018f0000-0000-7000-8000-000000009019', '1.1.0', '2.0.0', sr.source_id,
  sr.id, 'test-nonofficial-observation', 'official_status', sr.source_record_key,
  now() - interval '16 minutes', 'exact', now() - interval '16 minutes',
  'exact', now() - interval '16 minutes', 'authoritative',
  'authority_incident_update', 'public', 'accepted', now() - interval '16 minutes'
from ingest.source_revisions as sr
where sr.public_id = '018f0000-0000-7000-8000-000000009018';

insert into ingest.incident_relevance (
  public_id, contract_version, incident_id, aoi_version_id, observation_cursor,
  idempotency_key, method, relevance_score, rationale, evaluator,
  evaluator_version, evaluated_at
)
select
  '018f0000-0000-7000-8000-000000009020', '1.1.0', i.id, a.id, o.cursor,
  'test-nonofficial-relevance', 'analyst_link', 1, '{}'::jsonb,
  'test-reconciler', '1.0.0', now() - interval '15 minutes'
from core.incidents as i
join core.aoi_versions as a on a.incident_id = i.id
cross join ingest.global_observations as o
where i.slug = 'test-public-incident'
  and o.public_id = '018f0000-0000-7000-8000-000000009019';

insert into truth.assertions (
  public_id, contract_version, incident_id, assertion_key, version_no,
  observation_cursor, idempotency_key, assertion_type, subject_type,
  subject_key, predicate, value, authority_scope, assertion_status,
  effective_at, effective_precision, expires_at, extraction_method, extraction_version,
  asserted_at, recorded_at
)
select
  '018f0000-0000-7000-8000-000000009021', '1.1.0', i.id,
  'nonofficial-status-assertion', 1, o.cursor, 'test-nonofficial-assertion',
  'report', 'incident', i.slug, 'official_status_transition',
  '{"fromStatus":"in_progress","toStatus":"ended"}'::jsonb,
  'incident_status', 'active', now() - interval '14 minutes', 'exact',
  now() + interval '1 day', 'deterministic_parser', '1.0.0', now() - interval '14 minutes',
  now() - interval '14 minutes'
from core.incidents as i
cross join ingest.global_observations as o
where i.slug = 'test-public-incident'
  and o.public_id = '018f0000-0000-7000-8000-000000009019';

insert into truth.events (
  public_id, contract_version, incident_id, idempotency_key, event_type,
  first_effective_at, first_effective_precision, actor_kind,
  source_revision_id, observation_cursor, lifecycle, verification_state,
  current_summary_en, translation_state, reconciliation_version, visibility,
  payload, recorded_at
)
select
  '018f0000-0000-7000-8000-000000009022', '1.1.0', i.id,
  'test-nonofficial-status-event', 'official_status_transition',
  now() - interval '14 minutes', 'exact', 'source', sr.id, o.cursor,
  'active', 'official', 'Non-official ended claim', 'complete',
  'test-reconciliation-1', 'public',
  '{"fromStatus":"in_progress","toStatus":"ended"}'::jsonb,
  now() - interval '13 minutes'
from core.incidents as i
cross join ingest.source_revisions as sr
cross join ingest.global_observations as o
where i.slug = 'test-public-incident'
  and sr.public_id = '018f0000-0000-7000-8000-000000009018'
  and o.public_id = '018f0000-0000-7000-8000-000000009019';

insert into truth.evidence (
  public_id, contract_version, incident_id, event_cursor, assertion_cursor,
  idempotency_key, relationship, rationale_code, linked_by, recorded_at
)
select
  '018f0000-0000-7000-8000-000000009023', '1.1.0', e.incident_id,
  e.cursor, a.cursor, 'test-nonofficial-evidence', 'supports',
  'source-statement', 'test-reconciler', now() - interval '12 minutes'
from truth.events as e
join truth.assertions as a on a.incident_id = e.incident_id
where e.public_id = '018f0000-0000-7000-8000-000000009022'
  and a.public_id = '018f0000-0000-7000-8000-000000009021';

set local role firewatch_collector;

select ok(
  (
    select ingest.finish_ingestion_run(
      p_run_id => run.id,
      p_lease_token => run.lease_token,
      p_worker_id => run.lease_owner,
      p_status => 'success',
      p_request_count => 1,
      p_cursor_before => '{}'::jsonb,
      p_cursor_after => '{"cursor":"nonofficial-1"}'::jsonb
    )
    from ingest.runs as run
    where run.public_id = '018f0000-0000-7000-8000-000000009015'
  ),
  'collector atomically finalizes run, target cursor, and job success'
);

reset role;

select ok(
  truth.event_has_publishable_evidence(
    (select cursor from truth.events where public_id = '018f0000-0000-7000-8000-000000009022'),
    (select id from core.incidents where slug = 'test-public-incident'),
    now(),
    now()
  ),
  'non-official fixture satisfies the generic evidence-backed publication gate'
);

set local role firewatch_publisher;

select throws_ok(
  $$
    insert into truth.publications (
      public_id, contract_version, incident_id, event_cursor,
      idempotency_key, action, actor_kind, action_at
    )
    select
      '018f0000-0000-7000-8000-000000009024', '1.1.0', e.incident_id,
      e.cursor, 'test-nonofficial-status-publication', 'publish', 'system',
      now()
    from truth.events as e
    where e.public_id = '018f0000-0000-7000-8000-000000009022'
  $$,
  '23514',
  'official status transition lacks accepted authoritative provenance',
  'publisher cannot publish a fully built status chain from a non-official endpoint'
);

reset role;

-- Build the corresponding authoritative official-status chain. All durable
-- provenance predates the publication action; publication knowledge remains
-- database-recorded at transaction time.
insert into core.providers (
  public_id, contract_version, slug, name, organization_type, is_public
)
values (
  '018f0000-0000-7000-8000-000000009030', '1.1.0',
  'test-official-provider', 'Test Official Provider', 'government', true
);

insert into core.sources (
  public_id, contract_version, provider_id, slug, name, product_family,
  default_trust_class, default_evidence_class, operational_scope,
  license_status, redistribution_allowed, enabled, is_public
)
select
  '018f0000-0000-7000-8000-000000009031', '1.1.0', p.id,
  'test-official-status-source', 'Test Official Status Source',
  'official_status', 'authoritative', 'authority_incident_update',
  'incident_operations', 'approved', true, true, true
from core.providers as p where p.slug = 'test-official-provider';

insert into core.endpoints (
  public_id, contract_version, source_id, endpoint_key, name, endpoint_kind,
  source_kind, authority_scopes, content_policy, license_policy, transport,
  base_url, http_method, trust_class, evidence_class, coverage_scope,
  freshness, max_staleness
)
select
  '018f0000-0000-7000-8000-000000009032', '1.1.0', s.id,
  'official-status', 'Official status endpoint', 'feed', 'official_status',
  array['incident_status'], 'official_content', 'provider_terms', 'http_poll',
  'https://authority.example.test/status', 'GET', 'authoritative',
  'authority_incident_update', 'national', interval '5 minutes', interval '30 minutes'
from core.sources as s where s.slug = 'test-official-status-source';

insert into ingest.endpoint_state (endpoint_id, enabled)
select id, true from core.endpoints
where public_id = '018f0000-0000-7000-8000-000000009032';

insert into core.adapter_releases (
  public_id, contract_version, source_id, release_no, version_label,
  artifact_digest, schema_version, released_at
)
select
  '018f0000-0000-7000-8000-000000009033', '1.1.0', s.id, 1,
  'test-official-1', repeat('4', 64), '1.0.0', now() - interval '30 minutes'
from core.sources as s where s.slug = 'test-official-status-source';

insert into ingest.adapter_release_state (adapter_release_id, enabled)
select id, true from core.adapter_releases
where public_id = '018f0000-0000-7000-8000-000000009033';

insert into core.collection_targets (
  public_id, contract_version, source_id, endpoint_id, target_key, name,
  incident_id, visibility, enabled
)
select
  '018f0000-0000-7000-8000-000000009034', '1.1.0', s.id, ep.id,
  'official-incident-status', 'Official incident status', i.id, 'internal', true
from core.sources as s
join core.endpoints as ep on ep.source_id = s.id and ep.endpoint_key = 'official-status'
cross join core.incidents as i
where s.slug = 'test-official-status-source' and i.slug = 'test-public-incident';

insert into core.collection_target_revisions (
  public_id, contract_version, identity_version, collection_target_id,
  endpoint_id, version_no, target_kind, configuration_sha256, scope,
  incident_id, claim_kind, operational_role, cadence, stale_after, enabled,
  effective_at, recorded_at
)
select
  '018f0000-0000-7000-8000-000000009035', '1.1.0', '2.0.0', t.id,
  t.endpoint_id, 1, 'feed', repeat('5', 64), 'incident', t.incident_id,
  'official_status', 'operations', interval '5 minutes', interval '30 minutes',
  true, now() - interval '25 minutes', now() - interval '25 minutes'
from core.collection_targets as t
where t.public_id = '018f0000-0000-7000-8000-000000009034';

insert into ingest.collection_target_state (
  collection_target_revision_id, collection_target_id
)
select tr.id, tr.collection_target_id
from core.collection_target_revisions as tr
where tr.public_id = '018f0000-0000-7000-8000-000000009035';

insert into ingest.jobs (
  public_id, contract_version, source_id, endpoint_id, collection_target_id,
  collection_target_revision_id, adapter_release_id, idempotency_key, status,
  attempt_count, lease_token, lease_owner, lease_expires_at, claimed_at,
  created_at, updated_at
)
select
  '018f0000-0000-7000-8000-000000009036', '1.1.0', t.source_id,
  t.endpoint_id, t.id, tr.id, ar.id, 'test-official-job', 'pending', 0,
  null::uuid, null::text, null::timestamptz, null::timestamptz,
  now() - interval '20 minutes', now() - interval '20 minutes'
from core.collection_targets as t
join core.collection_target_revisions as tr on tr.collection_target_id = t.id
join core.adapter_releases as ar on ar.source_id = t.source_id
where t.public_id = '018f0000-0000-7000-8000-000000009034'
  and tr.public_id = '018f0000-0000-7000-8000-000000009035'
  and ar.public_id = '018f0000-0000-7000-8000-000000009033';

select lives_ok(
  $$select * from ingest.claim_collection_job('test-collector', interval '1 hour')$$,
  'official fixture job receives its lease only through the claim function'
);

insert into ingest.runs (
  public_id, contract_version, job_id, source_id, endpoint_id,
  collection_target_id, collection_target_revision_id, adapter_release_id,
  lease_token, lease_owner, attempt_no, status, started_at, collector_version,
  created_at, updated_at
)
select
  '018f0000-0000-7000-8000-000000009037', '1.1.0', j.id, j.source_id,
  j.endpoint_id, j.collection_target_id, j.collection_target_revision_id,
  j.adapter_release_id, j.lease_token, j.lease_owner, 1, 'running',
  now() - interval '19 minutes', 'test-collector-1',
  now() - interval '19 minutes', now() - interval '19 minutes'
from ingest.jobs as j
where j.public_id = '018f0000-0000-7000-8000-000000009036';

insert into ingest.http_exchanges (
  public_id, contract_version, run_id, source_id, endpoint_id, request_no,
  idempotency_key, request_method, request_url_redacted,
  request_fingerprint_sha256
)
select
  '018f0000-0000-7000-8000-000000009902', '1.1.0', run.id,
  run.source_id, run.endpoint_id, 1, 'test-official-http-failed-1', 'GET',
  'https://authority.example.test/status', repeat('b', 64)
from ingest.runs as run
where run.public_id = '018f0000-0000-7000-8000-000000009037';

set local role firewatch_collector;

select ok(
  (
    select ingest.finish_http_exchange(
      p_exchange_id => exchange.id,
      p_run_id => run.id,
      p_lease_token => run.lease_token,
      p_worker_id => run.lease_owner,
      p_outcome => 'transport_error',
      p_error_class => 'network',
      p_error_detail_safe => 'Fixture network failure.'
    )
    from ingest.http_exchanges as exchange
    join ingest.runs as run on run.id = exchange.run_id
    where exchange.public_id = '018f0000-0000-7000-8000-000000009902'
  ),
  'failed fixture terminalizes its issued HTTP request through the lease-fenced function'
);

select ok(
  (
    select ingest.finish_ingestion_run(
      p_run_id => run.id,
      p_lease_token => run.lease_token,
      p_worker_id => run.lease_owner,
      p_status => 'failed',
      p_error_class => 'network',
      p_request_count => 1,
      p_cursor_before => '{}'::jsonb,
      p_error_meta => '{"class":"network"}'::jsonb,
      p_retry_at => now()
    )
    from ingest.runs as run
    where run.public_id = '018f0000-0000-7000-8000-000000009037'
  ),
  'failed first attempt is finalized atomically with its metrics'
);

reset role;

select ok(
  (select status = 'failed' and request_count = 1
   from ingest.runs
   where public_id = '018f0000-0000-7000-8000-000000009037')
  and (select status = 'retry' and attempt_count = 1 and lease_token is null
       from ingest.jobs
       where public_id = '018f0000-0000-7000-8000-000000009036')
  and (select cursor_state = '{}'::jsonb and consecutive_failures = 1
       from ingest.collection_target_state as state
       join core.collection_target_revisions as revision
         on revision.id = state.collection_target_revision_id
       where revision.public_id = '018f0000-0000-7000-8000-000000009035'),
  'failed run retains metrics, does not advance cursor, and releases a retry job'
);

set local role firewatch_collector;

select is(
  (select count(*) from ingest.claim_collection_job('test-collector-2', interval '1 hour')),
  1::bigint,
  'retry job is reclaimed for attempt two'
);

reset role;

insert into ingest.runs (
  public_id, contract_version, job_id, source_id, endpoint_id,
  collection_target_id, collection_target_revision_id, adapter_release_id,
  lease_token, lease_owner, attempt_no, status, collector_version
)
select
  '018f0000-0000-7000-8000-000000009068', '1.1.0', job.id, job.source_id,
  job.endpoint_id, job.collection_target_id, job.collection_target_revision_id,
  job.adapter_release_id, job.lease_token, job.lease_owner, job.attempt_count,
  'running', 'test-collector-2'
from ingest.jobs as job
where job.public_id = '018f0000-0000-7000-8000-000000009036';

set local role firewatch_collector;

select ok(
  not (
    select ingest.finish_ingestion_run(
      p_run_id => run.id,
      p_lease_token => '00000000-0000-4000-8000-000000009068'::uuid,
      p_worker_id => run.lease_owner,
      p_status => 'success',
      p_cursor_before => '{}'::jsonb,
      p_cursor_after => '{"cursor":"forged"}'::jsonb
    )
    from ingest.runs as run
    where run.public_id = '018f0000-0000-7000-8000-000000009068'
  ),
  'stale or forged lease token cannot finalize a run'
);

reset role;

select ok(
  (select status = 'running' from ingest.runs
   where public_id = '018f0000-0000-7000-8000-000000009068')
  and (select cursor_state = '{}'::jsonb
       from ingest.collection_target_state as state
       join core.collection_target_revisions as revision
         on revision.id = state.collection_target_revision_id
       where revision.public_id = '018f0000-0000-7000-8000-000000009035'),
  'failed lease fencing leaves both run and cursor state untouched'
);

-- Issue every request before creating the exact raw response occurrence.
insert into ingest.http_exchanges (
  public_id, contract_version, run_id, source_id, endpoint_id, request_no,
  idempotency_key, request_method, request_url_redacted,
  request_fingerprint_sha256
)
select
  exchange.public_id::core.uuid_v7, '1.1.0', run.id, run.source_id,
  run.endpoint_id, exchange.request_no, exchange.idempotency_key, 'GET',
  'https://authority.example.test/status', exchange.request_fingerprint_sha256
from ingest.runs as run
join (
  values
    ('018f0000-0000-7000-8000-000000009903', 1, 'test-official-http-1', repeat('c', 64)),
    ('018f0000-0000-7000-8000-000000009904', 2, 'test-official-http-2', repeat('d', 64)),
    ('018f0000-0000-7000-8000-000000009905', 3, 'test-official-http-3', repeat('e', 64))
) as exchange(public_id, request_no, idempotency_key, request_fingerprint_sha256)
  on true
where run.public_id = '018f0000-0000-7000-8000-000000009068';

insert into ingest.content_blobs (
  public_id, contract_version, identity_version, content_sha256, content_type,
  byte_size, inline_bytes, created_at
)
select
  '018f0000-0000-7000-8000-000000009038', '1.1.0', '2.0.0',
  encode(pg_catalog.sha256(payload.bytes), 'hex'), 'application/json',
  octet_length(payload.bytes), payload.bytes, now() - interval '18 minutes'
from (values (convert_to('{"state":"a"}', 'UTF8'))) as payload(bytes);

insert into ingest.raw_objects (
  public_id, contract_version, source_id, endpoint_id, run_id, blob_id,
  content_sha256, idempotency_key, retrieved_at, created_at, http_exchange_id
)
select
  '018f0000-0000-7000-8000-000000009039', '1.1.0', r.source_id,
  r.endpoint_id, r.id, b.id, b.content_sha256, 'test-official-raw',
  now() - interval '18 minutes', now() - interval '18 minutes', exchange.id
from ingest.runs as r
join ingest.http_exchanges as exchange on exchange.run_id = r.id
cross join ingest.content_blobs as b
where r.public_id = '018f0000-0000-7000-8000-000000009068'
  and exchange.public_id = '018f0000-0000-7000-8000-000000009903'
  and b.public_id = '018f0000-0000-7000-8000-000000009038';

-- A source may legitimately restore earlier content. The version chain, not a
-- unique (record, hash) constraint, distinguishes the A -> B -> A sequence.
insert into ingest.content_blobs (
  public_id, contract_version, identity_version, content_sha256, content_type,
  byte_size, inline_bytes
)
select
  '018f0000-0000-7000-8000-000000009074', '1.1.0', '2.0.0',
  encode(pg_catalog.sha256(payload.bytes), 'hex'), 'application/json',
  octet_length(payload.bytes), payload.bytes
from (values (convert_to('{"state":"b"}', 'UTF8'))) as payload(bytes);

insert into ingest.raw_objects (
  public_id, contract_version, source_id, endpoint_id, run_id, blob_id,
  content_sha256, idempotency_key, retrieved_at, http_exchange_id
)
select
  '018f0000-0000-7000-8000-000000009075', '1.1.0', run.source_id,
  run.endpoint_id, run.id, blob.id, blob.content_sha256,
  'test-aba-raw-b', now(), exchange.id
from ingest.runs as run
join ingest.http_exchanges as exchange on exchange.run_id = run.id
cross join ingest.content_blobs as blob
where run.public_id = '018f0000-0000-7000-8000-000000009068'
  and exchange.public_id = '018f0000-0000-7000-8000-000000009904'
  and blob.public_id = '018f0000-0000-7000-8000-000000009074';

insert into ingest.raw_objects (
  public_id, contract_version, source_id, endpoint_id, run_id, blob_id,
  content_sha256, idempotency_key, retrieved_at, http_exchange_id
)
select
  '018f0000-0000-7000-8000-000000009077', '1.1.0', run.source_id,
  run.endpoint_id, run.id, blob.id, blob.content_sha256,
  'test-aba-raw-a-restored', now(), exchange.id
from ingest.runs as run
join ingest.http_exchanges as exchange on exchange.run_id = run.id
cross join ingest.content_blobs as blob
where run.public_id = '018f0000-0000-7000-8000-000000009068'
  and exchange.public_id = '018f0000-0000-7000-8000-000000009905'
  and blob.public_id = '018f0000-0000-7000-8000-000000009038';

set local role firewatch_collector;

select ok(
  (
    select bool_and(
      ingest.finish_http_exchange(
        p_exchange_id => exchange.id,
        p_run_id => run.id,
        p_lease_token => run.lease_token,
        p_worker_id => run.lease_owner,
        p_outcome => 'response',
        p_http_status => 200::smallint,
        p_response_raw_object_id => raw.id
      )
    )
    from ingest.http_exchanges as exchange
    join ingest.runs as run on run.id = exchange.run_id
    join (
      values
        (1, '018f0000-0000-7000-8000-000000009039'),
        (2, '018f0000-0000-7000-8000-000000009075'),
        (3, '018f0000-0000-7000-8000-000000009077')
    ) as expected(request_no, raw_public_id)
      on expected.request_no = exchange.request_no
    join ingest.raw_objects as raw
      on raw.run_id = run.id
      and raw.public_id = expected.raw_public_id::core.uuid_v7
    where run.public_id = '018f0000-0000-7000-8000-000000009068'
  ),
  'successful retry terminalizes each issued HTTP response through the lease-fenced function'
);

reset role;

insert into ingest.source_revisions (
  public_id, contract_version, identity_version, source_id, source_record_key,
  revision_no, run_id, raw_object_id, adapter_release_id, idempotency_key,
  content_sha256, schema_version, observed_at, observed_precision, retrieved_at,
  raw_payload, canonical_data, recorded_at
)
select
  '018f0000-0000-7000-8000-000000009040', '1.1.0', '2.0.0', run.source_id,
  'official-status-record', 1, run.id, raw.id, run.adapter_release_id,
  'test-official-revision', raw.content_sha256, '1.0.0',
  now() - interval '17 minutes', 'exact', now() - interval '17 minutes',
  '{}'::jsonb, '{}'::jsonb, now() - interval '17 minutes'
from ingest.runs as run
join ingest.raw_objects as raw on raw.run_id = run.id
where run.public_id = '018f0000-0000-7000-8000-000000009068'
  and raw.public_id = '018f0000-0000-7000-8000-000000009039';

insert into ingest.source_revisions (
  public_id, contract_version, identity_version, source_id, source_record_key,
  revision_no, run_id, raw_object_id, adapter_release_id, idempotency_key,
  content_sha256, schema_version, retrieved_at, raw_payload, canonical_data
)
select
  '018f0000-0000-7000-8000-000000009076', '1.1.0', '2.0.0', run.source_id,
  'aba-restoration-record', 1, run.id, raw.id, run.adapter_release_id,
  'test-aba-revision-a1', raw.content_sha256, '1.0.0', now(),
  '{}'::jsonb, '{"state":"a"}'::jsonb
from ingest.runs as run
join ingest.raw_objects as raw on raw.run_id = run.id
where run.public_id = '018f0000-0000-7000-8000-000000009068'
  and raw.public_id = '018f0000-0000-7000-8000-000000009039';

insert into ingest.source_revisions (
  public_id, contract_version, identity_version, source_id, source_record_key,
  revision_no, previous_revision_id, run_id, raw_object_id, adapter_release_id,
  idempotency_key, content_sha256, schema_version, retrieved_at,
  raw_payload, canonical_data
)
select
  '018f0000-0000-7000-8000-000000009078', '1.1.0', '2.0.0', run.source_id,
  prior.source_record_key, 2, prior.id, run.id, raw.id,
  run.adapter_release_id, 'test-aba-revision-b2', raw.content_sha256,
  '1.0.0', now(), '{}'::jsonb, '{"state":"b"}'::jsonb
from ingest.runs as run
join ingest.raw_objects as raw on raw.run_id = run.id
cross join ingest.source_revisions as prior
where run.public_id = '018f0000-0000-7000-8000-000000009068'
  and raw.public_id = '018f0000-0000-7000-8000-000000009075'
  and prior.public_id = '018f0000-0000-7000-8000-000000009076';

select lives_ok(
  $$
    insert into ingest.source_revisions (
      public_id, contract_version, identity_version, source_id, source_record_key,
      revision_no, previous_revision_id, run_id, raw_object_id, adapter_release_id,
      idempotency_key, content_sha256, schema_version, retrieved_at,
      raw_payload, canonical_data
    )
    select
      '018f0000-0000-7000-8000-000000009079', '1.1.0', '2.0.0', run.source_id,
      prior.source_record_key, 3, prior.id, run.id, raw.id,
      run.adapter_release_id, 'test-aba-revision-a3', raw.content_sha256,
      '1.0.0', now(), '{}'::jsonb, '{"state":"a"}'::jsonb
    from ingest.runs as run
    join ingest.raw_objects as raw on raw.run_id = run.id
    cross join ingest.source_revisions as prior
    where run.public_id = '018f0000-0000-7000-8000-000000009068'
      and raw.public_id = '018f0000-0000-7000-8000-000000009077'
      and prior.public_id = '018f0000-0000-7000-8000-000000009078'
  $$,
  'source revision chain permits an A to B to A content restoration'
);

select ok(
  (select revision.revision_no = 3
      and revision.content_sha256 = blob.content_sha256
   from ingest.source_revisions as revision
   cross join ingest.content_blobs as blob
   where revision.public_id = '018f0000-0000-7000-8000-000000009079'
     and blob.public_id = '018f0000-0000-7000-8000-000000009038')
  and not exists (
    select 1
    from ingest.source_revisions as successor
    where successor.previous_revision_id = (
      select id from ingest.source_revisions
      where public_id = '018f0000-0000-7000-8000-000000009079'
    )
  ),
  'restored A revision is the current immutable chain tip'
);

insert into ingest.global_observations (
  public_id, contract_version, identity_version, source_id, source_revision_id,
  idempotency_key, observation_kind, source_record_key, observed_at,
  observed_precision, effective_at, effective_precision, retrieved_at,
  trust_class, evidence_class, visibility, validation_state, ingested_at
)
select
  '018f0000-0000-7000-8000-000000009041', '1.1.0', '2.0.0', sr.source_id,
  sr.id, 'test-official-observation', 'official_status', sr.source_record_key,
  now() - interval '16 minutes', 'exact', now() - interval '16 minutes',
  'exact', now() - interval '16 minutes', 'authoritative',
  'authority_incident_update', 'public', 'accepted', now() - interval '16 minutes'
from ingest.source_revisions as sr
where sr.public_id = '018f0000-0000-7000-8000-000000009040';

insert into ingest.incident_relevance (
  public_id, contract_version, incident_id, aoi_version_id, observation_cursor,
  idempotency_key, method, relevance_score, rationale, evaluator,
  evaluator_version, evaluated_at
)
select
  '018f0000-0000-7000-8000-000000009042', '1.1.0', i.id, a.id, o.cursor,
  'test-official-relevance', 'analyst_link', 1, '{}'::jsonb,
  'test-reconciler', '1.0.0', now() - interval '15 minutes'
from core.incidents as i
join core.aoi_versions as a on a.incident_id = i.id
cross join ingest.global_observations as o
where i.slug = 'test-public-incident'
  and o.public_id = '018f0000-0000-7000-8000-000000009041';

insert into truth.assertions (
  public_id, contract_version, incident_id, assertion_key, version_no,
  observation_cursor, idempotency_key, assertion_type, subject_type,
  subject_key, predicate, value, authority_scope, assertion_status,
  effective_at, effective_precision, expires_at, extraction_method, extraction_version,
  asserted_at, recorded_at
)
select
  '018f0000-0000-7000-8000-000000009043', '1.1.0', i.id,
  'official-status-assertion', 1, o.cursor, 'test-official-assertion',
  'report', 'incident', i.slug, 'official_status_transition',
  '{"fromStatus":"in_progress","toStatus":"ended"}'::jsonb,
  'incident_status', 'active', now() - interval '14 minutes', 'exact',
  now() + interval '1 day', 'deterministic_parser', '1.0.0', now() - interval '14 minutes',
  now() - interval '14 minutes'
from core.incidents as i
cross join ingest.global_observations as o
where i.slug = 'test-public-incident'
  and o.public_id = '018f0000-0000-7000-8000-000000009041';

insert into truth.events (
  public_id, contract_version, incident_id, idempotency_key, event_type,
  first_effective_at, first_effective_precision, actor_kind,
  source_revision_id, observation_cursor, lifecycle, verification_state,
  current_summary_en, translation_state, reconciliation_version, visibility,
  payload, recorded_at
)
select
  '018f0000-0000-7000-8000-000000009044', '1.1.0', i.id,
  'test-official-status-event', 'official_status_transition',
  now() - interval '14 minutes', 'exact', 'authority', sr.id, o.cursor,
  'active', 'official', 'Official ended state', 'complete',
  'test-reconciliation-1', 'public',
  '{"fromStatus":"in_progress","toStatus":"ended"}'::jsonb,
  now() - interval '13 minutes'
from core.incidents as i
cross join ingest.source_revisions as sr
cross join ingest.global_observations as o
where i.slug = 'test-public-incident'
  and sr.public_id = '018f0000-0000-7000-8000-000000009040'
  and o.public_id = '018f0000-0000-7000-8000-000000009041';

insert into truth.evidence (
  public_id, contract_version, incident_id, event_cursor, assertion_cursor,
  idempotency_key, relationship, rationale_code, linked_by, recorded_at
)
select
  '018f0000-0000-7000-8000-000000009045', '1.1.0', e.incident_id,
  e.cursor, a.cursor, 'test-official-evidence', 'supports',
  'source-statement', 'test-reconciler', now() - interval '12 minutes'
from truth.events as e
join truth.assertions as a on a.incident_id = e.incident_id
where e.public_id = '018f0000-0000-7000-8000-000000009044'
  and a.public_id = '018f0000-0000-7000-8000-000000009043';

set local role firewatch_collector;

select ok(
  (
    select ingest.finish_ingestion_run(
      p_run_id => run.id,
      p_lease_token => run.lease_token,
      p_worker_id => run.lease_owner,
      p_status => 'success',
      p_request_count => 3,
      p_fetched_count => 1,
      p_accepted_count => 1,
      p_cursor_before => '{}'::jsonb,
      p_cursor_after => '{"cursor":"official-1"}'::jsonb
    )
    from ingest.runs as run
    where run.public_id = '018f0000-0000-7000-8000-000000009068'
  ),
  'attempt two atomically finalizes run metrics, cursor, and job success'
);

reset role;

select ok(
  (select status = 'success' and request_count = 3 and accepted_count = 1
   from ingest.runs
   where public_id = '018f0000-0000-7000-8000-000000009068')
  and (select status = 'succeeded' and attempt_count = 2 and completed_at is not null
       from ingest.jobs
       where public_id = '018f0000-0000-7000-8000-000000009036')
  and (select cursor_state = '{"cursor":"official-1"}'::jsonb
       from ingest.collection_target_state as state
       join core.collection_target_revisions as revision
         on revision.id = state.collection_target_revision_id
       where revision.public_id = '018f0000-0000-7000-8000-000000009035'),
  'successful retry retains attempt history and advances the cursor once'
);

insert into truth.source_health (
  public_id, contract_version, source_id, endpoint_id, collection_target_id,
  collection_target_revision_id, run_id, idempotency_key, status, visibility,
  checked_at
)
select
  '018f0000-0000-7000-8000-000000009069', '1.1.0', run.source_id,
  run.endpoint_id, run.collection_target_id, run.collection_target_revision_id,
  run.id, 'test-official-source-health', 'healthy', 'public',
  now() - interval '1 day'
from ingest.runs as run
where run.public_id = '018f0000-0000-7000-8000-000000009068';

insert into truth.snapshots (
  public_id, contract_version, identity_version, incident_id, version_no,
  basis_event_cursor, ruleset_version, idempotency_key, as_of, state_sha256,
  state, created_at
)
select
  '018f0000-0000-7000-8000-000000009070', '1.1.0', '2.0.0', event.incident_id,
  1, event.cursor, 'test-ruleset-1', 'test-official-snapshot', now(),
  repeat('a', 64), '{}'::jsonb, now() - interval '1 day'
from truth.events as event
where event.public_id = '018f0000-0000-7000-8000-000000009044';

insert into truth.material_changes (
  public_id, contract_version, incident_id, sequence_no, to_snapshot_cursor,
  basis_event_cursor, idempotency_key, rule_id, rule_version, change_type,
  materiality, calculated_at, evidence_event_cursors, notification_eligible,
  change_data, created_at
)
select
  '018f0000-0000-7000-8000-000000009071', '1.1.0', snapshot.incident_id,
  1, snapshot.cursor, event.cursor, 'test-official-material-change',
  'incident.created', 1, 'incident_created', 'medium',
  now() - interval '1 day', array[event.cursor], false, '{}'::jsonb,
  now() - interval '1 day'
from truth.snapshots as snapshot
join truth.events as event
  on event.cursor = snapshot.basis_event_cursor
  and event.incident_id = snapshot.incident_id
where snapshot.public_id = '018f0000-0000-7000-8000-000000009070';

select ok(
  (select checked_at = now() and created_at = now()
   from truth.source_health
   where public_id = '018f0000-0000-7000-8000-000000009069')
  and (select created_at = now()
       from truth.snapshots
       where public_id = '018f0000-0000-7000-8000-000000009070')
  and (select calculated_at = now() and created_at = now()
       from truth.material_changes
       where public_id = '018f0000-0000-7000-8000-000000009071'),
  'health, snapshot, and material-change admission clocks are database owned'
);

set local role firewatch_publisher;

select throws_ok(
  $$
    insert into truth.publications (
      public_id, contract_version, incident_id, snapshot_cursor,
      idempotency_key, action, actor_kind, action_at
    )
    select
      '018f0000-0000-7000-8000-000000009072', '1.1.0', snapshot.incident_id,
      snapshot.cursor, 'test-backdated-snapshot-publication', 'publish',
      'system', now() - interval '1 minute'
    from truth.snapshots as snapshot
    where snapshot.public_id = '018f0000-0000-7000-8000-000000009070'
  $$,
  '23514',
  'publication action cannot predate its database-recorded subject',
  'publisher cannot backdate a snapshot publication before snapshot admission'
);

select throws_ok(
  $$
    insert into truth.publications (
      public_id, contract_version, incident_id, material_change_cursor,
      idempotency_key, action, actor_kind, action_at
    )
    select
      '018f0000-0000-7000-8000-000000009073', '1.1.0', change.incident_id,
      change.cursor, 'test-backdated-change-publication', 'publish',
      'system', now() - interval '1 minute'
    from truth.material_changes as change
    where change.public_id = '018f0000-0000-7000-8000-000000009071'
  $$,
  '23514',
  'publication action cannot predate its database-recorded subject',
  'publisher cannot backdate a change publication before calculation/admission'
);

reset role;

select ok(
  truth.official_status_event_has_publishable_authority(
    (select cursor from truth.events where public_id = '018f0000-0000-7000-8000-000000009044'),
    (select id from core.incidents where slug = 'test-public-incident'),
    now(),
    now()
  ),
  'canonical official_status observation and exact assertion authorize its matching event'
);

set local role firewatch_publisher;

select lives_ok(
  $$
    insert into truth.publications (
      public_id, contract_version, incident_id, event_cursor,
      idempotency_key, action, actor_kind, action_at
    )
    select
      '018f0000-0000-7000-8000-000000009046', '1.1.0', e.incident_id,
      e.cursor, 'test-official-status-publication', 'publish', 'authority',
      now()
    from truth.events as e
    where e.public_id = '018f0000-0000-7000-8000-000000009044'
  $$,
  'matching authoritative official-status provenance can publish'
);

reset role;

set local role anon;

select ok(
  (select lifecycle = 'active' and official_status = 'ended'
   from api.incidents where slug = 'test-public-incident')
  and (select count(*) = 1
       from api.incident_timeline
       where event_id = '018f0000-0000-7000-8000-000000009044'::uuid),
  'official status and timeline appear only after an authority-backed publication'
);

reset role;

select ok(
  not truth.official_status_event_has_publishable_authority(
    (select cursor from truth.events
     where public_id = '018f0000-0000-7000-8000-000000009044'),
    (select id from core.incidents where slug = 'test-public-incident'),
    now(),
    now() + interval '2 days'
  )
  and not truth.publication_subject_is_dispatchable(
    (select cursor from truth.publications
     where public_id = '018f0000-0000-7000-8000-000000009046'),
    (select id from core.incidents where slug = 'test-public-incident'),
    (select cursor from truth.events
     where public_id = '018f0000-0000-7000-8000-000000009044'),
    null,
    now() + interval '2 days'
  ),
  'assertion expiry is evaluated at publication knowledge and delayed-dispatch time'
);

insert into truth.assertions (
  public_id, contract_version, incident_id, assertion_key, version_no,
  observation_cursor, idempotency_key, assertion_type, subject_type,
  subject_key, predicate, value, authority_scope, assertion_status,
  effective_at, effective_precision, extraction_method, extraction_version,
  asserted_at
)
select
  '018f0000-0000-7000-8000-000000009082', '1.1.0', incident.id,
  'test-road-assertion', 1, observation.cursor, 'test-road-assertion',
  'report', 'road', 'test-road', 'road_condition',
  '{"roadName":"Test Road","state":"closed","direction":null}'::jsonb,
  'road_status', 'active', now(), 'exact', 'deterministic_parser',
  '1.0.0', now()
from core.incidents as incident
cross join ingest.global_observations as observation
where incident.slug = 'test-public-incident'
  and observation.public_id = '018f0000-0000-7000-8000-000000009041';

insert into truth.events (
  public_id, contract_version, incident_id, idempotency_key, event_type,
  first_effective_at, first_effective_precision, actor_kind,
  source_revision_id, observation_cursor, lifecycle, verification_state,
  current_summary_en, translation_state, reconciliation_version, visibility,
  payload
)
select
  '018f0000-0000-7000-8000-000000009083', '1.1.0', incident.id,
  'test-road-event', 'road_condition', now(), 'exact', 'source', revision.id,
  observation.cursor, 'active', 'single_source', 'Test Road is closed',
  'complete', 'test-reconciliation-1', 'public',
  '{"roadName":"Test Road","state":"closed","direction":null}'::jsonb
from core.incidents as incident
cross join ingest.source_revisions as revision
cross join ingest.global_observations as observation
where incident.slug = 'test-public-incident'
  and revision.public_id = '018f0000-0000-7000-8000-000000009040'
  and observation.public_id = '018f0000-0000-7000-8000-000000009041';

insert into truth.evidence (
  public_id, contract_version, incident_id, event_cursor, assertion_cursor,
  idempotency_key, relationship, rationale_code, linked_by
)
select
  '018f0000-0000-7000-8000-000000009084', '1.1.0', event.incident_id,
  event.cursor, assertion.cursor, 'test-road-evidence', 'supports',
  'source-statement', 'test-reconciler'
from truth.events as event
join truth.assertions as assertion on assertion.incident_id = event.incident_id
where event.public_id = '018f0000-0000-7000-8000-000000009083'
  and assertion.public_id = '018f0000-0000-7000-8000-000000009082';

insert into truth.assertions (
  public_id, contract_version, incident_id, assertion_key, version_no,
  observation_cursor, idempotency_key, assertion_type, subject_type,
  subject_key, predicate, value, authority_scope, assertion_status,
  effective_at, effective_precision, extraction_method, extraction_version,
  asserted_at
)
select
  '018f0000-0000-7000-8000-000000009087', '1.1.0', incident.id,
  'test-settlement-assertion', 1, observation.cursor,
  'test-settlement-assertion', 'report', 'settlement', 'test-settlement',
  'settlement_threat',
  '{"settlementName":"Test Village","reportedRelationship":"threatened"}'::jsonb,
  'local_context', 'active', now(), 'exact', 'deterministic_parser',
  '1.0.0', now()
from core.incidents as incident
cross join ingest.global_observations as observation
where incident.slug = 'test-public-incident'
  and observation.public_id = '018f0000-0000-7000-8000-000000009041';

insert into truth.events (
  public_id, contract_version, incident_id, idempotency_key, event_type,
  first_effective_at, first_effective_precision, actor_kind,
  source_revision_id, observation_cursor, lifecycle, verification_state,
  current_summary_en, translation_state, reconciliation_version, visibility,
  payload
)
select
  '018f0000-0000-7000-8000-000000009088', '1.1.0', incident.id,
  'test-settlement-event', 'settlement_threat', now(), 'exact', 'source',
  revision.id, observation.cursor, 'active', 'single_source',
  'Test Village is threatened', 'complete', 'test-reconciliation-1', 'public',
  '{"settlementName":"Test Village","reportedRelationship":"threatened"}'::jsonb
from core.incidents as incident
cross join ingest.source_revisions as revision
cross join ingest.global_observations as observation
where incident.slug = 'test-public-incident'
  and revision.public_id = '018f0000-0000-7000-8000-000000009040'
  and observation.public_id = '018f0000-0000-7000-8000-000000009041';

insert into truth.evidence (
  public_id, contract_version, incident_id, event_cursor, assertion_cursor,
  idempotency_key, relationship, rationale_code, linked_by
)
select
  '018f0000-0000-7000-8000-000000009089', '1.1.0', event.incident_id,
  event.cursor, assertion.cursor, 'test-settlement-evidence', 'supports',
  'source-statement', 'test-reconciler'
from truth.events as event
join truth.assertions as assertion on assertion.incident_id = event.incident_id
where event.public_id = '018f0000-0000-7000-8000-000000009088'
  and assertion.public_id = '018f0000-0000-7000-8000-000000009087';

set local role firewatch_publisher;

select lives_ok(
  $$
    insert into truth.publications (
      public_id, contract_version, incident_id, event_cursor,
      idempotency_key, action, actor_kind, action_at
    )
    select
      '018f0000-0000-7000-8000-000000009085', '1.1.0', event.incident_id,
      event.cursor, 'test-road-publication', 'publish', 'system', now()
    from truth.events as event
    where event.public_id = '018f0000-0000-7000-8000-000000009083'
  $$,
  'generic road evidence may publish to the read model'
);

select lives_ok(
  $$
    insert into truth.publications (
      public_id, contract_version, incident_id, event_cursor,
      idempotency_key, action, actor_kind, action_at
    )
    select
      '018f0000-0000-7000-8000-000000009090', '1.1.0', event.incident_id,
      event.cursor, 'test-settlement-publication', 'publish', 'system', now()
    from truth.events as event
    where event.public_id = '018f0000-0000-7000-8000-000000009088'
  $$,
  'generic settlement evidence may publish to the read model'
);

reset role;

set local role firewatch_dispatcher;

select throws_ok(
  $$
    insert into truth.outbox (
      public_id, contract_version, incident_id, publication_cursor,
      event_cursor, idempotency_key, topic, partition_key, payload
    )
    select
      '018f0000-0000-7000-8000-000000009086', '1.1.0', publication.incident_id,
      publication.cursor, event.cursor, 'test-road-outbox',
      'incident.road_condition', incident.public_id::uuid::text,
      jsonb_build_object(
        'contractVersion', '1.1.0',
        'publicationId', publication.public_id::uuid::text,
        'subjectKind', 'event',
        'subjectId', event.public_id::uuid::text
      )
    from truth.publications as publication
    join truth.events as event on event.cursor = publication.event_cursor
    join core.incidents as incident on incident.id = event.incident_id
    where publication.public_id = '018f0000-0000-7000-8000-000000009085'
  $$,
  '23514',
  'outbox enqueue requires the current authorized publish action',
  'road alerts fail closed until a claim-specific authority gate exists'
);

select throws_ok(
  $$
    insert into truth.outbox (
      public_id, contract_version, incident_id, publication_cursor,
      event_cursor, idempotency_key, topic, partition_key, payload
    )
    select
      '018f0000-0000-7000-8000-000000009091', '1.1.0', publication.incident_id,
      publication.cursor, event.cursor, 'test-settlement-outbox',
      'incident.settlement_threat', incident.public_id::uuid::text,
      jsonb_build_object(
        'contractVersion', '1.1.0',
        'publicationId', publication.public_id::uuid::text,
        'subjectKind', 'event',
        'subjectId', event.public_id::uuid::text
      )
    from truth.publications as publication
    join truth.events as event on event.cursor = publication.event_cursor
    join core.incidents as incident on incident.id = event.incident_id
    where publication.public_id = '018f0000-0000-7000-8000-000000009090'
  $$,
  '23514',
  'outbox enqueue requires the current authorized publish action',
  'settlement alerts fail closed until a claim-specific corroboration gate exists'
);

reset role;

select ok(
  (select recorded_at = now() from ingest.source_revisions
   where public_id = '018f0000-0000-7000-8000-000000009040')
  and (select ingested_at = now() from ingest.global_observations
       where public_id = '018f0000-0000-7000-8000-000000009041')
  and (select evaluated_at = now() from ingest.incident_relevance
       where public_id = '018f0000-0000-7000-8000-000000009042')
  and (select recorded_at = now() from truth.assertions
       where public_id = '018f0000-0000-7000-8000-000000009043')
  and (select recorded_at = now() from truth.events
       where public_id = '018f0000-0000-7000-8000-000000009044')
  and (select recorded_at = now() from truth.evidence
       where public_id = '018f0000-0000-7000-8000-000000009045'),
  'provenance admission clocks ignore caller-supplied backdated values'
);

-- A noncritical event cannot borrow an accepted assertion and substitute a
-- different event predicate/payload.
insert into truth.events (
  public_id, contract_version, incident_id, idempotency_key, event_type,
  actor_kind, source_revision_id, observation_cursor, lifecycle,
  verification_state, current_summary_en, translation_state,
  reconciliation_version, visibility, payload
)
select
  '018f0000-0000-7000-8000-000000009063', '1.1.0', i.id,
  'test-borrowed-weather-event', 'weather_observation', 'system', sr.id,
  o.cursor, 'active', 'single_source', 'Borrowed evidence weather event',
  'complete', 'test-reconciliation-1', 'public',
  '{"basis":"measured","stationOrModel":"Test","windSpeedKmh":10,"windGustKmh":null,"windDirectionDeg":90}'::jsonb
from core.incidents as i
cross join ingest.source_revisions as sr
cross join ingest.global_observations as o
where i.slug = 'test-public-incident'
  and sr.public_id = '018f0000-0000-7000-8000-000000009040'
  and o.public_id = '018f0000-0000-7000-8000-000000009041';

insert into truth.evidence (
  public_id, contract_version, incident_id, event_cursor, assertion_cursor,
  idempotency_key, relationship, rationale_code, linked_by
)
select
  '018f0000-0000-7000-8000-000000009064', '1.1.0', e.incident_id,
  e.cursor, a.cursor, 'test-borrowed-weather-evidence', 'supports',
  'borrowed-claim', 'test-reconciler'
from truth.events as e
join truth.assertions as a on a.incident_id = e.incident_id
where e.public_id = '018f0000-0000-7000-8000-000000009063'
  and a.public_id = '018f0000-0000-7000-8000-000000009043';

select ok(
  not truth.event_has_publishable_evidence(
    (select cursor from truth.events where public_id = '018f0000-0000-7000-8000-000000009063'),
    (select id from core.incidents where slug = 'test-public-incident'),
    now(), now()
  ),
  'generic publication gate rejects borrowed evidence with a mismatched claim'
);

set local role firewatch_publisher;

select throws_ok(
  $$
    insert into truth.publications (
      public_id, contract_version, incident_id, event_cursor,
      idempotency_key, action, actor_kind, action_at
    )
    select
      '018f0000-0000-7000-8000-000000009065', '1.1.0', e.incident_id,
      e.cursor, 'test-borrowed-weather-publication', 'publish', 'system', now()
    from truth.events as e
    where e.public_id = '018f0000-0000-7000-8000-000000009063'
  $$,
  '23514',
  'publication subject lacks accepted evidence-backed provenance',
  'publisher cannot substitute a noncritical event payload over unrelated evidence'
);

reset role;

set local role firewatch_dispatcher;

select lives_ok(
  $$
    insert into truth.outbox (
      public_id, contract_version, incident_id, publication_cursor,
      event_cursor, idempotency_key, topic, partition_key, payload
    )
    select
      '018f0000-0000-7000-8000-000000009047', '1.1.0', p.incident_id,
      p.cursor, e.cursor, 'test-official-outbox', 'incident.status',
      i.public_id::uuid::text,
      jsonb_build_object(
        'contractVersion', '1.1.0',
        'publicationId', p.public_id::uuid::text,
        'subjectKind', 'event',
        'subjectId', e.public_id::uuid::text
      )
    from truth.publications as p
    join truth.events as e on e.cursor = p.event_cursor
    join core.incidents as i on i.id = e.incident_id
    where p.public_id = '018f0000-0000-7000-8000-000000009046'
  $$,
  'dispatcher can enqueue the exact identifier envelope for a current publication'
);

select throws_ok(
  $$
    insert into truth.outbox (
      public_id, contract_version, incident_id, publication_cursor,
      event_cursor, idempotency_key, topic, partition_key, payload
    )
    select
      '018f0000-0000-7000-8000-000000009080', '1.1.0', p.incident_id,
      p.cursor, e.cursor, 'test-status-on-protective-topic',
      'incident.protective', i.public_id::uuid::text,
      jsonb_build_object(
        'contractVersion', '1.1.0',
        'publicationId', p.public_id::uuid::text,
        'subjectKind', 'event',
        'subjectId', e.public_id::uuid::text
      )
    from truth.publications as p
    join truth.events as e on e.cursor = p.event_cursor
    join core.incidents as i on i.id = e.incident_id
    where p.public_id = '018f0000-0000-7000-8000-000000009046'
  $$,
  '23514',
  'outbox route must match the publication subject and incident',
  'official status cannot be routed onto the protective-alert topic'
);

select throws_ok(
  $$
    insert into truth.outbox (
      public_id, contract_version, incident_id, publication_cursor,
      event_cursor, idempotency_key, topic, partition_key, payload
    )
    select
      '018f0000-0000-7000-8000-000000009081', '1.1.0', p.incident_id,
      p.cursor, e.cursor, 'test-status-wrong-partition',
      'incident.status', 'caller-controlled-partition',
      jsonb_build_object(
        'contractVersion', '1.1.0',
        'publicationId', p.public_id::uuid::text,
        'subjectKind', 'event',
        'subjectId', e.public_id::uuid::text
      )
    from truth.publications as p
    join truth.events as e on e.cursor = p.event_cursor
    where p.public_id = '018f0000-0000-7000-8000-000000009046'
  $$,
  '23514',
  'outbox route must match the publication subject and incident',
  'outbox partition is the canonical incident public ID, not caller-controlled'
);

select throws_ok(
  $$
    insert into truth.outbox (
      public_id, contract_version, incident_id, publication_cursor,
      event_cursor, idempotency_key, topic, partition_key, payload
    )
    select
      '018f0000-0000-7000-8000-000000009059', '1.1.0', p.incident_id,
      p.cursor, e.cursor, 'test-arbitrary-outbox', 'incident.status.bad',
      e.incident_id::text, '{"claim":"forged text"}'::jsonb
    from truth.publications as p
    join truth.events as e on e.cursor = p.event_cursor
    where p.public_id = '018f0000-0000-7000-8000-000000009046'
  $$,
  '23514',
  'outbox payload must be the exact publication identifier envelope',
  'dispatcher cannot put arbitrary claim text in an outbox payload'
);

select throws_ok(
  $$
    insert into truth.outbox (
      public_id, contract_version, incident_id, publication_cursor,
      event_cursor, idempotency_key, topic, partition_key, payload
    )
    select
      '018f0000-0000-7000-8000-000000009060', '1.1.0', p.incident_id,
      p.cursor, e.cursor, 'test-unpublished-protective-outbox',
      'incident.protective', e.incident_id::text,
      jsonb_build_object(
        'contractVersion', '1.1.0',
        'publicationId', p.public_id::uuid::text,
        'subjectKind', 'event',
        'subjectId', e.public_id::uuid::text
      )
    from truth.publications as p
    cross join truth.events as e
    where p.public_id = '018f0000-0000-7000-8000-000000009046'
      and e.public_id = '018f0000-0000-7000-8000-000000009006'
  $$,
  '23514',
  'outbox enqueue requires the current authorized publish action',
  'an unpublished protective event cannot borrow another subject publication to enqueue'
);

select throws_ok(
  $$
    insert into truth.outbox (
      public_id, contract_version, incident_id, publication_cursor,
      event_cursor, idempotency_key, topic, partition_key, payload
    )
    select
      '018f0000-0000-7000-8000-000000009061', '1.1.0', p.incident_id,
      p.cursor, e.cursor, 'test-duplicate-official-outbox', 'incident.status',
      i.public_id::uuid::text,
      jsonb_build_object(
        'contractVersion', '1.1.0',
        'publicationId', p.public_id::uuid::text,
        'subjectKind', 'event',
        'subjectId', e.public_id::uuid::text
      )
    from truth.publications as p
    join truth.events as e on e.cursor = p.event_cursor
    join core.incidents as i on i.id = e.incident_id
    where p.public_id = '018f0000-0000-7000-8000-000000009046'
  $$,
  '23505',
  'duplicate key value violates unique constraint "outbox_publication_topic_key"',
  'one publication cannot enqueue the same notification topic twice'
);

reset role;

insert into truth.assertions (
  public_id, contract_version, incident_id, assertion_key, version_no,
  previous_assertion_cursor, observation_cursor, idempotency_key,
  assertion_type, subject_type, subject_key, predicate, value,
  authority_scope, assertion_status, effective_at, effective_precision,
  extraction_method, extraction_version, asserted_at, recorded_at
)
select
  '018f0000-0000-7000-8000-000000009049', '1.1.0', assertion.incident_id,
  assertion.assertion_key, 2, assertion.cursor, assertion.observation_cursor,
  'test-official-assertion-retraction', assertion.assertion_type,
  assertion.subject_type, assertion.subject_key, assertion.predicate,
  assertion.value, assertion.authority_scope, 'retracted',
  assertion.effective_at, 'exact', assertion.extraction_method,
  assertion.extraction_version, now(), now() + interval '1 day'
from truth.assertions as assertion
where assertion.public_id = '018f0000-0000-7000-8000-000000009043';

select is(
  (select recorded_at from truth.assertions
   where public_id = '018f0000-0000-7000-8000-000000009049'),
  now(),
  'future-dated assertion successor is overwritten with the database audit clock'
);

set local role anon;

select ok(
  (select count(*) = 0
   from api.incident_timeline
   where event_id = '018f0000-0000-7000-8000-000000009044'::uuid)
  and (select official_status is null
       from api.incidents where slug = 'test-public-incident'),
  'current API projections immediately hide a published claim with a retracted assertion tip'
);

reset role;

set local role firewatch_dispatcher;

select is(
  (select count(*) from truth.claim_outbox_message('test-dispatcher')),
  0::bigint,
  'dispatcher cannot claim a publication whose evidence chain became stale'
);

reset role;

select is(
  (select status from truth.outbox
   where public_id = '018f0000-0000-7000-8000-000000009047'),
  'dead',
  'claim revalidation dead-letters stale pending outbox work'
);

set local role firewatch_publisher;

select lives_ok(
  $$
    insert into truth.publications (
      public_id, contract_version, incident_id, event_cursor,
      previous_publication_cursor, idempotency_key, action, actor_kind,
      action_at, reason
    )
    select
      '018f0000-0000-7000-8000-000000009048', '1.1.0', p.incident_id,
      p.event_cursor, p.cursor, 'test-official-status-retraction', 'retract',
      'authority', now(), 'test retraction'
    from truth.publications as p
    where p.public_id = '018f0000-0000-7000-8000-000000009046'
  $$,
  'publisher can retract the published official-status event'
);

reset role;

select is(
  (select status from truth.outbox
   where public_id = '018f0000-0000-7000-8000-000000009047'),
  'dead',
  'publication retraction atomically dead-letters pending outbox work'
);

set local role firewatch_dispatcher;

select throws_ok(
  $$
    insert into truth.outbox (
      public_id, contract_version, incident_id, publication_cursor,
      event_cursor, idempotency_key, topic, partition_key, payload
    )
    select
      '018f0000-0000-7000-8000-000000009062', '1.1.0', p.incident_id,
      p.cursor, e.cursor, 'test-retracted-official-outbox',
      'incident.status.retracted', e.incident_id::text,
      jsonb_build_object(
        'contractVersion', '1.1.0',
        'publicationId', p.public_id::uuid::text,
        'subjectKind', 'event',
        'subjectId', e.public_id::uuid::text
      )
    from truth.publications as p
    join truth.events as e on e.cursor = p.event_cursor
    where p.public_id = '018f0000-0000-7000-8000-000000009046'
  $$,
  '23514',
  'outbox enqueue requires the current authorized publish action',
  'dispatcher cannot enqueue a retracted publication'
);

reset role;

set local role firewatch_publisher;

select throws_ok(
  $$
    insert into truth.publications (
      public_id, contract_version, incident_id, event_cursor,
      previous_publication_cursor, idempotency_key, action, actor_kind,
      action_at
    )
    select
      '018f0000-0000-7000-8000-000000009050', '1.1.0', p.incident_id,
      p.event_cursor, p.cursor, 'test-backdated-status-republication',
      'publish', 'system', now()
    from truth.publications as p
    where p.public_id = '018f0000-0000-7000-8000-000000009048'
  $$,
  '23514',
  'official status transition lacks accepted authoritative provenance',
  'publisher cannot revive an event after the assertion chain tip is retracted'
);

reset role;

set local role anon;

select is(
  (select count(*) from api.incidents where slug like 'test-%'),
  1::bigint,
  'API RLS exposes the public test incident and hides the internal incident'
);

select lives_ok($$select count(*) from api.source_catalog$$,
  'anon can execute the source catalog security-invoker projection');
select lives_ok($$select count(*) from api.incidents$$,
  'anon can execute the incident security-invoker projection');
select lives_ok($$select count(*) from api.incident_observations$$,
  'anon can execute the observation security-invoker projection');
select lives_ok($$select count(*) from api.incident_timeline$$,
  'anon can execute the timeline security-invoker projection');
select lives_ok($$select count(*) from api.incident_truth$$,
  'anon can execute the truth security-invoker projection without snapshot state access');
select lives_ok($$select count(*) from api.incident_changes$$,
  'anon can execute the change security-invoker projection');
select lives_ok($$select count(*) from api.source_health$$,
  'anon can execute the health security-invoker projection without health details access');

select lives_ok(
  $$select count(*) from core.collection_targets$$,
  'anon target policy does not require access to private endpoint configuration'
);

select ok(
  not has_table_privilege('anon', 'core.endpoints', 'SELECT')
  and not has_table_privilege('authenticated', 'core.endpoints', 'SELECT'),
  'endpoint credentials and request configuration remain private'
);

reset role;

select * from finish();
rollback;
