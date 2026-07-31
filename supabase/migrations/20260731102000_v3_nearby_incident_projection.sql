-- Bounded v3 Nearby projection over persisted public truth. This intentionally
-- remains a partial read: current-state checks can safely omit historical rows
-- that have since changed or retracted, but it never reconstructs those older
-- versions.
-- Consequently this RPC can publish persisted incident items, but it cannot
-- authorize valid-empty or claim ingestion coverage.

do $discovery_reader_role$
begin
  if exists (
    select 1 from pg_catalog.pg_roles
    where rolname = 'firewatch_discovery_reader'
  ) then
    raise exception 'firewatch_discovery_reader must be migration-owned'
      using errcode = '42710';
  end if;
  create role firewatch_discovery_reader
    nologin noinherit nocreatedb nocreaterole nosuperuser noreplication nobypassrls;
end;
$discovery_reader_role$;

grant firewatch_discovery_reader to authenticator;
grant usage on schema api to firewatch_discovery_reader;

-- Mutable source gates are not yet versioned. Returning the greatest gate
-- clock only when every current gate existed by the requested knowledge cutoff
-- makes historical reads safely omissive instead of admitting future state.
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
  select gate.gate_known_at
  from truth.events as event
  join ingest.global_observations as observation
    on observation.cursor = event.observation_cursor
  join ingest.source_revisions as revision
    on revision.id = event.source_revision_id
    and revision.id = observation.source_revision_id
    and revision.source_id = observation.source_id
  join ingest.runs as run
    on run.id = revision.run_id
    and run.source_id = revision.source_id
    and run.adapter_release_id = revision.adapter_release_id
  join core.endpoints as endpoint
    on endpoint.id = run.endpoint_id
    and endpoint.source_id = run.source_id
  join core.sources as source on source.id = run.source_id
  join core.providers as provider on provider.id = source.provider_id
  join core.collection_targets as target
    on target.id = run.collection_target_id
    and target.endpoint_id = endpoint.id
    and target.source_id = source.id
  join ingest.endpoint_state as endpoint_state
    on endpoint_state.endpoint_id = endpoint.id
  join ingest.adapter_release_state as adapter_state
    on adapter_state.adapter_release_id = run.adapter_release_id
  cross join lateral (
    select greatest(
      provider.updated_at,
      source.updated_at,
      target.updated_at,
      endpoint_state.updated_at,
      adapter_state.updated_at
    ) as gate_known_at
  ) as gate
  where event.cursor = p_event_cursor
    and event.incident_id = p_incident_id
    and gate.gate_known_at <= p_known_at;
$$;

revoke execute on function truth.publication_gate_known_at(
  bigint, bigint, timestamptz
) from public, anon, authenticated, service_role,
  firewatch_catalog_admin, firewatch_collector, firewatch_reconciler,
  firewatch_publisher, firewatch_dispatcher, firewatch_discovery_reader;

create or replace function api.nearby_incidents_v3(
  p_z integer,
  p_x integer,
  p_y integer,
  p_observed_from timestamptz,
  p_as_of timestamptz,
  p_known_at timestamptz,
  p_scope_timezone text default null,
  p_limit integer default 51
)
returns table (
  incident_id uuid,
  contract_version text,
  slug text,
  name text,
  localized_names jsonb,
  default_timezone text,
  incident_kind text,
  lifecycle text,
  started_at timestamptz,
  started_date date,
  started_precision text,
  started_timezone text,
  latest_observed_at timestamptz,
  latest_observed_date date,
  latest_observed_precision text,
  latest_observed_timezone text,
  item_known_at timestamptz,
  resolved_scope_timezone text
)
language plpgsql
stable
security definer
set search_path = ''
set statement_timeout = '5s'
as $$
declare
  cell_geom extensions.geometry(Polygon, 4326);
  cell_count integer;
  cell_minimum_span_m double precision;
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
    or p_as_of is null
    or p_known_at is null
    or p_observed_from >= p_as_of
    or p_as_of > p_known_at
    or p_as_of - p_observed_from > interval '7 days'
    or p_known_at > now() + interval '5 minutes'
    or p_known_at < now() - interval '31 days'
    or p_as_of < now() - interval '31 days'
    or p_known_at - p_as_of > interval '31 days'
  then
    raise exception 'Nearby cutoffs must be ordered, current within 31 days, and use at most a 7-day observation window'
      using errcode = '22023';
  end if;

  if p_scope_timezone is not null and (
    btrim(p_scope_timezone) = ''
    or length(p_scope_timezone) > 100
    or p_scope_timezone ~ '[[:cntrl:]]'
    or not exists (
      select 1
      from pg_catalog.pg_timezone_names as zone
      where zone.name = p_scope_timezone
    )
  ) then
    raise exception 'Nearby scope time zone is invalid'
      using errcode = '22023';
  end if;

  if p_limit is null or p_limit < 1 or p_limit > 101 then
    raise exception 'Nearby incident result limit must be between 1 and 101'
      using errcode = '22023';
  end if;

  cell_geom := extensions.st_transform(
    extensions.st_tileenvelope(p_z, p_x, p_y),
    4326
  );
  cell_minimum_span_m := least(
    40075016.686
      * cos(
          radians(
            (
              extensions.st_ymin(extensions.box2d(cell_geom))
              + extensions.st_ymax(extensions.box2d(cell_geom))
            ) / 2
          )
        )
      / (1 << p_z),
    40075016.686
      * (
          extensions.st_ymax(extensions.box2d(cell_geom))
          - extensions.st_ymin(extensions.box2d(cell_geom))
        )
      / 360
  );
  if round(cell_minimum_span_m) < 8000
    or round(cell_minimum_span_m) > 80000
  then
    raise exception 'Web Mercator cell span must be between 8 and 80 kilometres'
      using errcode = '22023';
  end if;

  return query
  with spatial_snapshots as materialized (
    -- Start with the GiST-indexable predicate. The anti-join then proves that
    -- each intersecting candidate is still the incident's latest snapshot;
    -- an older intersecting geometry cannot stand in for a newer geometry that
    -- moved outside the requested cell.
    select
      snapshot.cursor,
      snapshot.incident_id,
      snapshot.basis_event_cursor,
      snapshot.as_of,
      snapshot.created_at
    from truth.snapshots as snapshot
    where snapshot.geom is not null
      and snapshot.geom operator(extensions.&&) cell_geom
      and extensions.st_intersects(snapshot.geom, cell_geom)
      and snapshot.as_of <= p_as_of
      and snapshot.created_at <= p_known_at
      and not exists (
        select 1
        from truth.snapshots as successor
        where successor.incident_id = snapshot.incident_id
          and (successor.version_no, successor.cursor) >
            (snapshot.version_no, snapshot.cursor)
      )
  ), eligible as materialized (
    select
      incident.public_id::uuid as incident_id,
      incident.contract_version,
      incident.slug,
      incident.name,
      incident.localized_names,
      incident.default_timezone,
      incident.incident_kind,
      incident.status as lifecycle,
      incident.started_at,
      incident.started_date,
      incident.started_precision,
      case
        when exists (
          select 1 from pg_catalog.pg_timezone_names as started_zone
          where started_zone.name = incident.started_timezone
        ) then incident.started_timezone
        else null
      end as started_timezone,
      latest_event.latest_observed_at,
      latest_event.latest_observed_date,
      latest_event.latest_observed_precision,
      latest_event.latest_observed_timezone,
      item_clock.item_known_at,
      floor(pg_catalog.extract(epoch from item_clock.item_known_at) * 1000)::bigint
        as item_order_millis
    from spatial_snapshots as snapshot
    join core.incidents as incident on incident.id = snapshot.incident_id
    join lateral (
      select
        publication.action_at,
        publication.recorded_at,
        gate.gate_known_at
      from truth.publications as publication
      cross join lateral (
        select truth.publication_gate_known_at(
          snapshot.basis_event_cursor,
          snapshot.incident_id,
          p_known_at
        ) as gate_known_at
      ) as gate
      where publication.snapshot_cursor = snapshot.cursor
        and publication.incident_id = snapshot.incident_id
        and publication.action = 'publish'
        and publication.action_at <= p_known_at
        and publication.recorded_at <= p_known_at
        and gate.gate_known_at is not null
        and truth.publication_subject_is_current(
          publication.cursor,
          publication.incident_id,
          null,
          snapshot.cursor,
          null,
          p_known_at
        )
        and truth.publication_subject_is_current(
          publication.cursor,
          publication.incident_id,
          null,
          snapshot.cursor,
          null,
          pg_catalog.statement_timestamp()
        )
      order by publication.cursor desc
      limit 1
    ) as snapshot_publication on true
    join lateral (
      select
        normalized.latest_observed_at,
        normalized.latest_observed_date,
        normalized.latest_observed_precision,
        normalized.latest_observed_timezone,
        event_clock.event_known_at,
        gate.gate_known_at
      from truth.events as event
      join truth.publications as publication
        on publication.event_cursor = event.cursor
        and publication.incident_id = event.incident_id
      cross join lateral (
        select
          case
            when event.last_effective_precision in ('exact', 'date_only')
              then event.last_effective_precision
            when event.event_time_precision in ('exact', 'date_only')
              then event.event_time_precision
            when event.first_effective_precision in ('exact', 'date_only')
              then event.first_effective_precision
            else 'unknown'
          end as latest_observed_precision,
          case
            when event.last_effective_precision = 'exact'
              then event.last_effective_at
            when event.event_time_precision = 'exact'
              then event.event_time
            when event.first_effective_precision = 'exact'
              then event.first_effective_at
            else null
          end as latest_observed_at,
          case
            when event.last_effective_precision = 'date_only'
              then event.last_effective_date
            when event.event_time_precision = 'date_only'
              then event.event_date
            when event.first_effective_precision = 'date_only'
              then event.first_effective_date
            else null
          end as latest_observed_date,
          case
            when event.last_effective_precision in ('exact', 'date_only')
              then event.last_effective_timezone
            when event.event_time_precision in ('exact', 'date_only')
              then event.event_timezone
            when event.first_effective_precision in ('exact', 'date_only')
              then event.first_effective_timezone
            else null
          end as latest_observed_timezone
      ) as normalized
      cross join lateral (
        select
          case
            when normalized.latest_observed_precision = 'exact'
              then normalized.latest_observed_at
            when normalized.latest_observed_precision = 'date_only'
              and exists (
                select 1 from pg_catalog.pg_timezone_names as source_zone
                where source_zone.name = normalized.latest_observed_timezone
              )
              then pg_catalog.timezone(
                normalized.latest_observed_timezone,
                normalized.latest_observed_date::timestamp
              )
            else null
          end as interval_from,
          case
            when normalized.latest_observed_precision = 'exact'
              then normalized.latest_observed_at
            when normalized.latest_observed_precision = 'date_only'
              and exists (
                select 1 from pg_catalog.pg_timezone_names as source_zone
                where source_zone.name = normalized.latest_observed_timezone
              )
              then pg_catalog.timezone(
                normalized.latest_observed_timezone,
                (normalized.latest_observed_date + 1)::timestamp
              ) - interval '1 microsecond'
            else null
          end as interval_through
      ) as temporal_interval
      cross join lateral (
        select greatest(
          event.recorded_at,
          publication.action_at,
          publication.recorded_at
        ) as event_known_at
      ) as event_clock
      cross join lateral (
        select truth.publication_gate_known_at(
          event.cursor,
          event.incident_id,
          p_known_at
        ) as gate_known_at
      ) as gate
      where event.incident_id = incident.id
        and event.visibility = 'public'
        and event.lifecycle <> 'retracted'
        and event.recorded_at <= p_known_at
        and publication.action = 'publish'
        and publication.action_at <= p_known_at
        and publication.recorded_at <= p_known_at
        and gate.gate_known_at is not null
        and temporal_interval.interval_from is not null
        and temporal_interval.interval_from <= p_as_of
        and temporal_interval.interval_through >= p_observed_from
        and truth.publication_subject_is_current(
          publication.cursor,
          publication.incident_id,
          event.cursor,
          null,
          null,
          p_known_at
        )
        and truth.publication_subject_is_current(
          publication.cursor,
          publication.incident_id,
          event.cursor,
          null,
          null,
          pg_catalog.statement_timestamp()
        )
      order by
        temporal_interval.interval_through desc,
        temporal_interval.interval_from desc,
        event_clock.event_known_at desc,
        event.cursor desc
      limit 1
    ) as latest_event on true
    cross join lateral (
      select greatest(
        incident.updated_at,
        snapshot.created_at,
        snapshot_publication.action_at,
        snapshot_publication.recorded_at,
        snapshot_publication.gate_known_at,
        latest_event.event_known_at,
        latest_event.gate_known_at
      ) as item_known_at
    ) as item_clock
    where incident.visibility = 'public'
      and incident.incident_kind = 'wildfire'
      and incident.updated_at <= p_known_at
      and item_clock.item_known_at <= p_known_at
      and exists (
        select 1
        from pg_catalog.pg_timezone_names as zone
        where zone.name = incident.default_timezone
      )
  ), scoped as materialized (
    select
      eligible.*,
      coalesce(
        p_scope_timezone,
        first_value(eligible.default_timezone) over (
          order by eligible.item_order_millis desc, eligible.incident_id desc
        )
      ) as resolved_scope_timezone
    from eligible
  )
  select
    scoped.incident_id,
    scoped.contract_version,
    scoped.slug,
    scoped.name,
    scoped.localized_names,
    scoped.default_timezone,
    scoped.incident_kind,
    scoped.lifecycle,
    scoped.started_at,
    scoped.started_date,
    scoped.started_precision,
    scoped.started_timezone,
    scoped.latest_observed_at,
    scoped.latest_observed_date,
    scoped.latest_observed_precision,
    scoped.latest_observed_timezone,
    pg_catalog.date_trunc('milliseconds', scoped.item_known_at),
    scoped.resolved_scope_timezone
  from scoped
  order by scoped.item_order_millis desc, scoped.incident_id desc
  limit p_limit;
end;
$$;

revoke execute on function api.nearby_incidents_v3(
  integer, integer, integer, timestamptz, timestamptz, timestamptz,
  text, integer
) from public, firewatch_catalog_admin, firewatch_collector,
  firewatch_reconciler, firewatch_publisher, firewatch_dispatcher,
  anon, authenticated, service_role;

grant execute on function api.nearby_incidents_v3(
  integer, integer, integer, timestamptz, timestamptz, timestamptz,
  text, integer
) to firewatch_discovery_reader;

comment on function api.nearby_incidents_v3(
  integer, integer, integer, timestamptz, timestamptz, timestamptz,
  text, integer
) is
  'Returns one bounded partial Nearby projection through a private server reader role. Rows are cutoff-checked and PostGIS-filtered; absence never proves valid-empty.';

notify pgrst, 'reload schema';
