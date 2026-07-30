// All SQL for the persistence layer. Every function takes a Queryable first
// so tests can inject PGlite; production passes the pg Pool from client.ts.
// JSONB parameters are passed as JSON.stringify(...) with ::jsonb casts so
// pg and PGlite behave identically.

import { createHash } from "node:crypto";
import type { Queryable } from "./client.ts";

export type CacheRow = {
  key: string;
  payload: unknown;
  status: string;
  upstreamOk: boolean;
  storedAt: string;
};

export type ThermalDetectionRow = {
  routeId: string;
  passId: string;
  lat: number;
  lon: number;
  sensor: string;
  satellite: string;
  product: string;
  version: string | null;
  observedAt: string;
  confidence: string;
  confidenceCode: "h" | "n" | "l" | "u";
  frpMw: number | null;
  scanKm: number | null;
  trackKm: number | null;
  daynight: string | null;
  distanceFromIncidentKm: number;
  bearingFromIncidentDeg: number;
  scope: "incident" | "regional";
};

export type WireItemRow = {
  id: string;
  url: string;
  title: string;
  sourceId: string;
  sourceLabel: string;
  sourceKind: string;
  sourceTier: string;
  publishedAt: string | null;
  modifiedAt: string | null;
  category: string;
  severity: string;
  actionRequired: boolean;
  payload: unknown;
};

export type PassAggregate = {
  passId: string;
  product: string;
  satellite: string;
  sensor: string;
  observedAt: string;
  recordCount: number;
  incidentRecordCount: number;
  maxFrpMw: number | null;
  medianFrpMw: number | null;
  byConfidence: { h: number; n: number; l: number; u: number };
  firstSeenAt: string;
};

export type SnapshotMeta = {
  id: number;
  source: string;
  fetchedAt: string;
  lastConfirmedAt: string;
  status: string;
  upstreamOk: boolean;
  payloadBytes: number;
};

function isoString(value: unknown, field: string): string {
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "string") {
    const parsed = new Date(value);
    if (!Number.isNaN(parsed.getTime())) return parsed.toISOString();
  }
  throw new Error(`store: expected timestamp in column "${field}"`);
}

function requiredString(value: unknown, field: string): string {
  if (typeof value !== "string") {
    throw new Error(`store: expected text in column "${field}"`);
  }
  return value;
}

function requiredNumber(value: unknown, field: string): number {
  const parsed = typeof value === "string" ? Number(value) : value;
  if (typeof parsed !== "number" || !Number.isFinite(parsed)) {
    throw new Error(`store: expected number in column "${field}"`);
  }
  return parsed;
}

/**
 * Deterministic hash of a route-specific content signature. Signatures are
 * built from fixed-order arrays/objects of stable fields (item IDs, dataset
 * statuses) — never fetch-time fields — so identical upstream content hashes
 * identically across processes. Deliberately NOT reusing lib/truth/v1's
 * hashJson until its localeCompare key sort is fixed (non-deterministic
 * across ICU builds).
 */
export function contentHash(signature: unknown): string {
  return createHash("md5").update(JSON.stringify(signature)).digest("hex");
}

/**
 * Natural key matching lib/truth/v1/identity.ts firmsDetectionNaturalKey
 * (PR #15): product|satellite|observedAt|lat 4dp|lon 4dp|scan 3dp|track 3dp,
 * product/satellite trimmed + lowercased. Implemented locally because #15 is
 * an unmerged draft; unify by import once it lands.
 */
export function thermalNaturalKey(row: {
  product: string;
  satellite: string;
  observedAt: string;
  lat: number;
  lon: number;
  scanKm: number | null;
  trackKm: number | null;
}): string {
  const part = (value: number | null) =>
    value === null ? "null" : value.toFixed(3);
  return [
    row.product.trim().toLowerCase(),
    row.satellite.trim().toLowerCase(),
    row.observedAt,
    row.lat.toFixed(4),
    row.lon.toFixed(4),
    part(row.scanKm),
    part(row.trackKm),
  ].join("|");
}

export function isUndefinedTableError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === "42P01"
  );
}

export async function readCache(
  db: Queryable,
  key: string,
): Promise<CacheRow | null> {
  const result = await db.query(
    `select cache_key, payload, status, upstream_ok, stored_at
       from response_cache where cache_key = $1`,
    [key],
  );
  const row = result.rows[0];
  if (row === undefined) return null;
  return {
    key: requiredString(row.cache_key, "cache_key"),
    payload: row.payload,
    status: requiredString(row.status, "status"),
    upstreamOk: row.upstream_ok === true,
    storedAt: isoString(row.stored_at, "stored_at"),
  };
}

export async function writeCache(
  db: Queryable,
  key: string,
  payload: unknown,
  status: string,
  upstreamOk: boolean,
): Promise<void> {
  await db.query(
    `insert into response_cache (cache_key, payload, status, upstream_ok, stored_at)
     values ($1, $2::jsonb, $3, $4, now())
     on conflict (cache_key) do update
       set payload = excluded.payload,
           status = excluded.status,
           upstream_ok = excluded.upstream_ok,
           stored_at = excluded.stored_at`,
    [key, JSON.stringify(payload), status, upstreamOk],
  );
}

export async function appendSnapshot(
  db: Queryable,
  args: {
    source: string;
    payload: unknown;
    status: string;
    upstreamOk: boolean;
    contentHash: string | null;
  },
): Promise<"inserted" | "confirmed"> {
  if (args.contentHash !== null) {
    const confirmed = await db.query(
      `update source_snapshots set last_confirmed_at = now()
        where id = (select id from source_snapshots
                     where source = $1 order by fetched_at desc limit 1)
          and content_hash = $2
        returning id`,
      [args.source, args.contentHash],
    );
    if (confirmed.rows.length > 0) return "confirmed";
  }
  await db.query(
    `insert into source_snapshots (source, status, upstream_ok, content_hash, payload)
     values ($1, $2, $3, $4, $5::jsonb)`,
    [
      args.source,
      args.status,
      args.upstreamOk,
      args.contentHash,
      JSON.stringify(args.payload),
    ],
  );
  return "inserted";
}

const DETECTION_CHUNK = 200;

export async function upsertThermalDetections(
  db: Queryable,
  rows: ThermalDetectionRow[],
): Promise<void> {
  for (let offset = 0; offset < rows.length; offset += DETECTION_CHUNK) {
    const chunk = rows.slice(offset, offset + DETECTION_CHUNK);
    const values: unknown[] = [];
    const tuples = chunk.map((row, index) => {
      const base = index * 19;
      values.push(
        thermalNaturalKey(row),
        row.routeId,
        row.passId,
        row.lat,
        row.lon,
        row.sensor,
        row.satellite,
        row.product,
        row.version,
        row.observedAt,
        row.confidence,
        row.confidenceCode,
        row.frpMw,
        row.scanKm,
        row.trackKm,
        row.daynight,
        row.distanceFromIncidentKm,
        row.bearingFromIncidentDeg,
        row.scope,
      );
      const placeholders = Array.from(
        { length: 19 },
        (_, column) => `$${base + column + 1}`,
      );
      return `(${placeholders.join(", ")})`;
    });
    await db.query(
      `insert into thermal_detections (
         natural_key, route_id, pass_id, lat, lon, sensor, satellite, product,
         version, observed_at, confidence, confidence_code, frp_mw, scan_km,
         track_km, daynight, distance_from_incident_km,
         bearing_from_incident_deg, scope)
       values ${tuples.join(", ")}
       on conflict (natural_key) do update
         set last_seen_at = now(),
             pass_id = excluded.pass_id,
             route_id = excluded.route_id,
             confidence = excluded.confidence,
             confidence_code = excluded.confidence_code,
             frp_mw = excluded.frp_mw`,
      values,
    );
  }
}

export async function upsertWireItems(
  db: Queryable,
  rows: WireItemRow[],
): Promise<void> {
  for (const row of rows) {
    await db.query(
      `insert into wire_items (
         id, url, title, source_id, source_label, source_kind, source_tier,
         published_at, modified_at, category, severity, action_required, payload)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13::jsonb)
       on conflict (id) do update
         set last_seen_at = now(),
             title = excluded.title,
             modified_at = excluded.modified_at,
             category = excluded.category,
             severity = excluded.severity,
             action_required = excluded.action_required,
             payload = excluded.payload`,
      [
        row.id,
        row.url,
        row.title,
        row.sourceId,
        row.sourceLabel,
        row.sourceKind,
        row.sourceTier,
        row.publishedAt,
        row.modifiedAt,
        row.category,
        row.severity,
        row.actionRequired,
        JSON.stringify(row.payload),
      ],
    );
  }
}

export async function queryThermalPasses(
  db: Queryable,
  q: { from: string; to: string; limit: number },
): Promise<PassAggregate[]> {
  const result = await db.query(
    `select pass_id,
            min(product) as product,
            min(satellite) as satellite,
            min(sensor) as sensor,
            min(observed_at) as observed_at,
            count(*)::int as record_count,
            (count(*) filter (where scope = 'incident'))::int as incident_record_count,
            max(frp_mw) as max_frp_mw,
            percentile_cont(0.5) within group (order by frp_mw) as median_frp_mw,
            (count(*) filter (where confidence_code = 'h'))::int as h,
            (count(*) filter (where confidence_code = 'n'))::int as n,
            (count(*) filter (where confidence_code = 'l'))::int as l,
            (count(*) filter (where confidence_code = 'u'))::int as u,
            min(first_seen_at) as first_seen_at
       from thermal_detections
      where observed_at >= $1 and observed_at <= $2
      group by pass_id
      order by min(observed_at) desc
      limit $3`,
    [q.from, q.to, q.limit],
  );
  return result.rows.map((row) => ({
    passId: requiredString(row.pass_id, "pass_id"),
    product: requiredString(row.product, "product"),
    satellite: requiredString(row.satellite, "satellite"),
    sensor: requiredString(row.sensor, "sensor"),
    observedAt: isoString(row.observed_at, "observed_at"),
    recordCount: requiredNumber(row.record_count, "record_count"),
    incidentRecordCount: requiredNumber(
      row.incident_record_count,
      "incident_record_count",
    ),
    maxFrpMw: row.max_frp_mw === null ? null : requiredNumber(row.max_frp_mw, "max_frp_mw"),
    medianFrpMw:
      row.median_frp_mw === null
        ? null
        : requiredNumber(row.median_frp_mw, "median_frp_mw"),
    byConfidence: {
      h: requiredNumber(row.h, "h"),
      n: requiredNumber(row.n, "n"),
      l: requiredNumber(row.l, "l"),
      u: requiredNumber(row.u, "u"),
    },
    firstSeenAt: isoString(row.first_seen_at, "first_seen_at"),
  }));
}

export async function querySnapshotLog(
  db: Queryable,
  q: { source: string | null; from: string; to: string; limit: number },
): Promise<SnapshotMeta[]> {
  const result = await db.query(
    `select id, source, fetched_at, last_confirmed_at, status, upstream_ok,
            pg_column_size(payload) as payload_bytes
       from source_snapshots
      where ($1::text is null or source = $1)
        and fetched_at >= $2 and fetched_at <= $3
      order by fetched_at desc
      limit $4`,
    [q.source, q.from, q.to, q.limit],
  );
  return result.rows.map((row) => ({
    id: requiredNumber(row.id, "id"),
    source: requiredString(row.source, "source"),
    fetchedAt: isoString(row.fetched_at, "fetched_at"),
    lastConfirmedAt: isoString(row.last_confirmed_at, "last_confirmed_at"),
    status: requiredString(row.status, "status"),
    upstreamOk: row.upstream_ok === true,
    payloadBytes: requiredNumber(row.payload_bytes, "payload_bytes"),
  }));
}

export async function queryWireItems(
  db: Queryable,
  q: { from: string; to: string; limit: number },
): Promise<Array<Record<string, unknown>>> {
  const result = await db.query(
    `select id, url, title, source_id, source_label, source_kind, source_tier,
            published_at, modified_at, category, severity, action_required,
            payload, first_seen_at, last_seen_at
       from wire_items
      where coalesce(published_at, first_seen_at) >= $1
        and coalesce(published_at, first_seen_at) <= $2
      order by coalesce(published_at, first_seen_at) desc
      limit $3`,
    [q.from, q.to, q.limit],
  );
  return result.rows.map((row) => ({
    id: row.id,
    url: row.url,
    title: row.title,
    sourceId: row.source_id,
    sourceLabel: row.source_label,
    sourceKind: row.source_kind,
    sourceTier: row.source_tier,
    publishedAt: row.published_at === null ? null : isoString(row.published_at, "published_at"),
    modifiedAt: row.modified_at === null ? null : isoString(row.modified_at, "modified_at"),
    category: row.category,
    severity: row.severity,
    actionRequired: row.action_required === true,
    payload: row.payload,
    firstSeenAt: isoString(row.first_seen_at, "first_seen_at"),
    lastSeenAt: isoString(row.last_seen_at, "last_seen_at"),
  }));
}
