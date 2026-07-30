import {
  EvidencePersistenceError,
  recordedFetch,
  type HttpEvidenceLedger,
  type HttpExchangeReference,
  type HttpRequestEvidence,
  type SafeQuery,
} from "../evidence/recorded-fetch.ts";
import {
  CMR_FIREMASK_PRODUCTS,
  CMR_MAX_RESPONSE_BYTES,
  CMR_PAGE_SIZE,
  cmrGranulesUrl,
  cmrRequestHeaders,
  parseCmrProductPasses,
  type CmrProduct,
  type CmrProductResult,
  type CmrScanKind,
} from "./cmr.ts";

export const CMR_INCREMENTAL_CADENCE_MS = 5 * 60_000;
export const CMR_INCREMENTAL_OVERLAP_MS = 10 * 60_000;
export const CMR_ACTIVE_OBSERVATION_WINDOW_MS = 36 * 60 * 60_000;

const CMR_RESPONSE_HEADERS = Object.freeze([
  "cmr-hits",
  "cmr-request-id",
  "cmr-search-after",
  "cmr-time-out",
  "cmr-timed-out",
  "cmr-took",
  "content-encoding",
  "content-length",
  "content-type",
  "date",
  "retry-after",
  "x-request-id",
]);

export type CmrHarvestPlan = Readonly<{
  harvestKey: string;
  scanKind: CmrScanKind;
  requestedFrom: string;
  requestedTo: string;
  updatedSince: string | null;
  watermarkFrom: string | null;
  watermarkTo: string;
  predecessorHealthCursor: string | null;
}>;

export type CmrResponseMetadata = Readonly<{
  hits: number;
  searchAfter: string | null;
  timedOut: boolean;
  tookMs: number | null;
  cmrRequestId: string | null;
  xRequestId: string | null;
}>;

export type CmrPersistedPage = Readonly<{
  harvestId: string;
  plan: CmrHarvestPlan;
  product: CmrProduct;
  page: number;
  requestId: string;
  searchAfterBefore: string | null;
  exchange: HttpExchangeReference;
  responseBytes: number;
  response: CmrResponseMetadata;
  parsed: CmrProductResult;
}>;

export type CmrPersistedPageResult = Readonly<{
  acceptedCount: number;
  duplicateCount: number;
  rejectedCount: number;
}>;

export type CmrProductHarvestSummary = Readonly<{
  product: CmrProduct["shortName"];
  satellite: CmrProduct["satellite"];
  pages: number;
  upstreamHits: number;
  fetchedCount: number;
  acceptedCount: number;
  duplicateCount: number;
  latestObservedAt: string | null;
  latestCatalogedAt: string | null;
}>;

export type CmrHarvestSummary = Readonly<{
  status: "complete";
  harvestId: string;
  plan: CmrHarvestPlan;
  requestCount: number;
  responseBytes: number;
  pageCount: number;
  upstreamHitCount: number;
  fetchedCount: number;
  acceptedCount: number;
  duplicateCount: number;
  rejectedCount: 0;
  products: readonly CmrProductHarvestSummary[];
  coverage: "global-catalog-query";
  anomalyAssessment: "not-assessed";
}>;

export type CmrHarvestReservation =
  | Readonly<{ state: "execute"; harvestId: string }>
  | Readonly<{ state: "already-complete"; summary: CmrHarvestSummary }>
  | Readonly<{ state: "busy" }>;

export type CmrHarvestFailureCode =
  | "deadline"
  | "page_limit"
  | "byte_limit"
  | "timeout"
  | "network"
  | "redirect"
  | "rate_limit"
  | "upstream"
  | "provider_timeout"
  | "invalid_headers"
  | "invalid_response"
  | "pagination_drift"
  | "database";

/**
 * Production implementations are a narrow, server-only database/RPC adapter.
 * Every method MUST commit before resolving and run as `firewatch_collector`,
 * never `service_role` or a browser credential.
 *
 * Required database behavior:
 * - `reserveHarvest` atomically claims one lease-fenced job/run for the exact
 *   harvest key, mode, request window, watermarks, and predecessor. A completed
 *   key returns its stored summary; an active duplicate returns `busy`.
 * - `heartbeatHarvest` renews the same job lease and returns only after the
 *   renewal commits. A lost lease stops issuance before the next request.
 * - `persistPage` verifies `exchange` is a terminal response in that same run,
 *   resolves its immutable raw object, and transactionally inserts idempotent
 *   source revisions/global observations keyed by CMR concept + revision. It
 *   stores the source-declared Polygon/MultiPolygon and typed CMR detail row;
 *   CMR supplies no metric geometry accuracy, so persistence records a null
 *   precision with `not_applicable`. Rejected
 *   items are durably quarantined with their reason and exchange; they are not
 *   observations. The returned counts must account for every parsed item.
 * - `completeHarvest` atomically finalizes the run, publishes healthy source
 *   state, and inserts a scan-completion lineage row only after all three
 *   products have fully exhausted Search-After with zero rejected items. An
 *   incremental completion must validate predecessor/overlap continuity; a
 *   delta or catalog footprint never asserts a FireMask anomaly is absent.
 * - `failHarvest` terminalizes the run/job without a completion row or healthy
 *   projection. It is idempotent and lease fenced.
 */
export interface CmrHarvestPersistence {
  reserveHarvest(plan: CmrHarvestPlan): Promise<CmrHarvestReservation>;
  heartbeatHarvest(input: Readonly<{
    harvestId: string;
    plan: CmrHarvestPlan;
  }>): Promise<void>;
  persistPage(page: CmrPersistedPage): Promise<CmrPersistedPageResult>;
  completeHarvest(summary: CmrHarvestSummary): Promise<void>;
  failHarvest(input: Readonly<{
    harvestId: string;
    plan: CmrHarvestPlan;
    code: CmrHarvestFailureCode;
    detailSafe: string;
  }>): Promise<void>;
}

export type CmrHarvestLimits = Readonly<{
  maxPagesPerProduct: number;
  maxPageResponseBytes: number;
  maxTotalResponseBytes: number;
  requestTimeoutMs: number;
  maxElapsedMs: number;
}>;

export const DEFAULT_CMR_HARVEST_LIMITS: CmrHarvestLimits = Object.freeze({
  maxPagesPerProduct: 20,
  maxPageResponseBytes: 4_000_000,
  maxTotalResponseBytes: 48_000_000,
  requestTimeoutMs: 20_000,
  maxElapsedMs: 4 * 60_000,
});

export type CmrHarvestInput = Readonly<{
  plan: CmrHarvestPlan;
  fetchImpl: typeof fetch;
  ledger: HttpEvidenceLedger;
  persistence: CmrHarvestPersistence;
  limits?: Partial<CmrHarvestLimits>;
  signal?: AbortSignal;
  clockMs?: () => number;
}>;

export class CmrHarvestError extends Error {
  constructor(
    readonly code: CmrHarvestFailureCode | "busy",
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "CmrHarvestError";
  }
}

export class CmrHarvestPersistenceError extends Error {
  constructor(
    readonly stage:
      | "reserve_harvest"
      | "heartbeat_harvest"
      | "persist_page"
      | "complete_harvest"
      | "fail_harvest",
    options?: ErrorOptions,
  ) {
    super("CMR data was withheld because its harvest state was not durable.", options);
    this.name = "CmrHarvestPersistenceError";
  }
}

function assertServerRuntime() {
  if (typeof window !== "undefined") {
    throw new Error("The NASA CMR collector is server-only.");
  }
}

function canonicalTimestamp(value: string, field: string) {
  const epochMs = Date.parse(value);
  if (!Number.isFinite(epochMs) || new Date(epochMs).toISOString() !== value) {
    throw new TypeError(`${field} must be a canonical UTC timestamp.`);
  }
  return epochMs;
}

function validatePlan(plan: CmrHarvestPlan) {
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,179}$/u.test(plan.harvestKey)) {
    throw new TypeError("CMR harvestKey must be a bounded, credential-free key.");
  }
  const requestedFrom = canonicalTimestamp(plan.requestedFrom, "requestedFrom");
  const requestedTo = canonicalTimestamp(plan.requestedTo, "requestedTo");
  const watermarkFrom =
    plan.watermarkFrom === null
      ? null
      : canonicalTimestamp(plan.watermarkFrom, "watermarkFrom");
  const watermarkTo = canonicalTimestamp(plan.watermarkTo, "watermarkTo");
  if (
    requestedFrom > requestedTo ||
    watermarkTo < requestedFrom ||
    watermarkTo > requestedTo ||
    (watermarkFrom !== null && watermarkFrom > watermarkTo)
  ) {
    throw new TypeError("CMR harvest windows must be ordered.");
  }
  if (plan.scanKind === "incremental") {
    if (plan.updatedSince === null || watermarkFrom === null) {
      throw new TypeError(
        "Incremental CMR harvests require update and predecessor watermarks.",
      );
    }
    const updatedSince = canonicalTimestamp(plan.updatedSince, "updatedSince");
    if (updatedSince !== watermarkFrom) {
      throw new TypeError(
        "Incremental CMR updatedSince must equal its predecessor watermark.",
      );
    }
    if (!/^\d+$/u.test(plan.predecessorHealthCursor ?? "")) {
      throw new TypeError("Incremental CMR harvests require a predecessor cursor.");
    }
  } else if (
    plan.predecessorHealthCursor !== null ||
    plan.updatedSince !== null ||
    plan.watermarkFrom !== null
  ) {
    throw new TypeError(
      "Full CMR harvests cannot claim an incremental predecessor or watermark.",
    );
  }
}

function boundedInteger(
  value: number,
  name: string,
  maximum: number,
) {
  if (!Number.isSafeInteger(value) || value < 1 || value > maximum) {
    throw new TypeError(`${name} is outside the collector safety bound.`);
  }
  return value;
}

function normalizedLimits(overrides: Partial<CmrHarvestLimits> | undefined) {
  const limits = { ...DEFAULT_CMR_HARVEST_LIMITS, ...overrides };
  return Object.freeze({
    maxPagesPerProduct: boundedInteger(
      limits.maxPagesPerProduct,
      "maxPagesPerProduct",
      20,
    ),
    maxPageResponseBytes: boundedInteger(
      limits.maxPageResponseBytes,
      "maxPageResponseBytes",
      CMR_MAX_RESPONSE_BYTES,
    ),
    maxTotalResponseBytes: boundedInteger(
      limits.maxTotalResponseBytes,
      "maxTotalResponseBytes",
      128_000_000,
    ),
    requestTimeoutMs: boundedInteger(
      limits.requestTimeoutMs,
      "requestTimeoutMs",
      120_000,
    ),
    maxElapsedMs: boundedInteger(limits.maxElapsedMs, "maxElapsedMs", 240_000),
  }) satisfies CmrHarvestLimits;
}

function compactSlot(timestamp: string) {
  return timestamp.replace(/[-:.]/gu, "");
}

/**
 * Builds a bounded baseline plan for an initial bootstrap or periodic full
 * reconciliation. It deliberately has no predecessor: only a fully completed
 * scan may establish the next global catalog lineage.
 */
export function boundedCmrFullPlan(input: Readonly<{
  scanKind: Exclude<CmrScanKind, "incremental">;
  scheduledFor: string;
  overlapMs?: number;
}>): CmrHarvestPlan {
  const scheduledFor = canonicalTimestamp(input.scheduledFor, "scheduledFor");
  const overlapMs = boundedInteger(
    input.overlapMs ?? CMR_INCREMENTAL_OVERLAP_MS,
    "overlapMs",
    60 * 60_000,
  );
  const requestedTo =
    Math.floor(scheduledFor / CMR_INCREMENTAL_CADENCE_MS) *
    CMR_INCREMENTAL_CADENCE_MS;
  const requestedToIso = new Date(requestedTo).toISOString();
  const plan = Object.freeze({
    harvestKey: `cmr-${input.scanKind}-${compactSlot(requestedToIso)}`,
    scanKind: input.scanKind,
    requestedFrom: new Date(
      Math.max(0, requestedTo - CMR_ACTIVE_OBSERVATION_WINDOW_MS),
    ).toISOString(),
    requestedTo: requestedToIso,
    updatedSince: null,
    watermarkFrom: null,
    watermarkTo: new Date(Math.max(0, requestedTo - overlapMs)).toISOString(),
    predecessorHealthCursor: null,
  });
  validatePlan(plan);
  return plan;
}

export function fiveMinuteCmrIncrementalPlan(input: Readonly<{
  scheduledFor: string;
  previousWatermarkTo: string;
  predecessorHealthCursor: string;
  overlapMs?: number;
}>): CmrHarvestPlan {
  const scheduledFor = canonicalTimestamp(input.scheduledFor, "scheduledFor");
  const previousWatermarkTo = canonicalTimestamp(
    input.previousWatermarkTo,
    "previousWatermarkTo",
  );
  const overlapMs = boundedInteger(
    input.overlapMs ?? CMR_INCREMENTAL_OVERLAP_MS,
    "overlapMs",
    60 * 60_000,
  );
  const requestedTo =
    Math.floor(scheduledFor / CMR_INCREMENTAL_CADENCE_MS) *
    CMR_INCREMENTAL_CADENCE_MS;
  const watermarkTo = requestedTo - overlapMs;
  if (previousWatermarkTo >= watermarkTo) {
    throw new TypeError("The incremental CMR watermark must advance.");
  }
  const requestedToIso = new Date(requestedTo).toISOString();
  const plan = Object.freeze({
    harvestKey: `cmr-incremental-${compactSlot(requestedToIso)}`,
    scanKind: "incremental" as const,
    requestedFrom: new Date(
      Math.max(0, requestedTo - CMR_ACTIVE_OBSERVATION_WINDOW_MS),
    ).toISOString(),
    requestedTo: requestedToIso,
    // CMR has no upper bound paired with `updated_since`. Holding the durable
    // high-water mark behind the request slot causes the newest interval to be
    // fetched again on the next run without breaking predecessor continuity.
    updatedSince: new Date(previousWatermarkTo).toISOString(),
    watermarkFrom: new Date(previousWatermarkTo).toISOString(),
    watermarkTo: new Date(watermarkTo).toISOString(),
    predecessorHealthCursor: input.predecessorHealthCursor,
  });
  validatePlan(plan);
  return plan;
}

function safeQuery(url: URL): SafeQuery {
  const values: Record<string, string | readonly string[]> = {};
  for (const name of new Set(url.searchParams.keys())) {
    const entries = url.searchParams.getAll(name);
    values[name] = entries.length === 1 ? (entries[0] ?? "") : entries;
  }
  return Object.freeze(values);
}

function requestEvidence(
  url: URL,
  product: CmrProduct,
  page: number,
  requestId: string,
  searchAfter: string | null,
): HttpRequestEvidence {
  const headers = cmrRequestHeaders(requestId, searchAfter);
  const requestHeadersSafe: Record<string, string> = {
    accept: headers.Accept ?? "",
    "client-id": headers["Client-Id"] ?? "",
    "x-request-id": headers["X-Request-Id"] ?? "",
  };
  if (headers["CMR-Search-After"]) {
    requestHeadersSafe["cmr-search-after"] = headers["CMR-Search-After"];
  }
  return Object.freeze({
    method: "GET",
    requestUrlSafe: `${url.origin}${url.pathname}`,
    requestQuerySafe: safeQuery(url),
    requestBodyRedacted: null,
    requestHeadersSafe: Object.freeze(requestHeadersSafe),
    requestMetadataSafe: Object.freeze({
      cursor_kind: "cmr_search_after",
      operation: "cmr_firemask_catalog",
      page,
      page_size: CMR_PAGE_SIZE,
      product: product.shortName,
      scope: "global",
    }),
  });
}

function observingLedger(ledger: HttpEvidenceLedger, page: number) {
  let reference: HttpExchangeReference | null = null;
  const observed: HttpEvidenceLedger = {
    issue: async (request) => {
      reference = await ledger.issue(request);
      return reference;
    },
    finishResponse: (exchange, response) => {
      const timedOut = [
        response.safeHeaders["cmr-time-out"],
        response.safeHeaders["cmr-timed-out"],
      ].some((value) => value?.trim().toLowerCase() === "true");
      const providerRequestId =
        response.safeHeaders["cmr-request-id"] ??
        response.safeHeaders["x-request-id"];
      return ledger.finishResponse(exchange, {
        ...response,
        safeMetadata: Object.freeze({
          ...response.safeMetadata,
          page,
          partial: timedOut,
          terminal:
            response.status === 200 &&
            !timedOut &&
            response.safeHeaders["cmr-search-after"] === undefined,
          truncated: false,
          response_body_bytes: response.body.byteLength,
          ...(providerRequestId
            ? { provider_request_id: providerRequestId }
            : {}),
        }),
      });
    },
    finishTransportError: (exchange, error) =>
      ledger.finishTransportError(exchange, error),
  };
  return Object.freeze({
    ledger: observed,
    reference: () => reference,
  });
}

function requestSignal(external: AbortSignal | undefined, timeoutMs: number) {
  const timeout = AbortSignal.timeout(timeoutMs);
  return external ? AbortSignal.any([external, timeout]) : timeout;
}

function requiredNonnegativeIntegerHeader(headers: Headers, name: string) {
  const value = headers.get(name);
  if (value === null || !/^\d+$/u.test(value)) {
    throw new CmrHarvestError(
      "invalid_headers",
      `NASA CMR returned an invalid ${name} header.`,
    );
  }
  const result = Number(value);
  if (!Number.isSafeInteger(result)) {
    throw new CmrHarvestError(
      "invalid_headers",
      `NASA CMR returned an oversized ${name} header.`,
    );
  }
  return result;
}

function optionalNonnegativeNumberHeader(headers: Headers, name: string) {
  const value = headers.get(name);
  if (value === null) return null;
  const result = Number(value);
  if (value.trim() === "" || !Number.isFinite(result) || result < 0) {
    throw new CmrHarvestError(
      "invalid_headers",
      `NASA CMR returned an invalid ${name} header.`,
    );
  }
  return result;
}

function timeoutHeader(headers: Headers) {
  const values = [headers.get("cmr-time-out"), headers.get("cmr-timed-out")]
    .filter((value): value is string => value !== null)
    .map((value) => value.trim().toLowerCase());
  if (values.some((value) => value !== "true" && value !== "false")) {
    throw new CmrHarvestError(
      "invalid_headers",
      "NASA CMR returned an invalid timeout header.",
    );
  }
  return values.includes("true");
}

function responseMetadata(headers: Headers): CmrResponseMetadata {
  const searchAfter = headers.get("cmr-search-after");
  if (searchAfter !== null && searchAfter.trim() === "") {
    throw new CmrHarvestError(
      "invalid_headers",
      "NASA CMR returned an empty Search-After cursor.",
    );
  }
  return Object.freeze({
    hits: requiredNonnegativeIntegerHeader(headers, "cmr-hits"),
    searchAfter,
    timedOut: timeoutHeader(headers),
    tookMs: optionalNonnegativeNumberHeader(headers, "cmr-took"),
    cmrRequestId: headers.get("cmr-request-id"),
    xRequestId: headers.get("x-request-id"),
  });
}

function validatePagePersistenceResult(
  result: CmrPersistedPageResult,
  parsed: CmrProductResult,
) {
  for (const [name, value] of Object.entries(result)) {
    if (!Number.isSafeInteger(value) || value < 0) {
      throw new CmrHarvestPersistenceError("persist_page", {
        cause: new TypeError(`Persistence returned an invalid ${name}.`),
      });
    }
  }
  if (
    result.acceptedCount + result.duplicateCount + result.rejectedCount !==
      parsed.returnedItems ||
    result.rejectedCount < parsed.rejectedItems.length
  ) {
    throw new CmrHarvestPersistenceError("persist_page", {
      cause: new Error("Persistence counts did not account for the parsed page."),
    });
  }
}

function latestTimestamp(
  current: string | null,
  candidate: string,
) {
  return current === null || Date.parse(candidate) > Date.parse(current)
    ? candidate
    : current;
}

function classifyThrownFailure(error: unknown): Readonly<{
  code: CmrHarvestFailureCode;
  detailSafe: string;
}> {
  if (error instanceof CmrHarvestError && error.code !== "busy") {
    return Object.freeze({ code: error.code, detailSafe: error.message });
  }
  if (
    error instanceof EvidencePersistenceError &&
    error.stage === "capture_response" &&
    error.cause instanceof RangeError
  ) {
    return Object.freeze({
      code: "byte_limit",
      detailSafe: "NASA CMR response exceeded the configured evidence byte limit.",
    });
  }
  if (error instanceof EvidencePersistenceError || error instanceof CmrHarvestPersistenceError) {
    return Object.freeze({
      code: "database",
      detailSafe: "Collector persistence failed; no CMR result was published.",
    });
  }
  const name = error instanceof Error ? error.name : "";
  if (name === "AbortError" || name === "TimeoutError") {
    return Object.freeze({
      code: "timeout",
      detailSafe: "NASA CMR request timed out or was aborted.",
    });
  }
  return Object.freeze({
    code: "network",
    detailSafe: "NASA CMR request failed before collection completed.",
  });
}

async function persistFailure(
  persistence: CmrHarvestPersistence,
  harvestId: string,
  plan: CmrHarvestPlan,
  error: unknown,
) {
  const failure = classifyThrownFailure(error);
  try {
    await persistence.failHarvest({ harvestId, plan, ...failure });
  } catch (persistenceError) {
    throw new CmrHarvestPersistenceError("fail_harvest", {
      cause: new AggregateError(
        [error, persistenceError],
        "CMR failure state could not be persisted.",
      ),
    });
  }
}

function requestId(plan: CmrHarvestPlan, product: CmrProduct, page: number) {
  return `${plan.harvestKey}:${product.shortName}:${page}`;
}

type HarvestProductInput = Readonly<{
  product: CmrProduct;
  harvestId: string;
  plan: CmrHarvestPlan;
  fetchImpl: typeof fetch;
  ledger: HttpEvidenceLedger;
  persistence: CmrHarvestPersistence;
  limits: CmrHarvestLimits;
  signal?: AbortSignal;
  clockMs: () => number;
  deadlineMs: number;
  totalResponseBytes: () => number;
  addResponseBytes: (count: number) => void;
}>;

async function collectProduct(input: HarvestProductInput) {
  const url = cmrGranulesUrl(input.product, input.plan);
  let searchAfter: string | null = null;
  const seenCursors = new Set<string>();
  const seenRevisions = new Set<string>();
  let pages = 0;
  let expectedHits: number | null = null;
  let fetchedCount = 0;
  let acceptedCount = 0;
  let duplicateCount = 0;
  let latestObservedAt: string | null = null;
  let latestCatalogedAt: string | null = null;

  while (true) {
    if (pages >= input.limits.maxPagesPerProduct) {
      throw new CmrHarvestError(
        "page_limit",
        "NASA CMR pagination exceeded the configured page limit.",
      );
    }
    const remainingMs = input.deadlineMs - input.clockMs();
    if (remainingMs <= 0) {
      throw new CmrHarvestError(
        "deadline",
        "NASA CMR harvest exceeded its total execution deadline.",
      );
    }
    const remainingBytes =
      input.limits.maxTotalResponseBytes - input.totalResponseBytes();
    if (remainingBytes <= 0) {
      throw new CmrHarvestError(
        "byte_limit",
        "NASA CMR harvest exceeded its total response-byte limit.",
      );
    }

    const page = pages + 1;
    try {
      await input.persistence.heartbeatHarvest({
        harvestId: input.harvestId,
        plan: input.plan,
      });
    } catch (error) {
      throw new CmrHarvestPersistenceError("heartbeat_harvest", { cause: error });
    }
    const id = requestId(input.plan, input.product, page);
    const evidence = requestEvidence(url, input.product, page, id, searchAfter);
    const observedLedger = observingLedger(input.ledger, page);
    const headers = cmrRequestHeaders(id, searchAfter);
    const response = await recordedFetch(
      url,
      {
        method: "GET",
        headers,
        redirect: "manual",
        cache: "no-store",
        signal: requestSignal(
          input.signal,
          Math.min(input.limits.requestTimeoutMs, remainingMs),
        ),
      },
      {
        fetchImpl: input.fetchImpl,
        ledger: observedLedger.ledger,
        requestEvidence: evidence,
        maximumResponseBytes: Math.min(
          input.limits.maxPageResponseBytes,
          remainingBytes,
        ),
        safeResponseHeaderNames: CMR_RESPONSE_HEADERS,
        responseMetadataSafe: Object.freeze({ page }),
      },
    );
    const bytes = new Uint8Array(await response.arrayBuffer());
    input.addResponseBytes(bytes.byteLength);
    pages = page;

    if (response.status >= 300 && response.status < 400) {
      throw new CmrHarvestError(
        "redirect",
        "NASA CMR redirected a pinned collector endpoint; it was not followed.",
      );
    }
    if (response.status === 429) {
      throw new CmrHarvestError(
        "rate_limit",
        "NASA CMR rate-limited the catalog harvest.",
      );
    }
    if (response.status !== 200) {
      throw new CmrHarvestError(
        "upstream",
        "NASA CMR returned an unsuccessful HTTP response.",
      );
    }

    const responseMeta = responseMetadata(response.headers);
    if (responseMeta.timedOut) {
      throw new CmrHarvestError(
        "provider_timeout",
        "NASA CMR returned a timed-out partial result.",
      );
    }
    const parsed = parseCmrProductPasses(input.product, bytes);
    if (parsed.status !== "ok" || parsed.hits !== responseMeta.hits) {
      throw new CmrHarvestError(
        "invalid_response",
        "NASA CMR response metadata and payload did not form a valid page.",
      );
    }

    const reference = observedLedger.reference();
    if (reference === null) {
      throw new CmrHarvestPersistenceError("persist_page", {
        cause: new Error("Recorded response did not expose its exchange reference."),
      });
    }
    let persisted: CmrPersistedPageResult;
    try {
      persisted = await input.persistence.persistPage({
        harvestId: input.harvestId,
        plan: input.plan,
        product: input.product,
        page,
        requestId: id,
        searchAfterBefore: searchAfter,
        exchange: reference,
        responseBytes: bytes.byteLength,
        response: responseMeta,
        parsed,
      });
    } catch (error) {
      throw new CmrHarvestPersistenceError("persist_page", { cause: error });
    }
    validatePagePersistenceResult(persisted, parsed);
    acceptedCount += persisted.acceptedCount;
    duplicateCount += persisted.duplicateCount;
    fetchedCount += parsed.returnedItems;

    if (persisted.rejectedCount > 0) {
      throw new CmrHarvestError(
        "invalid_response",
        "NASA CMR returned items that failed schema or footprint validation.",
      );
    }
    if (expectedHits === null) expectedHits = responseMeta.hits;
    if (expectedHits !== responseMeta.hits) {
      throw new CmrHarvestError(
        "pagination_drift",
        "NASA CMR hit count changed while Search-After was in progress.",
      );
    }

    for (const pass of parsed.passes) {
      const revisionKey = `${pass.id}:${pass.revisionId}`;
      if (seenRevisions.has(revisionKey)) {
        throw new CmrHarvestError(
          "pagination_drift",
          "NASA CMR repeated a granule revision within one harvest.",
        );
      }
      seenRevisions.add(revisionKey);
      latestObservedAt = latestTimestamp(latestObservedAt, pass.observedFrom);
      latestCatalogedAt = latestTimestamp(latestCatalogedAt, pass.catalogedAt);
    }

    const nextCursor = responseMeta.searchAfter;
    if (nextCursor === null) {
      if (fetchedCount !== expectedHits) {
        throw new CmrHarvestError(
          "pagination_drift",
          "NASA CMR ended pagination before every reported hit was returned.",
        );
      }
      return Object.freeze({
        product: input.product.shortName,
        satellite: input.product.satellite,
        pages,
        upstreamHits: expectedHits,
        fetchedCount,
        acceptedCount,
        duplicateCount,
        latestObservedAt,
        latestCatalogedAt,
      }) satisfies CmrProductHarvestSummary;
    }
    if (parsed.returnedItems === 0 || seenCursors.has(nextCursor)) {
      throw new CmrHarvestError(
        "pagination_drift",
        "NASA CMR returned a non-advancing Search-After cursor.",
      );
    }
    seenCursors.add(nextCursor);
    searchAfter = nextCursor;
  }
}

/**
 * Executes one server-side, global three-product catalog harvest. It performs
 * no per-viewer/per-cell calls and it sends no Earthdata token: these public
 * CMR metadata endpoints do not require one. Every response is durable before
 * parsing, and completion is durable before any result is returned.
 */
export async function harvestCmrFireMaskCatalog(
  input: CmrHarvestInput,
): Promise<CmrHarvestSummary> {
  assertServerRuntime();
  validatePlan(input.plan);
  const limits = normalizedLimits(input.limits);
  const clockMs = input.clockMs ?? Date.now;
  const startedAt = clockMs();
  if (!Number.isFinite(startedAt)) {
    throw new TypeError("CMR collector clock must return finite milliseconds.");
  }

  let reservation: CmrHarvestReservation;
  try {
    reservation = await input.persistence.reserveHarvest(input.plan);
  } catch (error) {
    throw new CmrHarvestPersistenceError("reserve_harvest", { cause: error });
  }
  if (reservation.state === "already-complete") return reservation.summary;
  if (reservation.state === "busy") {
    throw new CmrHarvestError(
      "busy",
      "An identical CMR harvest is already running.",
    );
  }

  const harvestId = reservation.harvestId;
  if (harvestId.trim() === "" || harvestId.length > 256) {
    throw new CmrHarvestPersistenceError("reserve_harvest", {
      cause: new Error("Persistence returned an invalid harvest identifier."),
    });
  }
  let totalResponseBytes = 0;
  try {
    const products: CmrProductHarvestSummary[] = [];
    for (const product of CMR_FIREMASK_PRODUCTS) {
      products.push(
        await collectProduct({
          product,
          harvestId,
          plan: input.plan,
          fetchImpl: input.fetchImpl,
          ledger: input.ledger,
          persistence: input.persistence,
          limits,
          signal: input.signal,
          clockMs,
          deadlineMs: startedAt + limits.maxElapsedMs,
          totalResponseBytes: () => totalResponseBytes,
          addResponseBytes: (count) => {
            totalResponseBytes += count;
          },
        }),
      );
    }

    const summary = Object.freeze({
      status: "complete" as const,
      harvestId,
      plan: input.plan,
      requestCount: products.reduce((total, product) => total + product.pages, 0),
      responseBytes: totalResponseBytes,
      pageCount: products.reduce((total, product) => total + product.pages, 0),
      upstreamHitCount: products.reduce(
        (total, product) => total + product.upstreamHits,
        0,
      ),
      fetchedCount: products.reduce(
        (total, product) => total + product.fetchedCount,
        0,
      ),
      acceptedCount: products.reduce(
        (total, product) => total + product.acceptedCount,
        0,
      ),
      duplicateCount: products.reduce(
        (total, product) => total + product.duplicateCount,
        0,
      ),
      rejectedCount: 0 as const,
      products: Object.freeze(products),
      coverage: "global-catalog-query" as const,
      anomalyAssessment: "not-assessed" as const,
    }) satisfies CmrHarvestSummary;
    try {
      await input.persistence.completeHarvest(summary);
    } catch (error) {
      throw new CmrHarvestPersistenceError("complete_harvest", { cause: error });
    }
    return summary;
  } catch (error) {
    await persistFailure(input.persistence, harvestId, input.plan, error);
    throw error;
  }
}
