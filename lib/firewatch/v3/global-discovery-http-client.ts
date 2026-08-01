import {
  exploreDiscoveryRequestSchema,
  exploreDiscoveryResponseForRequestSchema,
  nearbyDiscoveryRequestSchema,
  nearbyDiscoveryResponseForRequestSchema,
  type ExploreDiscoveryRequest,
  type ExploreDiscoveryResponse,
  type NearbyDiscoveryRequest,
  type NearbyDiscoveryResponse,
} from "./discovery-contracts";
import type {
  GlobalDiscoveryClient,
  GlobalDiscoveryClientResult,
  GlobalDiscoveryRequestOptions,
} from "./global-discovery-client";

const MAX_RESPONSE_BYTES = 1_000_000;
const MAX_CACHE_ENTRIES = 64;

export type GlobalDiscoveryFetch = (
  input: string,
  init: RequestInit,
) => Promise<Response>;

export type GlobalDiscoveryHttpClientOptions = Readonly<{
  fetch: GlobalDiscoveryFetch;
}>;

type AnyDiscoveryRequest = ExploreDiscoveryRequest | NearbyDiscoveryRequest;

type ResponseParser<ResponseData> = Readonly<{
  safeParse(value: unknown):
    | Readonly<{ success: true; data: ResponseData }>
    | Readonly<{ success: false }>;
}>;

type CacheEntry = Readonly<{
  etag: string;
  data: unknown;
}>;

function queryFor(request: AnyDiscoveryRequest): string {
  const query = new URLSearchParams();
  if (request.kind === "nearby-incidents") query.set("cell", request.cell);
  query.set("schemaVersion", String(request.schemaVersion));
  query.set("asOf", request.time.asOf);
  query.set("knownAt", request.time.knownAt);
  query.set("limit", String(request.page.limit));
  if (request.page.after !== null) query.set("after", request.page.after);
  return query.toString();
}

/**
 * Builds one of two allowlisted, relative same-origin paths. Explore remains
 * a bounded page and does not imply viewport/zoom aggregation or camera state.
 * Nearby keeps the canonical cell in a single query value so encoded slashes
 * never depend on proxy or dynamic-route path-segment behavior.
 */
export function buildGlobalDiscoveryRequestPath(
  request: AnyDiscoveryRequest,
): string {
  if (request.kind === "explore-candidates") {
    const parsed = exploreDiscoveryRequestSchema.parse(request);
    return `/api/v3/explore/cells?${queryFor(parsed)}`;
  }
  const parsed = nearbyDiscoveryRequestSchema.parse(request);
  return `/api/v3/areas/nearby?${queryFor(parsed)}`;
}

function isJsonContentType(value: string | null): boolean {
  if (!value) return false;
  const mediaType = value.split(";", 1)[0]?.trim().toLowerCase() ?? "";
  return mediaType === "application/json" || mediaType.endsWith("+json");
}

function safeStrongEtag(value: string | null): string | null {
  if (
    value === null ||
    value.length > 256 ||
    !/^"[\x21\x23-\x7e]*"$/u.test(value)
  ) {
    return null;
  }
  return value;
}

function cacheControlDirectives(response: Response): readonly string[] | null {
  const value = response.headers.get("cache-control");
  if (value === null) return null;
  return value
    .split(",")
    .map((directive) => directive.trim().toLowerCase());
}

function explicitlyCacheable(response: Response): boolean {
  const directives = cacheControlDirectives(response);
  if (directives === null) return false;
  if (directives.includes("no-store")) return false;
  return directives.some(
    (directive) =>
      directive === "no-cache" ||
      directive === "must-revalidate" ||
      directive === "private" ||
      directive === "public" ||
      /^(?:s-maxage|max-age)=\d+$/u.test(directive),
  );
}

function isAbortError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "name" in error &&
    error.name === "AbortError"
  );
}

async function readBoundedJson(response: Response): Promise<unknown> {
  const declaredLength = response.headers.get("content-length");
  if (declaredLength !== null) {
    const bytes = Number(declaredLength);
    if (!Number.isSafeInteger(bytes) || bytes < 0 || bytes > MAX_RESPONSE_BYTES) {
      throw new Error("Discovery response exceeds its byte budget");
    }
  }
  const text = await response.text();
  if (new TextEncoder().encode(text).byteLength > MAX_RESPONSE_BYTES) {
    throw new Error("Discovery response exceeds its byte budget");
  }
  return JSON.parse(text) as unknown;
}

function fallbackOrUnavailable<ResponseData>(
  cached: CacheEntry | undefined,
): GlobalDiscoveryClientResult<ResponseData> {
  if (cached) {
    return {
      kind: "snapshot",
      transport: "cache-fallback",
      data: structuredClone(cached.data) as ResponseData,
    };
  }
  return { kind: "unavailable", retryable: true };
}

/**
 * Browser-facing persisted-read adapter. It calls only Firewatch same-origin
 * routes, never upstream providers, and caches solely first-page reads by the
 * exact bounded request path (including scope and event/knowledge cutoffs).
 * Continuation pages remain uncached presentation history. The caller must
 * inject the browser transport so this boundary cannot grow a second
 * unrecorded upstream-fetch path.
 */
export function createHttpGlobalDiscoveryClient(
  options: GlobalDiscoveryHttpClientOptions,
): GlobalDiscoveryClient {
  const requestFetch = options.fetch;
  const cache = new Map<string, CacheEntry>();

  const remember = (path: string, entry: CacheEntry) => {
    cache.delete(path);
    cache.set(path, entry);
    if (cache.size > MAX_CACHE_ENTRIES) {
      const oldest = cache.keys().next().value as string | undefined;
      if (oldest !== undefined) cache.delete(oldest);
    }
  };

  async function load<
    ResponseData extends ExploreDiscoveryResponse | NearbyDiscoveryResponse,
  >(
    path: string,
    parser: ResponseParser<ResponseData>,
    allowSnapshotCache: boolean,
    requestOptions?: GlobalDiscoveryRequestOptions,
  ): Promise<GlobalDiscoveryClientResult<ResponseData>> {
    if (requestOptions?.signal?.aborted) {
      return { kind: "cancelled", retryable: false };
    }
    // Continuation pages are short-lived presentation history. Even though
    // their exact path includes the cursor, keeping them out of this cache
    // prevents a later page from being mistaken for a complete global
    // fallback snapshot by future controller code.
    const cached = allowSnapshotCache ? cache.get(path) : undefined;
    const headers: Record<string, string> = { Accept: "application/json" };
    const conditionalEtag = cached?.etag ?? null;
    if (conditionalEtag !== null) headers["If-None-Match"] = conditionalEtag;

    let response: Response;
    try {
      response = await requestFetch(path, {
        method: "GET",
        headers,
        cache: "no-store",
        credentials: "same-origin",
        mode: "same-origin",
        redirect: "error",
        referrerPolicy: "same-origin",
        signal: requestOptions?.signal,
      });
    } catch (error) {
      if (requestOptions?.signal?.aborted || isAbortError(error)) {
        return { kind: "cancelled", retryable: false };
      }
      return fallbackOrUnavailable<ResponseData>(cached);
    }
    if (requestOptions?.signal?.aborted) {
      return { kind: "cancelled", retryable: false };
    }

    if (response.status === 304) {
      const responseEtag = safeStrongEtag(response.headers.get("etag"));
      if (
        !cached ||
        conditionalEtag === null ||
        responseEtag === null ||
        responseEtag !== conditionalEtag
      ) {
        return { kind: "invalid-response", retryable: true };
      }
      const parsed = parser.safeParse(structuredClone(cached.data));
      if (!parsed.success) {
        return { kind: "invalid-response", retryable: true };
      }
      if (cacheControlDirectives(response)?.includes("no-store")) {
        cache.delete(path);
      } else {
        remember(path, cached);
      }
      return {
        kind: "snapshot",
        transport: "revalidated-cache",
        data: parsed.data,
      };
    }

    if (
      response.status === 408 ||
      response.status === 425 ||
      response.status === 429 ||
      response.status >= 500
    ) {
      return fallbackOrUnavailable<ResponseData>(cached);
    }
    if (response.status >= 400 && response.status < 500) {
      return { kind: "invalid-request", retryable: false };
    }
    if (
      !response.ok ||
      !isJsonContentType(response.headers.get("content-type"))
    ) {
      return { kind: "invalid-response", retryable: true };
    }

    try {
      const parsed = parser.safeParse(await readBoundedJson(response));
      if (!parsed.success) {
        return { kind: "invalid-response", retryable: true };
      }
      const etag = safeStrongEtag(response.headers.get("etag"));
      if (
        allowSnapshotCache &&
        parsed.data.coverage.state === "complete" &&
        etag !== null &&
        explicitlyCacheable(response)
      ) {
        remember(path, { etag, data: structuredClone(parsed.data) });
      } else {
        cache.delete(path);
      }
      return { kind: "snapshot", transport: "live", data: parsed.data };
    } catch (error) {
      if (requestOptions?.signal?.aborted || isAbortError(error)) {
        return { kind: "cancelled", retryable: false };
      }
      return { kind: "invalid-response", retryable: true };
    }
  }

  return {
    async exploreCandidates(request, requestOptions) {
      const parsedRequest = exploreDiscoveryRequestSchema.safeParse(request);
      if (!parsedRequest.success) {
        return { kind: "invalid-request", retryable: false };
      }
      const path = buildGlobalDiscoveryRequestPath(parsedRequest.data);
      return load<ExploreDiscoveryResponse>(
        path,
        exploreDiscoveryResponseForRequestSchema(parsedRequest.data),
        parsedRequest.data.page.after === null,
        requestOptions,
      );
    },

    async nearbyIncidents(request, requestOptions) {
      const parsedRequest = nearbyDiscoveryRequestSchema.safeParse(request);
      if (!parsedRequest.success) {
        return { kind: "invalid-request", retryable: false };
      }
      const path = buildGlobalDiscoveryRequestPath(parsedRequest.data);
      return load<NearbyDiscoveryResponse>(
        path,
        nearbyDiscoveryResponseForRequestSchema(parsedRequest.data),
        parsedRequest.data.page.after === null,
        requestOptions,
      );
    },
  };
}
