-- Inert, durable global-candidate projection foundation.
--
-- This migration deliberately does not derive candidates from request-time
-- FIRMS scans, install a trigger/materializer, or grant any writer. A future
-- reconciler must atomically publish a complete immutable snapshot. Until
-- that happens the v3 endpoint returns unconfigured/indeterminate rather than
-- treating an empty database as evidence that no wildfire exists.

create or replace function truth.global_candidate_cell_minimum_span_m(
  p_z integer,
  p_y integer
)
returns integer
language plpgsql
immutable
strict
parallel safe
security invoker
set search_path = ''
as $$
declare
  cell_count integer;
  north_latitude double precision;
  south_latitude double precision;
  center_latitude double precision;
begin
  if p_z < 0 or p_z > 30 then
    raise exception 'Web Mercator zoom is outside the supported integer range'
      using errcode = '22023';
  end if;
  cell_count := (1 << p_z);
  if p_y < 0 or p_y >= cell_count then
    raise exception 'Web Mercator row is outside the zoom grid'
      using errcode = '22023';
  end if;

  north_latitude := degrees(
    atan(sinh(pi() * (1 - (2.0 * p_y / cell_count))))
  );
  south_latitude := degrees(
    atan(sinh(pi() * (1 - (2.0 * (p_y + 1) / cell_count))))
  );
  center_latitude := (north_latitude + south_latitude) / 2;

  return round(least(
    40075016.686 * cos(radians(center_latitude)) / cell_count,
    40075016.686 * (north_latitude - south_latitude) / 360
  ))::integer;
end;
$$;

revoke execute on function truth.global_candidate_cell_minimum_span_m(
  integer, integer
) from public, anon, authenticated, service_role,
  firewatch_catalog_admin, firewatch_collector, firewatch_reconciler,
  firewatch_publisher, firewatch_dispatcher, firewatch_discovery_reader;

-- PostgreSQL does not classify every built-in integer-to-text cast used by a
-- generated expression as immutable. These explicitly immutable wrappers make
-- the canonical key contract reviewable and safe for stored generation.
create or replace function truth.global_candidate_cell_key(
  p_z integer,
  p_x integer,
  p_y integer
)
returns text
language sql
immutable
strict
parallel safe
security invoker
set search_path = ''
as $$
  select 'wm/' || p_z::text || '/' || p_x::text || '/' || p_y::text;
$$;

create or replace function truth.global_candidate_semantic_key_v1(
  p_identity_version text,
  p_aggregation_version text,
  p_grid_version text,
  p_z integer,
  p_x integer,
  p_y integer
)
returns text
language sql
immutable
strict
parallel safe
security invoker
set search_path = ''
as $$
  select pg_catalog.encode(
    pg_catalog.sha256(
      pg_catalog.convert_to(
        p_identity_version || E'\\x00' || p_aggregation_version || E'\\x00'
          || p_grid_version || E'\\x00' || p_z::text || '/' || p_x::text
          || '/' || p_y::text,
        'UTF8'
      )
    ),
    'hex'
  );
$$;

revoke execute on function truth.global_candidate_cell_key(
  integer, integer, integer
), truth.global_candidate_semantic_key_v1(
  text, text, text, integer, integer, integer
) from public, anon, authenticated, service_role,
  firewatch_catalog_admin, firewatch_collector, firewatch_reconciler,
  firewatch_publisher, firewatch_dispatcher, firewatch_discovery_reader;

create or replace function truth.global_candidate_signal_kinds_are_valid(
  p_signal_kinds text[]
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
    pg_catalog.cardinality(p_signal_kinds) between 1 and 8
    and p_signal_kinds <@ array[
      'thermal_detection',
      'incident_summary',
      'hazard_advisory'
    ]::text[]
    and pg_catalog.cardinality(p_signal_kinds) = (
      select pg_catalog.count(distinct signal_kind)
      from pg_catalog.unnest(p_signal_kinds) as signal_kind
    );
$$;

revoke execute on function truth.global_candidate_signal_kinds_are_valid(
  text[]
) from public, anon, authenticated, service_role,
  firewatch_catalog_admin, firewatch_collector, firewatch_reconciler,
  firewatch_publisher, firewatch_dispatcher, firewatch_discovery_reader;

create table truth.global_candidate_cells (
  id bigint generated always as identity primary key,
  public_id core.uuid_v7 not null unique,
  identity_version text not null default 'global-signal-cell-v1' check (
    identity_version = 'global-signal-cell-v1'
  ),
  aggregation_version text not null default 'global-candidate-aggregation-v1'
    check (
    aggregation_version = 'global-candidate-aggregation-v1'
  ),
  grid_version text not null default 'web-mercator-adaptive-v1' check (
    grid_version = 'web-mercator-adaptive-v1'
  ),
  z integer not null check (z between 7 and 11),
  x integer not null check (x >= 0 and x < (1 << z)),
  y integer not null check (y >= 0 and y < (1 << z)),
  cell_key text generated always as (
    truth.global_candidate_cell_key(z, x, y)
  ) stored,
  minimum_span_m integer generated always as (
    truth.global_candidate_cell_minimum_span_m(z, y)
  ) stored,
  semantic_key_sha256 text generated always as (
    truth.global_candidate_semantic_key_v1(
      identity_version,
      aggregation_version,
      grid_version,
      z,
      x,
      y
    )
  ) stored,
  display_timezone text not null check (
    btrim(display_timezone) <> ''
    and char_length(display_timezone) <= 100
    and display_timezone !~ '[[:cntrl:]]'
  ),
  timezone_basis text not null default 'reviewed-iana-v1' check (
    timezone_basis = 'reviewed-iana-v1'
  ),
  timezone_known_at timestamptz not null,
  recorded_at timestamptz not null default pg_catalog.date_trunc(
    'milliseconds', now()
  ),
  constraint global_candidate_cells_adaptive_span_check check (
    minimum_span_m between 8000 and 80000
  ),
  constraint global_candidate_cells_clock_check check (
    timezone_known_at <= recorded_at
    and timezone_known_at = pg_catalog.date_trunc(
      'milliseconds', timezone_known_at
    )
    and recorded_at = pg_catalog.date_trunc('milliseconds', recorded_at)
  ),
  constraint global_candidate_cells_semantic_key_key unique (
    semantic_key_sha256
  ),
  constraint global_candidate_cells_coordinates_key unique (
    identity_version, aggregation_version, grid_version, z, x, y
  ),
  constraint global_candidate_cells_id_public_key unique (id, public_id)
);

comment on table truth.global_candidate_cells is
  'Private durable identities for recurring aggregate wildfire-signal cells. UUIDv7 is application-issued; identity is independent of any one detection and is not a fire-episode identity.';
comment on column truth.global_candidate_cells.semantic_key_sha256 is
  'Generated semantic key over identity/aggregation/grid versions and canonical z/x/y. This hash is never repurposed as the public UUID.';
comment on column truth.global_candidate_cells.display_timezone is
  'Reviewed IANA civil-time display context; never used for event-time filtering.';

create function truth.validate_global_candidate_cell_insert()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (
    select 1
    from pg_catalog.pg_timezone_names as zone
    where zone.name = new.display_timezone
  ) then
    raise exception 'Global candidate cell requires a reviewed IANA time zone'
      using errcode = '22023';
  end if;
  return new;
end;
$$;

revoke execute on function truth.validate_global_candidate_cell_insert()
from public, anon, authenticated, service_role,
  firewatch_catalog_admin, firewatch_collector, firewatch_reconciler,
  firewatch_publisher, firewatch_dispatcher, firewatch_discovery_reader;

create trigger global_candidate_cells_validate_insert
before insert on truth.global_candidate_cells
for each row execute function truth.validate_global_candidate_cell_insert();

create trigger global_candidate_cells_immutable
before update or delete on truth.global_candidate_cells
for each row execute function core.reject_mutation();

create table truth.global_candidate_projection_runs (
  id bigint generated always as identity primary key,
  public_id core.uuid_v7 not null unique,
  projection_version text not null default 'global-candidate-projection-v1'
    check (projection_version = 'global-candidate-projection-v1'),
  policy_version text not null default 'global-discovery-v1' check (
    policy_version = 'global-discovery-v1'
  ),
  aggregation_version text not null default 'global-candidate-aggregation-v1'
    check (
    aggregation_version = 'global-candidate-aggregation-v1'
  ),
  grid_version text not null default 'web-mercator-adaptive-v1' check (
    grid_version = 'web-mercator-adaptive-v1'
  ),
  observed_from timestamptz not null,
  as_of timestamptz not null,
  known_at timestamptz not null,
  evidence_epoch bigint not null check (evidence_epoch >= 0),
  publication_gate_digest text not null check (
    publication_gate_digest ~ '^[a-f0-9]{64}$'
  ),
  input_digest text not null check (input_digest ~ '^[a-f0-9]{64}$'),
  snapshot_digest text not null unique check (
    snapshot_digest ~ '^[a-f0-9]{64}$'
  ),
  item_count integer not null check (item_count between 0 and 1000000),
  materializer_release text not null check (
    btrim(materializer_release) <> ''
    and char_length(materializer_release) <= 128
    and materializer_release !~ '[[:cntrl:]]'
  ),
  recorded_at timestamptz not null default pg_catalog.date_trunc(
    'milliseconds', now()
  ),
  constraint global_candidate_projection_runs_window_check check (
    observed_from = as_of - interval '7 days'
    and observed_from < as_of
    and as_of <= known_at
    and known_at <= recorded_at
    and observed_from = pg_catalog.date_trunc('milliseconds', observed_from)
    and as_of = pg_catalog.date_trunc('milliseconds', as_of)
    and known_at = pg_catalog.date_trunc('milliseconds', known_at)
    and recorded_at = pg_catalog.date_trunc('milliseconds', recorded_at)
  ),
  constraint global_candidate_projection_runs_cutoffs_key unique (
    projection_version, policy_version, aggregation_version, grid_version,
    observed_from, as_of, known_at
  ),
  constraint global_candidate_projection_runs_id_public_key unique (
    id, public_id
  )
);

comment on table truth.global_candidate_projection_runs is
  'Private immutable publication records for precomputed global candidate pages. A row is published only after its complete item set is atomically prepared.';
comment on column truth.global_candidate_projection_runs.item_count is
  'Materializer-attested item cardinality. The future writer must publish the run and its exact item set in one transaction.';

create trigger global_candidate_projection_runs_immutable
before update or delete on truth.global_candidate_projection_runs
for each row execute function core.reject_mutation();

create table truth.global_candidate_projection_items (
  id bigint generated always as identity primary key,
  snapshot_id bigint not null,
  candidate_id bigint not null,
  candidate_public_id core.uuid_v7 not null,
  signal_kinds text[] not null check (
    truth.global_candidate_signal_kinds_are_valid(signal_kinds)
  ),
  observation_count bigint not null check (
    observation_count between 1 and 1000000
  ),
  source_count bigint not null check (
    source_count between 1 and 1000
    and source_count <= observation_count
  ),
  first_observed_at timestamptz,
  latest_observed_at timestamptz not null,
  item_known_at timestamptz not null,
  recorded_at timestamptz not null default pg_catalog.date_trunc(
    'milliseconds', now()
  ),
  constraint global_candidate_projection_items_snapshot_fkey
    foreign key (snapshot_id)
    references truth.global_candidate_projection_runs(id),
  constraint global_candidate_projection_items_candidate_fkey
    foreign key (candidate_id, candidate_public_id)
    references truth.global_candidate_cells(id, public_id),
  constraint global_candidate_projection_items_clock_check check (
    (first_observed_at is null or first_observed_at <= latest_observed_at)
    and latest_observed_at <= item_known_at
    and item_known_at <= recorded_at
    and (
      first_observed_at is null
      or first_observed_at = pg_catalog.date_trunc(
        'milliseconds', first_observed_at
      )
    )
    and latest_observed_at = pg_catalog.date_trunc(
      'milliseconds', latest_observed_at
    )
    and item_known_at = pg_catalog.date_trunc('milliseconds', item_known_at)
    and recorded_at = pg_catalog.date_trunc('milliseconds', recorded_at)
  ),
  constraint global_candidate_projection_items_snapshot_candidate_key unique (
    snapshot_id, candidate_id
  ),
  constraint global_candidate_projection_items_snapshot_public_key unique (
    snapshot_id, candidate_public_id
  )
);

comment on table truth.global_candidate_projection_items is
  'Private immutable candidate summaries belonging to one immutable projection run. No row confirms an incident, exact flame location, protective action, resolution, or all-clear.';
comment on column truth.global_candidate_projection_items.candidate_public_id is
  'Redundant, trigger/FK-validated UUIDv7 ordering key stored so keyset reads remain indexable without sorting a registry join.';

create index global_candidate_projection_items_page_idx
  on truth.global_candidate_projection_items(
    snapshot_id,
    item_known_at desc,
    candidate_public_id desc
  ) include (
    candidate_id,
    signal_kinds,
    observation_count,
    source_count,
    first_observed_at,
    latest_observed_at
  );

create index global_candidate_projection_items_candidate_fk_idx
  on truth.global_candidate_projection_items(candidate_id);

create function truth.validate_global_candidate_projection_item_insert()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  snapshot_recorded_at timestamptz;
  snapshot_observed_from timestamptz;
  snapshot_as_of timestamptz;
  snapshot_known_at timestamptz;
begin
  select
    run.observed_from,
    run.as_of,
    run.known_at,
    run.recorded_at
  into
    snapshot_observed_from,
    snapshot_as_of,
    snapshot_known_at,
    snapshot_recorded_at
  from truth.global_candidate_projection_runs as run
  where run.id = new.snapshot_id;

  if not found then
    raise exception 'Global candidate projection snapshot is unavailable'
      using errcode = '23503';
  end if;
  if new.latest_observed_at < snapshot_observed_from
    or new.latest_observed_at > snapshot_as_of
    or new.item_known_at > snapshot_known_at
    or new.recorded_at < new.item_known_at
    or new.recorded_at < snapshot_recorded_at
  then
    raise exception 'Global candidate projection item exceeds its snapshot cutoffs'
      using errcode = '23514';
  end if;
  return new;
end;
$$;

revoke execute on function truth.validate_global_candidate_projection_item_insert()
from public, anon, authenticated, service_role,
  firewatch_catalog_admin, firewatch_collector, firewatch_reconciler,
  firewatch_publisher, firewatch_dispatcher, firewatch_discovery_reader;

create trigger global_candidate_projection_items_validate_insert
before insert on truth.global_candidate_projection_items
for each row
execute function truth.validate_global_candidate_projection_item_insert();

create trigger global_candidate_projection_items_immutable
before update or delete on truth.global_candidate_projection_items
for each row execute function core.reject_mutation();

alter table truth.global_candidate_cells enable row level security;
alter table truth.global_candidate_cells force row level security;
alter table truth.global_candidate_projection_runs enable row level security;
alter table truth.global_candidate_projection_runs force row level security;
alter table truth.global_candidate_projection_items enable row level security;
alter table truth.global_candidate_projection_items force row level security;

revoke all on
  truth.global_candidate_cells,
  truth.global_candidate_projection_runs,
  truth.global_candidate_projection_items
from public, anon, authenticated, service_role,
  firewatch_catalog_admin, firewatch_collector, firewatch_reconciler,
  firewatch_publisher, firewatch_dispatcher, firewatch_discovery_reader;

revoke all on sequence
  truth.global_candidate_cells_id_seq,
  truth.global_candidate_projection_runs_id_seq,
  truth.global_candidate_projection_items_id_seq
from public, anon, authenticated, service_role,
  firewatch_catalog_admin, firewatch_collector, firewatch_reconciler,
  firewatch_publisher, firewatch_dispatcher, firewatch_discovery_reader;

create or replace function api.explore_candidate_cells_v3(
  p_observed_from timestamptz,
  p_as_of timestamptz,
  p_known_at timestamptz,
  p_limit integer default 51,
  p_snapshot_id uuid default null,
  p_snapshot_digest text default null,
  p_publication_gate_digest text default null,
  p_after_item_known_at timestamptz default null,
  p_after_candidate_id uuid default null
)
returns table (
  row_kind text,
  snapshot_id uuid,
  snapshot_as_of timestamptz,
  snapshot_known_at timestamptz,
  snapshot_observed_from timestamptz,
  snapshot_digest text,
  publication_gate_digest text,
  candidate_id uuid,
  cell_key text,
  display_timezone text,
  signal_kinds text[],
  observation_count bigint,
  source_count bigint,
  first_observed_at timestamptz,
  latest_observed_at timestamptz,
  item_known_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  selected_snapshot truth.global_candidate_projection_runs%rowtype;
  has_any_cursor_field boolean;
  has_every_cursor_field boolean;
begin
  if p_observed_from is null
    or p_as_of is null
    or p_known_at is null
    or p_observed_from <> p_as_of - interval '7 days'
    or p_observed_from >= p_as_of
    or p_as_of > p_known_at
    or p_known_at > now() + interval '5 minutes'
    or p_known_at < now() - interval '31 days'
    or p_as_of < now() - interval '31 days'
    or p_known_at - p_as_of > interval '31 days'
    or p_observed_from <> pg_catalog.date_trunc(
      'milliseconds', p_observed_from
    )
    or p_as_of <> pg_catalog.date_trunc('milliseconds', p_as_of)
    or p_known_at <> pg_catalog.date_trunc('milliseconds', p_known_at)
  then
    raise exception 'Global candidate cutoffs must be canonical, current, ordered, and use the exact seven-day observation window'
      using errcode = '22023';
  end if;

  if p_limit is null or p_limit < 1 or p_limit > 101 then
    raise exception 'Global candidate result limit must be between 1 and 101'
      using errcode = '22023';
  end if;

  has_any_cursor_field :=
    p_snapshot_id is not null
    or p_snapshot_digest is not null
    or p_publication_gate_digest is not null
    or p_after_item_known_at is not null
    or p_after_candidate_id is not null;
  has_every_cursor_field :=
    p_snapshot_id is not null
    and p_snapshot_digest is not null
    and p_publication_gate_digest is not null
    and p_after_item_known_at is not null
    and p_after_candidate_id is not null;

  if has_any_cursor_field <> has_every_cursor_field
    or (
      has_every_cursor_field
      and (
        p_snapshot_id::text !~ '^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
        or p_after_candidate_id::text !~ '^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
        or p_snapshot_digest !~ '^[a-f0-9]{64}$'
        or p_publication_gate_digest !~ '^[a-f0-9]{64}$'
        or p_after_item_known_at > p_known_at
        or p_after_item_known_at <> pg_catalog.date_trunc(
          'milliseconds', p_after_item_known_at
        )
      )
    )
  then
    raise exception 'Global candidate continuation is invalid'
      using errcode = '22023';
  end if;

  select run.*
  into selected_snapshot
  from truth.global_candidate_projection_runs as run
  where run.projection_version = 'global-candidate-projection-v1'
    and run.policy_version = 'global-discovery-v1'
    and run.aggregation_version = 'global-candidate-aggregation-v1'
    and run.grid_version = 'web-mercator-adaptive-v1'
    and run.observed_from = p_observed_from
    and run.as_of = p_as_of
    and run.known_at = p_known_at;

  if not found then
    if has_every_cursor_field then
      raise exception 'Global candidate snapshot changed'
        using errcode = '22023',
          detail = 'firewatch_snapshot_changed_v1';
    end if;
    return;
  end if;

  if has_every_cursor_field and (
    selected_snapshot.public_id::uuid <> p_snapshot_id
    or selected_snapshot.snapshot_digest <> p_snapshot_digest
    or selected_snapshot.publication_gate_digest
      <> p_publication_gate_digest
  ) then
    raise exception 'Global candidate snapshot changed'
      using errcode = '22023',
        detail = 'firewatch_snapshot_changed_v1';
  end if;

  return query
  with page_items as materialized (
    select
      item.candidate_public_id::uuid as candidate_public_id,
      candidate.cell_key,
      candidate.display_timezone,
      item.signal_kinds,
      item.observation_count,
      item.source_count,
      item.first_observed_at,
      item.latest_observed_at,
      item.item_known_at
    from truth.global_candidate_projection_items as item
    join truth.global_candidate_cells as candidate
      on candidate.id = item.candidate_id
      and candidate.public_id = item.candidate_public_id
      and candidate.aggregation_version = selected_snapshot.aggregation_version
      and candidate.grid_version = selected_snapshot.grid_version
    where item.snapshot_id = selected_snapshot.id
      and (
        not has_every_cursor_field
        or (item.item_known_at, item.candidate_public_id)
          < (
            p_after_item_known_at,
            p_after_candidate_id::core.uuid_v7
          )
      )
    order by item.item_known_at desc, item.candidate_public_id desc
    limit p_limit
  ), ordered_rows as (
    select
      0 as sort_rank,
      'snapshot'::text as row_kind,
      selected_snapshot.public_id::uuid as snapshot_id,
      selected_snapshot.as_of as snapshot_as_of,
      selected_snapshot.known_at as snapshot_known_at,
      selected_snapshot.observed_from as snapshot_observed_from,
      selected_snapshot.snapshot_digest,
      selected_snapshot.publication_gate_digest,
      null::uuid as candidate_id,
      null::text as cell_key,
      null::text as display_timezone,
      null::text[] as signal_kinds,
      null::bigint as observation_count,
      null::bigint as source_count,
      null::timestamptz as first_observed_at,
      null::timestamptz as latest_observed_at,
      null::timestamptz as item_known_at
    union all
    select
      1,
      'candidate'::text,
      selected_snapshot.public_id::uuid,
      selected_snapshot.as_of,
      selected_snapshot.known_at,
      selected_snapshot.observed_from,
      selected_snapshot.snapshot_digest,
      selected_snapshot.publication_gate_digest,
      page.candidate_public_id,
      page.cell_key,
      page.display_timezone,
      page.signal_kinds,
      page.observation_count,
      page.source_count,
      page.first_observed_at,
      page.latest_observed_at,
      page.item_known_at
    from page_items as page
  )
  select
    ordered.row_kind,
    ordered.snapshot_id,
    pg_catalog.date_trunc('milliseconds', ordered.snapshot_as_of),
    pg_catalog.date_trunc('milliseconds', ordered.snapshot_known_at),
    pg_catalog.date_trunc('milliseconds', ordered.snapshot_observed_from),
    ordered.snapshot_digest,
    ordered.publication_gate_digest,
    ordered.candidate_id,
    ordered.cell_key,
    ordered.display_timezone,
    ordered.signal_kinds,
    ordered.observation_count,
    ordered.source_count,
    pg_catalog.date_trunc('milliseconds', ordered.first_observed_at),
    pg_catalog.date_trunc('milliseconds', ordered.latest_observed_at),
    pg_catalog.date_trunc('milliseconds', ordered.item_known_at)
  from ordered_rows as ordered
  order by
    ordered.sort_rank,
    ordered.item_known_at desc nulls first,
    ordered.candidate_id desc nulls first;
end;
$$;

revoke execute on function api.explore_candidate_cells_v3(
  timestamptz, timestamptz, timestamptz, integer, uuid, text, text,
  timestamptz, uuid
) from public, firewatch_catalog_admin, firewatch_collector,
  firewatch_reconciler, firewatch_publisher, firewatch_dispatcher,
  anon, authenticated, service_role, firewatch_discovery_reader;

grant execute on function api.explore_candidate_cells_v3(
  timestamptz, timestamptz, timestamptz, integer, uuid, text, text,
  timestamptz, uuid
) to firewatch_discovery_reader;

comment on function api.explore_candidate_cells_v3(
  timestamptz, timestamptz, timestamptz, integer, uuid, text, text,
  timestamptz, uuid
) is
  'Returns one metadata sentinel plus a bounded immutable candidate-cell page. Zero rows means no exact projection; a sentinel without items remains indeterminate and never proves all-clear.';

notify pgrst, 'reload schema';
