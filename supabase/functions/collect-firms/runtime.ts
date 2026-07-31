import {
  collectFirmsShadow,
  FirmsShadowCollectionError,
  FirmsShadowPersistenceError,
  firmsShadowPlan,
  type FirmsShadowSummary,
} from "../../../lib/satellite/firms-collector.server.ts";
import type { CollectorDatabase } from "./database.ts";
import {
  FirmsCollectorDatabaseError,
  PostgresFirmsAdapter,
} from "./postgres-adapter.ts";

const MAX_REQUEST_BODY_BYTES = 512;

type Diagnostic = Readonly<{
  category: "busy" | "collector" | "database" | "runtime";
  code?: string;
  stage?: string;
}>;

type RuntimeStage =
  | "open_database"
  | "assert_runtime_identity"
  | "reap_expired_execution"
  | "build_plan"
  | "collect";

export type FirmsEdgeRuntimeDependencies = Readonly<{
  openDatabase: () => Promise<CollectorDatabase>;
  mapKey: () => string | undefined;
  fetchImpl?: typeof fetch;
  clockMs?: () => number;
  reportDiagnostic?: (diagnostic: Diagnostic) => void;
}>;

class InvalidInvocationError extends Error {
  constructor(readonly status: 400 | 413 | 415, message: string) {
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

type Invocation = Readonly<{
  area: Readonly<{ west: number; south: number; east: number; north: number }>;
  dateFrom: string;
  dayCount: 1 | 2 | 3 | 4 | 5;
}>;

async function invocation(request: Request): Promise<Invocation> {
  const url = new URL(request.url);
  if (url.search !== "") {
    throw new InvalidInvocationError(400, "Query parameters are not accepted.");
  }
  const mediaType = request.headers.get("content-type")
    ?.split(";", 1)[0]?.trim().toLowerCase();
  if (mediaType !== "application/json") {
    throw new InvalidInvocationError(415, "Content-Type must be application/json.");
  }
  const bytes = await boundedBody(request);
  let value: unknown;
  try {
    value = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch {
    throw new InvalidInvocationError(400, "Request body must be valid JSON.");
  }
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new InvalidInvocationError(400, "Request body must be a JSON object.");
  }
  const object = value as Record<string, unknown>;
  if (Object.keys(object).sort().join(",") !== "area,dateFrom,dayCount") {
    throw new InvalidInvocationError(400, "Request body fields are invalid.");
  }
  if (object.area === null || typeof object.area !== "object" || Array.isArray(object.area)) {
    throw new InvalidInvocationError(400, "Request area is invalid.");
  }
  const area = object.area as Record<string, unknown>;
  if (Object.keys(area).sort().join(",") !== "east,north,south,west") {
    throw new InvalidInvocationError(400, "Request area fields are invalid.");
  }
  if (
    typeof area.west !== "number" || typeof area.south !== "number" ||
    typeof area.east !== "number" || typeof area.north !== "number" ||
    typeof object.dateFrom !== "string" ||
    typeof object.dayCount !== "number" ||
    !Number.isInteger(object.dayCount) || object.dayCount < 1 || object.dayCount > 5
  ) {
    throw new InvalidInvocationError(400, "Request values are invalid.");
  }
  return Object.freeze({
    area: Object.freeze({
      west: area.west,
      south: area.south,
      east: area.east,
      north: area.north,
    }),
    dateFrom: object.dateFrom,
    dayCount: object.dayCount as Invocation["dayCount"],
  });
}

function publicSummary(summary: FirmsShadowSummary) {
  return Object.freeze({
    status: "complete",
    request: Object.freeze({
      area: summary.plan.area,
      coverage: summary.coverage,
      dateFrom: summary.plan.dateFrom,
      dateTo: summary.plan.dateTo,
      dateRequestMode: "explicit-starting-on",
      negativeAssessmentEligible: false,
      sensorAssessability: "unknown",
    }),
    counts: Object.freeze({
      accepted: summary.acceptedCount,
      duplicates: summary.duplicateCount,
      newDetails: summary.newDetailCount,
      rejected: summary.rejectedCount,
      requests: summary.requestCount,
      returned: summary.returnedCount,
    }),
    products: summary.products.map((product) => Object.freeze({
      accepted: product.acceptedCount,
      duplicates: product.duplicateCount,
      latestObservedAt: product.latestObservedAt,
      newDetails: product.newDetailCount,
      product: product.product,
      returned: product.returnedCount,
    })),
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

function safeFailureCode(error: unknown) {
  for (const current of errorChain(error)) {
    const candidate = current as { code?: unknown; name?: unknown };
    if (
      typeof candidate.code === "string" &&
      /^(?:[0-9A-Z]{5}|[a-z][a-z0-9_]{1,31})$/u.test(candidate.code)
    ) return candidate.code;
    if (candidate.name === "TypeError") return "TYPE_ERROR";
  }
  return undefined;
}

function diagnosticFor(error: unknown): Diagnostic {
  if (error instanceof FirmsShadowCollectionError) {
    return Object.freeze({
      category: error.code === "busy" ? "busy" : "collector",
      code: error.code,
    });
  }
  if (error instanceof FirmsShadowPersistenceError) {
    return Object.freeze({
      category: "database",
      stage: error.stage,
      ...(safeFailureCode(error) === undefined
        ? {}
        : { code: safeFailureCode(error) }),
    });
  }
  if (error instanceof FirmsCollectorDatabaseError) {
    const code = safeFailureCode(error);
    return Object.freeze({
      category: "database",
      ...(code === undefined ? {} : { code }),
    });
  }
  return Object.freeze({ category: "runtime" });
}

export function createFirmsEdgeHandler(dependencies: FirmsEdgeRuntimeDependencies) {
  const fetchImpl = dependencies.fetchImpl ?? fetch;
  const clockMs = dependencies.clockMs ?? Date.now;
  const reportDiagnostic = dependencies.reportDiagnostic ?? ((diagnostic) => {
    // Never log Error.message/cause, request URLs/bodies, secrets, or DSNs.
    console.error("collect-firms", diagnostic);
  });
  return async (request: Request): Promise<Response> => {
    if (request.method !== "POST") {
      return jsonResponse(
        { status: "error", error: "method_not_allowed" },
        405,
        { allow: "POST" },
      );
    }
    let requested: Invocation;
    try {
      requested = await invocation(request);
    } catch (error) {
      if (error instanceof InvalidInvocationError) {
        return jsonResponse({ status: "error", error: "invalid_request" }, error.status);
      }
      reportDiagnostic(diagnosticFor(error));
      return jsonResponse({ status: "error", error: "collector_unavailable" }, 503);
    }
    let database: CollectorDatabase | null = null;
    let stage: RuntimeStage = "open_database";
    try {
      const now = clockMs();
      if (!Number.isFinite(now)) throw new Error("Invalid collector clock.");
      database = await dependencies.openDatabase();
      const adapter = new PostgresFirmsAdapter(database, clockMs);
      stage = "assert_runtime_identity";
      await adapter.assertRuntimeIdentity();
      stage = "reap_expired_execution";
      await adapter.reapExpiredExecution();
      stage = "build_plan";
      const plan = firmsShadowPlan({
        scheduledFor: new Date(now).toISOString(),
        area: requested.area,
        dateFrom: requested.dateFrom,
        dayCount: requested.dayCount,
      });
      stage = "collect";
      const summary = await collectFirmsShadow({
        mapKey: dependencies.mapKey() ?? "",
        plan,
        persistence: adapter,
        fetchImpl,
        signal: request.signal,
        clockMs,
      });
      return jsonResponse(publicSummary(summary));
    } catch (error) {
      const diagnostic = diagnosticFor(error);
      reportDiagnostic(diagnostic.stage === undefined
        ? Object.freeze({ ...diagnostic, stage })
        : diagnostic);
      if (diagnostic.category === "busy") {
        return jsonResponse(
          { status: "busy", retryAfterSeconds: 30 },
          409,
          { "retry-after": "30" },
        );
      }
      return jsonResponse({ status: "error", error: "collector_unavailable" }, 503);
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
