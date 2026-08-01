import { describe, expect, it, vi } from "vitest";

import {
  GLOBAL_DISCOVERY_POLICY_VERSION,
  GLOBAL_DISCOVERY_SCHEMA_VERSION,
  buildGlobalDiscoveryRequestPath,
  createFixtureGlobalDiscoveryClient,
  createHttpGlobalDiscoveryClient,
  exploreDiscoveryRequestSchema,
  nearbyDiscoveryRequestSchema,
  type ExploreDiscoveryResponse,
  type GlobalDiscoveryFetch,
  type NearbyDiscoveryRequest,
} from "../lib/firewatch/v3";
import {
  SYNTHETIC_MARSEILLE_EXPLORE,
  SYNTHETIC_PARIS_VALID_EMPTY,
  SYNTHETIC_PLOMARI_NEARBY,
} from "./fixtures/global-discovery-v3";

function copy<Value>(value: Value): Value {
  return structuredClone(value);
}

function exploreRequest() {
  return exploreDiscoveryRequestSchema.parse({
    schemaVersion: GLOBAL_DISCOVERY_SCHEMA_VERSION,
    kind: "explore-candidates",
    time: {
      asOf: SYNTHETIC_MARSEILLE_EXPLORE.time.asOf,
      knownAt: SYNTHETIC_MARSEILLE_EXPLORE.time.knownAt,
    },
    page: {},
  });
}

function parisRequest() {
  return nearbyDiscoveryRequestSchema.parse({
    schemaVersion: GLOBAL_DISCOVERY_SCHEMA_VERSION,
    kind: "nearby-incidents",
    cell: SYNTHETIC_PARIS_VALID_EMPTY.scope.cell,
    time: {
      asOf: SYNTHETIC_PARIS_VALID_EMPTY.time.asOf,
      knownAt: SYNTHETIC_PARIS_VALID_EMPTY.time.knownAt,
    },
    page: {},
  });
}

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  const headers = new Headers(init.headers);
  if (!headers.has("content-type")) {
    headers.set("content-type", "application/json; charset=utf-8");
  }
  return new Response(JSON.stringify(body), { ...init, headers });
}

describe("fixture global discovery client", () => {
  it("serves only matching, request-bound synthetic snapshots", async () => {
    const client = createFixtureGlobalDiscoveryClient({
      explore: SYNTHETIC_MARSEILLE_EXPLORE,
      nearby: [SYNTHETIC_PLOMARI_NEARBY, SYNTHETIC_PARIS_VALID_EMPTY],
    });

    const explore = await client.exploreCandidates(exploreRequest());
    const paris = await client.nearbyIncidents(parisRequest());
    expect(explore.kind).toBe("snapshot");
    expect(paris.kind).toBe("snapshot");
    if (explore.kind === "snapshot") expect(explore.transport).toBe("fixture");
    if (paris.kind === "snapshot") expect(paris.data.incidents).toEqual([]);

    const changedCutoff = copy(parisRequest());
    changedCutoff.time.asOf = "2026-07-31T14:59:59.999Z";
    expect((await client.nearbyIncidents(changedCutoff)).kind).toBe(
      "invalid-response",
    );

    const missingArea = copy(parisRequest());
    missingArea.cell = "wm/10/517/352";
    expect((await client.nearbyIncidents(missingArea)).kind).toBe("unavailable");
  });

  it("does not allow returned-object mutation to corrupt a fixture", async () => {
    const client = createFixtureGlobalDiscoveryClient({
      explore: SYNTHETIC_MARSEILLE_EXPLORE,
      nearby: [SYNTHETIC_PARIS_VALID_EMPTY],
    });
    const first = await client.exploreCandidates(exploreRequest());
    if (first.kind !== "snapshot") throw new Error("Expected fixture snapshot");
    first.data.candidates.length = 0;

    const second = await client.exploreCandidates(exploreRequest());
    if (second.kind !== "snapshot") throw new Error("Expected fixture snapshot");
    expect(second.data.candidates).toHaveLength(1);
  });
});

describe("same-origin HTTP global discovery client", () => {
  it("builds only allowlisted relative paths with an encoded canonical cell query", () => {
    const nearbyPath = buildGlobalDiscoveryRequestPath(parisRequest());
    const nearbyUrl = new URL(nearbyPath, "https://firewatch.invalid");
    expect(nearbyUrl.origin).toBe("https://firewatch.invalid");
    expect(nearbyUrl.pathname).toBe("/api/v3/areas/nearby");
    expect([...nearbyUrl.searchParams.keys()]).toEqual([
      "cell",
      "schemaVersion",
      "asOf",
      "knownAt",
      "limit",
    ]);
    expect(nearbyUrl.searchParams.get("cell")).toBe("wm/10/518/352");
    expect(nearbyPath).toContain("cell=wm%2F10%2F518%2F352");
    expect(nearbyPath).not.toMatch(/lat|lon|latitude|longitude|bounds|timezone/iu);

    const exploreUrl = new URL(
      buildGlobalDiscoveryRequestPath(exploreRequest()),
      "https://firewatch.invalid",
    );
    expect(exploreUrl.pathname).toBe("/api/v3/explore/cells");
    expect(exploreUrl.searchParams.get("limit")).toBe("50");
  });

  it("rejects noncanonical cells before fetch", async () => {
    const request = copy(parisRequest()) as NearbyDiscoveryRequest;
    request.cell = "wm/010/0518/0352";
    const fetch = vi.fn<GlobalDiscoveryFetch>();
    const client = createHttpGlobalDiscoveryClient({ fetch });
    expect((await client.nearbyIncidents(request)).kind).toBe("invalid-request");
    expect(fetch).not.toHaveBeenCalled();
  });

  it("sends opaque continuation cursors but never caches continuation pages", async () => {
    const request = exploreDiscoveryRequestSchema.parse({
      ...exploreRequest(),
      page: { limit: 50, after: "continuation_cursor_v1" },
    });
    const response: ExploreDiscoveryResponse = copy(
      SYNTHETIC_MARSEILLE_EXPLORE,
    );
    response.page.isFirstPage = false;
    const calls: Array<Readonly<{ path: string; init: RequestInit }>> = [];
    const client = createHttpGlobalDiscoveryClient({
      fetch: async (path, init) => {
        calls.push({ path, init });
        if (calls.length === 1) {
          return jsonResponse(response, {
            status: 200,
            headers: {
              ETag: '"continuation-v1"',
              "Cache-Control": "private, no-cache",
            },
          });
        }
        throw new TypeError("offline");
      },
    });

    expect((await client.exploreCandidates(request)).kind).toBe("snapshot");
    expect((await client.exploreCandidates(request)).kind).toBe("unavailable");
    expect(new URL(calls[0]!.path, "https://firewatch.invalid").searchParams.get("after")).toBe(
      "continuation_cursor_v1",
    );
    expect(new Headers(calls[1]?.init.headers).has("if-none-match")).toBe(false);
  });

  it("performs exact-key ETag revalidation without exposing custom headers", async () => {
    const calls: Array<Readonly<{ path: string; init: RequestInit }>> = [];
    const fetch: GlobalDiscoveryFetch = async (path, init) => {
      calls.push({ path, init });
      if (calls.length === 1) {
        return jsonResponse(SYNTHETIC_PARIS_VALID_EMPTY, {
          status: 200,
          headers: {
            ETag: '"paris-v1"',
            "Cache-Control": "private, no-cache",
          },
        });
      }
      if (calls.length === 2) {
        return new Response(null, {
          status: 304,
          headers: { ETag: '"paris-v1"' },
        });
      }
      return new Response(null, { status: 304 });
    };
    const client = createHttpGlobalDiscoveryClient({ fetch });

    const first = await client.nearbyIncidents(parisRequest());
    expect(first.kind).toBe("snapshot");
    if (first.kind !== "snapshot") throw new Error("Expected live snapshot");
    expect(first.transport).toBe("live");
    first.data.scope.timeZone = "UTC";

    const second = await client.nearbyIncidents(parisRequest());
    expect(second.kind).toBe("snapshot");
    if (second.kind !== "snapshot") throw new Error("Expected cached snapshot");
    expect(second.transport).toBe("revalidated-cache");
    expect(second.data.scope.timeZone).toBe("Europe/Paris");

    const secondHeaders = new Headers(calls[1]?.init.headers);
    expect(secondHeaders.get("if-none-match")).toBe('"paris-v1"');
    expect(secondHeaders.has("authorization")).toBe(false);
    expect(calls[0]?.init).toMatchObject({
      method: "GET",
      credentials: "same-origin",
      mode: "same-origin",
      redirect: "error",
      cache: "no-store",
    });

    const missingValidator = await client.nearbyIncidents(parisRequest());
    expect(missingValidator.kind).toBe("invalid-response");
  });

  it("uses last-good data only for the exact historical request key", async () => {
    let shouldFail = false;
    const calls: string[] = [];
    const fetch: GlobalDiscoveryFetch = async (path) => {
      calls.push(path);
      if (shouldFail) throw new TypeError("offline");
      return jsonResponse(SYNTHETIC_PARIS_VALID_EMPTY, {
        status: 200,
        headers: {
          ETag: '"paris-history-v1"',
          "Cache-Control": "private, no-cache",
        },
      });
    };
    const client = createHttpGlobalDiscoveryClient({ fetch });
    expect((await client.nearbyIncidents(parisRequest())).kind).toBe("snapshot");

    shouldFail = true;
    const exactFallback = await client.nearbyIncidents(parisRequest());
    expect(exactFallback.kind).toBe("snapshot");
    if (exactFallback.kind === "snapshot") {
      expect(exactFallback.transport).toBe("cache-fallback");
    }

    const earlier = copy(parisRequest());
    earlier.time.asOf = "2026-07-31T14:59:59.999Z";
    expect((await client.nearbyIncidents(earlier)).kind).toBe("unavailable");
    expect(calls[1]).toBe(calls[0]);
    expect(calls[2]).not.toBe(calls[0]);
  });

  it("purges manual fallback data when a newer response forbids storage", async () => {
    const calls: RequestInit[] = [];
    let pass = 0;
    const client = createHttpGlobalDiscoveryClient({
      fetch: async (_path, init) => {
        calls.push(init);
        pass += 1;
        if (pass === 1) {
          return jsonResponse(SYNTHETIC_PARIS_VALID_EMPTY, {
            status: 200,
            headers: {
              ETag: '"paris-cacheable"',
              "Cache-Control": "private, no-cache",
            },
          });
        }
        if (pass === 2) {
          return jsonResponse(SYNTHETIC_PARIS_VALID_EMPTY, {
            status: 200,
            headers: {
              ETag: '"paris-private"',
              "Cache-Control": "No-Store",
            },
          });
        }
        throw new TypeError("offline");
      },
    });

    expect((await client.nearbyIncidents(parisRequest())).kind).toBe(
      "snapshot",
    );
    expect((await client.nearbyIncidents(parisRequest())).kind).toBe(
      "snapshot",
    );
    expect((await client.nearbyIncidents(parisRequest())).kind).toBe(
      "unavailable",
    );
    expect(new Headers(calls[1]?.headers).get("if-none-match")).toBe(
      '"paris-cacheable"',
    );
    expect(new Headers(calls[2]?.headers).has("if-none-match")).toBe(false);
  });

  it("never conditions or falls back from a weak ETag", async () => {
    const calls: RequestInit[] = [];
    let first = true;
    const client = createHttpGlobalDiscoveryClient({
      fetch: async (_path, init) => {
        calls.push(init);
        if (first) {
          first = false;
          return jsonResponse(SYNTHETIC_PARIS_VALID_EMPTY, {
            status: 200,
            headers: {
              ETag: 'W/"paris-weak"',
              "Cache-Control": "private, no-cache",
            },
          });
        }
        throw new TypeError("offline");
      },
    });

    expect((await client.nearbyIncidents(parisRequest())).kind).toBe(
      "snapshot",
    );
    expect((await client.nearbyIncidents(parisRequest())).kind).toBe(
      "unavailable",
    );
    expect(new Headers(calls[1]?.headers).has("if-none-match")).toBe(false);
  });

  it("fails closed on scope, history, media-type, and 304 binding errors", async () => {
    const wrongScopeClient = createHttpGlobalDiscoveryClient({
      fetch: async () => jsonResponse(SYNTHETIC_PLOMARI_NEARBY),
    });
    expect((await wrongScopeClient.nearbyIncidents(parisRequest())).kind).toBe(
      "invalid-response",
    );

    const future = copy(SYNTHETIC_MARSEILLE_EXPLORE);
    const candidate = future.candidates[0];
    if (!candidate) throw new Error("Missing Marseille candidate");
    candidate.times.latestObservedAt = {
      precision: "exact",
      instant: "2026-07-31T17:00:00.001Z",
    };
    candidate.times.knownAt = "2026-07-31T17:01:00.000Z";
    const futureClient = createHttpGlobalDiscoveryClient({
      fetch: async () => jsonResponse(future),
    });
    expect((await futureClient.exploreCandidates(exploreRequest())).kind).toBe(
      "invalid-response",
    );

    const wrongTypeClient = createHttpGlobalDiscoveryClient({
      fetch: async () =>
        new Response(JSON.stringify(SYNTHETIC_PARIS_VALID_EMPTY), {
          status: 200,
          headers: { "content-type": "text/plain" },
        }),
    });
    expect((await wrongTypeClient.nearbyIncidents(parisRequest())).kind).toBe(
      "invalid-response",
    );

    const empty304Client = createHttpGlobalDiscoveryClient({
      fetch: async () => new Response(null, { status: 304 }),
    });
    expect((await empty304Client.nearbyIncidents(parisRequest())).kind).toBe(
      "invalid-response",
    );
  });

  it("keeps domain coverage distinct from transport failure", async () => {
    const stale: ExploreDiscoveryResponse = copy(SYNTHETIC_MARSEILLE_EXPLORE);
    stale.coverage = {
      state: "stale",
      policyVersion: GLOBAL_DISCOVERY_POLICY_VERSION,
      scope: copy(SYNTHETIC_MARSEILLE_EXPLORE.coverage.scope),
      checkedAt: "2026-07-31T17:04:00.000Z",
      freshnessDeadline: "2026-07-31T16:45:00.000Z",
      coveredEventWindow: {
        from: "2026-07-30T17:00:00.000Z",
        through: "2026-07-31T17:00:00.000Z",
      },
      lastCompleteAt: "2026-07-31T16:30:00.000Z",
      requiredPartitionCount: 3,
      completedPartitionCount: 3,
    };
    const client = createHttpGlobalDiscoveryClient({
      fetch: async () => jsonResponse(stale),
    });
    const result = await client.exploreCandidates(exploreRequest());
    expect(result.kind).toBe("snapshot");
    if (result.kind === "snapshot") {
      expect(result.data.coverage.state).toBe("stale");
    }
  });

  it("never promotes misconfigured partial coverage into last-good fallback", async () => {
    const partial: ExploreDiscoveryResponse = copy(
      SYNTHETIC_MARSEILLE_EXPLORE,
    );
    partial.coverage = {
      state: "partial",
      policyVersion: GLOBAL_DISCOVERY_POLICY_VERSION,
      scope: copy(SYNTHETIC_MARSEILLE_EXPLORE.coverage.scope),
      checkedAt: "2026-07-31T17:04:00.000Z",
      requiredPartitionCount: 3,
      completedPartitionCount: 2,
    };
    let first = true;
    const client = createHttpGlobalDiscoveryClient({
      fetch: async () => {
        if (first) {
          first = false;
          return jsonResponse(partial, {
            status: 200,
            headers: {
              ETag: '"misconfigured-partial"',
              "Cache-Control": "public, max-age=300",
            },
          });
        }
        throw new TypeError("offline");
      },
    });

    const live = await client.exploreCandidates(exploreRequest());
    expect(live.kind).toBe("snapshot");
    if (live.kind === "snapshot") {
      expect(live.data.coverage.state).toBe("partial");
    }
    expect((await client.exploreCandidates(exploreRequest())).kind).toBe(
      "unavailable",
    );
  });

  it("accepts not-assessed items without caching them as complete coverage", async () => {
    const notAssessed: ExploreDiscoveryResponse = copy(
      SYNTHETIC_MARSEILLE_EXPLORE,
    );
    notAssessed.coverage = {
      state: "not_assessed",
      policyVersion: GLOBAL_DISCOVERY_POLICY_VERSION,
      scope: copy(SYNTHETIC_MARSEILLE_EXPLORE.coverage.scope),
    };
    let first = true;
    const client = createHttpGlobalDiscoveryClient({
      fetch: async () => {
        if (first) {
          first = false;
          return jsonResponse(notAssessed, {
            status: 200,
            headers: {
              ETag: '"not-assessed"',
              "Cache-Control": "public, max-age=300",
            },
          });
        }
        throw new TypeError("offline");
      },
    });

    const live = await client.exploreCandidates(exploreRequest());
    expect(live.kind).toBe("snapshot");
    if (live.kind === "snapshot") {
      expect(live.data.coverage.state).toBe("not_assessed");
      expect(live.data.candidates).toHaveLength(1);
    }
    expect((await client.exploreCandidates(exploreRequest())).kind).toBe(
      "unavailable",
    );
  });

  it("does not fetch or fall back after caller cancellation", async () => {
    const fetch = vi.fn<GlobalDiscoveryFetch>();
    const client = createHttpGlobalDiscoveryClient({ fetch });
    const controller = new AbortController();
    controller.abort();
    const result = await client.nearbyIncidents(parisRequest(), {
      signal: controller.signal,
    });
    expect(result).toEqual({ kind: "cancelled", retryable: false });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("does not return exact-key fallback when cancellation wins a response race", async () => {
    const controller = new AbortController();
    let pass = 0;
    const client = createHttpGlobalDiscoveryClient({
      fetch: async () => {
        pass += 1;
        if (pass === 1) {
          return jsonResponse(SYNTHETIC_PARIS_VALID_EMPTY, {
            status: 200,
            headers: {
              ETag: '"paris-cancel-race"',
              "Cache-Control": "private, no-cache",
            },
          });
        }
        controller.abort();
        return new Response(null, { status: 503 });
      },
    });
    expect((await client.nearbyIncidents(parisRequest())).kind).toBe(
      "snapshot",
    );
    expect(
      await client.nearbyIncidents(parisRequest(), {
        signal: controller.signal,
      }),
    ).toEqual({ kind: "cancelled", retryable: false });
  });
});
