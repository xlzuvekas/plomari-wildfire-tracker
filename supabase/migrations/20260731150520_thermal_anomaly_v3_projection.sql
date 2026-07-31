-- Bounded v3 thermal-anomaly projection over immutable FIRMS detections and
-- append-only assessments. The function is deliberately a partial read: an
-- empty result means only that no publishable assessed row was visible at both
-- cutoffs. It never proves that the cell was sensed, that a later pass was
-- assessable, that no anomaly exists, or that an incident is resolved.

-- The existing assessment lookup index is optimized first for event time. This
-- companion index also covers the independent knowledge-time cutoff used by
-- historical replay without duplicating the large limitations array.
create index thermal_anomaly_assessments_projection_cutoff_idx
  on truth.thermal_anomaly_assessments(
    original_detection_id,
    as_of desc,
    known_at desc,
    version_no desc,
    cursor desc
  );

create or replace function api.thermal_anomalies_v3(
  p_z integer,
  p_x integer,
  p_y integer,
  p_as_of timestamptz,
  p_known_at timestamptz,
  p_limit integer default 101
)
returns table (
  detection_id uuid,
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
  item_known_at timestamptz
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

  if p_as_of is null
    or p_known_at is null
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

  -- Publication/license gates are mutable rather than versioned. Current false
  -- always withholds rows; current true is admitted only when every gate clock
  -- existed by p_known_at. Historical reads are therefore safely omissive.
  return query
  with visible_details as materialized (
    select
      detail.*,
      source.public_id::uuid as source_public_id,
      source.slug as source_slug,
      greatest(
        provider.updated_at,
        source.updated_at,
        product.updated_at
      ) as publication_gate_known_at
    from ingest.firms_detection_details as detail
    join core.firms_products as product
      on product.id = detail.product_id
      and product.source_id = detail.source_id
      and product.product_key = detail.product_key
    join core.sources as source on source.id = detail.source_id
    join core.providers as provider on provider.id = source.provider_id
    where detail.acquired_at > p_as_of - interval '7 days'
      and detail.acquired_at <= p_as_of
      and detail.retrieved_at <= p_known_at
      and detail.recorded_at <= p_known_at
      and detail.centroid_geom operator(extensions.&&) cell_geom
      and extensions.st_intersects(detail.centroid_geom, cell_geom)
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
      and not exists (
        select 1
        from ingest.firms_detection_details as successor
        where successor.original_detail_id = detail.original_detail_id
          and (successor.version_no, successor.id) >
            (detail.version_no, detail.id)
          and successor.retrieved_at <= p_known_at
          and successor.recorded_at <= p_known_at
      )
  ), assessed as materialized (
    select
      detail.*,
      assessment.public_id::uuid as assessment_public_id,
      assessment.assessment_state,
      assessment.reason_code,
      assessment.rule_id,
      assessment.rule_version,
      assessment.as_of as assessment_as_of_value,
      assessment.known_at as assessment_known_at_value,
      assessment.recorded_at as assessment_recorded_at_value,
      assessment.limitations as assessment_limitations_value,
      assessment.claim_kind,
      assessment.operational_effect,
      assessment.notification_eligible,
      assessment.official_status_eligible,
      assessment.protective_action_eligible,
      assessment.incident_resolution_eligible,
      greatest(
        detail.recorded_at,
        detail.publication_gate_known_at,
        assessment.known_at,
        assessment.recorded_at
      ) as item_known_at_value
    from visible_details as detail
    join lateral (
      select candidate.*
      from truth.thermal_anomaly_assessments as candidate
      where candidate.original_detection_id = detail.original_detail_id
        and candidate.as_of <= p_as_of
        and candidate.known_at <= p_known_at
        and candidate.recorded_at <= p_known_at
        and candidate.assessment_state in (
          'detected', 'awaiting_later_assessment', 'unknown'
        )
      order by
        candidate.version_no desc,
        candidate.cursor desc
      limit 1
    ) as assessment on true
  )
  select
    assessed.public_id::uuid,
    assessed.assessment_public_id,
    assessed.source_public_id,
    assessed.source_slug,
    assessed.contract_version,
    assessed.identity_version,
    assessed.product_key,
    assessed.satellite,
    assessed.instrument,
    pg_catalog.date_trunc('milliseconds', assessed.acquired_at),
    assessed.source_time_precision,
    pg_catalog.date_trunc('milliseconds', assessed.published_at),
    pg_catalog.date_trunc('milliseconds', assessed.retrieved_at),
    pg_catalog.date_trunc('milliseconds', assessed.recorded_at),
    assessed.latitude::double precision,
    assessed.longitude::double precision,
    assessed.scan_km::double precision,
    assessed.track_km::double precision,
    assessed.spatial_support_method,
    assessed.confidence_class,
    assessed.confidence_percent::double precision,
    assessed.brightness_primary_k::double precision,
    assessed.brightness_secondary_k::double precision,
    assessed.brightness_contract,
    assessed.frp_mw::double precision,
    assessed.day_night,
    assessed.source_dataset_version,
    assessed.limitations,
    assessed.assessment_state,
    assessed.reason_code,
    assessed.rule_id,
    assessed.rule_version,
    pg_catalog.date_trunc('milliseconds', assessed.assessment_as_of_value),
    pg_catalog.date_trunc('milliseconds', assessed.assessment_known_at_value),
    pg_catalog.date_trunc('milliseconds', assessed.assessment_recorded_at_value),
    assessed.assessment_limitations_value,
    assessed.claim_kind,
    assessed.operational_effect,
    assessed.notification_eligible,
    assessed.official_status_eligible,
    assessed.protective_action_eligible,
    assessed.incident_resolution_eligible,
    pg_catalog.date_trunc('milliseconds', assessed.item_known_at_value)
  from assessed
  order by assessed.acquired_at desc, assessed.public_id desc
  limit p_limit;
end;
$$;

revoke execute on function api.thermal_anomalies_v3(
  integer, integer, integer, timestamptz, timestamptz, integer
) from public, firewatch_catalog_admin, firewatch_collector,
  firewatch_reconciler, firewatch_publisher, firewatch_dispatcher,
  anon, authenticated, service_role, firewatch_discovery_reader;

grant execute on function api.thermal_anomalies_v3(
  integer, integer, integer, timestamptz, timestamptz, integer
) to firewatch_discovery_reader;

comment on function api.thermal_anomalies_v3(
  integer, integer, integer, timestamptz, timestamptz, integer
) is
  'Returns bounded assessed FIRMS thermal-pixel observations for one canonical coarse cell and two independent temporal cutoffs. Absence is indeterminate and never an all-clear.';

notify pgrst, 'reload schema';
