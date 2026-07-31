import { z } from "zod";

import { parseAreaCellKey } from "../map-context";

const instantSchema = z.iso.datetime({ offset: true });
const nullableInstantSchema = instantSchema.nullable();
const idSchema = z.string().trim().min(1).max(256);
const nonnegativeIntegerSchema = z.number().int().nonnegative().safe();
const nullableNonnegativeIntegerSchema = nonnegativeIntegerSchema.nullable();
const longitudeSchema = z.number().finite().min(-180).max(180);
const latitudeSchema = z.number().finite().min(-90).max(90);
const positionSchema = z.tuple([longitudeSchema, latitudeSchema]);
const linearRingSchema = z.array(positionSchema).min(4).max(4_096);
const polygonCoordinatesSchema = z.array(linearRingSchema).min(1).max(128);

const footprintSchema = z.discriminatedUnion("type", [
  z.strictObject({
    type: z.literal("Polygon"),
    coordinates: polygonCoordinatesSchema,
  }),
  z.strictObject({
    type: z.literal("MultiPolygon"),
    coordinates: z.array(polygonCoordinatesSchema).min(1).max(128),
  }),
]);

export const satellitePassResultStateSchema = z.enum([
  "catalog-footprints",
  "valid-empty",
  "complete-not-eligible",
  "complete_stale",
  "partial",
  "disabled",
  "unconfigured",
  "unavailable",
]);

export const satellitePassPayloadSchema = z.strictObject({
  schemaVersion: z.literal(3),
  mode: z.literal("persisted"),
  scope: z.strictObject({
    kind: z.literal("coarse-area"),
    gridVersion: z.literal("web-mercator-adaptive-v1"),
    cell: z.string().refine((value) => parseAreaCellKey(value) !== null),
    bounds: z.strictObject({
      west: longitudeSchema,
      south: latitudeSchema,
      east: longitudeSchema,
      north: latitudeSchema,
    }),
  }),
  timeSemantics: z.strictObject({
    format: z.literal("RFC3339"),
    normalizedTimeZone: z.literal("UTC"),
    observed: z.literal("source granule coverage interval"),
    produced: z.literal("source production time when supplied"),
    cataloged: z.literal("source CMR catalog revision time"),
    retrieved: z.literal("Firewatch evidence retrieval time"),
  }),
  requestedWindow: z.strictObject({
    from: instantSchema,
    to: instantSchema,
    timeZone: z.literal("UTC"),
  }),
  scan: z.strictObject({
    source: z.strictObject({ id: idSchema, key: idSchema }),
    collectionTarget: z.strictObject({ id: idSchema, revisionId: idSchema }),
    healthId: idSchema.nullable(),
    scanHealthId: idSchema.nullable(),
    healthState: z.enum([
      "healthy",
      "stale",
      "failed",
      "rate_limited",
      "authentication_failed",
      "unconfigured",
      "disabled",
      "unknown",
    ]),
    coverageState: z.enum([
      "disabled",
      "unconfigured",
      "complete_current",
      "complete_stale",
      "partial",
      "unavailable",
    ]),
    scanKind: z
      .enum(["bootstrap", "incremental", "reconciliation"])
      .nullable(),
    sourceRequestWindow: z.strictObject({
      from: nullableInstantSchema,
      to: nullableInstantSchema,
      timeZone: z.literal("UTC"),
    }),
    watermark: z.strictObject({
      from: nullableInstantSchema,
      updatedSince: nullableInstantSchema,
      to: nullableInstantSchema,
      timeZone: z.literal("UTC"),
    }),
    continuousCoverage: z.strictObject({
      from: nullableInstantSchema,
      to: nullableInstantSchema,
      timeZone: z.literal("UTC"),
    }),
    lineage: z.strictObject({
      predecessorHealthId: idSchema.nullable(),
      baselineHealthId: idSchema.nullable(),
      depth: nullableNonnegativeIntegerSchema,
      coversRequestedWindow: z.boolean(),
    }),
    freshness: z.strictObject({
      checkedAt: nullableInstantSchema,
      lastSuccessAt: nullableInstantSchema,
      latestSourceObservedAt: nullableInstantSchema,
      scanCheckedAt: nullableInstantSchema,
      deadline: nullableInstantSchema,
      isCurrent: z.boolean(),
      timeZone: z.literal("UTC"),
    }),
    completeness: z.strictObject({
      expectedProducts: z
        .array(z.enum(["VNP14IMG_NRT", "VJ114IMG_NRT", "VJ214IMG_NRT"]))
        .length(3),
      completedProducts: z
        .array(z.enum(["VNP14IMG_NRT", "VJ114IMG_NRT", "VJ214IMG_NRT"]))
        .max(3)
        .nullable(),
      pageCount: nullableNonnegativeIntegerSchema,
      upstreamHitCount: nullableNonnegativeIntegerSchema,
      acceptedGranuleCount: nullableNonnegativeIntegerSchema,
      geographic: z.number().finite().min(0).max(1).nullable(),
      schemaFailureCount: nullableNonnegativeIntegerSchema,
    }),
  }),
  result: z.strictObject({
    state: satellitePassResultStateSchema,
    validEmpty: z.boolean(),
    count: z
      .strictObject({
        value: nonnegativeIntegerSchema,
        relation: z.enum(["exact", "at-least"]),
      })
      .optional(),
    coverage: z.literal("catalog-footprint-intersection"),
    anomalyAssessment: z.literal("not_assessed"),
    message: z.string().trim().min(1).max(1_000),
  }),
  passes: z
    .array(
      z.strictObject({
        observationId: idSchema,
        contractVersion: z.literal("1.1.0"),
        identityVersion: z.enum(["1.0.0", "2.0.0"]),
        source: z.strictObject({ id: idSchema, key: idSchema }),
        catalogGranuleId: idSchema,
        catalogCollectionId: idSchema,
        cmrRevisionId: z.number().int().positive().safe(),
        ummGVersion: z.literal("1.6.7"),
        product: z.enum(["VNP14IMG_NRT", "VJ114IMG_NRT", "VJ214IMG_NRT"]),
        productVersion: z.literal("2"),
        satellite: z.enum(["Suomi-NPP", "NOAA-20", "NOAA-21"]),
        sensor: z.literal("VIIRS"),
        dayNight: z.enum(["day", "night", "both", "unknown"]),
        times: z.strictObject({
          observedFrom: instantSchema,
          observedTo: instantSchema,
          producedAt: nullableInstantSchema,
          catalogedAt: instantSchema,
          retrievedAt: instantSchema,
          timeZone: z.literal("UTC"),
        }),
        coverage: z.strictObject({
          basis: z.literal("cmr_catalog_metadata"),
          relationship: z.literal("catalog_footprint_intersection"),
          footprint: footprintSchema,
          geometryPrecisionM: z.number().finite().nonnegative().nullable(),
          geometryPrecisionSource: z.enum([
            "declared",
            "estimated",
            "not_applicable",
          ]),
        }),
        anomalyAssessment: z.literal("not_assessed"),
      }),
    )
    .max(100),
  page: z.strictObject({
    limit: z.number().int().min(1).max(100),
    truncated: z.boolean(),
  }),
}).superRefine((payload, refinement) => {
  const cell = parseAreaCellKey(payload.scope.cell);
  const canonicalBounds = cell?.bounds;
  if (
    !canonicalBounds ||
    canonicalBounds.west !== payload.scope.bounds.west ||
    canonicalBounds.south !== payload.scope.bounds.south ||
    canonicalBounds.east !== payload.scope.bounds.east ||
    canonicalBounds.north !== payload.scope.bounds.north
  ) {
    refinement.addIssue({
      code: "custom",
      message: "Satellite pass scope does not match its canonical coarse cell",
      path: ["scope", "bounds"],
    });
  }

  if (
    Date.parse(payload.requestedWindow.from) >
    Date.parse(payload.requestedWindow.to)
  ) {
    refinement.addIssue({
      code: "custom",
      message: "Satellite pass window ends before it starts",
      path: ["requestedWindow"],
    });
  }

  if (payload.passes.length > payload.page.limit) {
    refinement.addIssue({
      code: "custom",
      message: "Satellite pass page exceeds its declared limit",
      path: ["passes"],
    });
  }

  if (
    payload.result.count &&
    (payload.result.count.value !== payload.passes.length ||
      payload.result.count.relation !==
        (payload.page.truncated ? "at-least" : "exact"))
  ) {
    refinement.addIssue({
      code: "custom",
      message: "Satellite pass result count is inconsistent with its page",
      path: ["result", "count"],
    });
  }

  const hasFootprints = payload.passes.length > 0;
  if (
    (payload.result.state === "catalog-footprints") !== hasFootprints ||
    payload.result.validEmpty !== (payload.result.state === "valid-empty")
  ) {
    refinement.addIssue({
      code: "custom",
      message: "Satellite pass result state and records are inconsistent",
      path: ["result", "state"],
    });
  }

  const satelliteForProduct = {
    VNP14IMG_NRT: "Suomi-NPP",
    VJ114IMG_NRT: "NOAA-20",
    VJ214IMG_NRT: "NOAA-21",
  } as const;
  payload.passes.forEach((pass, index) => {
    if (Date.parse(pass.times.observedTo) < Date.parse(pass.times.observedFrom)) {
      refinement.addIssue({
        code: "custom",
        message: "Satellite pass observation interval is reversed",
        path: ["passes", index, "times", "observedTo"],
      });
    }
    if (satelliteForProduct[pass.product] !== pass.satellite) {
      refinement.addIssue({
        code: "custom",
        message: "Satellite pass product does not match its platform",
        path: ["passes", index, "satellite"],
      });
    }
    if (
      Date.parse(pass.times.observedTo) <
        Date.parse(payload.requestedWindow.from) ||
      Date.parse(pass.times.observedFrom) >
        Date.parse(payload.requestedWindow.to)
    ) {
      refinement.addIssue({
        code: "custom",
        message: "Satellite pass does not overlap its requested window",
        path: ["passes", index, "times"],
      });
    }
  });
});

export const satellitePassErrorSchema = z.strictObject({
  schemaVersion: z.literal(3),
  error: z.strictObject({
    code: z.enum(["invalid_request", "read_model_unavailable"]),
    message: z.string().trim().min(1).max(500),
  }),
});

export type SatellitePassPayload = z.infer<typeof satellitePassPayloadSchema>;
export type SatellitePass = SatellitePassPayload["passes"][number];

export function buildSatellitePassUrl(cellKey: string, limit = 50) {
  const cell = parseAreaCellKey(cellKey);
  if (!cell || !Number.isInteger(limit) || limit < 1 || limit > 100) {
    throw new TypeError("Satellite pass reads require a canonical coarse cell.");
  }
  const parameters = new URLSearchParams({
    cell: cell.cellKey,
    limit: String(limit),
  });
  return `/api/v3/satellite-passes?${parameters.toString()}`;
}

export function parseSatellitePassPayload(value: unknown) {
  return satellitePassPayloadSchema.parse(value);
}

/** Converts GeoJSON longitude/latitude rings into Leaflet latitude/longitude. */
export function footprintLeafletPolygons(
  footprint: SatellitePass["coverage"]["footprint"],
) {
  const polygons =
    footprint.type === "Polygon"
      ? [footprint.coordinates]
      : footprint.coordinates;
  return polygons.map((polygon) =>
    polygon.map((ring) =>
      ring.map(([longitude, latitude]) => [latitude, longitude] as const),
    ),
  );
}
