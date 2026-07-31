import { describe, expect, it } from "vitest";

import {
  buildSatellitePassUrl,
  footprintLeafletPolygons,
  parseSatellitePassPayload,
} from "../lib/firewatch/v3/satellite-pass-client";
import { parseAreaCellKey } from "../lib/firewatch/map-context";

const CELL_KEY = "wm/10/587/391";
const CELL = (() => {
  const cell = parseAreaCellKey(CELL_KEY);
  if (!cell) throw new Error("Test cell is invalid");
  return cell;
})();

function payloadFixture() {
  return {
    schemaVersion: 3,
    mode: "persisted",
    scope: {
      kind: "coarse-area",
      gridVersion: "web-mercator-adaptive-v1",
      cell: CELL_KEY,
      bounds: CELL.bounds,
    },
    timeSemantics: {
      format: "RFC3339",
      normalizedTimeZone: "UTC",
      observed: "source granule coverage interval",
      produced: "source production time when supplied",
      cataloged: "source CMR catalog revision time",
      retrieved: "Firewatch evidence retrieval time",
    },
    requestedWindow: {
      from: "2026-07-29T06:00:00.000Z",
      to: "2026-07-30T18:00:00.000Z",
      timeZone: "UTC",
    },
    scan: {
      source: { id: "source-id", key: "nasa-cmr-firemask" },
      collectionTarget: { id: "target-id", revisionId: "revision-id" },
      healthId: "health-id",
      scanHealthId: "scan-health-id",
      healthState: "healthy",
      coverageState: "complete_current",
      scanKind: "incremental",
      sourceRequestWindow: {
        from: "2026-07-29T06:00:00.000Z",
        to: "2026-07-30T18:00:00.000Z",
        timeZone: "UTC",
      },
      watermark: {
        from: "2026-07-30T17:45:00.000Z",
        updatedSince: "2026-07-30T17:45:00.000Z",
        to: "2026-07-30T17:50:00.000Z",
        timeZone: "UTC",
      },
      continuousCoverage: {
        from: "2026-07-29T06:00:00.000Z",
        to: "2026-07-30T18:00:00.000Z",
        timeZone: "UTC",
      },
      lineage: {
        predecessorHealthId: "previous-health-id",
        baselineHealthId: "baseline-health-id",
        depth: 12,
        coversRequestedWindow: true,
      },
      freshness: {
        checkedAt: "2026-07-30T18:05:00.000Z",
        lastSuccessAt: "2026-07-30T18:05:00.000Z",
        latestSourceObservedAt: "2026-07-30T17:58:00.000Z",
        scanCheckedAt: "2026-07-30T18:05:00.000Z",
        deadline: "2026-07-30T21:05:00.000Z",
        isCurrent: true,
        timeZone: "UTC",
      },
      completeness: {
        expectedProducts: [
          "VNP14IMG_NRT",
          "VJ114IMG_NRT",
          "VJ214IMG_NRT",
        ],
        completedProducts: [
          "VNP14IMG_NRT",
          "VJ114IMG_NRT",
          "VJ214IMG_NRT",
        ],
        pageCount: 6,
        upstreamHitCount: 421,
        acceptedGranuleCount: 421,
        geographic: 1,
        schemaFailureCount: 0,
      },
    },
    result: {
      state: "catalog-footprints",
      validEmpty: false,
      count: { value: 1, relation: "exact" },
      coverage: "catalog-footprint-intersection",
      anomalyAssessment: "not_assessed",
      message: "One catalog footprint intersects this area.",
    },
    passes: [
      {
        observationId: "observation-id",
        contractVersion: "1.1.0",
        identityVersion: "2.0.0",
        source: { id: "source-id", key: "nasa-cmr-firemask" },
        catalogGranuleId: "G123-LANCEMODIS",
        catalogCollectionId: "C123-LANCEMODIS",
        cmrRevisionId: 4,
        ummGVersion: "1.6.7",
        product: "VJ114IMG_NRT",
        productVersion: "2",
        satellite: "NOAA-20",
        sensor: "VIIRS",
        dayNight: "day",
        times: {
          observedFrom: "2026-07-30T17:54:00.000Z",
          observedTo: "2026-07-30T18:00:00.000Z",
          producedAt: "2026-07-30T18:02:00.000Z",
          catalogedAt: "2026-07-30T18:03:00.000Z",
          retrievedAt: "2026-07-30T18:04:00.000Z",
          timeZone: "UTC",
        },
        coverage: {
          basis: "cmr_catalog_metadata",
          relationship: "catalog_footprint_intersection",
          footprint: {
            type: "Polygon",
            coordinates: [
              [
                [26.3, 38.9],
                [26.4, 38.9],
                [26.4, 39],
                [26.3, 38.9],
              ],
            ],
          },
          geometryPrecisionM: null,
          geometryPrecisionSource: "not_applicable",
        },
        anomalyAssessment: "not_assessed",
      },
    ],
    page: { limit: 20, truncated: false },
  };
}

describe("satellite pass v3 browser contract", () => {
  it("accepts persisted catalog metadata and converts GeoJSON coordinate order", () => {
    const fixture = payloadFixture();
    const payload = parseSatellitePassPayload(fixture);
    expect(payload.scope.cell).toBe(CELL_KEY);
    expect(payload.result.count).toEqual({ value: 1, relation: "exact" });
    expect(
      footprintLeafletPolygons(payload.passes[0]!.coverage.footprint)[0]![0]![0],
    ).toEqual([38.9, 26.3]);

    const legacyResult = {
      state: fixture.result.state,
      validEmpty: fixture.result.validEmpty,
      coverage: fixture.result.coverage,
      anomalyAssessment: fixture.result.anomalyAssessment,
      message: fixture.result.message,
    };
    expect(
      parseSatellitePassPayload({ ...fixture, result: legacyResult }).passes,
    ).toHaveLength(1);
  });

  it("builds a same-origin request from only a canonical coarse cell", () => {
    expect(buildSatellitePassUrl(CELL_KEY, 20)).toBe(
      "/api/v3/satellite-passes?cell=wm%2F10%2F587%2F391&limit=20",
    );
    expect(() => buildSatellitePassUrl("38.989013,26.382489")).toThrow(
      /coarse cell/u,
    );
    expect(() => buildSatellitePassUrl(CELL_KEY, 101)).toThrow(/coarse cell/u);
  });

  it("keeps a completed valid-empty state distinct from an anomaly assessment", () => {
    const fixture = payloadFixture();
    fixture.passes = [];
    fixture.result.state = "valid-empty";
    fixture.result.validEmpty = true;
    fixture.result.count.value = 0;
    fixture.result.message =
      "No CMR FireMask granule footprints intersect this completed window.";
    const payload = parseSatellitePassPayload(fixture);
    expect(payload.result.validEmpty).toBe(true);
    expect(payload.result.anomalyAssessment).toBe("not_assessed");
  });

  it("rejects inconsistent states, exact-scope geometry, and malformed footprints", () => {
    const inconsistent = payloadFixture();
    inconsistent.result.state = "valid-empty";
    expect(() => parseSatellitePassPayload(inconsistent)).toThrow();

    const wrongBounds = payloadFixture();
    wrongBounds.scope.bounds = { ...wrongBounds.scope.bounds, west: 26.3 };
    expect(() => parseSatellitePassPayload(wrongBounds)).toThrow();

    const malformed = payloadFixture();
    malformed.passes[0]!.coverage.footprint.coordinates[0]![0]![0] = 181;
    expect(() => parseSatellitePassPayload(malformed)).toThrow();

    const outsideWindow = payloadFixture();
    outsideWindow.passes[0]!.times.observedFrom =
      "2026-07-31T17:54:00.000Z";
    outsideWindow.passes[0]!.times.observedTo = "2026-07-31T18:00:00.000Z";
    expect(() => parseSatellitePassPayload(outsideWindow)).toThrow();

    const inconsistentCount = payloadFixture();
    inconsistentCount.result.count.relation = "at-least";
    expect(() => parseSatellitePassPayload(inconsistentCount)).toThrow();

    const nonRfc3339 = payloadFixture();
    nonRfc3339.requestedWindow.from = "July 29 2026";
    expect(() => parseSatellitePassPayload(nonRfc3339)).toThrow();

    expect(() =>
      parseSatellitePassPayload({ ...payloadFixture(), latitude: 38.989013 }),
    ).toThrow();
  });
});
