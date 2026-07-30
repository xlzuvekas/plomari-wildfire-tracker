import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import type { Queryable } from "../../lib/db/client.ts";

const SETUP_SQL = readFileSync(
  join(process.cwd(), "docs", "db", "setup.sql"),
  "utf8",
);

/** Fresh in-process Postgres with the REAL production DDL applied. */
export async function newDb(): Promise<Queryable & { exec(sql: string): Promise<unknown> }> {
  const db = new PGlite();
  await db.exec(SETUP_SQL);
  return db;
}

export function detection(overrides: Record<string, unknown> = {}) {
  return {
    routeId: "VIIRS_NOAA20_NRT-2026-07-30T10:17:00Z-38.98912-26.38446",
    passId: "VIIRS_NOAA20_NRT-2026-07-30T10:17:00Z",
    lat: 38.98912,
    lon: 26.38446,
    sensor: "NOAA-20 VIIRS",
    satellite: "N20",
    product: "VIIRS_NOAA20_NRT",
    version: "2.0NRT",
    observedAt: "2026-07-30T10:17:00Z",
    confidence: "Nominal",
    confidenceCode: "n" as const,
    frpMw: 12.4,
    scanKm: 0.54,
    trackKm: 0.51,
    daynight: "D",
    distanceFromIncidentKm: 0.42,
    bearingFromIncidentDeg: 45.2,
    scope: "incident" as const,
    ...overrides,
  };
}

export function wireItem(overrides: Record<string, unknown> = {}) {
  return {
    id: "stonisi-114624",
    url: "https://www.stonisi.gr/post/114624/example",
    title: "Example headline",
    sourceId: "stonisi",
    sourceLabel: "StoNisi",
    sourceKind: "publisher",
    sourceTier: "publisher",
    publishedAt: "2026-07-30T06:07:25.000Z",
    modifiedAt: null,
    category: "response",
    severity: "info",
    actionRequired: false,
    payload: { title: "Example headline" },
    ...overrides,
  };
}
