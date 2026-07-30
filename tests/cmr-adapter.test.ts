import { describe, expect, it } from "vitest";

import {
  CMR_FIREMASK_PRODUCTS,
  cmrGranulesUrl,
  cmrRequestHeaders,
  combineCmrFireMaskPasses,
  parseCmrProductPasses,
} from "../lib/satellite/cmr";

const NOW_MS = Date.parse("2026-07-30T15:00:00Z");

function bytes(value: unknown) {
  return new TextEncoder().encode(JSON.stringify(value));
}

function cmrItem(product: string, conceptId: string, observedFrom: string) {
  return {
    meta: {
      "concept-id": conceptId,
      "collection-concept-id": `C-${product}`,
      "revision-date": "2026-07-30T14:10:00Z",
    },
    umm: {
      TemporalExtent: {
        RangeDateTime: {
          BeginningDateTime: observedFrom,
          EndingDateTime: "2026-07-30T12:00:00Z",
        },
      },
      CollectionReference: { ShortName: product, Version: "2" },
      DataGranule: {
        DayNightFlag: "Day",
        ProductionDateTime: "2026-07-30T14:05:00Z",
      },
    },
  };
}

describe("NASA CMR FireMask adapter", () => {
  it("builds a global, paginatable request without performing network I/O", () => {
    for (const product of CMR_FIREMASK_PRODUCTS) {
      const url = cmrGranulesUrl(product, NOW_MS);
      expect(url.origin).toBe("https://cmr.earthdata.nasa.gov");
      expect(url.pathname).toBe("/search/granules.umm_json_v1_6_7");
      expect(url.searchParams.get("provider")).toBe("LANCEMODIS");
      expect(url.searchParams.get("short_name")).toBe(product.shortName);
      expect(url.searchParams.get("version")).toBe("2");
      expect(url.searchParams.has("bounding_box")).toBe(false);
      expect(url.searchParams.get("page_size")).toBe("200");
      expect(url.searchParams.getAll("sort_key[]")).toEqual([
        "-start_date",
        "granule_ur",
      ]);
      expect(String(url)).not.toMatch(/token|authorization|bearer/iu);
    }
    expect(cmrRequestHeaders("collector-request-1", "next-page-cursor")).toEqual({
      Accept: "application/vnd.nasa.cmr.umm_results+json",
      "CMR-Search-After": "next-page-cursor",
      "Client-Id": "plomari-wildfire-tracker",
      "X-Request-Id": "collector-request-1",
    });
  });

  it("parses already-persisted bytes and combines products by newest pass", () => {
    const [snpp, noaa20, noaa21] = CMR_FIREMASK_PRODUCTS;
    expect(snpp).toBeDefined();
    expect(noaa20).toBeDefined();
    expect(noaa21).toBeDefined();
    if (!snpp || !noaa20 || !noaa21) return;

    const results = [
      parseCmrProductPasses(
        snpp,
        bytes({
          hits: 1,
          items: [cmrItem(snpp.shortName, "G-old-snpp", "2026-07-30T00:20:00Z")],
        }),
      ),
      parseCmrProductPasses(
        noaa20,
        bytes({
          hits: 1,
          items: [
            cmrItem(noaa20.shortName, "G-new-noaa20", "2026-07-30T11:54:00Z"),
          ],
        }),
      ),
      parseCmrProductPasses(noaa21, bytes({ hits: 0, items: [] })),
    ];
    const discovery = combineCmrFireMaskPasses(
      results,
      "2026-07-29T03:00:00.000Z",
      "2026-07-30T15:00:00.000Z",
    );

    expect(discovery.passes[0]).toMatchObject({
      id: "G-new-noaa20",
      product: "VJ114IMG_NRT",
      satellite: "NOAA-20",
      observedFrom: "2026-07-30T11:54:00.000Z",
      coverage: "catalog-footprint",
      anomalyAssessment: "not-assessed",
    });
    expect(discovery.products.every((product) => product.status === "ok")).toBe(
      true,
    );
  });

  it("rejects malformed or oversized response bytes before normalization", () => {
    const product = CMR_FIREMASK_PRODUCTS[0];
    expect(product).toBeDefined();
    if (!product) return;

    expect(parseCmrProductPasses(product, new TextEncoder().encode("{"))).toMatchObject({
      status: "error",
      errorCode: "invalid-response",
    });
    expect(parseCmrProductPasses(product, new Uint8Array(16_000_001))).toMatchObject({
      status: "error",
      errorCode: "response-too-large",
    });
  });
});
