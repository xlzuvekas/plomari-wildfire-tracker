-- Plomari Wildfire Tracker — persistence schema.
--
-- Idempotent: every statement is IF NOT EXISTS, safe to paste repeatedly in
-- the Supabase SQL editor (or run through the Supabase MCP database tools).
-- This file is also loaded verbatim by tests/db/helpers.ts into PGlite, so it
-- must stay pure DDL — no extensions, no cron, no data. Cron lives in
-- docs/db/cron.sql.
--
-- Terminology note for the truth-layer roadmap (#8/#13): "source_snapshots"
-- here is raw per-route response history — the spec's *source items* lane.
-- It is NOT the spec's "incident_state_snapshots" (reconciled read model),
-- which belongs to workstream D and does not exist yet.

-- One row per cache key; the shared read-through store. Never grows.
create table if not exists response_cache (
  cache_key   text primary key,
  payload     jsonb       not null,
  status      text        not null,
  upstream_ok boolean     not null,
  stored_at   timestamptz not null default now()
);

-- Append-only response history with content-hash dedupe: when the newest row
-- for a source carries the same content_hash, the writer bumps
-- last_confirmed_at instead of inserting, so quiet hours add no rows.
-- Semantics: "content first seen at fetched_at, last verified identical at
-- last_confirmed_at".
create table if not exists source_snapshots (
  id                bigint generated always as identity primary key,
  source            text        not null,
  status            text        not null,
  upstream_ok       boolean     not null,
  content_hash      text,
  payload           jsonb       not null,
  fetched_at        timestamptz not null default now(),
  last_confirmed_at timestamptz not null default now()
);
create index if not exists source_snapshots_source_fetched_idx
  on source_snapshots (source, fetched_at desc);

-- Normalized NASA FIRMS detections, accumulated beyond FIRMS's 24 h window.
-- natural_key follows the truth-layer contract draft
-- (lib/truth/v1/identity.ts firmsDetectionNaturalKey on PR #15):
--   product|satellite|observed_at|lat(4dp)|lon(4dp)|scan(3dp)|track(3dp)
-- with product/satellite trimmed + lowercased. The /api/thermal route's own
-- 5-decimal id is kept as route_id for joins against live payloads.
create table if not exists thermal_detections (
  natural_key               text primary key,
  route_id                  text not null,
  pass_id                   text not null,
  lat                       double precision not null,
  lon                       double precision not null,
  sensor                    text not null,
  satellite                 text not null,
  product                   text not null,
  version                   text,
  observed_at               timestamptz not null,
  confidence                text not null,
  confidence_code           text not null check (confidence_code in ('h', 'n', 'l', 'u')),
  frp_mw                    double precision,
  scan_km                   double precision,
  track_km                  double precision,
  daynight                  text,
  distance_from_incident_km double precision not null,
  bearing_from_incident_deg double precision not null,
  scope                     text not null check (scope in ('incident', 'regional')),
  first_seen_at             timestamptz not null default now(),
  last_seen_at              timestamptz not null default now()
);
create index if not exists thermal_detections_observed_idx
  on thermal_detections (observed_at desc);
create index if not exists thermal_detections_pass_idx
  on thermal_detections (pass_id, observed_at);

-- Incident-wire news items, upserted by the stable FeedItem.id so the wire
-- survives RSS roll-off. first_seen_at is preserved across upserts.
create table if not exists wire_items (
  id              text primary key,
  url             text not null,
  title           text not null,
  source_id       text not null,
  source_label    text not null,
  source_kind     text not null,
  source_tier     text not null,
  published_at    timestamptz,
  modified_at     timestamptz,
  category        text not null,
  severity        text not null,
  action_required boolean not null default false,
  payload         jsonb not null,
  first_seen_at   timestamptz not null default now(),
  last_seen_at    timestamptz not null default now()
);
create index if not exists wire_items_published_idx
  on wire_items (published_at desc nulls last);
