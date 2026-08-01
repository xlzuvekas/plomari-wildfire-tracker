import { createHash } from "node:crypto";

import { afterEach, describe, expect, it, vi } from "vitest";

import { GET } from "../app/api/v3/thermal-anomalies/route";
import {
  admitThermalAnomalyRequest,
  ThermalAdmissionUnavailableError,
  type ThermalAdmissionEnvironmentInput,
} from "../lib/firewatch/v3/thermal-anomaly-admission.server";

const ENVIRONMENT: ThermalAdmissionEnvironmentInput = {
  VERCEL: "1",
  VERCEL_ENV: "preview",
  VERCEL_URL: "firewatch-review-123.vercel.app",
  VERCEL_DEPLOYMENT_ID: `dpl_${"a".repeat(24)}`,
  FIREWATCH_THERMAL_V3_ADMISSION_ENABLED: "true",
  FIREWATCH_THERMAL_V3_ACCESS_MODE: "public",
  FIREWATCH_THERMAL_ADMISSION_REDIS_URL: "https://redis.example.com",
  FIREWATCH_THERMAL_ADMISSION_REDIS_TOKEN: "redis-test-token-value",
  FIREWATCH_THERMAL_ADMISSION_IDENTITY_SECRET: "i".repeat(48),
  FIREWATCH_THERMAL_ADMISSION_BURST_LIMIT: "6",
  FIREWATCH_THERMAL_ADMISSION_BURST_WINDOW_SECONDS: "10",
  FIREWATCH_THERMAL_ADMISSION_SUSTAINED_LIMIT: "60",
  FIREWATCH_THERMAL_ADMISSION_SUSTAINED_WINDOW_SECONDS: "600",
  FIREWATCH_THERMAL_ADMISSION_GLOBAL_CONCURRENCY: "2",
  FIREWATCH_THERMAL_ADMISSION_LEASE_SECONDS: "12",
  FIREWATCH_THERMAL_ADMISSION_TIMEOUT_MS: "500",
};
const LEASE_TOKEN = "e366b981-01f4-4f7c-8bbd-6368bd2a3215";
const CANARY_TOKEN = "c".repeat(43);
const CANARY_TOKEN_SHA256 = createHash("sha256")
  .update(CANARY_TOKEN, "ascii")
  .digest("hex");

function request(
  ip = "203.0.113.42",
  headers: Readonly<Record<string, string>> = {},
) {
  return new Request("https://firewatch.test/api/v3/thermal-anomalies", {
    headers: {
      "x-forwarded-for": ip,
      "x-vercel-forwarded-for": ip,
      "x-real-ip": ip,
      ...headers,
    },
  });
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("thermal v3 distributed admission", () => {
  it("atomically acquires and idempotently releases a pseudonymous global lease", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async (input, init) => {
      expect(String(input)).toBe("https://redis.example.com");
      expect(init).toMatchObject({
        method: "POST",
        cache: "no-store",
        redirect: "error",
      });
      const headers = new Headers(init?.headers);
      expect(headers.get("authorization")).toBe(
        "Bearer redis-test-token-value",
      );
      const command = JSON.parse(String(init?.body)) as unknown[];
      expect(command[0]).toBe("EVAL");
      expect(String(command)).not.toContain("203.0.113.42");
      if (fetchImpl.mock.calls.length === 1) {
        expect(String(command[1])).toContain("ZREMRANGEBYSCORE");
        expect(String(command[1])).toContain("ZCARD");
        expect(command.slice(-7)).toEqual([
          "6",
          "10000",
          "60",
          "600000",
          "2",
          "12000",
          LEASE_TOKEN,
        ]);
        expect(String(command[3])).toMatch(
          /^firewatch:thermal:v3:preview:burst:[a-f0-9]{64}$/u,
        );
        return Response.json({ result: [1, "admitted", 12_000] });
      }
      expect(String(command[1])).toContain("ZREM");
      expect(command.slice(-2)).toEqual([
        "firewatch:thermal:v3:preview:leases",
        LEASE_TOKEN,
      ]);
      return Response.json({ result: 1 });
    });

    const decision = await admitThermalAnomalyRequest(request(), {
      environment: ENVIRONMENT,
      fetchImpl,
      createLeaseToken: () => LEASE_TOKEN,
    });
    expect(decision.kind).toBe("admitted");
    if (decision.kind !== "admitted") throw new Error("Expected admission");
    await decision.lease.release();
    await decision.lease.release();
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("accepts Vercel Upstash REST aliases and uses only the write token", async () => {
    const upstashEnvironment: ThermalAdmissionEnvironmentInput = {
      ...ENVIRONMENT,
      FIREWATCH_THERMAL_ADMISSION_REDIS_URL: undefined,
      FIREWATCH_THERMAL_ADMISSION_REDIS_TOKEN: undefined,
      FIREWATCH_THERMAL_ADMISSION_REDIS_KV_REST_API_URL:
        "https://admission-redis.example.com",
      FIREWATCH_THERMAL_ADMISSION_REDIS_KV_REST_API_TOKEN:
        "upstash-write-token-value",
      FIREWATCH_THERMAL_ADMISSION_REDIS_KV_REST_API_READ_ONLY_TOKEN:
        "upstash-read-only-token-value",
      FIREWATCH_THERMAL_ADMISSION_REDIS_KV_URL:
        "rediss://default:secret@admission-redis.example.com:6379",
      FIREWATCH_THERMAL_ADMISSION_REDIS_REDIS_URL:
        "redis://default:secret@admission-redis.example.com:6379",
    };
    const fetchImpl = vi.fn<typeof fetch>(async (input, init) => {
      expect(String(input)).toBe("https://admission-redis.example.com");
      expect(new Headers(init?.headers).get("authorization")).toBe(
        "Bearer upstash-write-token-value",
      );
      return Response.json({ result: [0, "burst", 1_000] });
    });

    await expect(
      admitThermalAnomalyRequest(request(), {
        environment: upstashEnvironment,
        fetchImpl,
        createLeaseToken: () => LEASE_TOKEN,
      }),
    ).resolves.toMatchObject({ kind: "rejected", reason: "burst" });
    expect(fetchImpl).toHaveBeenCalledOnce();
  });

  it("fails closed for read-only, TCP-only, or conflicting Redis credentials", async () => {
    const fetchImpl = vi.fn<typeof fetch>();
    const cases: ThermalAdmissionEnvironmentInput[] = [
      {
        ...ENVIRONMENT,
        FIREWATCH_THERMAL_ADMISSION_REDIS_URL: undefined,
        FIREWATCH_THERMAL_ADMISSION_REDIS_TOKEN: undefined,
        FIREWATCH_THERMAL_ADMISSION_REDIS_KV_REST_API_URL:
          "https://admission-redis.example.com",
        FIREWATCH_THERMAL_ADMISSION_REDIS_KV_REST_API_READ_ONLY_TOKEN:
          "upstash-read-only-token-value",
        FIREWATCH_THERMAL_ADMISSION_REDIS_KV_URL:
          "rediss://default:secret@admission-redis.example.com:6379",
      },
      {
        ...ENVIRONMENT,
        FIREWATCH_THERMAL_ADMISSION_REDIS_URL: undefined,
        FIREWATCH_THERMAL_ADMISSION_REDIS_TOKEN: undefined,
        FIREWATCH_THERMAL_ADMISSION_REDIS_REDIS_URL:
          "redis://default:secret@admission-redis.example.com:6379",
      },
      {
        ...ENVIRONMENT,
        FIREWATCH_THERMAL_ADMISSION_REDIS_KV_REST_API_URL:
          "https://different-redis.example.com",
        FIREWATCH_THERMAL_ADMISSION_REDIS_KV_REST_API_TOKEN:
          ENVIRONMENT.FIREWATCH_THERMAL_ADMISSION_REDIS_TOKEN,
      },
      {
        ...ENVIRONMENT,
        FIREWATCH_THERMAL_ADMISSION_REDIS_KV_REST_API_URL:
          ENVIRONMENT.FIREWATCH_THERMAL_ADMISSION_REDIS_URL,
        FIREWATCH_THERMAL_ADMISSION_REDIS_KV_REST_API_TOKEN:
          "different-write-token-value",
      },
    ];

    for (const environment of cases) {
      await expect(
        admitThermalAnomalyRequest(request(), {
          environment,
          fetchImpl,
          createLeaseToken: () => LEASE_TOKEN,
        }),
      ).rejects.toEqual(new ThermalAdmissionUnavailableError());
    }
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it.each([
    ["burst", 1_001, 2],
    ["sustained", 1, 1],
    ["capacity", 9_000_000, 3_600],
  ] as const)(
    "returns bounded Retry-After data for %s rejection",
    async (reason, retryMilliseconds, retryAfterSeconds) => {
      const decision = await admitThermalAnomalyRequest(request(), {
        environment: ENVIRONMENT,
        createLeaseToken: () => LEASE_TOKEN,
        fetchImpl: async () =>
          Response.json({ result: [0, reason, retryMilliseconds] }),
      });
      expect(decision).toEqual({
        kind: "rejected",
        reason,
        retryAfterSeconds,
      });
    },
  );

  it("fails closed before Redis when deployment identity or configuration is untrusted", async () => {
    const fetchImpl = vi.fn<typeof fetch>();
    const cases = [
      {
        environment: { ...ENVIRONMENT, VERCEL: undefined },
        candidate: request(),
      },
      {
        environment: { ...ENVIRONMENT, VERCEL_URL: undefined },
        candidate: request(),
      },
      {
        environment: {
          ...ENVIRONMENT,
          VERCEL_DEPLOYMENT_ID: "caller-selected-value",
        },
        candidate: request(),
      },
      {
        environment: ENVIRONMENT,
        candidate: new Request("https://firewatch.test/"),
      },
      {
        environment: ENVIRONMENT,
        candidate: request("203.0.113.42, 198.51.100.4"),
      },
      {
        environment: {
          ...ENVIRONMENT,
          FIREWATCH_THERMAL_ADMISSION_SUSTAINED_WINDOW_SECONDS: "10",
        },
        candidate: request(),
      },
    ];

    for (const testCase of cases) {
      await expect(
        admitThermalAnomalyRequest(testCase.candidate, {
          environment: testCase.environment,
          fetchImpl,
          createLeaseToken: () => LEASE_TOKEN,
        }),
      ).rejects.toEqual(new ThermalAdmissionUnavailableError());
    }
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("requires a server-verified bearer token in canary mode", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async (_input, init) => {
      expect(String(init?.body)).not.toContain(CANARY_TOKEN);
      return Response.json({ result: [0, "burst", 1_000] });
    });
    const canaryEnvironment = {
      ...ENVIRONMENT,
      FIREWATCH_THERMAL_V3_ACCESS_MODE: "canary",
      FIREWATCH_THERMAL_V3_CANARY_TOKEN_SHA256: CANARY_TOKEN_SHA256,
    };

    await expect(
      admitThermalAnomalyRequest(
        request("203.0.113.42", {
          authorization: `Bearer ${CANARY_TOKEN}`,
        }),
        {
          environment: canaryEnvironment,
          fetchImpl,
          createLeaseToken: () => LEASE_TOKEN,
        },
      ),
    ).resolves.toMatchObject({ kind: "rejected", reason: "burst" });
    expect(fetchImpl).toHaveBeenCalledOnce();

    for (const authorization of [
      undefined,
      "Bearer wrong-token-value",
      `Bearer ${"d".repeat(43)}`,
    ]) {
      await expect(
        admitThermalAnomalyRequest(
          request(
            "203.0.113.42",
            authorization === undefined ? {} : { authorization },
          ),
          {
            environment: canaryEnvironment,
            fetchImpl,
            createLeaseToken: () => LEASE_TOKEN,
          },
        ),
      ).rejects.toEqual(new ThermalAdmissionUnavailableError());
    }
    expect(fetchImpl).toHaveBeenCalledOnce();
  });

  it("canonicalizes mapped IPv4 and groups rotating IPv6 addresses by /64", async () => {
    const burstKeys: string[] = [];
    const fetchImpl = vi.fn<typeof fetch>(async (_input, init) => {
      const command = JSON.parse(String(init?.body)) as unknown[];
      burstKeys.push(String(command[3]));
      return Response.json({ result: [0, "burst", 1_000] });
    });
    for (const ip of [
      "2001:0db8:abcd:0012::1",
      "2001:db8:abcd:12::dead",
      "2001:db8:abcd:13::1",
      "::ffff:192.0.2.1",
      "192.0.2.1",
    ]) {
      await admitThermalAnomalyRequest(request(ip), {
        environment: ENVIRONMENT,
        fetchImpl,
        createLeaseToken: () => LEASE_TOKEN,
      });
    }
    expect(burstKeys[0]).toBe(burstKeys[1]);
    expect(burstKeys[0]).not.toBe(burstKeys[2]);
    expect(burstKeys[3]).toBe(burstKeys[4]);
  });

  it("keeps the deployed route closed when admission is not explicitly enabled", async () => {
    const fetchImpl = vi.fn<typeof fetch>();
    const killSwitchEnvironment = {
      ...ENVIRONMENT,
      FIREWATCH_THERMAL_V3_ADMISSION_ENABLED: "false",
      FIREWATCH_THERMAL_V3_ACCESS_MODE: "canary",
      FIREWATCH_THERMAL_V3_CANARY_TOKEN_SHA256: CANARY_TOKEN_SHA256,
    };
    for (const [name, value] of Object.entries(killSwitchEnvironment)) {
      vi.stubEnv(name, value);
    }
    vi.stubGlobal("fetch", fetchImpl);
    vi.spyOn(console, "info").mockImplementation(() => undefined);
    const cutoff = new Date().toISOString();
    const response = await GET(
      new Request(
        `https://firewatch.test/api/v3/thermal-anomalies?cell=wm%2F10%2F587%2F391&schemaVersion=3&asOf=${encodeURIComponent(cutoff)}&knownAt=${encodeURIComponent(cutoff)}&limit=50`,
        {
          headers: {
            "x-forwarded-for": "203.0.113.42",
            "x-vercel-forwarded-for": "203.0.113.42",
            "x-real-ip": "203.0.113.42",
            authorization: `Bearer ${CANARY_TOKEN}`,
          },
        },
      ),
    );

    expect(response.status).toBe(503);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("fails closed on Redis transport, status, and shape errors", async () => {
    const fetches: Array<typeof fetch> = [
      async () => {
        throw new Error("network detail must not escape");
      },
      async () => Response.json({ error: "limited" }, { status: 429 }),
      async () => Response.json({ result: [1, "capacity", 1_000] }),
      async () => new Response("not-json"),
    ];

    for (const fetchImpl of fetches) {
      await expect(
        admitThermalAnomalyRequest(request(), {
          environment: ENVIRONMENT,
          fetchImpl,
          createLeaseToken: () => LEASE_TOKEN,
        }),
      ).rejects.toEqual(new ThermalAdmissionUnavailableError());
    }
  });

  it("treats a missing release token as expiry fallback rather than success", async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        Response.json({ result: [1, "admitted", 12_000] }),
      )
      .mockResolvedValueOnce(Response.json({ result: 0 }));
    const decision = await admitThermalAnomalyRequest(request(), {
      environment: ENVIRONMENT,
      fetchImpl,
      createLeaseToken: () => LEASE_TOKEN,
    });
    if (decision.kind !== "admitted") throw new Error("Expected admission");

    await expect(decision.lease.release()).rejects.toEqual(
      new ThermalAdmissionUnavailableError(),
    );
  });

  it("aborts a slow Redis admission call without retrying or reaching Supabase", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async (_input, init) => {
      await new Promise((resolve, reject) => {
        const timer = setTimeout(resolve, 1_000);
        init?.signal?.addEventListener(
          "abort",
          () => {
            clearTimeout(timer);
            reject(new DOMException("Aborted", "AbortError"));
          },
          { once: true },
        );
      });
      return Response.json({ result: [1, "admitted", 12_000] });
    });
    const startedAt = performance.now();

    await expect(
      admitThermalAnomalyRequest(request(), {
        environment: {
          ...ENVIRONMENT,
          FIREWATCH_THERMAL_ADMISSION_TIMEOUT_MS: "100",
        },
        fetchImpl,
        createLeaseToken: () => LEASE_TOKEN,
      }),
    ).rejects.toEqual(new ThermalAdmissionUnavailableError());

    expect(performance.now() - startedAt).toBeLessThan(500);
    expect(fetchImpl).toHaveBeenCalledOnce();
  });
});
