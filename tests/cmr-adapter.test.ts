import { describe, expect, it } from "vitest";

import {
  CMR_FIREMASK_PRODUCTS,
  cmrGranulesUrl,
  cmrRequestHeaders,
  combineCmrFireMaskPasses,
  parseCmrProductPasses,
  type CmrCatalogFootprint,
  type GeoJsonLinearRing,
  type GeoJsonPosition,
} from "../lib/satellite/cmr";

const FROM = "2026-07-29T03:00:00.000Z";
const TO = "2026-07-30T15:00:00.000Z";

function bytes(value: unknown) {
  return new TextEncoder().encode(JSON.stringify(value));
}

function gPolygon() {
  return {
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
  };
}

function cmrItem(
  product: string,
  conceptId: string,
  observedFrom: string,
  geometry: unknown = gPolygon(),
) {
  return {
    meta: {
      "concept-id": conceptId,
      "collection-concept-id": "C1886251885-LANCEMODIS",
      "revision-id": 7,
      "revision-date": "2026-07-30T14:10:00Z",
    },
    umm: {
      GranuleUR: `${conceptId}.h5`,
      TemporalExtent: {
        RangeDateTime: {
          BeginningDateTime: observedFrom,
          EndingDateTime: "2026-07-30T12:00:00Z",
        },
      },
      SpatialExtent: {
        HorizontalSpatialDomain: { Geometry: geometry },
      },
      CollectionReference: { ShortName: product, Version: "2" },
      DataGranule: {
        DayNightFlag: "Day",
        ProductionDateTime: "2026-07-30T14:05:00Z",
      },
      MetadataSpecification: { Name: "UMM-G", Version: "1.6.7" },
    },
  };
}

function pointOnRingBoundary(point: GeoJsonPosition, ring: GeoJsonLinearRing) {
  return ring.slice(0, -1).some((start, index) => {
    const end = ring[index + 1];
    if (!end) return false;
    const cross =
      (point[0] - start[0]) * (end[1] - start[1]) -
      (point[1] - start[1]) * (end[0] - start[0]);
    return Math.abs(cross) < 1e-8 &&
      point[0] >= Math.min(start[0], end[0]) - 1e-8 &&
      point[0] <= Math.max(start[0], end[0]) + 1e-8 &&
      point[1] >= Math.min(start[1], end[1]) - 1e-8 &&
      point[1] <= Math.max(start[1], end[1]) + 1e-8;
  });
}

function ringContains(point: GeoJsonPosition, ring: GeoJsonLinearRing) {
  if (pointOnRingBoundary(point, ring)) return true;
  let inside = false;
  for (let index = 0, previous = ring.length - 1; index < ring.length; previous = index++) {
    const currentPoint = ring[index];
    const previousPoint = ring[previous];
    if (!currentPoint || !previousPoint) continue;
    const intersects =
      currentPoint[1] > point[1] !== previousPoint[1] > point[1] &&
      point[0] <
        ((previousPoint[0] - currentPoint[0]) *
          (point[1] - currentPoint[1])) /
          (previousPoint[1] - currentPoint[1]) +
          currentPoint[0];
    if (intersects) inside = !inside;
  }
  return inside;
}

function footprintContains(
  footprint: CmrCatalogFootprint,
  point: GeoJsonPosition,
) {
  const polygons = footprint.type === "Polygon"
    ? [footprint.coordinates]
    : footprint.coordinates;
  return polygons.some((polygon) => {
    const exterior = polygon[0];
    return exterior !== undefined &&
      ringContains(point, exterior) &&
      polygon.slice(1).every((hole) => !ringContains(point, hole));
  });
}

function footprintPositions(footprint: CmrCatalogFootprint) {
  const polygons = footprint.type === "Polygon"
    ? [footprint.coordinates]
    : footprint.coordinates;
  return polygons.flatMap((polygon) => polygon.flatMap((ring) => ring));
}

function expectValidRfc7946Footprint(footprint: CmrCatalogFootprint) {
  const polygons = footprint.type === "Polygon"
    ? [footprint.coordinates]
    : footprint.coordinates;
  expect(polygons.length).toBeGreaterThan(0);
  for (const polygon of polygons) {
    expect(polygon.length).toBeGreaterThan(0);
    for (const [ringIndex, ring] of polygon.entries()) {
      expect(ring.length).toBeGreaterThanOrEqual(4);
      expect(ring[0]).toEqual(ring[ring.length - 1]);
      const signedArea = ring.slice(0, -1).reduce((twiceArea, start, index) => {
        const end = ring[index + 1];
        return end
          ? twiceArea + start[0] * end[1] - end[0] * start[1]
          : twiceArea;
      }, 0) / 2;
      expect(Math.abs(signedArea)).toBeGreaterThan(1e-9);
      if (ringIndex === 0) expect(signedArea).toBeGreaterThan(0);
      else expect(signedArea).toBeLessThan(0);
      for (const [longitude, latitude] of ring) {
        expect(Number.isFinite(longitude)).toBe(true);
        expect(Number.isFinite(latitude)).toBe(true);
        expect(longitude).toBeGreaterThanOrEqual(-180);
        expect(longitude).toBeLessThanOrEqual(180);
        expect(latitude).toBeGreaterThanOrEqual(-90);
        expect(latitude).toBeLessThanOrEqual(90);
      }
      for (let index = 0; index < ring.length - 1; index += 1) {
        const start = ring[index];
        const end = ring[index + 1];
        if (!start || !end || Math.abs(start[0] - end[0]) <= 180) continue;
        // A pole is one geographic point represented across the full top or
        // bottom edge of the RFC 7946 longitude domain.
        expect(Math.abs(start[1])).toBe(90);
        expect(Math.abs(end[1])).toBe(90);
      }
    }
  }
}

describe("NASA CMR FireMask adapter", () => {
  it("builds bounded global full and incremental queries without credentials", () => {
    for (const product of CMR_FIREMASK_PRODUCTS) {
      const full = cmrGranulesUrl(product, {
        scanKind: "bootstrap",
        requestedFrom: FROM,
        requestedTo: TO,
        updatedSince: null,
      });
      expect(full.origin).toBe("https://cmr.earthdata.nasa.gov");
      expect(full.pathname).toBe("/search/granules.umm_json_v1_6_7");
      expect(full.searchParams.get("provider")).toBe("LANCEMODIS");
      expect(full.searchParams.get("short_name")).toBe(product.shortName);
      expect(full.searchParams.get("version")).toBe("2");
      expect(full.searchParams.get("temporal")).toBe(`${FROM},${TO}`);
      expect(full.searchParams.has("bounding_box")).toBe(false);
      expect(full.searchParams.get("page_size")).toBe("200");
      expect(full.searchParams.getAll("sort_key[]")).toEqual([
        "-start_date",
        "granule_ur",
      ]);

      const incremental = cmrGranulesUrl(product, {
        scanKind: "incremental",
        requestedFrom: FROM,
        requestedTo: TO,
        updatedSince: "2026-07-30T14:50:00.000Z",
      });
      expect(incremental.searchParams.get("updated_since")).toBe(
        "2026-07-30T14:50:00.000Z",
      );
      expect(incremental.searchParams.get("temporal")).toBe(`${FROM},${TO}`);
      expect(incremental.searchParams.getAll("sort_key[]")).toEqual([
        "-start_date",
        "granule_ur",
      ]);
      expect(String(incremental)).not.toMatch(/token|authorization|bearer/iu);
    }
    expect(cmrRequestHeaders("collector-request-1", "next-page-cursor")).toEqual({
      Accept: "application/vnd.nasa.cmr.umm_results+json",
      "CMR-Search-After": "next-page-cursor",
      "Client-Id": "plomari-wildfire-tracker",
      "X-Request-Id": "collector-request-1",
    });
  });

  it("parses persisted UMM-G revision and GPolygon footprint metadata", () => {
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
          items: [cmrItem(snpp.shortName, "G1001-LANCEMODIS", "2026-07-30T00:20:00Z")],
        }),
      ),
      parseCmrProductPasses(
        noaa20,
        bytes({
          hits: 1,
          items: [
            cmrItem(noaa20.shortName, "G1002-LANCEMODIS", "2026-07-30T11:54:00Z"),
          ],
        }),
      ),
      parseCmrProductPasses(noaa21, bytes({ hits: 0, items: [] })),
    ];
    const discovery = combineCmrFireMaskPasses(results, FROM, TO);

    expect(discovery.passes[0]).toMatchObject({
      id: "G1002-LANCEMODIS",
      revisionId: 7,
      granuleUr: "G1002-LANCEMODIS.h5",
      product: "VJ114IMG_NRT",
      satellite: "NOAA-20",
      observedFrom: "2026-07-30T11:54:00.000Z",
      ummGVersion: "1.6.7",
      footprintSource: "umm-g-gpolygon",
      footprintPrecision: "not_applicable",
      coverage: "catalog-footprint",
      anomalyAssessment: "not-assessed",
    });
    expect(discovery.passes[0]?.footprint).toEqual({
      type: "Polygon",
      coordinates: [
        [
          [25.9, 38.9],
          [26.1, 38.9],
          [26.1, 39.1],
          [25.9, 39.1],
          [25.9, 38.9],
        ],
      ],
    });
    expect(discovery.products.every((product) => product.status === "ok")).toBe(
      true,
    );
  });

  it("splits a source-declared antimeridian bounding rectangle", () => {
    const product = CMR_FIREMASK_PRODUCTS[0];
    expect(product).toBeDefined();
    if (!product) return;
    const result = parseCmrProductPasses(
      product,
      bytes({
        hits: 1,
        items: [
          cmrItem(product.shortName, "G1003-LANCEMODIS", "2026-07-30T11:00:00Z", {
            BoundingRectangles: [
              {
                WestBoundingCoordinate: 170,
                NorthBoundingCoordinate: 10,
                EastBoundingCoordinate: -170,
                SouthBoundingCoordinate: -10,
              },
            ],
          }),
        ],
      }),
    );

    expect(result.passes[0]).toMatchObject({
      footprintSource: "umm-g-bounding-rectangle",
      footprint: { type: "MultiPolygon" },
    });
    expect(result.passes[0]?.footprint.coordinates).toHaveLength(2);
  });

  it("splits a real NASA dateline swath at great-circle seam intersections", () => {
    const product = CMR_FIREMASK_PRODUCTS[0];
    expect(product).toBeDefined();
    if (!product) return;
    const result = parseCmrProductPasses(
      product,
      bytes({
        hits: 1,
        items: [
          cmrItem(product.shortName, "G4263648760-LANCEMODIS", "2026-07-30T11:00:00Z", {
            GPolygons: [
              {
                Boundary: {
                  Points: [
                    { Longitude: -178.843964, Latitude: 29.286585 },
                    { Longitude: -146.769485, Latitude: 34.165283 },
                    { Longitude: -147.329178, Latitude: 54.929882 },
                    { Longitude: 168.525146, Latitude: 48.229374 },
                    { Longitude: -178.843964, Latitude: 29.286585 },
                  ],
                },
              },
            ],
          }),
        ],
      }),
    );

    expect(result.rejectedItems).toEqual([]);
    const footprint = result.passes[0]?.footprint;
    expect(footprint).toBeDefined();
    if (!footprint) return;
    expect(footprint.type).toBe("MultiPolygon");
    expectValidRfc7946Footprint(footprint);
    expect(footprintContains(footprint, [179, 40])).toBe(true);
    expect(footprintContains(footprint, [-179, 40])).toBe(true);
    expect(footprintContains(footprint, [0, 40])).toBe(false);

    const seamLatitudes = footprintPositions(footprint)
      .filter(([longitude]) => Math.abs(longitude) === 180)
      .map(([, latitude]) => latitude);
    expect(seamLatitudes).toEqual(
      expect.arrayContaining([
        expect.closeTo(31.531385656362364, 10),
        expect.closeTo(51.88381588521969, 10),
      ]),
    );
    for (const source of [
      [-178.843964, 29.286585],
      [-146.769485, 34.165283],
      [-147.329178, 54.929882],
      [168.525146, 48.229374],
    ] as const) {
      expect(
        footprintPositions(footprint).some(
          ([longitude, latitude]) =>
            longitude === source[0] && latitude === source[1],
        ),
      ).toBe(true);
    }
  });

  it.each([
    [
      "G4263812281-LANCEMODIS",
      [
        [83.600647, 64.969757],
        [175.711746, 78.274475],
        [-60.508934, 78.426384],
        [31.871296, 65.005386],
        [83.600647, 64.969757],
      ],
    ],
    [
      "G4264286042-LANCEMODIS",
      [
        [-64.409058, 67.261734],
        [91.382027, 84.475372],
        [-177.547867, 70.299553],
        [-111.234863, 60.244175],
        [-64.409058, 67.261734],
      ],
    ],
    [
      "G4264357297-LANCEMODIS",
      [
        [-94.19825, 67.324249],
        [83.351425, 84.796158],
        [158.064423, 68.582367],
        [-139.292374, 59.043045],
        [-94.19825, 67.324249],
      ],
    ],
    [
      "G4264167057-LANCEMODIS",
      [
        [-4.543541, 66.679306],
        [116.370934, 82.491821],
        [-129.442398, 73.592476],
        [-54.662376, 62.368111],
        [-4.543541, 66.679306],
      ],
    ],
  ])("preserves the north-polar cap for live NASA swath %s", (conceptId, points) => {
    const product = CMR_FIREMASK_PRODUCTS[0];
    expect(product).toBeDefined();
    if (!product) return;
    const result = parseCmrProductPasses(
      product,
      bytes({
        hits: 1,
        items: [
          cmrItem(product.shortName, conceptId, "2026-07-30T11:00:00Z", {
            GPolygons: [{
              Boundary: {
                Points: points.map(([Longitude, Latitude]) => ({
                  Longitude,
                  Latitude,
                })),
              },
            }],
          }),
        ],
      }),
    );

    expect(result.rejectedItems).toEqual([]);
    const footprint = result.passes[0]?.footprint;
    expect(footprint).toBeDefined();
    if (!footprint) return;
    expect(footprint.type).toBe("Polygon");
    expectValidRfc7946Footprint(footprint);
    expect(footprintContains(footprint, [0, 89])).toBe(true);
    expect(footprintContains(footprint, [179, 89])).toBe(true);
    expect(footprintContains(footprint, [-179, 89])).toBe(true);
    expect(footprintContains(footprint, [0, 0])).toBe(false);
    for (const source of points.slice(0, -1)) {
      expect(
        footprintPositions(footprint).some(
          ([longitude, latitude]) =>
            longitude === source[0] && latitude === source[1],
        ),
      ).toBe(true);
    }
  });

  it("quarantines a north-polar exterior whose winding claims the south pole", () => {
    const product = CMR_FIREMASK_PRODUCTS[0];
    expect(product).toBeDefined();
    if (!product) return;
    const points = [
      [83.600647, 64.969757],
      [31.871296, 65.005386],
      [-60.508934, 78.426384],
      [175.711746, 78.274475],
      [83.600647, 64.969757],
    ] as const;
    const result = parseCmrProductPasses(
      product,
      bytes({
        hits: 1,
        items: [
          cmrItem(product.shortName, "G1008-LANCEMODIS", "2026-07-30T11:00:00Z", {
            GPolygons: [{
              Boundary: {
                Points: points.map(([Longitude, Latitude]) => ({
                  Longitude,
                  Latitude,
                })),
              },
            }],
          }),
        ],
      }),
    );
    expect(result).toMatchObject({
      passes: [],
      rejectedItems: [{
        conceptId: "G1008-LANCEMODIS",
        reason: "invalid-footprint",
      }],
    });
  });

  it("preserves the mirrored south-polar winding without selecting its complement", () => {
    const product = CMR_FIREMASK_PRODUCTS[0];
    expect(product).toBeDefined();
    if (!product) return;
    // Derived by reflecting and reversing live G4263812281-LANCEMODIS. This
    // exercises the opposite CMR exterior winding without inventing a query
    // rectangle or treating the northern fixture as southern evidence.
    const points = [
      [83.600647, -64.969757],
      [31.871296, -65.005386],
      [-60.508934, -78.426384],
      [175.711746, -78.274475],
      [83.600647, -64.969757],
    ] as const;
    const result = parseCmrProductPasses(
      product,
      bytes({
        hits: 1,
        items: [
          cmrItem(product.shortName, "G1007-LANCEMODIS", "2026-07-30T11:00:00Z", {
            GPolygons: [{
              Boundary: {
                Points: points.map(([Longitude, Latitude]) => ({
                  Longitude,
                  Latitude,
                })),
              },
            }],
          }),
        ],
      }),
    );
    const footprint = result.passes[0]?.footprint;
    expect(footprint).toBeDefined();
    if (!footprint) return;
    expectValidRfc7946Footprint(footprint);
    expect(footprintContains(footprint, [0, -89])).toBe(true);
    expect(footprintContains(footprint, [179, -89])).toBe(true);
    expect(footprintContains(footprint, [-179, -89])).toBe(true);
    expect(footprintContains(footprint, [0, 0])).toBe(false);
  });

  it("subtracts a source-declared hole that crosses the dateline", () => {
    const product = CMR_FIREMASK_PRODUCTS[0];
    expect(product).toBeDefined();
    if (!product) return;
    const result = parseCmrProductPasses(
      product,
      bytes({
        hits: 1,
        items: [
          cmrItem(product.shortName, "G1004-LANCEMODIS", "2026-07-30T11:00:00Z", {
            GPolygons: [{
              Boundary: {
                Points: [
                  { Longitude: 170, Latitude: -20 },
                  { Longitude: -170, Latitude: -20 },
                  { Longitude: -170, Latitude: 20 },
                  { Longitude: 170, Latitude: 20 },
                  { Longitude: 170, Latitude: -20 },
                ],
              },
              ExclusiveZone: {
                Boundaries: [{
                  Points: [
                    { Longitude: 175, Latitude: -5 },
                    { Longitude: 175, Latitude: 5 },
                    { Longitude: -175, Latitude: 5 },
                    { Longitude: -175, Latitude: -5 },
                    { Longitude: 175, Latitude: -5 },
                  ],
                }],
              },
            }],
          }),
        ],
      }),
    );
    const footprint = result.passes[0]?.footprint;
    expect(footprint).toBeDefined();
    if (!footprint) return;
    expectValidRfc7946Footprint(footprint);
    expect(footprintContains(footprint, [179, 0])).toBe(false);
    expect(footprintContains(footprint, [-179, 0])).toBe(false);
    expect(footprintContains(footprint, [172, 0])).toBe(true);
    expect(footprintContains(footprint, [-172, 0])).toBe(true);
  });

  it("quarantines missing or invalid footprints instead of substituting bounds", () => {
    const product = CMR_FIREMASK_PRODUCTS[0];
    expect(product).toBeDefined();
    if (!product) return;
    const missing = cmrItem(
      product.shortName,
      "G1005-LANCEMODIS",
      "2026-07-30T11:00:00Z",
    );
    delete (missing.umm as { SpatialExtent?: unknown }).SpatialExtent;
    const openRing = cmrItem(
      product.shortName,
      "G1006-LANCEMODIS",
      "2026-07-30T11:00:00Z",
      {
        GPolygons: [
          {
            Boundary: {
              Points: [
                { Longitude: 25, Latitude: 38 },
                { Longitude: 26, Latitude: 38 },
                { Longitude: 26, Latitude: 39 },
                { Longitude: 25, Latitude: 39 },
              ],
            },
          },
        ],
      },
    );

    const result = parseCmrProductPasses(
      product,
      bytes({ hits: 2, items: [missing, openRing] }),
    );
    expect(result).toMatchObject({
      status: "ok",
      returnedItems: 2,
      passes: [],
      rejectedItems: [
        { conceptId: "G1005-LANCEMODIS", revisionId: 7, reason: "missing-footprint" },
        { conceptId: "G1006-LANCEMODIS", revisionId: 7, reason: "invalid-footprint" },
      ],
    });
  });

  it("retains each accepted pass's exact response item index across rejects and sorting", () => {
    const product = CMR_FIREMASK_PRODUCTS[0];
    expect(product).toBeDefined();
    if (!product) return;
    const rejected = cmrItem(
      product.shortName,
      "G1010-LANCEMODIS",
      "2026-07-30T11:50:00Z",
    );
    delete (rejected.umm as { SpatialExtent?: unknown }).SpatialExtent;
    const earlier = cmrItem(
      product.shortName,
      "G1011-LANCEMODIS",
      "2026-07-30T11:00:00Z",
    );
    const later = cmrItem(
      product.shortName,
      "G1012-LANCEMODIS",
      "2026-07-30T12:00:00Z",
    );

    const result = parseCmrProductPasses(
      product,
      bytes({ hits: 3, items: [rejected, earlier, later] }),
    );

    expect(result.rejectedItems).toMatchObject([{ itemIndex: 0 }]);
    expect(result.passes.map((pass) => ({ id: pass.id, itemIndex: pass.itemIndex })))
      .toEqual([
        { id: "G1012-LANCEMODIS", itemIndex: 2 },
        { id: "G1011-LANCEMODIS", itemIndex: 1 },
      ]);
  });

  it("does not promote malformed upstream concept identities", () => {
    const product = CMR_FIREMASK_PRODUCTS[0];
    expect(product).toBeDefined();
    if (!product) return;
    const malformed = cmrItem(
      product.shortName,
      "not-a-cmr-concept",
      "2026-07-30T11:00:00Z",
    );

    const result = parseCmrProductPasses(
      product,
      bytes({ hits: 1, items: [malformed] }),
    );

    expect(result).toMatchObject({
      status: "ok",
      returnedItems: 1,
      passes: [],
      rejectedItems: [
        { conceptId: null, revisionId: 7, reason: "invalid-item" },
      ],
    });
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
