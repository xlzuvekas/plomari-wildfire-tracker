import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  FIRMS_RUNTIME_ROLE,
  validateFirmsDatabaseUrl,
} from "../supabase/functions/collect-firms/connection";
import { FIRMS_RUNTIME_CATALOG_CONTRACT } from "../supabase/functions/collect-firms/postgres-adapter";
import type { CollectorDatabase } from "../supabase/functions/collect-firms/database";
import { createFirmsEdgeHandler } from "../supabase/functions/collect-firms/runtime";

const migration = readFileSync(new URL(
  "../supabase/migrations/20260731043914_firms_shadow_collector_runtime.sql",
  import.meta.url,
), "utf8");
const rollback = readFileSync(new URL(
  "../supabase/rollbacks/20260731043914_firms_shadow_collector_runtime.sql",
  import.meta.url,
), "utf8");
const runtime = readFileSync(new URL(
  "../supabase/functions/collect-firms/runtime.ts",
  import.meta.url,
), "utf8");
const entrypoint = readFileSync(new URL(
  "../supabase/functions/collect-firms/index.ts",
  import.meta.url,
), "utf8");
const config = readFileSync(new URL("../supabase/config.toml", import.meta.url), "utf8");

describe("FIRMS shadow production runtime contract", () => {
  it("ships the exact four-product explicit-date bounded contract", () => {
    expect(FIRMS_RUNTIME_CATALOG_CONTRACT.requestParams).toEqual({
      dateRequestMode: "explicit_starting_on",
      dayRangeMaximum: 5,
      maximumAreaSquareDegrees: 100,
      maximumLatitudeSpanDegrees: 10,
      maximumLongitudeSpanDegrees: 10,
      maximumResponseBytesPerProduct: 2_000_000,
      maximumTotalResponseBytes: 8_000_000,
      products: [
        "MODIS_NRT", "VIIRS_NOAA20_NRT",
        "VIIRS_NOAA21_NRT", "VIIRS_SNPP_NRT",
      ],
      requestTimeoutMs: 15_000,
      responseFormat: "csv",
    });
    expect(migration).toContain("dateRequestMode\":\"explicit_starting_on");
    expect(migration).toContain("job.max_attempts = 3");
    expect(migration).toContain("p_lease_for <= interval '150 seconds'");
    expect(migration).toContain(
      "5c607d72fa1c21180bd64ec846d42f9ebae16603d6647f5c5023103d596fd404",
    );
  });

  it("is inert, unscheduled, and unable to publish an anomaly or all-clear", () => {
    expect(migration).toContain("and not source.enabled");
    expect(migration).toContain("and not endpoint_state.enabled");
    expect(migration).toContain("and not target.enabled");
    expect(migration).toContain("and not revision.enabled");
    expect(migration).toContain("and not adapter_state.enabled");
    expect(migration).not.toMatch(/cron\.schedule|insert into cron\.job/iu);
    expect(migration).not.toMatch(/create (?:or replace )?view api\./iu);
    expect(runtime).toContain("negativeAssessmentEligible: false");
    expect(runtime).toContain('sensorAssessability: "unknown"');
  });

  it("preserves raw occurrence lineage and the complete typed rejection set", () => {
    expect(migration).toContain("source_row_number");
    expect(migration).toContain("rejection_reasons text[]");
    expect(migration).toContain("'identity-collision'");
    expect(migration).toContain("'persistence-contract-mismatch'");
    expect(migration).toContain("failure_code text");
    expect(migration).toContain("exchange.outcome = 'pending'");
  });

  it("keeps both secrets server-side and diagnostics credential-free", () => {
    expect(entrypoint).toContain('environment("FIRMS_MAP_KEY")');
    expect(entrypoint).toContain('environment("FIRMS_COLLECTOR_DATABASE_URL")');
    expect(entrypoint).toContain('auth: "secret:firms_shadow"');
    expect(entrypoint).not.toContain("NEXT_PUBLIC_");
    expect(runtime).not.toContain('console.error("collect-firms", error)');
    expect(runtime).not.toContain("JSON.stringify(error)");
    expect(config).toContain("[functions.collect-firms]\nverify_jwt = false");
  });

  it("requires one dedicated Supavisor transaction-pooler login", () => {
    const projectRef = "abcdefghijklmnopqrst";
    const dsn = `postgresql://${FIRMS_RUNTIME_ROLE}.${projectRef}:password` +
      "@aws-0-eu-central-1.pooler.supabase.com:6543/postgres?sslmode=require";
    expect(validateFirmsDatabaseUrl(
      dsn,
      `https://${projectRef}.supabase.co`,
    )).toEqual({ value: dsn, projectRef });
    for (const invalid of [
      dsn.replace(`${FIRMS_RUNTIME_ROLE}.`, "postgres."),
      dsn.replace(":6543/", ":5432/"),
      dsn.replace(".pooler.supabase.com", ".supabase.co"),
      `${dsn}&application_name=collector`,
    ]) {
      expect(() => validateFirmsDatabaseUrl(
        invalid,
        `https://${projectRef}.supabase.co`,
      )).toThrow();
    }
  });

  it("rejects unbounded invocation fields and fails a disabled catalog safely", async () => {
    let opened = 0;
    let closed = 0;
    let mapKeyReads = 0;
    const diagnostics: unknown[] = [];
    const database: CollectorDatabase = {
      async query() {
        return [];
      },
      async transaction() {
        throw new Error("A disabled catalog must not start a transaction.");
      },
      async close() {
        closed += 1;
      },
    };
    const handler = createFirmsEdgeHandler({
      async openDatabase() {
        opened += 1;
        return database;
      },
      mapKey() {
        mapKeyReads += 1;
        return "never-read-test-key";
      },
      clockMs: () => Date.parse("2026-07-31T12:00:00.000Z"),
      reportDiagnostic: (diagnostic) => diagnostics.push(diagnostic),
    });
    const invalid = await handler(new Request("https://edge.test/collect-firms", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        area: { west: 26.9, south: 38.9, east: 27.1, north: 39.1 },
        dateFrom: "2026-07-31",
        dayCount: 1,
        mapKey: "must-not-be-accepted",
      }),
    }));
    expect(invalid.status).toBe(400);
    expect(opened).toBe(0);

    const disabled = await handler(new Request("https://edge.test/collect-firms", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        area: { west: 26.9, south: 38.9, east: 27.1, north: 39.1 },
        dateFrom: "2026-07-31",
        dayCount: 1,
      }),
    }));
    expect(disabled.status).toBe(503);
    expect(await disabled.json()).toEqual({
      status: "error",
      error: "collector_unavailable",
    });
    expect(opened).toBe(1);
    expect(closed).toBe(1);
    expect(mapKeyReads).toBe(0);
    expect(JSON.stringify(diagnostics)).not.toContain("never-read-test-key");
  });

  it("has a fail-closed rollback that never deletes evidence", () => {
    expect(rollback).toContain(
      "refusing FIRMS runtime rollback: durable execution or evidence rows exist",
    );
    expect(rollback).toContain(
      "refusing FIRMS runtime rollback: runtime activation state changed",
    );
    expect(rollback).not.toMatch(
      /delete from (?:ingest|truth)\.(?:firms|source_revisions|global_observations)/iu,
    );
  });
});
