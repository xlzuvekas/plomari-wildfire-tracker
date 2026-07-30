import { describe, expect, it, vi } from "vitest";

import type {
  HttpEvidenceLedger,
  HttpExchangeReference,
  HttpRequestEvidence,
  HttpResponseEvidence,
} from "../lib/evidence/recorded-fetch";
import {
  boundedCmrFullPlan,
  fiveMinuteCmrIncrementalPlan,
  harvestCmrFireMaskCatalog,
  type CmrHarvestPersistence,
  type CmrPersistedPage,
} from "../lib/satellite/cmr-collector.server";

const PLAN = fiveMinuteCmrIncrementalPlan({
  scheduledFor: "2026-07-30T15:03:00.000Z",
  previousWatermarkTo: "2026-07-30T14:45:00.000Z",
  predecessorHealthCursor: "901",
});

function cmrItem(product: string, id: string, minute = 0) {
  return {
    meta: {
      "concept-id": id,
      "collection-concept-id": "C1886251885-LANCEMODIS",
      "revision-id": 3,
      "revision-date": `2026-07-30T14:${String(minute).padStart(2, "0")}:30Z`,
    },
    umm: {
      GranuleUR: `${id}.nc`,
      TemporalExtent: {
        RangeDateTime: {
          BeginningDateTime: `2026-07-30T13:${String(minute).padStart(2, "0")}:00Z`,
          EndingDateTime: `2026-07-30T13:${String(minute).padStart(2, "0")}:59Z`,
        },
      },
      SpatialExtent: {
        HorizontalSpatialDomain: {
          Geometry: {
            GPolygons: [
              {
                Boundary: {
                  Points: [
                    { Longitude: 25.9, Latitude: 38.9 },
                    { Longitude: 26.1, Latitude: 38.9 },
                    { Longitude: 26.1, Latitude: 39.1 },
                    { Longitude: 25.9, Latitude: 39.1 },
                    { Longitude: 25.9, Latitude: 38.9 },
                  ],
                },
              },
            ],
          },
        },
      },
      CollectionReference: { ShortName: product, Version: "2" },
      DataGranule: {
        DayNightFlag: "Day",
        ProductionDateTime: "2026-07-30T14:00:00Z",
      },
      MetadataSpecification: { Name: "UMM-G", Version: "1.6.7" },
    },
  };
}

function cmrResponse(
  product: string,
  items: readonly unknown[],
  options: Readonly<{
    hits?: number;
    searchAfter?: string;
    extraHeaders?: Readonly<Record<string, string>>;
    status?: number;
  }> = {},
) {
  return new Response(
    JSON.stringify({ hits: options.hits ?? items.length, items }),
    {
      status: options.status ?? 200,
      headers: {
        "CMR-Hits": String(options.hits ?? items.length),
        "CMR-Took": "40",
        "Content-Type": "application/json",
        "X-Request-Id": `nasa-${product}`,
        ...(options.searchAfter
          ? { "CMR-Search-After": options.searchAfter }
          : {}),
        ...options.extraHeaders,
      },
    },
  );
}

function evidenceHarness(events: string[]) {
  let nextExchange = 1;
  const requests: HttpRequestEvidence[] = [];
  const responses: HttpResponseEvidence[] = [];
  const labels = new Map<string, string>();
  const ledger: HttpEvidenceLedger = {
    issue: vi.fn(async (request) => {
      const reference = Object.freeze({
        exchangeId: String(nextExchange++),
        runId: "77",
      }) satisfies HttpExchangeReference;
      const label = `${request.requestMetadataSafe.product}:${request.requestMetadataSafe.page}`;
      labels.set(reference.exchangeId, label);
      requests.push(request);
      events.push(`issue:${label}`);
      return reference;
    }),
    finishResponse: vi.fn(async (reference, response) => {
      responses.push(response);
      events.push(`durable:${labels.get(reference.exchangeId)}`);
    }),
    finishTransportError: vi.fn(async (reference) => {
      events.push(`transport-error:${labels.get(reference.exchangeId)}`);
    }),
  };
  return { ledger, requests, responses };
}

function persistenceHarness(
  events: string[],
  overrides: Partial<CmrHarvestPersistence> = {},
) {
  const pages: CmrPersistedPage[] = [];
  const failures: Array<{ code: string; detailSafe: string }> = [];
  const persistence: CmrHarvestPersistence = {
    reserveHarvest: vi.fn(async () => {
      events.push("reserve");
      return { state: "execute", harvestId: "harvest-77" } as const;
    }),
    heartbeatHarvest: vi.fn(async () => {
      events.push("heartbeat");
    }),
    persistPage: vi.fn(async (page) => {
      pages.push(page);
      events.push(`persist:${page.product.shortName}:${page.page}`);
      return {
        acceptedCount: page.parsed.passes.length,
        duplicateCount: 0,
        rejectedCount: page.parsed.rejectedItems.length,
      };
    }),
    completeHarvest: vi.fn(async () => {
      events.push("complete-durable");
    }),
    failHarvest: vi.fn(async (failure) => {
      failures.push(failure);
      events.push(`failed:${failure.code}`);
    }),
    ...overrides,
  };
  return { persistence, pages, failures };
}

describe("scheduled NASA CMR collector", () => {
  it("builds bounded baseline plans without pretending to have a predecessor", () => {
    expect(
      boundedCmrFullPlan({
        scanKind: "bootstrap",
        scheduledFor: "2026-07-30T15:03:00.000Z",
      }),
    ).toEqual({
      harvestKey: "cmr-bootstrap-20260730T150000000Z",
      scanKind: "bootstrap",
      requestedFrom: "2026-07-29T03:00:00.000Z",
      requestedTo: "2026-07-30T15:00:00.000Z",
      updatedSince: null,
      watermarkFrom: null,
      watermarkTo: "2026-07-30T14:50:00.000Z",
      predecessorHealthCursor: null,
    });
  });

  it("builds a deterministic five-minute delta with overlap and a 36-hour window", () => {
    expect(PLAN).toEqual({
      harvestKey: "cmr-incremental-20260730T150000000Z",
      scanKind: "incremental",
      requestedFrom: "2026-07-29T03:00:00.000Z",
      requestedTo: "2026-07-30T15:00:00.000Z",
      updatedSince: "2026-07-30T14:45:00.000Z",
      watermarkFrom: "2026-07-30T14:45:00.000Z",
      watermarkTo: "2026-07-30T14:50:00.000Z",
      predecessorHealthCursor: "901",
    });
  });

  it("records every response before parsing/persistence and completes all products", async () => {
    const events: string[] = [];
    const evidence = evidenceHarness(events);
    const stored = persistenceHarness(events);
    const networkRequests: Array<{ url: URL; init: RequestInit }> = [];
    const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(input instanceof Request ? input.url : input);
      const product = url.searchParams.get("short_name") ?? "unknown";
      networkRequests.push({ url, init: init ?? {} });
      events.push(`network:${product}:1`);
      const conceptId = product === "VNP14IMG_NRT"
        ? "G2001-LANCEMODIS"
        : product === "VJ114IMG_NRT"
          ? "G2002-LANCEMODIS"
          : "G2003-LANCEMODIS";
      return cmrResponse(product, [cmrItem(product, conceptId)], {
        extraHeaders: { "Content-Encoding": "gzip" },
      });
    });

    const result = await harvestCmrFireMaskCatalog({
      plan: PLAN,
      fetchImpl,
      ledger: evidence.ledger,
      persistence: stored.persistence,
    });
    events.push("returned");

    expect(result).toMatchObject({
      status: "complete",
      requestCount: 3,
      pageCount: 3,
      upstreamHitCount: 3,
      fetchedCount: 3,
      acceptedCount: 3,
      rejectedCount: 0,
      coverage: "global-catalog-query",
      anomalyAssessment: "not-assessed",
    });
    expect(result.products.map((product) => product.product)).toEqual([
      "VNP14IMG_NRT",
      "VJ114IMG_NRT",
      "VJ214IMG_NRT",
    ]);
    expect(events[0]).toBe("reserve");
    for (const product of result.products) {
      expect(events.indexOf(`issue:${product.product}:1`)).toBeLessThan(
        events.indexOf(`network:${product.product}:1`),
      );
      expect(events.indexOf(`network:${product.product}:1`)).toBeLessThan(
        events.indexOf(`durable:${product.product}:1`),
      );
      expect(events.indexOf(`durable:${product.product}:1`)).toBeLessThan(
        events.indexOf(`persist:${product.product}:1`),
      );
    }
    expect(events.indexOf("complete-durable")).toBeLessThan(
      events.indexOf("returned"),
    );

    expect(networkRequests).toHaveLength(3);
    for (const request of networkRequests) {
      expect(request.url.searchParams.get("updated_since")).toBe(
        PLAN.updatedSince,
      );
      expect(request.url.searchParams.get("temporal")).toBe(
        `${PLAN.requestedFrom},${PLAN.requestedTo}`,
      );
      expect(request.url.searchParams.has("bounding_box")).toBe(false);
      expect(request.init.redirect).toBe("manual");
      expect(request.init.cache).toBe("no-store");
      const headers = new Headers(request.init.headers);
      expect(headers.has("authorization")).toBe(false);
      expect(headers.has("token")).toBe(false);
      expect(headers.get("client-id")).toBe("plomari-wildfire-tracker");
      expect(request.init.signal).toBeInstanceOf(AbortSignal);
    }
    expect(evidence.requests[0]?.requestQuerySafe.updated_since).toBe(
      PLAN.updatedSince,
    );
    expect(evidence.responses[0]?.safeHeaders).toMatchObject({
      "cmr-hits": "1",
      "cmr-took": "40",
      "content-encoding": "gzip",
      "x-request-id": "nasa-VNP14IMG_NRT",
    });
    expect(evidence.responses[0]?.safeMetadata).toMatchObject({
      page: 1,
      partial: false,
      terminal: true,
      truncated: false,
      provider_request_id: "nasa-VNP14IMG_NRT",
    });
    expect(evidence.responses[0]?.safeMetadata.response_body_bytes).toBeGreaterThan(
      0,
    );
  });

  it("forwards each opaque Search-After cursor verbatim with stable parameters", async () => {
    const events: string[] = [];
    const evidence = evidenceHarness(events);
    const stored = persistenceHarness(events);
    const cursor = '[1785429360000,"lancemodis:2980851483",4265516276]';
    const vnpUrls: string[] = [];
    const vnpCursors: Array<string | null> = [];
    const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(input instanceof Request ? input.url : input);
      const product = url.searchParams.get("short_name") ?? "unknown";
      const requestCursor = new Headers(init?.headers).get("cmr-search-after");
      if (product === "VNP14IMG_NRT") {
        vnpUrls.push(String(url));
        vnpCursors.push(requestCursor);
        return requestCursor === null
          ? cmrResponse(product, [cmrItem(product, "G2101-LANCEMODIS", 1)], {
              hits: 2,
              searchAfter: cursor,
            })
          : cmrResponse(product, [cmrItem(product, "G2102-LANCEMODIS", 2)], {
              hits: 2,
            });
      }
      return cmrResponse(product, [], { hits: 0 });
    });

    const result = await harvestCmrFireMaskCatalog({
      plan: PLAN,
      fetchImpl,
      ledger: evidence.ledger,
      persistence: stored.persistence,
    });

    expect(result.requestCount).toBe(4);
    expect(result.products[0]).toMatchObject({ pages: 2, upstreamHits: 2 });
    expect(vnpUrls).toEqual([vnpUrls[0], vnpUrls[0]]);
    expect(vnpCursors).toEqual([null, cursor]);
    expect(evidence.requests[1]?.requestHeadersSafe["cmr-search-after"]).toBe(
      cursor,
    );
    expect(stored.pages[1]?.searchAfterBefore).toBe(cursor);
    expect(evidence.responses[0]?.safeMetadata).toMatchObject({
      terminal: false,
      partial: false,
    });
    expect(evidence.responses[1]?.safeMetadata).toMatchObject({
      terminal: true,
      partial: false,
    });
  });

  it.each(["CMR-Time-Out", "CMR-Timed-Out"])(
    "fails closed on provider partial results reported by %s",
    async (timeoutHeader) => {
      const events: string[] = [];
      const evidence = evidenceHarness(events);
      const stored = persistenceHarness(events);
      const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
        const url = new URL(input instanceof Request ? input.url : input);
        const product = url.searchParams.get("short_name") ?? "unknown";
        return cmrResponse(product, [cmrItem(product, "G2201-LANCEMODIS")], {
          extraHeaders: { [timeoutHeader]: "true" },
        });
      });

      await expect(
        harvestCmrFireMaskCatalog({
          plan: PLAN,
          fetchImpl,
          ledger: evidence.ledger,
          persistence: stored.persistence,
        }),
      ).rejects.toMatchObject({ code: "provider_timeout" });
      expect(events).toContain("durable:VNP14IMG_NRT:1");
      expect(stored.pages).toHaveLength(0);
      expect(stored.failures).toMatchObject([{ code: "provider_timeout" }]);
      expect(events).not.toContain("complete-durable");
      expect(evidence.responses[0]?.safeHeaders).toHaveProperty(
        timeoutHeader.toLowerCase(),
        "true",
      );
    },
  );

  it("persists geometry rejections before failing the harvest", async () => {
    const events: string[] = [];
    const evidence = evidenceHarness(events);
    const stored = persistenceHarness(events);
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(input instanceof Request ? input.url : input);
      const product = url.searchParams.get("short_name") ?? "unknown";
      const item = cmrItem(product, "G2301-LANCEMODIS");
      delete (item.umm as { SpatialExtent?: unknown }).SpatialExtent;
      return cmrResponse(product, [item]);
    });

    await expect(
      harvestCmrFireMaskCatalog({
        plan: PLAN,
        fetchImpl,
        ledger: evidence.ledger,
        persistence: stored.persistence,
      }),
    ).rejects.toMatchObject({ code: "invalid_response" });
    expect(stored.pages).toHaveLength(1);
    expect(stored.pages[0]?.parsed.rejectedItems).toMatchObject([
      { conceptId: "G2301-LANCEMODIS", reason: "missing-footprint" },
    ]);
    expect(events.indexOf("durable:VNP14IMG_NRT:1")).toBeLessThan(
      events.indexOf("persist:VNP14IMG_NRT:1"),
    );
    expect(events).toContain("failed:invalid_response");
    expect(events).not.toContain("complete-durable");
  });

  it("records but never follows an upstream redirect", async () => {
    const events: string[] = [];
    const evidence = evidenceHarness(events);
    const stored = persistenceHarness(events);
    const fetchImpl = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      expect(init?.redirect).toBe("manual");
      return new Response("moved", {
        status: 302,
        headers: { Location: "https://example.invalid/other" },
      });
    });

    await expect(
      harvestCmrFireMaskCatalog({
        plan: PLAN,
        fetchImpl,
        ledger: evidence.ledger,
        persistence: stored.persistence,
      }),
    ).rejects.toMatchObject({ code: "redirect" });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(events).toContain("durable:VNP14IMG_NRT:1");
    expect(events).toContain("failed:redirect");
  });

  it("stops at the page bound after persisting the last allowed page", async () => {
    const events: string[] = [];
    const evidence = evidenceHarness(events);
    const stored = persistenceHarness(events);
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(input instanceof Request ? input.url : input);
      const product = url.searchParams.get("short_name") ?? "unknown";
      return cmrResponse(product, [cmrItem(product, "G2401-LANCEMODIS")], {
        hits: 2,
        searchAfter: "next",
      });
    });

    await expect(
      harvestCmrFireMaskCatalog({
        plan: PLAN,
        fetchImpl,
        ledger: evidence.ledger,
        persistence: stored.persistence,
        limits: { maxPagesPerProduct: 1 },
      }),
    ).rejects.toMatchObject({ code: "page_limit" });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(stored.pages).toHaveLength(1);
    expect(events).toContain("failed:page_limit");
  });

  it("bounds response bytes and publishes no unrecorded body", async () => {
    const events: string[] = [];
    const evidence = evidenceHarness(events);
    const stored = persistenceHarness(events);
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(input instanceof Request ? input.url : input);
      const product = url.searchParams.get("short_name") ?? "unknown";
      return cmrResponse(product, [cmrItem(product, "G2501-LANCEMODIS")]);
    });

    await expect(
      harvestCmrFireMaskCatalog({
        plan: PLAN,
        fetchImpl,
        ledger: evidence.ledger,
        persistence: stored.persistence,
        limits: { maxPageResponseBytes: 32 },
      }),
    ).rejects.toMatchObject({ stage: "capture_response" });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(evidence.ledger.issue).toHaveBeenCalledTimes(1);
    expect(evidence.ledger.finishResponse).not.toHaveBeenCalled();
    expect(stored.pages).toHaveLength(0);
    expect(stored.failures).toMatchObject([{ code: "byte_limit" }]);
    expect(events).not.toContain("complete-durable");
  });

  it("enforces the total elapsed deadline before request issuance", async () => {
    const events: string[] = [];
    const evidence = evidenceHarness(events);
    const stored = persistenceHarness(events);
    const fetchImpl = vi.fn<typeof fetch>();
    const clockMs = vi
      .fn<() => number>()
      .mockReturnValueOnce(1_000)
      .mockReturnValue(1_101);

    await expect(
      harvestCmrFireMaskCatalog({
        plan: PLAN,
        fetchImpl,
        ledger: evidence.ledger,
        persistence: stored.persistence,
        limits: { maxElapsedMs: 100 },
        clockMs,
      }),
    ).rejects.toMatchObject({ code: "deadline" });
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(evidence.ledger.issue).not.toHaveBeenCalled();
    expect(stored.failures).toMatchObject([{ code: "deadline" }]);
  });

  it("does no network I/O if the harvest reservation is not durable", async () => {
    const events: string[] = [];
    const evidence = evidenceHarness(events);
    const stored = persistenceHarness(events, {
      reserveHarvest: vi.fn(async () => {
        throw new Error("database offline");
      }),
    });
    const fetchImpl = vi.fn<typeof fetch>();

    await expect(
      harvestCmrFireMaskCatalog({
        plan: PLAN,
        fetchImpl,
        ledger: evidence.ledger,
        persistence: stored.persistence,
      }),
    ).rejects.toMatchObject({ stage: "reserve_harvest" });
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(evidence.ledger.issue).not.toHaveBeenCalled();
  });

  it("does no request issuance after a lease heartbeat fails", async () => {
    const events: string[] = [];
    const evidence = evidenceHarness(events);
    const stored = persistenceHarness(events, {
      heartbeatHarvest: vi.fn(async () => {
        throw new Error("lease lost");
      }),
    });
    const fetchImpl = vi.fn<typeof fetch>();

    await expect(
      harvestCmrFireMaskCatalog({
        plan: PLAN,
        fetchImpl,
        ledger: evidence.ledger,
        persistence: stored.persistence,
      }),
    ).rejects.toMatchObject({ stage: "heartbeat_harvest" });
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(evidence.ledger.issue).not.toHaveBeenCalled();
    expect(stored.failures).toMatchObject([{ code: "database" }]);
  });
});
