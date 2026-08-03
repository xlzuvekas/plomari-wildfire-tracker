import { Buffer } from "node:buffer";

import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

import { GET } from "../app/api/v3/shadow/sources/route";
import {
  readPostgrestRows,
  readPostgrestRpcRows,
  SupabasePostgrestReadError,
} from "../lib/supabase/postgrest";
import { sourceCatalogRowSchema } from "../lib/supabase/source-read-model";
import {
  readSupabaseDiscoveryReaderApiKey,
  readSupabaseServerEnvironment,
  SupabaseServerConfigurationError,
  type SupabaseServerEnvironment,
} from "../lib/supabase/server-env";

const TEST_PROJECT_REF = "abcdefghijklmnopqrst";
const TEST_ENVIRONMENT: SupabaseServerEnvironment = Object.freeze({
  url: `https://${TEST_PROJECT_REF}.supabase.co`,
  publishableKey: "test-publishable-key-1234",
});

function legacyDiscoveryReaderJwt(
  payload: Readonly<Record<string, unknown>> = {},
  header: Readonly<Record<string, unknown>> = {},
) {
  const now = Math.floor(Date.now() / 1_000);
  const encode = (value: unknown) =>
    Buffer.from(JSON.stringify(value), "utf8").toString("base64url");
  return [
    encode({ alg: "HS256", typ: "JWT", ...header }),
    encode({
      iss: "supabase",
      ref: TEST_PROJECT_REF,
      role: "firewatch_discovery_reader",
      iat: now - 60,
      exp: now + 3_600,
      ...payload,
    }),
    Buffer.alloc(32, 1).toString("base64url"),
  ].join(".");
}

const CATALOG_ROW = {
  source_id: "018f0000-0000-7000-8000-000000000101",
  contract_version: "1.1.0",
  provider_id: "018f0000-0000-7000-8000-000000000001",
  provider_contract_version: "1.1.0",
  provider_slug: "nasa",
  provider_name: "NASA",
  slug: "nasa-firms",
  name: "NASA FIRMS Active Fire Data",
  description: "Satellite thermal detections.",
  product_family: "active_fire",
  default_trust_class: "official_observation",
  default_evidence_class: "thermal_detection",
  operational_scope: "mixed",
  homepage_url: "https://firms.modaps.eosdis.nasa.gov/",
  terms_url: null,
  license_code: "provider_terms",
  license_name: null,
  attribution_text: null,
  license_status: "unreviewed",
  commercial_use_allowed: null,
  redistribution_allowed: null,
  default_freshness: "00:15:00",
  default_max_staleness: "03:00:00",
  enabled: false,
  updated_at: "2026-07-30T00:00:00+00:00",
} as const;

const HEALTH_ROW = {
  health_id: "018f0000-0000-7000-8000-000000000601",
  source_id: CATALOG_ROW.source_id,
  source_slug: CATALOG_ROW.slug,
  collection_target_id: "018f0000-0000-7000-8000-000000000401",
  collection_target_name: "FIRMS global discovery",
  status: "healthy",
  circuit_state: "closed",
  checked_at: "2026-07-30T01:00:00+00:00",
  last_success_at: "2026-07-30T00:59:00+00:00",
  last_payload_changed_at: "2026-07-30T00:58:00+00:00",
  latest_source_observed_at: "2026-07-30T00:57:00+00:00",
  consecutive_failures: 0,
  error_class: null,
  source_lag: "00:02:00",
  fetch_latency_ms: 125,
  error_rate: 0,
  duplicate_ratio: 0,
  geographic_completeness: 1,
  schema_failure_count: 0,
  rate_limit_resets_at: null,
} as const;

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("server-only Supabase environment", () => {
  it("accepts HTTPS and local HTTP origins and normalizes trailing slashes", () => {
    expect(
      readSupabaseServerEnvironment({
        SUPABASE_URL: `${TEST_ENVIRONMENT.url}/`,
        SUPABASE_PUBLISHABLE_KEY: TEST_ENVIRONMENT.publishableKey,
      }),
    ).toEqual(TEST_ENVIRONMENT);

    expect(
      readSupabaseServerEnvironment({
        SUPABASE_URL: "http://127.0.0.1:54321/",
        SUPABASE_PUBLISHABLE_KEY: TEST_ENVIRONMENT.publishableKey,
      }).url,
    ).toBe("http://127.0.0.1:54321");
  });

  it("accepts the preferred dedicated secret API-key format", () => {
    const key = `sb_secret_${"a".repeat(48)}`;
    expect(
      readSupabaseDiscoveryReaderApiKey({
        SUPABASE_DISCOVERY_READER_KEY: key,
      }),
    ).toBe(key);

    for (const invalid of [
      `sb_publishable_${"a".repeat(48)}`,
      "sb_secret_too-short",
    ]) {
      expect(() =>
        readSupabaseDiscoveryReaderApiKey({
          SUPABASE_DISCOVERY_READER_KEY: invalid,
        }),
      ).toThrow(SupabaseServerConfigurationError);
    }
  });

  it("accepts only a currently valid legacy HS256 JWT for the reader role", () => {
    const valid = legacyDiscoveryReaderJwt();
    expect(
      readSupabaseDiscoveryReaderApiKey({
        SUPABASE_URL: TEST_ENVIRONMENT.url,
        SUPABASE_DISCOVERY_READER_KEY: valid,
      }),
    ).toBe(valid);
    expect(
      readSupabaseDiscoveryReaderApiKey({
        SUPABASE_DISCOVERY_READER_KEY: valid,
      }),
    ).toBe(valid);

    const now = Math.floor(Date.now() / 1_000);
    for (const invalid of [
      legacyDiscoveryReaderJwt({ role: "anon" }),
      legacyDiscoveryReaderJwt({ role: "authenticated" }),
      legacyDiscoveryReaderJwt({ role: "service_role" }),
      legacyDiscoveryReaderJwt({ role: "firewatch_publisher" }),
      legacyDiscoveryReaderJwt({ iss: "not-supabase" }),
      legacyDiscoveryReaderJwt({ ref: "abcdefghijklmnopqrs1" }),
      legacyDiscoveryReaderJwt({ exp: now }),
      legacyDiscoveryReaderJwt({ nbf: now + 60 }),
      legacyDiscoveryReaderJwt({ iat: now + 31 }),
      legacyDiscoveryReaderJwt({ iat: undefined }),
      legacyDiscoveryReaderJwt({ exp: undefined }),
      legacyDiscoveryReaderJwt({ exp: "not-a-timestamp" }),
      legacyDiscoveryReaderJwt({ iat: now, exp: now + 31 * 86_400 + 1 }),
      legacyDiscoveryReaderJwt({ exp: now + 3_600, nbf: now + 3_600 }),
      legacyDiscoveryReaderJwt({}, { alg: "none" }),
      `${valid.split(".").slice(0, 2).join(".")}.abc`,
      `${valid}.extra`,
      "not-a-jwt",
    ]) {
      expect(() =>
        readSupabaseDiscoveryReaderApiKey({
          SUPABASE_DISCOVERY_READER_KEY: invalid,
        }),
      ).toThrow(SupabaseServerConfigurationError);
    }

    expect(() =>
      readSupabaseDiscoveryReaderApiKey({
        SUPABASE_URL: "https://bcdefghijklmnopqrstu.supabase.co",
        SUPABASE_DISCOVERY_READER_KEY: valid,
      }),
    ).toThrow(SupabaseServerConfigurationError);
  });

  it("fails closed without disclosing invalid environment values", () => {
    const invalidKey = "sensitive-but-invalid";

    expect(() =>
      readSupabaseServerEnvironment({
        SUPABASE_URL: "http://remote.example.com/unsafe",
        SUPABASE_PUBLISHABLE_KEY: invalidKey,
      }),
    ).toThrow(SupabaseServerConfigurationError);

    try {
      readSupabaseServerEnvironment({
        SUPABASE_URL: "http://remote.example.com/unsafe",
        SUPABASE_PUBLISHABLE_KEY: invalidKey,
      });
    } catch (error) {
      expect(String(error)).not.toContain(invalidKey);
      expect(String(error)).not.toContain("remote.example.com");
    }
  });
});

describe("typed api-schema PostgREST reads", () => {
  it("uses only the publishable apikey and validates the response with Zod", async () => {
    const fetchMock = vi.fn(async (...arguments_: Parameters<typeof fetch>) => {
      void arguments_;
      return Response.json([CATALOG_ROW]);
    });

    const rows = await readPostgrestRows({
      environment: TEST_ENVIRONMENT,
      fetchImpl: fetchMock as typeof fetch,
      resource: "source_catalog",
      query: { select: "source_id,slug", limit: "1" },
      rowSchema: sourceCatalogRowSchema,
    });

    expect(rows[0]?.updated_at).toBe("2026-07-30T00:00:00.000Z");
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const call = fetchMock.mock.calls[0];
    expect(call).toBeDefined();
    const [input, init] = call ?? [];
    const url = new URL(String(input));
    const headers = new Headers(init?.headers);

    expect(url.origin).toBe(TEST_ENVIRONMENT.url);
    expect(url.pathname).toBe("/rest/v1/source_catalog");
    expect(url.searchParams.get("select")).toBe("source_id,slug");
    expect(url.searchParams.get("limit")).toBe("1");
    expect(headers.get("accept-profile")).toBe("api");
    expect(headers.get("apikey")).toBe(TEST_ENVIRONMENT.publishableKey);
    expect(headers.has("authorization")).toBe(false);
    expect(init?.cache).toBe("no-store");
  });

  it("adds a bearer header only for the validated legacy reader JWT", async () => {
    const jwt = legacyDiscoveryReaderJwt();
    const secret = `sb_secret_${"a".repeat(48)}`;
    const fetchMock = vi.fn<typeof fetch>(async () => Response.json([]));

    for (const apiKey of [jwt, secret]) {
      await readPostgrestRpcRows({
        environment: TEST_ENVIRONMENT,
        fetchImpl: fetchMock,
        rpc: "explore_candidate_cells_v3",
        query: {},
        rowSchema: z.object({}),
        apiKey,
      });
    }

    const jwtHeaders = new Headers(fetchMock.mock.calls[0]?.[1]?.headers);
    expect(jwtHeaders.get("apikey")).toBe(TEST_ENVIRONMENT.publishableKey);
    expect(jwtHeaders.get("authorization")).toBe(`Bearer ${jwt}`);

    const secretHeaders = new Headers(fetchMock.mock.calls[1]?.[1]?.headers);
    expect(secretHeaders.get("apikey")).toBe(secret);
    expect(secretHeaders.has("authorization")).toBe(false);
  });

  it("cancels a chunked response as soon as its streaming byte bound is exceeded", async () => {
    const encoder = new TextEncoder();
    let cancelled = false;
    let pullCount = 0;
    const response = new Response(
      new ReadableStream<Uint8Array>({
        pull(controller) {
          controller.enqueue(
            encoder.encode(
              pullCount++ === 0 ? '[{"source_id":"' : "x".repeat(256),
            ),
          );
        },
        cancel() {
          cancelled = true;
        },
      }),
      { headers: { "content-type": "application/json" } },
    );
    await expect(
      readPostgrestRows({
        environment: TEST_ENVIRONMENT,
        fetchImpl: async () => response,
        resource: "source_catalog",
        query: {},
        rowSchema: sourceCatalogRowSchema,
        maxResponseBytes: 32,
      }),
    ).rejects.toMatchObject({ code: "invalid_response" });
    expect(cancelled).toBe(true);
  });

  it("rejects malformed rows without surfacing the response body", async () => {
    const marker = "upstream-private-detail";
    const fetchMock = vi.fn(async () =>
      Response.json([{ ...CATALOG_ROW, source_id: marker }]),
    );

    await expect(
      readPostgrestRows({
        environment: TEST_ENVIRONMENT,
        fetchImpl: fetchMock as typeof fetch,
        resource: "source_catalog",
        query: { select: "*" },
        rowSchema: sourceCatalogRowSchema,
      }),
    ).rejects.toMatchObject({ code: "invalid_response" });

    try {
      await readPostgrestRows({
        environment: TEST_ENVIRONMENT,
        fetchImpl: fetchMock as typeof fetch,
        resource: "source_catalog",
        query: { select: "*" },
        rowSchema: sourceCatalogRowSchema,
      });
    } catch (error) {
      expect(String(error)).not.toContain(marker);
    }
  });

  it("aborts bounded reads and reports a safe timeout", async () => {
    const fetchMock = vi.fn(
      (_input: Parameters<typeof fetch>[0], init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener(
            "abort",
            () => reject(new DOMException("aborted", "AbortError")),
            { once: true },
          );
        }),
    );

    await expect(
      readPostgrestRows({
        environment: TEST_ENVIRONMENT,
        fetchImpl: fetchMock as typeof fetch,
        timeoutMs: 5,
        resource: "source_health",
        query: { select: "source_id" },
        rowSchema: z.strictObject({ source_id: z.string() }),
      }),
    ).rejects.toEqual(new SupabasePostgrestReadError("timeout"));
  });
});

function configureRouteEnvironment() {
  vi.stubEnv("SUPABASE_URL", TEST_ENVIRONMENT.url);
  vi.stubEnv(
    "SUPABASE_PUBLISHABLE_KEY",
    TEST_ENVIRONMENT.publishableKey,
  );
}

function installRouteFetch() {
  const fetchMock = vi.fn(
    async (input: Parameters<typeof fetch>[0]) => {
      const url = new URL(String(input));
      if (url.pathname.endsWith("/source_catalog")) {
        return Response.json([CATALOG_ROW]);
      }
      if (url.pathname.endsWith("/source_health")) {
        return Response.json([HEALTH_ROW]);
      }
      return Response.json({ error: "unexpected test route" }, { status: 404 });
    },
  );
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

describe("GET /api/v3/shadow/sources", () => {
  it("returns deterministic global catalog and health data with CDN caching", async () => {
    configureRouteEnvironment();
    const fetchMock = installRouteFetch();

    const response = await GET(
      new Request("http://localhost/api/v3/shadow/sources"),
    );
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toContain("s-maxage=30");
    expect(response.headers.get("etag")).toMatch(/^"[A-Za-z0-9_-]+"$/);
    expect(payload).toMatchObject({
      schemaVersion: 3,
      mode: "shadow",
      scope: "global-targets",
      asOf: "2026-07-30T01:00:00.000Z",
      items: [
        {
          source: {
            id: CATALOG_ROW.source_id,
            key: CATALOG_ROW.slug,
            provider: { key: CATALOG_ROW.provider_slug },
          },
          target: { id: HEALTH_ROW.collection_target_id },
          health: {
            sampleId: HEALTH_ROW.health_id,
            state: "healthy",
            latestSourceObservedAt: "2026-07-30T00:57:00.000Z",
          },
        },
      ],
      page: { nextCursor: null },
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);

    const etag = response.headers.get("etag");
    expect(etag).not.toBeNull();
    const conditional = await GET(
      new Request("http://localhost/api/v3/shadow/sources", {
        headers: { "If-None-Match": etag ?? "" },
      }),
    );
    expect(conditional.status).toBe(304);
    expect(await conditional.text()).toBe("");
  });

  it.each(["1", "100"])(
    "accepts the canonical limit boundary %s",
    async (limit) => {
      configureRouteEnvironment();
      const fetchMock = installRouteFetch();

      const response = await GET(
        new Request(
          `http://localhost/api/v3/shadow/sources?limit=${limit}`,
        ),
      );

      expect(response.status).toBe(200);
      const healthCall = fetchMock.mock.calls.find(([input]) =>
        new URL(String(input)).pathname.endsWith("/source_health"),
      );
      expect(healthCall).toBeDefined();
      expect(new URL(String(healthCall?.[0])).searchParams.get("limit")).toBe(
        String(Number(limit) + 1),
      );
    },
  );

  it("fails closed and skips the network when server configuration is absent", async () => {
    vi.stubEnv("SUPABASE_URL", "");
    vi.stubEnv("SUPABASE_PUBLISHABLE_KEY", "");
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const response = await GET(
      new Request("http://localhost/api/v3/shadow/sources"),
    );
    const body = await response.text();

    expect(response.status).toBe(503);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(body).toContain("read_model_unavailable");
    expect(body).not.toContain("SUPABASE_URL");
    expect(body).not.toContain("SUPABASE_PUBLISHABLE_KEY");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns a generic uncached error without relaying PostgREST details", async () => {
    configureRouteEnvironment();
    const marker = "database-private-detail";
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json({ message: marker }, { status: 500 })),
    );

    const response = await GET(
      new Request("http://localhost/api/v3/shadow/sources"),
    );
    const body = await response.text();

    expect(response.status).toBe(503);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(body).toContain("read_model_unavailable");
    expect(body).not.toContain(marker);
  });

  it("fails closed when source projection expands beyond the public response ceiling", async () => {
    configureRouteEnvironment();
    const uuidAt = (sequence: number) =>
      `018f0000-0000-7000-8000-${sequence.toString(16).padStart(12, "0")}`;
    const healthRows = Array.from({ length: 100 }, (_, index) => ({
      ...HEALTH_ROW,
      health_id: uuidAt(0x700 + index),
      collection_target_id: uuidAt(0x900 + index),
      collection_target_name: `Global target ${index + 1}`,
    }));
    const marker = "oversized-public-marker";
    const catalogRow = {
      ...CATALOG_ROW,
      homepage_url: `https://example.com/${marker}/${"x".repeat(12_000)}`,
    };
    const fetchMock = vi.fn(
      async (input: Parameters<typeof fetch>[0]) => {
        const url = new URL(String(input));
        if (url.pathname.endsWith("/source_health")) {
          return Response.json(healthRows);
        }
        if (url.pathname.endsWith("/source_catalog")) {
          return Response.json([catalogRow]);
        }
        return Response.json(
          { error: "unexpected test route" },
          { status: 404 },
        );
      },
    );
    vi.stubGlobal("fetch", fetchMock);

    const response = await GET(
      new Request("http://localhost/api/v3/shadow/sources?limit=100"),
    );
    const body = await response.text();

    expect(response.status).toBe(503);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("etag")).toBeNull();
    expect(body).toContain("read_model_unavailable");
    expect(body).not.toContain(marker);
    expect(body.length).toBeLessThan(1_000);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("rejects malformed, repeated, and unknown query parameters before fetching", async () => {
    configureRouteEnvironment();
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const paths = [
      "/api/v3/shadow/sources?limit=101",
      "/api/v3/shadow/sources?limit=01",
      "/api/v3/shadow/sources?limit=1.0",
      "/api/v3/shadow/sources?limit=1e1",
      "/api/v3/shadow/sources?limit=%2B1",
      "/api/v3/shadow/sources?limit=1%20",
      "/api/v3/shadow/sources?limit=1&limit=2",
      "/api/v3/shadow/sources?unknown=true",
      "/api/v3/shadow/sources?after=not-a-cursor",
    ];

    for (const path of paths) {
      const response = await GET(new Request(`http://localhost${path}`));
      expect(response.status).toBe(400);
      expect(response.headers.get("cache-control")).toBe("no-store");
      expect(await response.text()).toContain("invalid_request");
    }

    expect(fetchMock).not.toHaveBeenCalled();
  });
});
