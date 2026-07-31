-- Bounded v3 thermal-anomaly projection over immutable FIRMS detections and
-- append-only assessments. Empty results are indeterminate: this projection
-- does not prove sensing coverage, sensor assessability, incident resolution,
-- or an all-clear.

create or replace function truth.ceil_millisecond_utc(p_value timestamptz)
returns timestamptz
language sql
immutable
strict
parallel safe
security invoker
set search_path = ''
as $$
  select case
    when p_value = pg_catalog.date_trunc('milliseconds', p_value)
      then p_value
    else pg_catalog.date_trunc('milliseconds', p_value)
      + interval '1 millisecond'
  end;
$$;

revoke execute on function truth.ceil_millisecond_utc(timestamptz)
from public, anon, authenticated, service_role,
  firewatch_catalog_admin, firewatch_collector, firewatch_reconciler,
  firewatch_publisher, firewatch_dispatcher, firewatch_discovery_reader;

-- One private transactional epoch makes HTTP keyset pages a coherent evidence
-- snapshot. Relevant append-only writes bump this row in the same transaction
-- as their evidence, so a reader snapshot sees either both changes or neither.
create table truth.thermal_anomaly_projection_epochs (
  projection_key text primary key check (
    projection_key = 'nasa-firms-thermal-anomaly-v3'
  ),
  evidence_epoch bigint not null default 0 check (evidence_epoch >= 0)
);

insert into truth.thermal_anomaly_projection_epochs(
  projection_key, evidence_epoch
) values ('nasa-firms-thermal-anomaly-v3', 0);

alter table truth.thermal_anomaly_projection_epochs enable row level security;
alter table truth.thermal_anomaly_projection_epochs force row level security;

revoke all on truth.thermal_anomaly_projection_epochs
from public, anon, authenticated, service_role,
  firewatch_catalog_admin, firewatch_collector, firewatch_reconciler,
  firewatch_publisher, firewatch_dispatcher, firewatch_discovery_reader;

comment on table truth.thermal_anomaly_projection_epochs is
  'Private transactional invalidation epoch for snapshot-bound thermal anomaly pagination.';

create function truth.bump_thermal_anomaly_projection_epoch()
returns trigger
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  update truth.thermal_anomaly_projection_epochs
  set evidence_epoch = evidence_epoch + 1
  where projection_key = 'nasa-firms-thermal-anomaly-v3';

  if not found then
    raise exception 'Thermal anomaly projection epoch is unavailable';
  end if;

  return null;
end;
$$;

revoke execute on function truth.bump_thermal_anomaly_projection_epoch()
from public, anon, authenticated, service_role,
  firewatch_catalog_admin, firewatch_collector, firewatch_reconciler,
  firewatch_publisher, firewatch_dispatcher, firewatch_discovery_reader;

create trigger firms_detection_details_projection_epoch
after insert on ingest.firms_detection_details
for each statement
execute function truth.bump_thermal_anomaly_projection_epoch();

create trigger thermal_anomaly_assessments_projection_epoch
after insert on truth.thermal_anomaly_assessments
for each statement
execute function truth.bump_thermal_anomaly_projection_epoch();

-- The projection starts at immutable original identities and orders by their
-- acquisition/public UUID tuple. The narrow partial index complements the
-- spatial GiST index and avoids ordering every historical revision.
create index firms_detection_details_projection_original_idx
  on ingest.firms_detection_details(acquired_at desc, public_id desc)
  include (id, source_id, product_id, retrieved_at, recorded_at)
  where version_no = 1;

-- Latest-visible lookup orders by immutable assessment chain position. Cutoff
-- clocks and the exact basis revision are covered without including wide text
-- arrays in the index.
create index thermal_anomaly_assessments_projection_chain_idx
  on truth.thermal_anomaly_assessments(
    original_detection_id,
    version_no desc,
    cursor desc
  ) include (as_of, known_at, recorded_at, basis_detection_id);

-- Preserve the previous implementation for an exact transactional rollback,
-- but remove all execution privileges before publishing the replacement.
alter function api.thermal_anomalies_v3(
  integer, integer, integer, timestamptz, timestamptz, integer
) rename to thermal_anomalies_v3_legacy;

alter function api.thermal_anomalies_v3_legacy(
  integer, integer, integer, timestamptz, timestamptz, integer
) set schema truth;

revoke execute on function truth.thermal_anomalies_v3_legacy(
  integer, integer, integer, timestamptz, timestamptz, integer
) from public, firewatch_catalog_admin, firewatch_collector,
  firewatch_reconciler, firewatch_publisher, firewatch_dispatcher,
  anon, authenticated, service_role, firewatch_discovery_reader;

comment on function truth.thermal_anomalies_v3_legacy(
  integer, integer, integer, timestamptz, timestamptz, integer
) is
  'Non-executable rollback copy of the superseded thermal anomaly projection.';

create or replace function api.thermal_anomalies_v3(
  p_z integer,
  p_x integer,
  p_y integer,
  p_as_of timestamptz,
  p_known_at timestamptz,
  p_limit integer default 101,
  p_after_acquired_at timestamptz default null,
  p_after_detection_id uuid default null,
  p_gate_snapshot text default null
)
returns table (
  detection_id uuid,
  basis_detection_id uuid,
  basis_version_no bigint,
  assessment_id uuid,
  source_id uuid,
  source_key text,
  contract_version text,
  identity_version text,
  product_key text,
  platform text,
  instrument text,
  acquired_at timestamptz,
  source_time_precision text,
  published_at timestamptz,
  retrieved_at timestamptz,
  detection_recorded_at timestamptz,
  latitude double precision,
  longitude double precision,
  scan_km double precision,
  track_km double precision,
  spatial_support_method text,
  confidence_class text,
  confidence_percent double precision,
  brightness_primary_k double precision,
  brightness_secondary_k double precision,
  brightness_contract text,
  frp_mw double precision,
  day_night text,
  source_dataset_version text,
  detection_limitations text[],
  assessment_state text,
  assessment_reason text,
  assessment_rule_id text,
  assessment_rule_version text,
  assessment_as_of timestamptz,
  assessment_known_at timestamptz,
  assessment_recorded_at timestamptz,
  assessment_limitations text[],
  claim_kind text,
  operational_effect text,
  notification_eligible boolean,
  official_status_eligible boolean,
  protective_action_eligible boolean,
  incident_resolution_eligible boolean,
  item_known_at timestamptz,
  gate_snapshot text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  cell_geom extensions.geometry(Polygon, 4326);
  cell_count integer;
  cell_minimum_span_m double precision;
  current_gate_snapshot text;
  current_evidence_epoch bigint;
  candidate_scan_limit integer;
  scanned_candidate_count integer;
  eligible_candidate_count integer;
  selected_assessment_cursors bigint[];
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

  if p_as_of is null
    or p_known_at is null
    or p_as_of <> pg_catalog.date_trunc('milliseconds', p_as_of)
    or p_known_at <> pg_catalog.date_trunc('milliseconds', p_known_at)
    or p_as_of > p_known_at
    or p_known_at > now() + interval '5 minutes'
    or p_known_at < now() - interval '31 days'
    or p_as_of < now() - interval '31 days'
    or p_known_at - p_as_of > interval '31 days'
  then
    raise exception 'Thermal anomaly cutoffs must be ordered and current within 31 days'
      using errcode = '22023';
  end if;

  if p_limit is null or p_limit < 1 or p_limit > 101 then
    raise exception 'Thermal anomaly result limit must be between 1 and 101'
      using errcode = '22023';
  end if;

  candidate_scan_limit := least(4096, greatest(256, p_limit * 16));

  if (p_after_acquired_at is null) <> (p_after_detection_id is null)
    or (p_after_acquired_at is null) <> (p_gate_snapshot is null)
    or (
      p_after_acquired_at is not null
      and (
        p_after_acquired_at <> pg_catalog.date_trunc(
          'milliseconds', p_after_acquired_at
        )
        or p_after_acquired_at <= p_as_of - interval '7 days'
        or p_after_acquired_at > p_as_of
        or p_after_detection_id::text !~
          '^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
        or p_gate_snapshot !~ '^[a-f0-9]{64}$'
      )
    )
  then
    raise exception 'Thermal anomaly page cursor is invalid'
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

  -- Bind continuation pages to the complete current publication-gate state,
  -- plus a transactionally coherent epoch for every relevant evidence insert.
  -- Mutable catalog state or newly committed evidence therefore invalidates an
  -- in-progress traversal instead of mixing two database snapshots.
  select epoch.evidence_epoch
  into current_evidence_epoch
  from truth.thermal_anomaly_projection_epochs as epoch
  where epoch.projection_key = 'nasa-firms-thermal-anomaly-v3';

  if current_evidence_epoch is null then
    raise exception 'Thermal anomaly projection epoch is unavailable';
  end if;

  select pg_catalog.encode(
    pg_catalog.sha256(
      pg_catalog.convert_to(
        pg_catalog.concat_ws(
          '|',
          'thermal-anomaly-snapshot-v1',
          current_evidence_epoch::text,
          provider.id::text,
          provider.public_id::text,
          provider.is_public::text,
          pg_catalog.to_char(
            provider.updated_at at time zone 'UTC',
            'YYYY-MM-DD"T"HH24:MI:SS.US'
          ),
          source.id::text,
          source.public_id::text,
          source.slug,
          source.enabled::text,
          source.is_public::text,
          source.sensitivity,
          source.license_status,
          coalesce(source.redistribution_allowed::text, 'null'),
          pg_catalog.to_char(
            source.updated_at at time zone 'UTC',
            'YYYY-MM-DD"T"HH24:MI:SS.US'
          ),
          coalesce(
            (
              select pg_catalog.string_agg(
                pg_catalog.concat_ws(
                  ':',
                  product.id::text,
                  product.public_id::text,
                  product.product_key,
                  product.enabled::text,
                  product.assessment_enabled::text,
                  product.license_status,
                  pg_catalog.to_char(
                    product.updated_at at time zone 'UTC',
                    'YYYY-MM-DD"T"HH24:MI:SS.US'
                  )
                ),
                ',' order by product.product_key
              )
              from core.firms_products as product
              where product.source_id = source.id
            ),
            ''
          )
        ),
        'UTF8'
      )
    ),
    'hex'
  )
  into current_gate_snapshot
  from core.sources as source
  join core.providers as provider on provider.id = source.provider_id
  where source.slug = 'nasa-firms';

  if current_gate_snapshot is null then
    raise exception 'Thermal anomaly publication snapshot is unavailable';
  end if;

  if p_gate_snapshot is not null
    and p_gate_snapshot <> current_gate_snapshot
  then
    raise exception 'Thermal anomaly publication gate snapshot changed'
      using
        errcode = '22023',
        detail = 'firewatch_snapshot_changed_v1';
  end if;

  -- Bound original identities before assessment lookup. If the bounded set is
  -- too sparse to prove either a full page or exhaustion, fail closed instead
  -- of silently skipping later eligible rows. Only the selected assessment
  -- cursor array (at most p_limit entries) reaches the wide evidence join.
  with bounded_original_candidates as materialized (
    select
      original.id as original_id,
      original.public_id::uuid as detection_public_id,
      original.acquired_at
    from ingest.firms_detection_details as original
    join core.firms_products as product
      on product.id = original.product_id
      and product.source_id = original.source_id
      and product.product_key = original.product_key
    join core.sources as source on source.id = original.source_id
    join core.providers as provider on provider.id = source.provider_id
    where original.version_no = 1
      and original.acquired_at > p_as_of - interval '7 days'
      and original.acquired_at <= p_as_of
      and original.retrieved_at <= p_known_at
      and original.recorded_at <= p_known_at
      and original.centroid_geom operator(extensions.&&) cell_geom
      and extensions.st_intersects(original.centroid_geom, cell_geom)
      and (
        p_after_acquired_at is null
        or (original.acquired_at, original.public_id::uuid)
          < (p_after_acquired_at, p_after_detection_id)
      )
      and provider.is_public
      and source.slug = 'nasa-firms'
      and source.enabled
      and source.is_public
      and source.sensitivity = 'public'
      and source.license_status = 'approved'
      and source.redistribution_allowed is true
      and product.enabled
      and product.assessment_enabled
      and product.license_status = 'approved'
      and greatest(
        provider.updated_at,
        source.updated_at,
        product.updated_at
      ) <= p_known_at
    order by original.acquired_at desc, original.public_id desc
    limit candidate_scan_limit + 1
  ), eligible_assessments as materialized (
    select
      original.detection_public_id,
      original.acquired_at,
      assessment.cursor as assessment_cursor
    from bounded_original_candidates as original
    join lateral (
      select candidate.cursor, candidate.basis_detection_id
      from truth.thermal_anomaly_assessments as candidate
      where candidate.original_detection_id = original.original_id
        and candidate.as_of <= p_as_of
        and candidate.known_at <= p_known_at
        and candidate.recorded_at <= p_known_at
        and candidate.assessment_state in (
          'detected', 'awaiting_later_assessment', 'unknown'
        )
      order by candidate.version_no desc, candidate.cursor desc
      limit 1
    ) as assessment on true
    join ingest.firms_detection_details as basis
      on basis.id = assessment.basis_detection_id
      and basis.original_detail_id = original.original_id
      and basis.retrieved_at <= p_known_at
      and basis.recorded_at <= p_known_at
  )
  select
    (
      select count(*)::integer
      from bounded_original_candidates
    ),
    (
      select count(*)::integer
      from eligible_assessments
    ),
    coalesce(
      (
        select pg_catalog.array_agg(
          page.assessment_cursor
          order by page.acquired_at desc, page.detection_public_id desc
        )
        from (
          select candidate.*
          from eligible_assessments as candidate
          order by candidate.acquired_at desc, candidate.detection_public_id desc
          limit p_limit
        ) as page
      ),
      array[]::bigint[]
    )
  into
    scanned_candidate_count,
    eligible_candidate_count,
    selected_assessment_cursors;

  if scanned_candidate_count > candidate_scan_limit
    and eligible_candidate_count < p_limit
  then
    raise exception 'Thermal anomaly candidate scan bound exceeded'
      using errcode = '54000';
  end if;

  return query
  select
    original.public_id::uuid,
    basis.public_id::uuid,
    basis.version_no,
    assessment.public_id::uuid,
    source.public_id::uuid,
    source.slug,
    basis.contract_version,
    basis.identity_version,
    basis.product_key,
    basis.satellite,
    basis.instrument,
    truth.ceil_millisecond_utc(basis.acquired_at),
    basis.source_time_precision,
    truth.ceil_millisecond_utc(basis.published_at),
    truth.ceil_millisecond_utc(basis.retrieved_at),
    truth.ceil_millisecond_utc(basis.recorded_at),
    basis.latitude::double precision,
    basis.longitude::double precision,
    basis.scan_km::double precision,
    basis.track_km::double precision,
    basis.spatial_support_method,
    basis.confidence_class,
    basis.confidence_percent::double precision,
    basis.brightness_primary_k::double precision,
    basis.brightness_secondary_k::double precision,
    basis.brightness_contract,
    basis.frp_mw::double precision,
    basis.day_night,
    basis.source_dataset_version,
    basis.limitations,
    assessment.assessment_state,
    assessment.reason_code,
    assessment.rule_id,
    assessment.rule_version,
    truth.ceil_millisecond_utc(assessment.as_of),
    truth.ceil_millisecond_utc(assessment.known_at),
    truth.ceil_millisecond_utc(assessment.recorded_at),
    assessment.limitations,
    assessment.claim_kind,
    assessment.operational_effect,
    assessment.notification_eligible,
    assessment.official_status_eligible,
    assessment.protective_action_eligible,
    assessment.incident_resolution_eligible,
    truth.ceil_millisecond_utc(
      greatest(
        original.recorded_at,
        basis.recorded_at,
        provider.updated_at,
        source.updated_at,
        product.updated_at,
        assessment.known_at,
        assessment.recorded_at
      )
    ),
    current_gate_snapshot
  from pg_catalog.unnest(selected_assessment_cursors)
    with ordinality as page(assessment_cursor, page_ordinality)
  join truth.thermal_anomaly_assessments as assessment
    on assessment.cursor = page.assessment_cursor
  join ingest.firms_detection_details as original
    on original.id = assessment.original_detection_id
    and original.version_no = 1
  join ingest.firms_detection_details as basis
    on basis.id = assessment.basis_detection_id
    and basis.original_detail_id = original.id
  join core.firms_products as product
    on product.id = basis.product_id
    and product.source_id = basis.source_id
    and product.product_key = basis.product_key
  join core.sources as source on source.id = basis.source_id
  join core.providers as provider on provider.id = source.provider_id
  order by page.page_ordinality;
end;
$$;

revoke execute on function api.thermal_anomalies_v3(
  integer, integer, integer, timestamptz, timestamptz, integer,
  timestamptz, uuid, text
) from public, firewatch_catalog_admin, firewatch_collector,
  firewatch_reconciler, firewatch_publisher, firewatch_dispatcher,
  anon, authenticated, service_role, firewatch_discovery_reader;

grant execute on function api.thermal_anomalies_v3(
  integer, integer, integer, timestamptz, timestamptz, integer,
  timestamptz, uuid, text
) to firewatch_discovery_reader;

comment on function api.thermal_anomalies_v3(
  integer, integer, integer, timestamptz, timestamptz, integer,
  timestamptz, uuid, text
) is
  'Returns a snapshot-bound keyset page of assessed FIRMS thermal-pixel observations for one coarse cell and two temporal cutoffs. Absence is indeterminate and never an all-clear.';

notify pgrst, 'reload schema';
