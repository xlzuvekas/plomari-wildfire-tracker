import { describe, expect, it } from "vitest";
import { contentSha256 } from "../lib/evidence/recorded-fetch";
import {
  FIRMS_SHADOW_PRODUCTS,
  collectFirmsShadow,
  firmsShadowPlan,
  type FirmsShadowPersistence,
  type FirmsShadowProductSummary,
  type FirmsShadowSummary,
} from "../lib/satellite/firms-collector.server";
import type { FirmsProduct } from "../lib/satellite/firms";

const VIIRS_HEADER = [
  "latitude", "longitude", "bright_ti4", "scan", "track", "acq_date",
  "acq_time", "satellite", "instrument", "confidence", "version",
  "bright_ti5", "frp", "daynight",
].join(",");
const MODIS_HEADER = [
  "latitude", "longitude", "brightness", "scan", "track", "acq_date",
  "acq_time", "satellite", "instrument", "confidence", "version",
  "bright_t31", "frp", "daynight",
].join(",");

const SATELLITE: Record<Exclude<FirmsProduct, "MODIS_NRT">, string> = {
  VIIRS_NOAA20_NRT: "N20",
  VIIRS_NOAA21_NRT: "N21",
  VIIRS_SNPP_NRT: "N",
};

function fixture(product: FirmsProduct, latitude = 39) {
  if (product === "MODIS_NRT") {
    return `${MODIS_HEADER}\n${latitude},27,330,0.5,0.6,2026-07-31,1100,A,MODIS,80,2.0NRT,290,12,D\n`;
  }
  return `${VIIRS_HEADER}\n${latitude},27,330,0.5,0.6,2026-07-31,1100,${SATELLITE[product]},VIIRS,n,2.0NRT,290,12,D\n`;
}

function plan() {
  return firmsShadowPlan({
    scheduledFor: "2026-07-31T12:00:00.000Z",
    area: { west: 26.9, south: 38.9, east: 27.1, north: 39.1 },
    dateFrom: "2026-07-31",
    dayCount: 1,
  });
}

function persistence(events: string[]) {
  let completed: FirmsShadowSummary | null = null;
  let failed: string | null = null;
  const products = new Map<string, FirmsProduct>();
  let exchange = 0;
  const value: FirmsShadowPersistence = {
    async reserveCollection() {
      events.push("reserve");
      return { state: "execute", collectionId: "collection-1" };
    },
    async heartbeatCollection() {
      events.push("heartbeat");
    },
    async issue(request) {
      const product = request.requestMetadataSafe.product as FirmsProduct;
      exchange += 1;
      products.set(String(exchange), product);
      events.push(`issue:${product}`);
      expect(JSON.stringify(request)).not.toContain("test-map-key");
      return { exchangeId: String(exchange), runId: "10" };
    },
    async finishResponse(reference, response) {
      const product = products.get(reference.exchangeId);
      events.push(`durable:${product}`);
      return {
        rawObjectId: String(100 + Number(reference.exchangeId)),
        httpExchangeId: reference.exchangeId,
        runId: reference.runId,
        contentSha256: await contentSha256(response.body),
        retrievedAt: "2026-07-31T12:00:01.000Z",
      };
    },
    async finishTransportError(reference) {
      events.push(`transport:${products.get(reference.exchangeId)}`);
    },
    async persistProduct(input) {
      const last = events.at(-1);
      expect(last).toBe(`durable:${input.product}`);
      events.push(`parsed:${input.product}`);
      const accepted = input.parsed.detections.length;
      const rejected = input.parsed.rejectedRows.length;
      const outcome = input.parsed.status === "ok" && rejected === 0
        ? "complete"
        : input.parsed.status === "error"
        ? "failed"
        : "partial";
      return {
        product: input.product,
        outcome,
        returnedCount: input.parsed.returnedRows,
        acceptedCount: accepted,
        rejectedCount: rejected,
        newDetailCount: accepted,
        duplicateCount: 0,
        latestObservedAt: input.parsed.detections[0]?.observedAt ?? null,
      } satisfies FirmsShadowProductSummary;
    },
    async persistProductFailure(input) {
      events.push(`failed-product:${input.product}:${input.code}`);
      return {
        product: input.product,
        outcome: "failed",
        returnedCount: 0,
        acceptedCount: 0,
        rejectedCount: 0,
        newDetailCount: 0,
        duplicateCount: 0,
        latestObservedAt: null,
      };
    },
    async completeCollection(summary) {
      completed = summary;
      events.push("complete");
    },
    async failCollection(input) {
      failed = input.code;
      events.push(`failed:${input.code}`);
    },
  };
  return {
    value,
    state: () => ({ completed: completed as FirmsShadowSummary | null, failed }),
  };
}

function network(
  events: string[],
  bodyFor: (product: FirmsProduct) => string = (product) => fixture(product),
) {
  return async (input: RequestInfo | URL) => {
    const url = String(input);
    const product = FIRMS_SHADOW_PRODUCTS.find((candidate) =>
      url.includes(`/${candidate}/`)
    );
    if (product === undefined) throw new Error("Unknown test product.");
    expect(events.at(-1)).toBe(`issue:${product}`);
    events.push(`network:${product}`);
    expect(url).toContain("/test-map-key/");
    return new Response(bodyFor(product), {
      status: 200,
      headers: { "content-type": "text/csv" },
    });
  };
}

describe("FIRMS bounded shadow collector", () => {
  it("persists every exact response before parsing the four fixed products", async () => {
    const events: string[] = [];
    const durable = persistence(events);
    const summary = await collectFirmsShadow({
      mapKey: "test-map-key",
      plan: plan(),
      persistence: durable.value,
      fetchImpl: network(events),
      clockMs: () => Date.parse("2026-07-31T12:00:00.500Z"),
    });

    expect(summary.products.map((product) => product.product)).toEqual(
      FIRMS_SHADOW_PRODUCTS,
    );
    expect(summary).toMatchObject({
      requestCount: 4,
      returnedCount: 4,
      acceptedCount: 4,
      rejectedCount: 0,
      coverage: "requested-bbox-only",
      sensorAssessability: "unknown",
      negativeAssessmentEligible: false,
    });
    expect(durable.state().completed).toEqual(summary);
    expect(durable.state().failed).toBeNull();
    for (const product of FIRMS_SHADOW_PRODUCTS) {
      expect(events.indexOf(`issue:${product}`)).toBeLessThan(
        events.indexOf(`network:${product}`),
      );
      expect(events.indexOf(`durable:${product}`)).toBeLessThan(
        events.indexOf(`parsed:${product}`),
      );
    }
  });

  it("records an empty four-product response without turning it into an all-clear", async () => {
    const events: string[] = [];
    const durable = persistence(events);
    const summary = await collectFirmsShadow({
      mapKey: "test-map-key",
      plan: plan(),
      persistence: durable.value,
      fetchImpl: network(events, (product) =>
        `${product === "MODIS_NRT" ? MODIS_HEADER : VIIRS_HEADER}\n`),
      clockMs: () => Date.parse("2026-07-31T12:00:00.500Z"),
    });
    expect(summary.returnedCount).toBe(0);
    expect(summary.negativeAssessmentEligible).toBe(false);
    expect(summary.sensorAssessability).toBe("unknown");
    expect(JSON.stringify(summary)).not.toMatch(/all.?clear|resolved|no.?fire/iu);
  });

  it("fails the collection closed while retaining typed rejected rows", async () => {
    const events: string[] = [];
    const durable = persistence(events);
    await expect(collectFirmsShadow({
      mapKey: "test-map-key",
      plan: plan(),
      persistence: durable.value,
      fetchImpl: network(events, (product) =>
        product === "MODIS_NRT" ? fixture(product, 50) : fixture(product)),
      clockMs: () => Date.parse("2026-07-31T12:00:00.500Z"),
    })).rejects.toMatchObject({ code: "parser" });
    expect(durable.state().completed).toBeNull();
    expect(durable.state().failed).toBe("parser");
    expect(events.filter((event) => event.startsWith("network:"))).toHaveLength(4);
  });

  it("rejects credentials, future windows, and oversized AOIs before I/O", async () => {
    const events: string[] = [];
    const durable = persistence(events);
    await expect(collectFirmsShadow({
      mapKey: "bad key",
      plan: plan(),
      persistence: durable.value,
      fetchImpl: network(events),
    })).rejects.toThrow("credential is invalid");
    expect(events).toEqual([]);
    expect(() => firmsShadowPlan({
      scheduledFor: "2026-07-31T12:00:00.000Z",
      area: { west: 0, south: 0, east: 11, north: 1 },
      dateFrom: "2026-07-31",
      dayCount: 1,
    })).toThrow("bounded envelope");
    expect(() => firmsShadowPlan({
      scheduledFor: "2026-07-31T12:00:00.000Z",
      area: { west: 0, south: 0, east: 1, north: 1 },
      dateFrom: "2026-08-01",
      dayCount: 1,
    })).toThrow("future");
  });
});
