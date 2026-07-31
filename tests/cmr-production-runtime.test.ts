import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CMR_FIREMASK_PRODUCTS, type SatellitePass } from "../lib/satellite/cmr";
import type { CmrHarvestPlan } from "../lib/satellite/cmr-collector.server";
import type {
  CollectorDatabase,
  DatabaseRow,
  DatabaseSession,
} from "../supabase/functions/collect-cmr/database";
import {
  CMR_RUNTIME_ROLE,
  validateCollectorDatabaseUrl,
} from "../supabase/functions/collect-cmr/connection";
import { canonicalJson, sha256Hex, uuidV7 } from "../supabase/functions/collect-cmr/identifiers";
import {
  PostgresCmrAdapter,
  cmrDuplicateContentMatches,
  cmrRejectionIdentity,
} from "../supabase/functions/collect-cmr/postgres-adapter";
import {
  CMR_EDGE_HARVEST_LIMITS,
  createCmrEdgeHandler,
} from "../supabase/functions/collect-cmr/runtime";

const projectRef = "abcdefghijklmnopqrst";
const validDsn =
  `postgresql://${CMR_RUNTIME_ROLE}.${projectRef}:one-time-password` +
  "@aws-0-eu-central-1.pooler.supabase.com:6543/postgres?sslmode=require";
const validSupabaseUrl = `https://${projectRef}.supabase.co`;

afterEach(() => vi.unstubAllGlobals());

function identityRow() {
  return {
    runtime_role: CMR_RUNTIME_ROLE,
    has_collector_capability: true,
    runtime_superuser: false,
    runtime_bypasses_rls: false,
    runtime_inherits: true,
    runtime_createdb: false,
    runtime_createrole: false,
    runtime_replication: false,
    member_of_postgres: false,
    member_of_service_role: false,
    member_of_authenticator: false,
    member_of_catalog_admin: false,
    member_of_reconciler: false,
    member_of_publisher: false,
    member_of_dispatcher: false,
    direct_memberships: ["firewatch_collector"],
    effective_memberships: ["anon", "firewatch_collector"],
    collector_memberships: ["anon"],
  };
}

function jsonArgument(value: unknown) {
  return typeof value === "string" ? JSON.parse(value) as unknown : value;
}

function currentDatabase(
  onClose: () => void,
  completion: Readonly<Record<string, unknown>> = {
    health_cursor: "42",
    watermark_to: "2026-07-30T12:20:00.000Z",
    baseline_checked_at: "2026-07-29T13:00:00.000Z",
    reconciliation_interval_hours: 24,
  },
  reapedRunId: string | null = null,
): CollectorDatabase {
  const query = async <Row extends DatabaseRow = DatabaseRow>(
    statement: string,
    parameters: readonly unknown[] = [],
  ) => {
    const placeholders = [...statement.matchAll(/\$(\d+)/gu)]
      .map((match) => Number(match[1]));
    expect(parameters).toHaveLength(Math.max(0, ...placeholders));
    if (
      statement.includes("current_user as runtime_role") &&
      statement.includes("target_state.cursor_state")
    ) {
      return [{
        ...identityRow(),
        source_id: "1",
        endpoint_id: "2",
        target_id: "3",
        target_revision_id: "4",
        adapter_release_id: "5",
        adapter_version: "cmr-test-v1",
        cursor_state: {},
      }] as unknown as readonly Row[];
    }
    if (statement.includes("current_user as runtime_role")) {
      return [identityRow()] as unknown as readonly Row[];
    }
    if (statement.includes("reap_expired_cmr_collection_job")) {
      return [{ reaped_run_id: reapedRunId }] as unknown as readonly Row[];
    }
    if (statement.includes("completion.health_cursor")) {
      return [completion] as unknown as readonly Row[];
    }
    throw new Error("Unexpected fake-database query.");
  };
  return {
    query,
    async transaction<Result>(): Promise<Result> {
      throw new Error("Current plan must not start a transaction.");
    },
    async close() {
      onClose();
    },
  };
}

describe("CMR collector production connection boundary", () => {
  it("accepts only the dedicated transaction-pooler login", () => {
    expect(validateCollectorDatabaseUrl(validDsn, validSupabaseUrl)).toEqual({
      value: validDsn,
      projectRef,
    });

    for (const invalid of [
      validDsn.replace(`${CMR_RUNTIME_ROLE}.`, "postgres."),
      validDsn.replace(`${CMR_RUNTIME_ROLE}.`, "service_role."),
      validDsn.replace(":6543/", ":5432/"),
      validDsn.replace(".pooler.supabase.com", ".supabase.co"),
      validDsn.replace("?sslmode=require", ""),
      `${validDsn}&application_name=collector`,
      `${validDsn}&sslmode=require`,
      validDsn.replace("one-time-password", ""),
      ` ${validDsn}`,
    ]) {
      expect(() => validateCollectorDatabaseUrl(invalid, validSupabaseUrl)).toThrow();
    }
    expect(() => validateCollectorDatabaseUrl(validDsn, undefined)).toThrow();
    expect(() => validateCollectorDatabaseUrl(
      validDsn,
      "https://zyxwvutsrqponmlkjihg.supabase.co",
    )).toThrow();
  });

  it("rejects any unlisted direct or inherited database role", async () => {
    const base = currentDatabase(() => undefined);
    const elevated: CollectorDatabase = {
      ...base,
      async query<Row extends DatabaseRow = DatabaseRow>(
        statement: string,
        parameters: readonly unknown[] = [],
      ) {
        if (
          statement.includes("current_user as runtime_role") &&
          !statement.includes("target_state.cursor_state")
        ) {
          return [{
            ...identityRow(),
            direct_memberships: ["firewatch_collector", "mystery_admin"],
            effective_memberships: [
              "anon",
              "firewatch_collector",
              "mystery_admin",
            ],
          }] as unknown as readonly Row[];
        }
        return base.query<Row>(statement, parameters);
      },
    };

    await expect(
      new PostgresCmrAdapter(elevated).assertRuntimeIdentity(),
    ).rejects.toThrow("least-privileged login");
  });
});

describe("CMR collector durable identifiers", () => {
  it("creates RFC 9562 version 7, variant 10 identifiers deterministically", () => {
    const id = uuidV7(1_700_000_000_000, (target) => {
      target.fill(0xff);
      return target;
    });
    expect(id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-b[0-9a-f]{3}-[0-9a-f]{12}$/u,
    );
  });

  it("uses code-unit sorted canonical JSON and Web Crypto SHA-256", async () => {
    expect(canonicalJson({ z: 1, a: { d: 4, b: 2 } })).toBe(
      '{"a":{"b":2,"d":4},"z":1}',
    );
    expect(await sha256Hex("abc")).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
  });

  it("withholds malformed provider identifiers from typed rejection columns", () => {
    expect(cmrRejectionIdentity({
      conceptId: "G12345-LANCEMODIS",
      revisionId: 7,
    })).toEqual({
      catalogGranuleId: "G12345-LANCEMODIS",
      cmrRevisionId: 7,
    });
    expect(cmrRejectionIdentity({
      conceptId: "bad\nidentity",
      revisionId: -1,
    })).toEqual({ catalogGranuleId: null, cmrRevisionId: null });
    expect(cmrRejectionIdentity({
      conceptId: null,
      revisionId: Number.MAX_SAFE_INTEGER + 1,
    })).toEqual({ catalogGranuleId: null, cmrRevisionId: null });
  });

  it("fails duplicate replay identity closed when normalized content changed", () => {
    expect(cmrDuplicateContentMatches({
      incomingSha256: "a".repeat(64),
      existingSha256: "a".repeat(64),
    })).toBe(true);
    expect(cmrDuplicateContentMatches({
      incomingSha256: "a".repeat(64),
      existingSha256: "b".repeat(64),
    })).toBe(false);
    expect(cmrDuplicateContentMatches({
      incomingSha256: "not-a-hash",
      existingSha256: "not-a-hash",
    })).toBe(false);
  });
});

describe("CMR collector replay occurrences", () => {
  it("links a replay duplicate and publishes failed source health atomically", async () => {
    const statements: Array<Readonly<{
      statement: string;
      parameters: readonly unknown[];
    }>> = [];
    const database: CollectorDatabase = {
      async query<Row extends DatabaseRow = DatabaseRow>(
        statement: string,
        parameters: readonly unknown[] = [],
      ) {
        statements.push({ statement, parameters });
        if (
          statement.includes("current_user as runtime_role") &&
          statement.includes("target_state.cursor_state")
        ) {
          return [{
            ...identityRow(),
            source_id: "1",
            endpoint_id: "2",
            target_id: "3",
            target_revision_id: "4",
            adapter_release_id: "5",
            adapter_version: "cmr-test-v1",
            cursor_state: {},
          }] as unknown as readonly Row[];
        }
        if (statement.includes("insert into ingest.jobs")) {
          return [] as readonly Row[];
        }
        if (statement.includes("from ingest.jobs") && statement.includes("idempotency_key")) {
          return [{
            id: "10",
            status: "pending",
            lease_token: null,
            lease_owner: null,
            attempt_count: 0,
          }] as unknown as readonly Row[];
        }
        if (statement.includes("claim_cmr_collection_job_exact")) {
          return [{
            id: "10",
            status: "running",
            lease_token: "018f0000-0000-7000-8000-000000000901",
            lease_owner: parameters[1],
            attempt_count: 1,
          }] as unknown as readonly Row[];
        }
        if (statement.includes("insert into ingest.runs")) {
          return [{ id: "20", public_id: parameters[0] }] as unknown as readonly Row[];
        }
        if (statement.includes("insert into ingest.content_blobs")) {
          return [] as readonly Row[];
        }
        if (
          statement.includes("select id, byte_size") &&
          statement.includes("from ingest.content_blobs")
        ) {
          return [{ id: "31", byte_size: "3" }] as unknown as readonly Row[];
        }
        if (statement.includes("insert into ingest.raw_objects")) {
          return [{ id: "30" }] as unknown as readonly Row[];
        }
        if (statement.includes("ingest.finish_http_exchange")) {
          return [{ finished: true }] as unknown as readonly Row[];
        }
        if (
          statement.includes("from ingest.http_exchanges as exchange") &&
          statement.includes("raw.retrieved_at")
        ) {
          return [{
            raw_object_id: "30",
            retrieved_at: "2026-07-30T12:31:00.000Z",
          }] as unknown as readonly Row[];
        }
        if (statement.includes("pg_advisory_xact_lock")) {
          return [] as readonly Row[];
        }
        if (
          statement.includes("from ingest.cmr_granule_details as detail") &&
          statement.includes("jsonb_to_recordset")
        ) {
          const input = jsonArgument(parameters[0]) as Array<{
            content_sha256: string;
          }>;
          return [{
            observation_cursor: "99",
            catalog_granule_id: "G12345-LANCEMODIS",
            cmr_revision_id: "7",
            content_sha256: input[0]?.content_sha256,
          }] as unknown as readonly Row[];
        }
        if (statement.includes("insert into ingest.cmr_granule_occurrences")) {
          return [{ observation_cursor: "99" }] as unknown as readonly Row[];
        }
        if (statement.includes("select status from ingest.runs")) {
          return [{ status: "running" }] as unknown as readonly Row[];
        }
        if (statement.includes("abandon_pending_cmr_http_exchanges")) {
          return [{ abandon_pending_cmr_http_exchanges: 0 }] as unknown as readonly Row[];
        }
        if (
          statement.includes("as occurrence_count") &&
          statement.includes("as rejected_count")
        ) {
          return [{
            request_count: "1",
            occurrence_count: "1",
            accepted_count: "0",
            rejected_count: "0",
          }] as unknown as readonly Row[];
        }
        if (statement.includes("ingest.finish_ingestion_run")) {
          return [{ finished: true }] as unknown as readonly Row[];
        }
        if (statement.includes("insert into truth.source_health")) {
          return [{ cursor: "101" }] as unknown as readonly Row[];
        }
        throw new Error(`Unexpected fake-database statement: ${statement}`);
      },
      async transaction<Result>(
        operation: (session: DatabaseSession) => Promise<Result>,
      ) {
        return operation(this);
      },
      async close() {},
    };
    const plan: CmrHarvestPlan = Object.freeze({
      harvestKey: "cmr-bootstrap-20260730T123000000Z",
      scanKind: "bootstrap",
      requestedFrom: "2026-07-29T00:30:00.000Z",
      requestedTo: "2026-07-30T12:30:00.000Z",
      updatedSince: null,
      watermarkFrom: null,
      watermarkTo: "2026-07-30T12:20:00.000Z",
      predecessorHealthCursor: null,
    });
    const adapter = new PostgresCmrAdapter(
      database,
      () => Date.parse("2026-07-30T12:31:00.000Z"),
    );
    const reservation = await adapter.reserveHarvest(plan);
    expect(reservation.state).toBe("execute");
    if (reservation.state !== "execute") throw new Error("Expected execution.");
    for (const [exchangeId, encoding] of [
      ["40", "gzip"],
      ["41", "br"],
    ] as const) {
      await adapter.finishResponse(
        { exchangeId, runId: "20" },
        {
          status: 200,
          body: new Uint8Array([123, 125, 10]),
          safeHeaders: {
            "content-type": "application/json",
            "content-encoding": encoding,
          },
          safeMetadata: { page: 1 },
        },
      );
    }
    const contentBlobs = statements.filter(({ statement }) =>
      statement.includes("insert into ingest.content_blobs")
    );
    expect(contentBlobs).toHaveLength(2);
    expect(contentBlobs.map(({ parameters }) => parameters[3])).toEqual([
      null,
      null,
    ]);
    expect(contentBlobs[0]?.parameters[1]).toBe(contentBlobs[1]?.parameters[1]);
    const job = statements.find(({ statement }) =>
      statement.includes("insert into ingest.jobs")
    );
    expect(job?.parameters[8]).toMatchObject({
      collector: "cmr_firemask_catalog",
      plan: { scanKind: "bootstrap" },
    });
    expect(typeof job?.parameters[8]).toBe("object");
    const finishedExchanges = statements.filter(({ statement }) =>
      statement.includes("ingest.finish_http_exchange")
    );
    expect(finishedExchanges.map(({ parameters }) =>
      (jsonArgument(parameters[6]) as Record<string, unknown>)["content-encoding"]
    )).toEqual(["gzip", "br"]);
    const product = CMR_FIREMASK_PRODUCTS[0];
    if (product === undefined) throw new Error("CMR product fixture is missing.");
    const pass: SatellitePass = Object.freeze({
      itemIndex: 0,
      id: "G12345-LANCEMODIS",
      revisionId: 7,
      granuleUr: "VNP14IMG_NRT.A2026211.1230.002",
      collectionId: "C12345-LANCEMODIS",
      product: product.shortName,
      productVersion: product.version,
      satellite: product.satellite,
      sensor: "VIIRS",
      ummGVersion: "1.6.7",
      observedFrom: "2026-07-30T12:25:00.000Z",
      observedTo: "2026-07-30T12:30:00.000Z",
      producedAt: "2026-07-30T12:30:30.000Z",
      catalogedAt: "2026-07-30T12:30:45.000Z",
      dayNight: "day",
      footprint: {
        type: "Polygon" as const,
        coordinates: [[
          [20, 38],
          [21, 38],
          [21, 39],
          [20, 38],
        ]] as const,
      },
      footprintSource: "umm-g-gpolygon",
      footprintPrecision: "not_applicable",
      coverage: "catalog-footprint",
      anomalyAssessment: "not-assessed",
    });
    const persisted = await adapter.persistPage({
      harvestId: reservation.harvestId,
      plan,
      product,
      page: 1,
      requestId: `${plan.harvestKey}:${product.shortName}:1`,
      searchAfterBefore: null,
      exchange: { exchangeId: "40", runId: "20" },
      responseBytes: 512,
      response: {
        hits: 1,
        searchAfter: null,
        timedOut: false,
        tookMs: 10,
        cmrRequestId: "provider-request-1",
        xRequestId: null,
      },
      parsed: {
        product: product.shortName,
        satellite: product.satellite,
        status: "ok",
        hits: 1,
        returnedItems: 1,
        passes: [pass],
        rejectedItems: [],
        errorCode: null,
      },
    });

    expect(persisted).toEqual({
      acceptedCount: 0,
      duplicateCount: 1,
      rejectedCount: 0,
    });
    const occurrence = statements.find(({ statement }) =>
      statement.includes("insert into ingest.cmr_granule_occurrences")
    );
    expect(occurrence).toBeDefined();
    expect(jsonArgument(occurrence?.parameters[4])).toEqual([{
      item_index: 0,
      observation_cursor: "99",
      product: "VNP14IMG_NRT",
      catalog_granule_id: "G12345-LANCEMODIS",
      cmr_revision_id: 7,
    }]);
    expect(
      statements.some(({ statement }) =>
        statement.includes("insert into ingest.source_revisions")
      ),
    ).toBe(false);

    await adapter.failHarvest({
      harvestId: reservation.harvestId,
      plan,
      code: "rate_limit",
      detailSafe: "NASA CMR rate-limited the catalog harvest.",
    });
    const failedHealth = statements.find(({ statement }) =>
      statement.includes("insert into truth.source_health")
    );
    expect(failedHealth).toBeDefined();
    expect(failedHealth?.parameters.slice(2, 8)).toEqual([
      `cmr-health-failed:${plan.harvestKey}`,
      "rate_limited",
      "open",
      "rate_limit",
      1,
      0,
    ]);
    expect(jsonArgument(failedHealth?.parameters[8])).toEqual({
      anomalyAssessment: "not_assessed",
      catalogMetadataOnly: true,
      failure: { class: "rate_limit", reason: "rate_limit" },
    });
    expect(failedHealth?.statement).toContain("state.last_succeeded_at");
    expect(failedHealth?.statement).toContain("1, null");
  });
});

describe("CMR Edge invocation contract", () => {
  it("automatically starts a bounded full reconciliation when its baseline is due", async () => {
    const adapter = new PostgresCmrAdapter(currentDatabase(
      () => undefined,
      {
        health_cursor: "42",
        watermark_to: "2026-07-30T12:20:00.000Z",
        baseline_checked_at: "2026-07-29T12:30:00.000Z",
        reconciliation_interval_hours: 24,
      },
    ));
    const resolution = await adapter.resolvePlan(
      "auto",
      "2026-07-30T12:34:56.000Z",
    );
    expect(resolution).toMatchObject({
      state: "execute",
      plan: {
        scanKind: "reconciliation",
        requestedFrom: "2026-07-29T00:30:00.000Z",
        requestedTo: "2026-07-30T12:30:00.000Z",
        watermarkFrom: null,
        updatedSince: null,
        watermarkTo: "2026-07-30T12:20:00.000Z",
        predecessorHealthCursor: null,
      },
    });
  });

  it("moves a killed deterministic slot onto a deterministic recovery job", async () => {
    const adapter = new PostgresCmrAdapter(currentDatabase(
      () => undefined,
      {
        health_cursor: "42",
        watermark_to: "2026-07-30T12:20:00.000Z",
        baseline_checked_at: "2026-07-29T13:00:00.000Z",
        reconciliation_interval_hours: 24,
      },
      "20",
    ));

    await adapter.assertRuntimeIdentity();
    expect(await adapter.reapExpiredExecution()).toBe(true);
    const resolution = await adapter.resolvePlan(
      "bootstrap",
      "2026-07-30T12:34:56.000Z",
    );
    expect(resolution).toMatchObject({
      state: "execute",
      plan: {
        harvestKey: "cmr-bootstrap-20260730T123000000Z-recovery-20",
        scanKind: "bootstrap",
      },
    });
  });

  it("is free-tier bounded and returns a safe current response", async () => {
    expect(CMR_EDGE_HARVEST_LIMITS.maxElapsedMs).toBeLessThanOrEqual(120_000);
    expect(CMR_EDGE_HARVEST_LIMITS.requestTimeoutMs).toBeLessThanOrEqual(15_000);
    let closed = false;
    const handler = createCmrEdgeHandler({
      clockMs: () => Date.parse("2026-07-30T12:34:56.000Z"),
      openDatabase: async () => currentDatabase(() => {
        closed = true;
      }),
      reportDiagnostic: () => {
        throw new Error("No diagnostic expected.");
      },
    });
    const response = await handler(new Request("https://example.test/collect-cmr", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
    }));
    const text = await response.text();
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(JSON.parse(text)).toEqual({
      status: "current",
      scan: {
        requestedTo: "2026-07-30T12:30:00.000Z",
        watermarkTo: "2026-07-30T12:20:00.000Z",
        coverage: "global-catalog-query",
        anomalyAssessment: "not-assessed",
      },
    });
    expect(text).not.toContain("42");
    expect(closed).toBe(true);
  });

  it("fails closed when the exact catalog context is disabled", async () => {
    let closed = false;
    const base = currentDatabase(() => {
      closed = true;
    });
    const disabled: CollectorDatabase = {
      ...base,
      async query<Row extends DatabaseRow = DatabaseRow>(
        statement: string,
        parameters: readonly unknown[] = [],
      ) {
        if (
          statement.includes("current_user as runtime_role") &&
          statement.includes("target_state.cursor_state")
        ) {
          return [] as readonly Row[];
        }
        return base.query<Row>(statement, parameters);
      },
    };
    const diagnostics: unknown[] = [];
    const handler = createCmrEdgeHandler({
      clockMs: () => Date.parse("2026-07-30T12:34:56.000Z"),
      openDatabase: async () => disabled,
      reportDiagnostic: (diagnostic) => diagnostics.push(diagnostic),
    });
    const response = await handler(new Request("https://example.test/collect-cmr", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
    }));

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({
      status: "error",
      error: "collector_unavailable",
    });
    expect(diagnostics).toEqual([{
      category: "database",
      stage: "resolve_plan",
    }]);
    expect(closed).toBe(true);
  });

  it("reports only a safe persistence stage and code", async () => {
    vi.stubGlobal("window", globalThis);
    const base = currentDatabase(() => undefined);
    const failing: CollectorDatabase = {
      ...base,
      async transaction<Result>(): Promise<Result> {
        throw new TypeError("postgresql://collector:must-not-be-logged@example.test");
      },
    };
    const diagnostics: unknown[] = [];
    const handler = createCmrEdgeHandler({
      clockMs: () => Date.parse("2026-07-30T12:34:56.000Z"),
      openDatabase: async () => failing,
      reportDiagnostic: (diagnostic) => diagnostics.push(diagnostic),
    });
    const response = await handler(new Request("https://example.test/collect-cmr", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: '{"mode":"bootstrap"}',
    }));

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({
      status: "error",
      error: "collector_unavailable",
    });
    expect(diagnostics).toEqual([{
      category: "database",
      stage: "reserve_harvest",
      code: "TYPE_ERROR",
    }]);
    expect(JSON.stringify(diagnostics)).not.toContain("must-not-be-logged");
  });

  it("rejects methods, query input, unknown JSON, media types, and oversized bodies", async () => {
    let opens = 0;
    const handler = createCmrEdgeHandler({
      openDatabase: async () => {
        opens += 1;
        return currentDatabase(() => undefined);
      },
      reportDiagnostic: () => undefined,
    });
    const cases = [
      new Request("https://example.test/collect-cmr", { method: "GET" }),
      new Request("https://example.test/collect-cmr?mode=auto", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{}",
      }),
      new Request("https://example.test/collect-cmr", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: '{"mode":"auto","extra":true}',
      }),
      new Request("https://example.test/collect-cmr", {
        method: "POST",
        headers: { "content-type": "text/plain" },
        body: "{}",
      }),
      new Request("https://example.test/collect-cmr", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: `{"mode":"${"x".repeat(257)}"}`,
      }),
    ];
    const statuses = [];
    for (const request of cases) {
      const response = await handler(request);
      statuses.push(response.status);
      expect(await response.json()).toMatchObject({ status: "error" });
    }
    expect(statuses).toEqual([405, 400, 400, 415, 413]);
    expect(opens).toBe(0);
  });

  it("does not echo database errors or secrets", async () => {
    const diagnostics: unknown[] = [];
    const handler = createCmrEdgeHandler({
      openDatabase: async () => {
        throw new Error("postgresql://collector:top-secret@pooler.invalid");
      },
      reportDiagnostic: (diagnostic) => diagnostics.push(diagnostic),
    });
    const response = await handler(new Request("https://example.test/collect-cmr", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
    }));
    const text = await response.text();
    expect(response.status).toBe(503);
    expect(text).toBe('{"status":"error","error":"collector_unavailable"}');
    expect(text).not.toContain("top-secret");
    expect(diagnostics).toEqual([{
      category: "runtime",
      stage: "open_database",
    }]);
  });
});

describe("CMR production wiring", () => {
  it("pins named-secret auth, serverless pooler options, and narrow SQL grants", async () => {
    const root = resolve(import.meta.dirname, "..");
    const [
      indexSource,
      runtimeSource,
      adapterSource,
      config,
      migration,
      denoConfig,
      packageJson,
    ] =
      await Promise.all([
        readFile(resolve(root, "supabase/functions/collect-cmr/index.ts"), "utf8"),
        readFile(resolve(root, "supabase/functions/collect-cmr/runtime.ts"), "utf8"),
        readFile(
          resolve(root, "supabase/functions/collect-cmr/postgres-adapter.ts"),
          "utf8",
        ),
        readFile(resolve(root, "supabase/config.toml"), "utf8"),
        readFile(
          resolve(root, "supabase/migrations/20260730221525_cmr_collector_runtime_rpcs.sql"),
          "utf8",
        ),
        readFile(resolve(root, "supabase/functions/collect-cmr/deno.json"), "utf8"),
        readFile(resolve(root, "package.json"), "utf8"),
      ]);

    expect(indexSource).toContain('auth: "secret:cmr_cron"');
    expect(indexSource).toMatch(/max:\s*1/u);
    expect(indexSource).toMatch(/prepare:\s*false/u);
    expect(indexSource).not.toContain("service_role");
    expect(config).toMatch(
      /\[functions\.collect-cmr\]\s+verify_jwt\s*=\s*false/u,
    );
    expect(migration).toContain("claim_cmr_collection_job_exact");
    expect(migration).toContain("reap_expired_cmr_collection_job");
    expect(migration).toContain("collector_lease_expired");
    expect(migration).toContain("job.max_attempts = 1");
    expect(migration).toContain("job.attempt_count = 0");
    expect(migration).toMatch(
      /revoke execute[\s\S]+from public, anon, authenticated, service_role/u,
    );
    expect(migration).toMatch(
      /grant execute[\s\S]+to firewatch_collector/u,
    );
    expect(runtimeSource).toContain("await adapter.reapExpiredExecution()");
    expect(adapterSource).toContain(
      "and adapter.schema_version = 'cmr-umm-g-1.6.7-pass-v1'",
    );
    expect(adapterSource).toContain(
      '"reconciliationIntervalHours":24',
    );
    expect(adapterSource).not.toContain("revision.request_params = $7::jsonb");
    expect(adapterSource).toContain(
      "and revision.geometry_precision_source = 'not_applicable'",
    );
    expect(adapterSource.match(/to_jsonb\(array\(/gu)).toHaveLength(6);
    expect(JSON.parse(denoConfig).imports).toEqual({
      "@supabase/server": "npm:@supabase/server@1.4.1",
      "polygon-clipping": "npm:polygon-clipping@0.15.7",
      postgres: "npm:postgres@3.4.9",
      zod: "npm:zod@4.4.3",
    });
    expect(JSON.parse(packageJson).devDependencies).toMatchObject({
      "@supabase/server": "1.4.1",
      postgres: "3.4.9",
    });
  });
});
