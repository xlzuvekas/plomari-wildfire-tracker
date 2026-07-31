begin;

create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public, pg_catalog;

select no_plan();

select ok(
  to_regprocedure(
    'api.nearby_incidents_v3(integer,integer,integer,timestamptz,timestamptz,timestamptz,text,integer)'
  ) is not null,
  'bounded v3 Nearby RPC exists'
);

select ok(
  (
    select procedure.prosecdef
    from pg_proc as procedure
    where procedure.oid =
      'api.nearby_incidents_v3(integer,integer,integer,timestamptz,timestamptz,timestamptz,text,integer)'::regprocedure
  ),
  'Nearby projection is a deliberately narrow SECURITY DEFINER boundary'
);

select ok(
  has_function_privilege(
    'firewatch_discovery_reader',
    'api.nearby_incidents_v3(integer,integer,integer,timestamptz,timestamptz,timestamptz,text,integer)',
    'EXECUTE'
  )
  and not has_function_privilege(
    'anon',
    'api.nearby_incidents_v3(integer,integer,integer,timestamptz,timestamptz,timestamptz,text,integer)',
    'EXECUTE'
  )
  and not has_function_privilege(
    'authenticated',
    'api.nearby_incidents_v3(integer,integer,integer,timestamptz,timestamptz,timestamptz,text,integer)',
    'EXECUTE'
  )
  and not has_function_privilege(
    'service_role',
    'api.nearby_incidents_v3(integer,integer,integer,timestamptz,timestamptz,timestamptz,text,integer)',
    'EXECUTE'
  )
  and not has_function_privilege(
    'firewatch_collector',
    'api.nearby_incidents_v3(integer,integer,integer,timestamptz,timestamptz,timestamptz,text,integer)',
    'EXECUTE'
  ),
  'only the scoped server discovery role can execute the RPC'
);

select ok(
  pg_has_role('authenticator', 'firewatch_discovery_reader', 'MEMBER')
  and not pg_has_role('anon', 'firewatch_discovery_reader', 'MEMBER')
  and not (
    select rolsuper or rolreplication or rolbypassrls or rolcanlogin or rolinherit
    from pg_roles where rolname = 'firewatch_discovery_reader'
  ),
  'PostgREST may assume a no-login, no-inherit, non-privileged reader role'
);

set local role firewatch_discovery_reader;

select throws_ok(
  $$select * from api.nearby_incidents_v3(
      6, 36, 24,
      now() - interval '1 hour', now(), now()
    )$$,
  '22023',
  'Web Mercator cell zoom must be between 7 and 11',
  'direct callers cannot bypass the canonical cell zoom boundary'
);

select throws_ok(
  $$select * from api.nearby_incidents_v3(
      7, 64, 64,
      now() - interval '1 hour', now(), now()
    )$$,
  '22023',
  'Web Mercator cell span must be between 8 and 80 kilometres',
  'direct callers cannot amplify Nearby through an oversized cell'
);

select throws_ok(
  $$select * from api.nearby_incidents_v3(
      11, 0, 0,
      now() - interval '1 hour', now(), now()
    )$$,
  '22023',
  'Web Mercator cell span must be between 8 and 80 kilometres',
  'direct callers cannot request a sub-policy polar cell'
);

select throws_ok(
  $$select * from api.nearby_incidents_v3(
      10, 587, 391,
      now() - interval '8 days', now(), now()
    )$$,
  '22023',
  'Nearby cutoffs must be ordered, current within 31 days, and use at most a 7-day observation window',
  'direct callers cannot request an unbounded observation window'
);

select throws_ok(
  $$select * from api.nearby_incidents_v3(
      10, 587, 391,
      now() - interval '1 hour', now(), now(),
      'Not/A_Time_Zone'
    )$$,
  '22023',
  'Nearby scope time zone is invalid',
  'direct callers cannot inject an unresolved display time zone'
);

reset role;

-- Isolate the projection's spatial/temporal/withdrawal behavior from the much
-- larger evidence-chain fixture. These transaction-local replacements retain
-- append-only publish/retract semantics and roll back with all seeded rows.
create or replace function truth.publication_subject_is_current(
  p_publication_cursor bigint,
  p_incident_id bigint,
  p_event_cursor bigint,
  p_snapshot_cursor bigint,
  p_material_change_cursor bigint,
  p_as_of timestamptz
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from truth.publications as publication
    where publication.cursor = p_publication_cursor
      and publication.incident_id = p_incident_id
      and publication.event_cursor is not distinct from p_event_cursor
      and publication.snapshot_cursor is not distinct from p_snapshot_cursor
      and publication.material_change_cursor is not distinct from p_material_change_cursor
      and publication.action = 'publish'
      and publication.action_at <= p_as_of
      and publication.recorded_at <= p_as_of
      and not exists (
        select 1 from truth.publications as successor
        where successor.previous_publication_cursor = publication.cursor
          and successor.recorded_at <= p_as_of
      )
  );
$$;

create or replace function truth.publication_gate_known_at(
  p_event_cursor bigint,
  p_incident_id bigint,
  p_known_at timestamptz
)
returns timestamptz
language sql
stable
security definer
set search_path = ''
as $$
  select p_known_at - interval '1 minute'
  where p_event_cursor is not null and p_incident_id is not null;
$$;

alter table truth.events disable trigger user;
alter table truth.snapshots disable trigger user;
alter table truth.publications disable trigger user;
alter table core.incidents disable trigger user;

insert into core.incidents (
  public_id, contract_version, slug, name, default_timezone,
  incident_kind, status, visibility, updated_at
)
values
  ('019a0000-0000-7000-8000-000000000101', '1.1.0', 'nearby-exact',
   'Nearby exact', 'Europe/Athens', 'wildfire', 'monitoring', 'public',
   now() - interval '10 minutes'),
  ('019a0000-0000-7000-8000-000000000102', '1.1.0', 'nearby-date-only',
   'Nearby date only', 'Europe/Paris', 'wildfire', 'active', 'public',
   now() - interval '10 minutes'),
  ('019a0000-0000-7000-8000-000000000103', '1.1.0', 'nearby-internal',
   'Internal incident', 'Europe/Athens', 'wildfire', 'active', 'internal',
   now() - interval '10 minutes'),
  ('019a0000-0000-7000-8000-000000000104', '1.1.0', 'nearby-moved',
   'Moved incident', 'Europe/Athens', 'wildfire', 'active', 'public',
   now() - interval '10 minutes'),
  ('019a0000-0000-7000-8000-000000000105', '1.1.0', 'nearby-withdrawn',
   'Withdrawn incident', 'Europe/Athens', 'wildfire', 'active', 'public',
   now() - interval '10 minutes');

insert into truth.events (
  public_id, contract_version, incident_id, idempotency_key, event_type,
  last_effective_at, last_effective_date, last_effective_precision,
  last_effective_timezone, actor_kind, lifecycle, verification_state,
  current_summary_en, translation_state, reconciliation_version, visibility,
  payload, recorded_at
)
select
  incident.public_id, '1.1.0', incident.id, 'nearby-event-' || incident.slug,
  'thermal_detection',
  case when incident.slug = 'nearby-date-only' then null
    else now() - interval '1 hour' end,
  case when incident.slug = 'nearby-date-only'
    then (now() at time zone 'Europe/Paris')::date else null end,
  case when incident.slug = 'nearby-date-only' then 'date_only' else 'exact' end,
  case when incident.slug = 'nearby-date-only' then 'Europe/Paris' else null end,
  'system', 'active', 'corroborated', 'Seeded projection event', 'complete',
  'nearby-projection-test', 'public',
  '{"product":"VIIRS","satellite":"NPP","frpMw":1,"confidence":"nominal","scanKm":1,"trackKm":1}'::jsonb,
  now() - interval '9 minutes'
from core.incidents as incident
where incident.slug like 'nearby-%';

insert into truth.snapshots (
  public_id, contract_version, identity_version, incident_id, version_no,
  basis_event_cursor, ruleset_version, idempotency_key, as_of, state_sha256,
  state, geom, created_at
)
select
  ('019b0000-0000-7000-8000-' || lpad(incident.id::text, 12, '0'))::uuid,
  '1.1.0', '2.0.0', incident.id, 1, event.cursor,
  'nearby-projection-test', 'nearby-snapshot-' || incident.slug,
  now() - interval '1 hour', repeat('a', 64),
  '{}'::jsonb,
  extensions.st_setsrid(extensions.st_makepoint(26.50, 38.95), 4326),
  now() - interval '8 minutes'
from core.incidents as incident
join truth.events as event on event.incident_id = incident.id
where incident.slug like 'nearby-%';

-- A newer out-of-cell snapshot proves that the older intersecting geometry is
-- not a valid current spatial candidate.
insert into truth.snapshots (
  public_id, contract_version, identity_version, incident_id, version_no,
  previous_snapshot_cursor, basis_event_cursor, ruleset_version,
  idempotency_key, as_of, state_sha256, state, geom, created_at
)
select
  '019f0000-0000-7000-8000-000000000204', '1.1.0', '2.0.0',
  incident.id, 2, prior.cursor, event.cursor, 'nearby-projection-test',
  'nearby-snapshot-moved-2', now() - interval '30 minutes', repeat('f', 64),
  '{}'::jsonb,
  extensions.st_setsrid(extensions.st_makepoint(2.35, 48.86), 4326),
  now() - interval '7 minutes'
from core.incidents as incident
join truth.events as event on event.incident_id = incident.id
join truth.snapshots as prior on prior.incident_id = incident.id
where incident.slug = 'nearby-moved';

insert into truth.publications (
  public_id, contract_version, incident_id, event_cursor, idempotency_key,
  action, actor_kind, action_at, recorded_at
)
select
  ('019c0000-0000-7000-8000-' || lpad(incident.id::text, 12, '0'))::uuid,
  '1.1.0', incident.id, event.cursor, 'nearby-event-publish-' || incident.slug,
  'publish', 'system', now() - interval '7 minutes',
  now() - interval '7 minutes' + interval '900 microseconds'
from core.incidents as incident
join truth.events as event on event.incident_id = incident.id
where incident.slug like 'nearby-%';

insert into truth.publications (
  public_id, contract_version, incident_id, snapshot_cursor, idempotency_key,
  action, actor_kind, action_at, recorded_at
)
select
  ('019d0000-0000-7000-8000-' || lpad(snapshot.cursor::text, 12, '0'))::uuid,
  '1.1.0', snapshot.incident_id, snapshot.cursor,
  'nearby-snapshot-publish-' || snapshot.cursor,
  'publish', 'system', now() - interval '6 minutes',
  now() - interval '6 minutes' + interval '900 microseconds'
from truth.snapshots as snapshot;

-- Historical eligibility at p_known_at is insufficient: current withdrawal
-- must win before a row is returned.
insert into truth.publications (
  public_id, contract_version, incident_id, event_cursor,
  previous_publication_cursor, idempotency_key, action, actor_kind,
  action_at, recorded_at
)
select
  '019e0000-0000-7000-8000-000000000105', '1.1.0', publication.incident_id,
  publication.event_cursor, publication.cursor, 'nearby-event-retract-withdrawn',
  'retract', 'system', now() - interval '30 seconds', now() - interval '30 seconds'
from truth.publications as publication
join core.incidents as incident on incident.id = publication.incident_id
where incident.slug = 'nearby-withdrawn'
  and publication.event_cursor is not null
  and publication.action = 'publish';

set local role firewatch_discovery_reader;

select is(
  (
    select count(*)
    from api.nearby_incidents_v3(
      10, 587, 391,
      now() - interval '2 days', now() - interval '1 minute',
      now() - interval '1 minute', 'Europe/Athens', 101
    )
  ),
  2::bigint,
  'only public, intersecting, latest, and still-current incidents are returned'
);

select results_eq(
  $$
    select incident_id
    from api.nearby_incidents_v3(
      10, 587, 391,
      now() - interval '2 days', now() - interval '1 minute',
      now() - interval '1 minute', 'Europe/Athens', 101
    )
  $$,
  $$values
    ('019a0000-0000-7000-8000-000000000102'::uuid),
    ('019a0000-0000-7000-8000-000000000101'::uuid)
  $$,
  'millisecond-safe ordering uses descending UUID for tied knowledge clocks'
);

select is(
  (
    select latest_observed_timezone
    from api.nearby_incidents_v3(
      10, 587, 391,
      now() - interval '2 days', now() - interval '1 minute',
      now() - interval '1 minute', 'Europe/Athens', 101
    )
    where incident_id = '019a0000-0000-7000-8000-000000000102'::uuid
  ),
  'Europe/Paris'::text,
  'date-only evidence retains its source calendar zone across display scopes'
);

reset role;

select * from finish();
rollback;
