import {
  CmrHarvestError,
  CmrHarvestPersistenceError,
  harvestCmrFireMaskCatalog,
  type CmrHarvestSummary,
} from "../../../lib/satellite/cmr-collector.server.ts";
import type { CollectorDatabase } from "./database.ts";
import {
  CmrCollectorDatabaseError,
  PostgresCmrAdapter,
  type CmrInvocationMode,
} from "./postgres-adapter.ts";

const MAX_REQUEST_BODY_BYTES = 256;

// Keep the network/parse/persistence loop well inside the Supabase Free Edge
// 150-second wall-time ceiling and the 150-second database lease. The final
// failure/completion transaction retains roughly thirty seconds of headroom.
export const CMR_EDGE_HARVEST_LIMITS = Object.freeze({
  maxPagesPerProduct: 20,
  maxPageResponseBytes: 4_000_000,
  maxTotalResponseBytes: 48_000_000,
  requestTimeoutMs: 15_000,
  maxElapsedMs: 120_000,
});

type Diagnostic = Readonly<{
  category: "busy" | "collector" | "database" | "runtime";
  code?: string;
  stage?: string;
}>;

type RuntimeStage =
  | "open_database"
  | "assert_runtime_identity"
  | "reap_expired_execution"
  | "resolve_plan"
  | "harvest";

const CMR_PERSISTENCE_STAGES = new Set([
  "reserve_harvest",
  "heartbeat_harvest",
  "persist_page",
  "complete_harvest",
  "fail_harvest",
]);
const EVIDENCE_PERSISTENCE_STAGES = new Set([
  "issue",
  "capture_response",
  "finish_response",
  "finish_transport_error",
]);

export type CmrEdgeRuntimeDependencies = Readonly<{
  openDatabase: () => Promise<CollectorDatabase>;
  fetchImpl?: typeof fetch;
  clockMs?: () => number;
  reportDiagnostic?: (diagnostic: Diagnostic) => void;
}>;

class InvalidInvocationError extends Error {
  constructor(
    readonly status: 400 | 413 | 415,
    message: string,
  ) {
    super(message);
    this.name = "InvalidInvocationError";
  }
}

function jsonResponse(
  body: Readonly<Record<string, unknown>>,
  status = 200,
  headers?: HeadersInit,
) {
  return Response.json(body, {
    status,
    headers: {
      "cache-control": "no-store",
      "content-type": "application/json; charset=utf-8",
      "x-content-type-options": "nosniff",
      ...headers,
    },
  });
}

async function boundedBody(request: Request) {
  const declaredLength = request.headers.get("content-length");
  if (declaredLength !== null) {
    if (!/^(0|[1-9][0-9]*)$/u.test(declaredLength)) {
      throw new InvalidInvocationError(400, "Invalid Content-Length header.");
    }
    if (Number(declaredLength) > MAX_REQUEST_BODY_BYTES) {
      throw new InvalidInvocationError(413, "Request body is too large.");
    }
  }

  if (request.body === null) return new Uint8Array();
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_REQUEST_BODY_BYTES) {
        await reader.cancel();
        throw new InvalidInvocationError(413, "Request body is too large.");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const body = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return body;
}

async function invocationMode(request: Request): Promise<CmrInvocationMode> {
  const url = new URL(request.url);
  if (url.search !== "") {
    throw new InvalidInvocationError(400, "Query parameters are not accepted.");
  }
  const mediaType = request.headers.get("content-type")
    ?.split(";", 1)[0]
    ?.trim()
    .toLowerCase();
  if (mediaType !== "application/json") {
    throw new InvalidInvocationError(415, "Content-Type must be application/json.");
  }
  const bytes = await boundedBody(request);
  let value: unknown;
  try {
    const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    value = text === "" ? {} : JSON.parse(text);
  } catch {
    throw new InvalidInvocationError(400, "Request body must be valid JSON.");
  }
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new InvalidInvocationError(400, "Request body must be a JSON object.");
  }
  const entries = Object.entries(value as Record<string, unknown>);
  if (entries.some(([key]) => key !== "mode") || entries.length > 1) {
    throw new InvalidInvocationError(400, "Request body contains an unknown field.");
  }
  const mode = (value as { mode?: unknown }).mode ?? "auto";
  if (
    mode !== "auto" &&
    mode !== "bootstrap" &&
    mode !== "reconciliation"
  ) {
    throw new InvalidInvocationError(400, "Request mode is invalid.");
  }
  return mode;
}

function publicSummary(summary: CmrHarvestSummary) {
  return Object.freeze({
    status: "complete",
    scan: Object.freeze({
      kind: summary.plan.scanKind,
      requestedFrom: summary.plan.requestedFrom,
      requestedTo: summary.plan.requestedTo,
      watermarkTo: summary.plan.watermarkTo,
      coverage: summary.coverage,
      anomalyAssessment: summary.anomalyAssessment,
    }),
    counts: Object.freeze({
      requests: summary.requestCount,
      pages: summary.pageCount,
      upstreamHits: summary.upstreamHitCount,
      fetched: summary.fetchedCount,
      accepted: summary.acceptedCount,
      duplicates: summary.duplicateCount,
      rejected: summary.rejectedCount,
    }),
    products: summary.products.map((product) =>
      Object.freeze({
        product: product.product,
        satellite: product.satellite,
        pages: product.pages,
        upstreamHits: product.upstreamHits,
        fetched: product.fetchedCount,
        accepted: product.acceptedCount,
        duplicates: product.duplicateCount,
        latestObservedAt: product.latestObservedAt,
        latestCatalogedAt: product.latestCatalogedAt,
      })
    ),
  });
}

function errorChain(error: unknown) {
  const chain: unknown[] = [];
  let current = error;
  for (let depth = 0; depth < 4; depth += 1) {
    if (current === null || typeof current !== "object") break;
    chain.push(current);
    current = (current as { cause?: unknown }).cause;
  }
  return chain;
}

function fixedStage(
  error: unknown,
  errorName: string,
  allowed: ReadonlySet<string>,
) {
  for (const current of errorChain(error)) {
    const candidate = current as { name?: unknown; stage?: unknown };
    if (
      candidate.name === errorName &&
      typeof candidate.stage === "string" &&
      allowed.has(candidate.stage)
    ) {
      return candidate.stage;
    }
  }
  return null;
}

function safeFailureCode(error: unknown) {
  for (const current of errorChain(error)) {
    const candidate = current as { code?: unknown; name?: unknown };
    if (
      typeof candidate.code === "string" &&
      /^(?:[0-9A-Z]{5}|[A-Z][A-Z0-9_]{1,31})$/u.test(candidate.code)
    ) {
      return candidate.code;
    }
    if (candidate.name === "TypeError") return "TYPE_ERROR";
  }
  return undefined;
}

function databaseDiagnostic(
  error: unknown,
  stage?: string,
): Diagnostic {
  const code = safeFailureCode(error);
  return Object.freeze({
    category: "database" as const,
    ...(stage === undefined ? {} : { stage }),
    ...(code === undefined ? {} : { code }),
  });
}

function diagnosticFor(error: unknown): Diagnostic {
  if (error instanceof CmrHarvestError) {
    return Object.freeze({
      category: error.code === "busy" ? "busy" : "collector",
      code: error.code,
    });
  }
  const cmrPersistenceStage = error instanceof CmrHarvestPersistenceError
    ? error.stage
    : fixedStage(error, "CmrHarvestPersistenceError", CMR_PERSISTENCE_STAGES);
  if (cmrPersistenceStage !== null) {
    return databaseDiagnostic(error, cmrPersistenceStage);
  }
  const evidencePersistenceStage = fixedStage(
    error,
    "EvidencePersistenceError",
    EVIDENCE_PERSISTENCE_STAGES,
  );
  if (evidencePersistenceStage !== null) {
    return databaseDiagnostic(error, `evidence_${evidencePersistenceStage}`);
  }
  if (error instanceof CmrCollectorDatabaseError) {
    return databaseDiagnostic(error);
  }
  return Object.freeze({ category: "runtime" });
}

export function createCmrEdgeHandler(dependencies: CmrEdgeRuntimeDependencies) {
  const fetchImpl = dependencies.fetchImpl ?? fetch;
  const clockMs = dependencies.clockMs ?? Date.now;
  const reportDiagnostic = dependencies.reportDiagnostic ?? ((diagnostic) => {
    // The structured diagnostic deliberately excludes Error.message/cause,
    // request headers, bodies, URLs, environment values, and database DSNs.
    console.error("collect-cmr", diagnostic);
  });

  return async (request: Request): Promise<Response> => {
    if (request.method !== "POST") {
      return jsonResponse(
        { status: "error", error: "method_not_allowed" },
        405,
        { allow: "POST" },
      );
    }

    let mode: CmrInvocationMode;
    try {
      mode = await invocationMode(request);
    } catch (error) {
      if (error instanceof InvalidInvocationError) {
        return jsonResponse(
          { status: "error", error: "invalid_request" },
          error.status,
        );
      }
      reportDiagnostic(diagnosticFor(error));
      return jsonResponse(
        { status: "error", error: "collector_unavailable" },
        503,
      );
    }

    let database: CollectorDatabase | null = null;
    let runtimeStage: RuntimeStage = "open_database";
    try {
      const now = clockMs();
      if (!Number.isFinite(now)) throw new Error("Invalid collector clock.");
      const scheduledFor = new Date(now).toISOString();
      database = await dependencies.openDatabase();
      const adapter = new PostgresCmrAdapter(database, clockMs);
      runtimeStage = "assert_runtime_identity";
      await adapter.assertRuntimeIdentity();
      runtimeStage = "reap_expired_execution";
      await adapter.reapExpiredExecution();
      runtimeStage = "resolve_plan";
      const resolution = await adapter.resolvePlan(mode, scheduledFor);
      if (resolution.state === "current") {
        return jsonResponse({
          status: "current",
          scan: {
            requestedTo: resolution.requestedTo,
            watermarkTo: resolution.watermarkTo,
            coverage: "global-catalog-query",
            anomalyAssessment: "not-assessed",
          },
        });
      }

      runtimeStage = "harvest";
      const summary = await harvestCmrFireMaskCatalog({
        plan: resolution.plan,
        fetchImpl,
        ledger: adapter,
        persistence: adapter,
        limits: CMR_EDGE_HARVEST_LIMITS,
        signal: request.signal,
        clockMs,
      });
      return jsonResponse(publicSummary(summary));
    } catch (error) {
      const diagnostic = diagnosticFor(error);
      reportDiagnostic(diagnostic.stage === undefined
        ? Object.freeze({ ...diagnostic, stage: runtimeStage })
        : diagnostic);
      if (diagnostic.category === "busy") {
        return jsonResponse(
          { status: "busy", retryAfterSeconds: 30 },
          409,
          { "retry-after": "30" },
        );
      }
      return jsonResponse(
        { status: "error", error: "collector_unavailable" },
        503,
      );
    } finally {
      if (database !== null) {
        try {
          await database.close();
        } catch {
          reportDiagnostic(Object.freeze({ category: "database", stage: "close" }));
        }
      }
    }
  };
}
