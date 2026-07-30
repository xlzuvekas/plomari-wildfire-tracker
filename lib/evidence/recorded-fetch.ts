const FORBIDDEN_HEADER_NAME =
  /(^|[-_])(authorization|proxy[-_]?authorization|cookie|set[-_]?cookie|password|secret|api[-_]?key|access[-_]?token|refresh[-_]?token|signature)([-_]|$)/iu;
const AUTHORIZATION_VALUE = /^\s*(bearer|basic)\s+/iu;
const CREDENTIAL_QUERY_KEY =
  /(^|[-_.])(authorization|auth|password|secret|signature|credential|api[-_]?key|key|token|access[-_]?token|refresh[-_]?token)([-_.]|$)/iu;
// FIRMS Area embeds MAP_KEY in the first path segment after `/csv/`.
const KNOWN_CREDENTIAL_PATH = /^\/api\/area\/csv\/[^/]+(?:\/|$)/iu;
const MAX_SAFE_HEADER_VALUE_BYTES = 2_048;
const MAX_SAFE_HEADERS_BYTES = 12_288;
const MAX_SAFE_METADATA_BYTES = 24_576;

const SAFE_KEYS = Object.freeze({
  requestHeader: new Set([
    "accept",
    "accept-encoding",
    "accept-language",
    "client-id",
    "cmr-search-after",
    "content-type",
    "if-match",
    "if-modified-since",
    "if-none-match",
    "if-unmodified-since",
    "range",
    "user-agent",
    "x-request-id",
  ]),
  responseHeader: new Set([
    "age",
    "cache-control",
    "cmr-hits",
    "cmr-request-id",
    "cmr-search-after",
    "cmr-time-out",
    "cmr-timed-out",
    "cmr-took",
    "content-encoding",
    "content-language",
    "content-length",
    "content-range",
    "content-type",
    "date",
    "etag",
    "expires",
    "last-modified",
    "retry-after",
    "traceparent",
    "vary",
    "x-ratelimit-limit",
    "x-ratelimit-remaining",
    "x-ratelimit-reset",
    "x-request-id",
  ]),
  requestQuery: new Set([
    "area",
    "bbox",
    "bounding_box",
    "collection",
    "concept_id",
    "cursor",
    "current",
    "date",
    "date_from",
    "date_to",
    "end",
    "end_date",
    "exclude",
    "forecast_days",
    "format",
    "hourly",
    "hours",
    "ids",
    "language",
    "lat",
    "latitude",
    "limit",
    "lon",
    "longitude",
    "max_results",
    "model",
    "offset",
    "order",
    "page",
    "page_num",
    "page_size",
    "polygon",
    "product",
    "provider",
    "radius",
    "search_after",
    "short_name",
    "short_name[]",
    "sort_key",
    "sort_key[]",
    "start",
    "start_date",
    "start_time",
    "temperature_unit",
    "temporal",
    "timezone",
    "tweet.fields",
    "units",
    "updated_since",
    "version",
    "wind_speed_unit",
  ]),
  requestMetadata: new Set([
    "attempt",
    "cache_mode",
    "collection",
    "cursor_kind",
    "operation",
    "page",
    "page_size",
    "product",
    "scope",
  ]),
  resultMetadata: new Set([
    "cache_status",
    "class",
    "error_class",
    "page",
    "page_count",
    "partial",
    "provider_request_id",
    "reason",
    "response_body_bytes",
    "retry_after_ms",
    "terminal",
    "truncated",
  ]),
});

type SafeScalar = string | number | boolean | null;
type SafeMapValue = SafeScalar | readonly SafeScalar[];
type SafeMap = Readonly<Record<string, SafeMapValue>>;

export type SafeMetadata = SafeMap;
export type SafeQuery = SafeMap;
export type SafeHeaders = Readonly<Record<string, string>>;

export type HttpExchangeReference = Readonly<{
  exchangeId: string;
  runId: string;
}>;

export type HttpRequestEvidence = Readonly<{
  method: string;
  requestUrlSafe: string;
  requestQuerySafe: SafeQuery;
  requestBodyRedacted: Uint8Array | null;
  requestHeadersSafe: SafeHeaders;
  requestMetadataSafe: SafeMetadata;
}>;

export type HttpResponseEvidence = Readonly<{
  status: number;
  body: Uint8Array;
  safeHeaders: SafeHeaders;
  safeMetadata: SafeMetadata;
}>;

export type HttpTransportErrorEvidence = Readonly<{
  errorClass: "timeout" | "network";
  errorDetailSafe: string;
  safeMetadata: SafeMetadata;
}>;

/**
 * Database implementations map these three operations to the lease-fenced
 * `ingest.http_exchanges` lifecycle. `issue` must commit before resolving;
 * terminal methods must persist the raw response/outcome before resolving.
 */
export interface HttpEvidenceLedger {
  issue(request: HttpRequestEvidence): Promise<HttpExchangeReference>;
  finishResponse(
    reference: HttpExchangeReference,
    response: HttpResponseEvidence,
  ): Promise<void>;
  finishTransportError(
    reference: HttpExchangeReference,
    error: HttpTransportErrorEvidence,
  ): Promise<void>;
}

export type RecordedFetchOptions = Readonly<{
  fetchImpl: typeof fetch;
  ledger: HttpEvidenceLedger;
  requestEvidence: HttpRequestEvidence;
  maximumResponseBytes: number;
  safeResponseHeaderNames?: readonly string[];
  responseMetadataSafe?: SafeMetadata;
}>;

export class EvidencePersistenceError extends Error {
  constructor(
    readonly stage:
      | "issue"
      | "capture_response"
      | "finish_response"
      | "finish_transport_error",
    options?: ErrorOptions,
  ) {
    super("Upstream data was withheld because its evidence was not durable.", options);
    this.name = "EvidencePersistenceError";
  }
}

function byteLength(value: string) {
  return new TextEncoder().encode(value).byteLength;
}

function safeTextIsAllowed(value: string) {
  return (
    byteLength(value) <= MAX_SAFE_HEADER_VALUE_BYTES &&
    !/[\u0000-\u001f\u007f]/u.test(value) &&
    !AUTHORIZATION_VALUE.test(value) &&
    !value.includes("://") &&
    !/\/\/\S+\?/u.test(value)
  );
}

function validateSafeMap(
  values: SafeMap,
  allowedKeys: ReadonlySet<string>,
  maximumBytes: number,
) {
  let encoded: string;
  try {
    encoded = JSON.stringify(values);
  } catch {
    throw new TypeError("Evidence safe maps must be JSON serializable.");
  }
  if (
    values === null ||
    typeof values !== "object" ||
    Array.isArray(values) ||
    encoded === undefined ||
    byteLength(encoded) > maximumBytes
  ) {
    throw new TypeError("Evidence safe map is invalid or too large.");
  }

  for (const [name, rawValue] of Object.entries(values)) {
    if (name !== name.toLowerCase() || !allowedKeys.has(name)) {
      throw new TypeError("Evidence safe map contains a non-allowlisted key.");
    }
    const entries = Array.isArray(rawValue) ? rawValue : [rawValue];
    if (
      entries.some(
        (value) =>
          !(
            value === null ||
            typeof value === "string" ||
            typeof value === "boolean" ||
            (typeof value === "number" && Number.isFinite(value))
          ) ||
          (typeof value === "string" && !safeTextIsAllowed(value)),
      )
    ) {
      throw new TypeError("Evidence safe map contains an unsafe value.");
    }
  }
}

function validateSafeHeaders(headers: SafeHeaders) {
  let totalBytes = 2;
  for (const [rawName, value] of Object.entries(headers)) {
    const name = rawName.trim().toLowerCase();
    if (
      name === "" ||
      name !== rawName ||
      FORBIDDEN_HEADER_NAME.test(name) ||
      AUTHORIZATION_VALUE.test(value) ||
      byteLength(value) > MAX_SAFE_HEADER_VALUE_BYTES
    ) {
      throw new TypeError("Evidence headers must use a credential-free allowlist.");
    }
    totalBytes += byteLength(name) + byteLength(value) + 6;
  }
  if (totalBytes > MAX_SAFE_HEADERS_BYTES) {
    throw new TypeError("Evidence headers exceed the safe metadata limit.");
  }
  validateSafeMap(headers, SAFE_KEYS.requestHeader, MAX_SAFE_HEADERS_BYTES);
}

function validateMaximumResponseBytes(maximumBytes: number) {
  if (!Number.isSafeInteger(maximumBytes) || maximumBytes < 0) {
    throw new TypeError("maximumResponseBytes must be a non-negative safe integer.");
  }
}

function normalizeSafeResponseHeaderNames(names: readonly string[]) {
  const normalized = names.map((rawName) => rawName.trim().toLowerCase());
  if (
    normalized.some(
      (name) =>
        name === "" ||
        FORBIDDEN_HEADER_NAME.test(name) ||
        !SAFE_KEYS.responseHeader.has(name),
    )
  ) {
    throw new TypeError("Response evidence header allowlist is unsafe.");
  }
  return Object.freeze([...new Set(normalized)]);
}

function normalizedMethod(input: RequestInfo | URL, init?: RequestInit) {
  const method = init?.method ?? (input instanceof Request ? input.method : "GET");
  return method.trim().toUpperCase();
}

function validateActualQuery(
  actualUrl: URL,
  requestQuerySafe: SafeQuery,
) {
  const actualSafeQuery = new Map<string, string[]>();
  for (const [name, value] of actualUrl.searchParams) {
    if (SAFE_KEYS.requestQuery.has(name)) {
      const values = actualSafeQuery.get(name) ?? [];
      values.push(value);
      actualSafeQuery.set(name, values);
    } else if (!CREDENTIAL_QUERY_KEY.test(name)) {
      throw new TypeError("Network request contains an unreviewed query key.");
    }
  }

  if (actualSafeQuery.size !== Object.keys(requestQuerySafe).length) {
    throw new TypeError("Safe query evidence does not match the network request.");
  }
  for (const [name, actualValues] of actualSafeQuery) {
    const evidenceValue = requestQuerySafe[name];
    const evidenceValues = Array.isArray(evidenceValue)
      ? evidenceValue.map(String)
      : evidenceValue === undefined
        ? []
        : [String(evidenceValue)];
    if (
      actualValues.length !== evidenceValues.length ||
      actualValues.some((value, index) => value !== evidenceValues[index])
    ) {
      throw new TypeError("Safe query evidence does not match the network request.");
    }
  }
}

function validateRequestEvidence(
  input: RequestInfo | URL,
  init: RequestInit | undefined,
  evidence: HttpRequestEvidence,
) {
  if (!/^[A-Z][A-Z0-9_-]{0,31}$/u.test(evidence.method)) {
    throw new TypeError("Evidence request method is invalid.");
  }
  if (normalizedMethod(input, init) !== evidence.method) {
    throw new TypeError("Evidence request method does not match network request.");
  }
  if (
    (evidence.method === "GET" || evidence.method === "HEAD") &&
    evidence.requestBodyRedacted !== null
  ) {
    throw new TypeError("GET and HEAD evidence cannot contain a request body.");
  }

  let requestUrlSafe: URL;
  let actualUrl: URL;
  try {
    requestUrlSafe = new URL(evidence.requestUrlSafe);
    actualUrl = new URL(input instanceof Request ? input.url : input);
  } catch {
    throw new TypeError("Evidence request URL is invalid.");
  }
  if (
    requestUrlSafe.protocol !== "https:" ||
    requestUrlSafe.username !== "" ||
    requestUrlSafe.password !== "" ||
    requestUrlSafe.search !== "" ||
    requestUrlSafe.hash !== "" ||
    actualUrl.protocol !== "https:" ||
    actualUrl.username !== "" ||
    actualUrl.password !== "" ||
    `${actualUrl.origin}${actualUrl.pathname}` !==
      `${requestUrlSafe.origin}${requestUrlSafe.pathname}` ||
    KNOWN_CREDENTIAL_PATH.test(actualUrl.pathname) ||
    evidence.requestUrlSafe.includes("?") ||
    evidence.requestUrlSafe.includes("#") ||
    /[\u0000-\u0020\u007f]/u.test(evidence.requestUrlSafe) ||
    /%(23|3f|40)/iu.test(requestUrlSafe.pathname) ||
    /(^|[/._-])(authorization|password|secret|signature|credential|api[-_]?key|access[-_]?token|refresh[-_]?token)([/._=-]|$)/iu.test(
      requestUrlSafe.pathname,
    ) ||
    evidence.requestUrlSafe.length > 4_096
  ) {
    throw new TypeError("Evidence request URL must be credential-free HTTPS.");
  }
  validateSafeMap(
    evidence.requestQuerySafe,
    SAFE_KEYS.requestQuery,
    MAX_SAFE_HEADERS_BYTES,
  );
  validateActualQuery(actualUrl, evidence.requestQuerySafe);
  validateSafeHeaders(evidence.requestHeadersSafe);
  validateSafeMap(
    evidence.requestMetadataSafe,
    SAFE_KEYS.requestMetadata,
    MAX_SAFE_METADATA_BYTES,
  );
}

function safeResponseHeaders(
  headers: Headers,
  allowedNames: readonly string[],
): SafeHeaders {
  const captured: Record<string, string> = {};
  for (const name of allowedNames) {
    const value = headers.get(name);
    if (value !== null && byteLength(value) <= MAX_SAFE_HEADER_VALUE_BYTES) {
      captured[name] = value;
    }
  }
  validateSafeMap(captured, SAFE_KEYS.responseHeader, MAX_SAFE_HEADERS_BYTES);
  return Object.freeze(captured);
}

async function readBoundedBytes(response: Response, maximumBytes: number) {
  const declaredLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > maximumBytes) {
    throw new RangeError("Response exceeds the evidence capture limit.");
  }
  if (response.body === null) return new Uint8Array();

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      totalBytes += chunk.value.byteLength;
      if (totalBytes > maximumBytes) {
        await reader.cancel().catch(() => undefined);
        throw new RangeError("Response exceeds the evidence capture limit.");
      }
      chunks.push(chunk.value);
    }
  } finally {
    reader.releaseLock();
  }

  const body = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return body;
}

function classifyTransportError(error: unknown): HttpTransportErrorEvidence {
  const name = error instanceof Error ? error.name : "";
  const timeout = name === "AbortError" || name === "TimeoutError";
  return Object.freeze({
    errorClass: timeout ? "timeout" : "network",
    errorDetailSafe: timeout
      ? "Upstream request timed out or was aborted."
      : "Upstream request failed before an HTTP response was available.",
    safeMetadata: Object.freeze({}),
  });
}

/**
 * Fetches only after request issuance is durable, and returns a response only
 * after exact application-visible response bytes (including error/empty
 * bodies) are durable. Redirects must remain manual; a caller that follows a
 * validated 3xx target must issue that target through a new recordedFetch call.
 * Callers must provide credential-redacted request evidence explicitly.
 */
export async function recordedFetch(
  input: RequestInfo | URL,
  init: RequestInit | undefined,
  options: RecordedFetchOptions,
): Promise<Response> {
  if (init?.redirect !== "manual") {
    throw new TypeError(
      "Evidence-recording fetches require manual redirect handling.",
    );
  }
  validateRequestEvidence(input, init, options.requestEvidence);
  validateMaximumResponseBytes(options.maximumResponseBytes);
  const allowedResponseHeaders = normalizeSafeResponseHeaderNames(
    options.safeResponseHeaderNames ?? [],
  );
  const responseMetadataSafe =
    options.responseMetadataSafe ?? Object.freeze({});
  validateSafeMap(
    responseMetadataSafe,
    SAFE_KEYS.resultMetadata,
    MAX_SAFE_METADATA_BYTES,
  );

  let reference: HttpExchangeReference;
  try {
    reference = await options.ledger.issue(options.requestEvidence);
  } catch (error) {
    throw new EvidencePersistenceError("issue", { cause: error });
  }

  let response: Response;
  try {
    response = await options.fetchImpl(input, init);
  } catch (error) {
    try {
      await options.ledger.finishTransportError(
        reference,
        classifyTransportError(error),
      );
    } catch (persistenceError) {
      throw new EvidencePersistenceError("finish_transport_error", {
        cause: persistenceError,
      });
    }
    throw error;
  }

  let body: Uint8Array;
  try {
    body = await readBoundedBytes(response, options.maximumResponseBytes);
  } catch (error) {
    throw new EvidencePersistenceError("capture_response", { cause: error });
  }

  try {
    await options.ledger.finishResponse(reference, {
      status: response.status,
      body,
      safeHeaders: safeResponseHeaders(
        response.headers,
        allowedResponseHeaders,
      ),
      safeMetadata: responseMetadataSafe,
    });
  } catch (error) {
    throw new EvidencePersistenceError("finish_response", { cause: error });
  }

  return new Response(body.byteLength === 0 ? null : new Uint8Array(body), {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
  });
}
