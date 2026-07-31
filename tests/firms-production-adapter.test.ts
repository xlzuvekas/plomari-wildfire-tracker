import { describe, expect, it } from "vitest";
import type {
  CollectorDatabase,
  DatabaseRow,
  DatabaseSession,
} from "../supabase/functions/collect-firms/database";
import { PostgresFirmsAdapter } from "../supabase/functions/collect-firms/postgres-adapter";
import { contentSha256 } from "../lib/evidence/recorded-fetch";
import { firmsShadowPlan } from "../lib/satellite/firms-collector.server";

function identity() {
  return {
    runtime_role: "firewatch_firms_collector_runtime",
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

describe("FIRMS Postgres adapter evidence boundary", () => {
  it("returns an exact durable occurrence and binds a failed product result", async () => {
    const statements: Array<Readonly<{
      statement: string;
      parameters: readonly unknown[];
    }>> = [];
    const body = new TextEncoder().encode("bad");
    const digest = await contentSha256(body);
    const query = async <Row extends DatabaseRow = DatabaseRow>(
      statement: string,
      parameters: readonly unknown[] = [],
    ) => {
      const placeholders = [...statement.matchAll(/\$(\d+)/gu)]
        .map((match) => Number(match[1]));
      expect(parameters).toHaveLength(Math.max(0, ...placeholders));
      statements.push({ statement, parameters });
      if (statement.includes("target_state.cursor_state")) {
        return [{
          ...identity(),
          source_id: "1",
          endpoint_id: "2",
          target_id: "3",
          target_revision_id: "4",
          adapter_release_id: "5",
          adapter_version: "firms-shadow-runtime@1.0.0",
          cursor_state: {},
        }] as unknown as readonly Row[];
      }
      if (statement.includes("insert into ingest.jobs")) {
        return [] as readonly Row[];
      }
      if (statement.includes("select id, status, attempt_count")) {
        return [{
          id: "10",
          status: "pending",
          attempt_count: 0,
          lease_token: null,
          lease_owner: null,
        }] as unknown as readonly Row[];
      }
      if (statement.includes("claim_firms_collection_job_exact")) {
        return [{
          lease_token: "018f0000-0000-7000-8000-000000009901",
          lease_owner: parameters[1],
          attempt_count: 1,
        }] as unknown as readonly Row[];
      }
      if (statement.includes("insert into ingest.runs")) {
        return [{ id: "20", public_id: parameters[0] }] as unknown as readonly Row[];
      }
      if (statement.includes("insert into ingest.http_exchanges")) {
        return [{ id: "21", run_id: "20" }] as unknown as readonly Row[];
      }
      if (statement.includes("insert into ingest.content_blobs")) {
        return [] as readonly Row[];
      }
      if (statement.includes("select id, byte_size from ingest.content_blobs")) {
        return [{ id: "30", byte_size: "3" }] as unknown as readonly Row[];
      }
      if (statement.includes("insert into ingest.raw_objects")) {
        return [{
          id: "31",
          retrieved_at: "2026-07-31T12:00:01.000Z",
        }] as unknown as readonly Row[];
      }
      if (statement.includes("ingest.finish_http_exchange")) {
        return [{ finished: true }] as unknown as readonly Row[];
      }
      if (statement.includes("product.id as product_id")) {
        return [{
          product_id: "40",
          parser_contract: "firms-area-csv-modis-v1",
          exchange_outcome: "response",
          http_status: 503,
          completed_at: "2026-07-31T12:00:02.000Z",
          request_fingerprint_sha256: "a".repeat(64),
          issued_at: "2026-07-31T12:00:00.000Z",
          response_raw_object_id: "31",
          response_content_sha256: digest,
          response_retrieved_at: "2026-07-31T12:00:01.000Z",
        }] as unknown as readonly Row[];
      }
      if (statement.includes("insert into ingest.firms_query_product_results")) {
        return [{ id: "50" }] as unknown as readonly Row[];
      }
      throw new Error(`Unexpected fake-database statement: ${statement}`);
    };
    const database: CollectorDatabase = {
      query,
      async transaction<Result>(
        operation: (session: DatabaseSession) => Promise<Result>,
      ) {
        return operation(this);
      },
      async close() {},
    };
    const plan = firmsShadowPlan({
      scheduledFor: "2026-07-31T12:00:00.000Z",
      area: { west: 26.9, south: 38.9, east: 27.1, north: 39.1 },
      dateFrom: "2026-07-31",
      dayCount: 1,
    });
    const adapter = new PostgresFirmsAdapter(
      database,
      () => Date.parse("2026-07-31T12:00:00.000Z"),
    );
    const reservation = await adapter.reserveCollection(plan);
    expect(reservation).toMatchObject({ state: "execute" });
    if (reservation.state !== "execute") throw new Error("Expected execution.");
    const reference = await adapter.issue({
      method: "GET",
      requestUrlSafe: "https://firms.modaps.eosdis.nasa.gov/api/area/csv",
      requestQuerySafe: {
        area: plan.areaToken,
        date: "2026-07-31/1",
        product: "MODIS_NRT",
      },
      requestBodyRedacted: null,
      requestHeadersSafe: { accept: "text/csv" },
      requestMetadataSafe: {
        issued_at: "2026-07-31T12:00:00.000Z",
        operation: "firms-area-csv",
        product: "MODIS_NRT",
        scope: "geographic-area",
      },
    });
    const occurrence = await adapter.finishResponse(reference, {
      status: 503,
      body,
      safeHeaders: { "content-type": "text/csv" },
      safeMetadata: { partial: false, terminal: true, truncated: false },
    });
    expect(occurrence).toEqual({
      rawObjectId: "31",
      httpExchangeId: "21",
      runId: "20",
      contentSha256: digest,
      retrievedAt: "2026-07-31T12:00:01.000Z",
    });
    const failed = await adapter.persistProductFailure({
      collectionId: reservation.collectionId,
      plan,
      product: "MODIS_NRT",
      code: "upstream",
    });
    expect(failed).toMatchObject({ product: "MODIS_NRT", outcome: "failed" });
    expect(JSON.stringify(statements)).not.toContain("example-map-key");
    const resultInsert = statements.find((entry) =>
      entry.statement.includes("insert into ingest.firms_query_product_results")
    );
    expect(resultInsert?.parameters).toContain("31");
    expect(resultInsert?.parameters).toContain(digest);
  });
});
