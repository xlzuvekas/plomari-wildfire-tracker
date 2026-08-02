import { describe, expect, it, vi } from "vitest";
import type {
  HttpExchangeReference,
  HttpRequestEvidence,
} from "../lib/evidence/recorded-fetch";
import {
  AirQualityCollectionError,
  AirQualityPersistenceError,
  collectOpenMeteoAirQuality,
  openMeteoAirQualityPlan,
  type AirQualityPersistence,
  type AirQualityReservation,
  type AirQualityTargetSummary,
} from "../lib/air-quality/open-meteo-collector.server";

const SCHEDULED_FOR = "2026-07-31T09:00:00.000Z";

const TARGETS = [
  { targetKey: "area-alpha", point: { latitude: 43.5, longitude: 4.8 } },
  { targetKey: "area-beta", point: { latitude: 40.2, longitude: -3.9 } },
] as const;

const aqBody = (time: string) =>
  JSON.stringify({
    latitude: 43.5,
    longitude: 4.8,
    utc_offset_seconds: 0,
    current: { time, pm2_5: 10.5, european_aqi: 28 },
  });

function harness(input?: {
  reserve?: () => Promise<AirQualityReservation>;
  failPersistReading?: boolean;
}) {
  const events: string[] = [];
  let exchangeNo = 0;
  const persistence: AirQualityPersistence = {
    issue: async (request: HttpRequestEvidence) => {
      events.push(`issue:${request.requestQuerySafe.latitude}`);
      exchangeNo += 1;
      return { exchangeId: `x-${exchangeNo}` } as unknown as HttpExchangeReference;
    },
    finishResponse: async (_reference, response) => {
      events.push(`durable:${response.status}`);
    },
    finishTransportError: async () => {
      events.push("transport-error");
    },
    reserveCollection: input?.reserve ??
      (async () => {
        events.push("reserve");
        return { state: "execute", collectionId: "c-1" } as const;
      }),
    heartbeatCollection: async () => {
      events.push("heartbeat");
    },
    persistReading: async ({ target, parsed }) => {
      if (input?.failPersistReading) throw new Error("db down");
      events.push(`persist:${target.targetKey}:${parsed.status}`);
      const summary: AirQualityTargetSummary = {
        targetKey: target.targetKey,
        outcome: parsed.status === "ok" ? "complete" : "failed",
        observedAtUtc:
          parsed.status === "ok" ? parsed.reading.observedAtUtc : null,
      };
      return summary;
    },
    persistReadingFailure: async ({ target, code }) => {
      events.push(`persist-failure:${target.targetKey}:${code}`);
      return { targetKey: target.targetKey, outcome: "failed", observedAtUtc: null };
    },
    completeCollection: async (summary) => {
      events.push(`complete:${summary.completeCount}`);
    },
    failCollection: async ({ code }) => {
      events.push(`fail:${code}`);
    },
  };
  return { events, persistence };
}

describe("openMeteoAirQualityPlan", () => {
  it("is deterministic for a schedule slot", () => {
    const a = openMeteoAirQualityPlan({ scheduledFor: SCHEDULED_FOR, targets: TARGETS });
    const b = openMeteoAirQualityPlan({
      scheduledFor: "2026-07-31T09:04:59.000Z",
      targets: TARGETS,
    });
    expect(a.planKey).toBe(b.planKey);
  });

  it("rejects duplicate or malformed target keys", () => {
    expect(() =>
      openMeteoAirQualityPlan({
        scheduledFor: SCHEDULED_FOR,
        targets: [TARGETS[0], TARGETS[0]],
      }),
    ).toThrow(TypeError);
    expect(() =>
      openMeteoAirQualityPlan({
        scheduledFor: SCHEDULED_FOR,
        targets: [{ targetKey: "Bad Key!", point: TARGETS[0].point }],
      }),
    ).toThrow(TypeError);
  });
});

describe("collectOpenMeteoAirQuality", () => {
  it("records evidence before parsing and persists per target in order", async () => {
    const { events, persistence } = harness();
    const fetchImpl = vi.fn(async () =>
      new Response(aqBody("2026-07-31T09:00"), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    const summary = await collectOpenMeteoAirQuality({
      plan: openMeteoAirQualityPlan({ scheduledFor: SCHEDULED_FOR, targets: TARGETS }),
      persistence,
      fetchImpl,
    });
    expect(summary.status).toBe("complete");
    expect(summary.completeCount).toBe(2);
    expect(summary.latestObservedAtUtc).toBe("2026-07-31T09:00:00.000Z");
    expect(events).toEqual([
      "reserve",
      "heartbeat",
      "issue:43.5000",
      "durable:200",
      "persist:area-alpha:ok",
      "heartbeat",
      "issue:40.2000",
      "durable:200",
      "persist:area-beta:ok",
      "complete:2",
    ]);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("returns the stored summary when the slot is already complete", async () => {
    const stored = {
      status: "complete",
      collectionId: "c-0",
      plan: openMeteoAirQualityPlan({ scheduledFor: SCHEDULED_FOR, targets: TARGETS }),
      targets: [],
      requestCount: 2,
      completeCount: 2,
      failedCount: 0,
      latestObservedAtUtc: null,
    } as const;
    const { persistence } = harness({
      reserve: async () => ({ state: "already-complete", summary: stored }),
    });
    const fetchImpl = vi.fn();
    const summary = await collectOpenMeteoAirQuality({
      plan: stored.plan,
      persistence,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(summary).toBe(stored);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("records a target failure and fails the collection on upstream error", async () => {
    const { events, persistence } = harness();
    const fetchImpl = vi.fn(async () =>
      new Response("upstream broke", { status: 500 }),
    );
    await expect(
      collectOpenMeteoAirQuality({
        plan: openMeteoAirQualityPlan({
          scheduledFor: SCHEDULED_FOR,
          targets: [TARGETS[0]],
        }),
        persistence,
        fetchImpl,
      }),
    ).rejects.toBeInstanceOf(AirQualityCollectionError);
    expect(events).toContain("persist-failure:area-alpha:upstream");
    expect(events.at(-1)).toBe("fail:upstream");
    // The failing response body is still durable evidence.
    expect(events).toContain("durable:500");
  });

  it("withholds data when persistence is not durable", async () => {
    const { persistence } = harness({ failPersistReading: true });
    const fetchImpl = vi.fn(async () =>
      new Response(aqBody("2026-07-31T09:00"), { status: 200 }),
    );
    await expect(
      collectOpenMeteoAirQuality({
        plan: openMeteoAirQualityPlan({
          scheduledFor: SCHEDULED_FOR,
          targets: [TARGETS[0]],
        }),
        persistence,
        fetchImpl,
      }),
    ).rejects.toBeInstanceOf(AirQualityPersistenceError);
  });
});
