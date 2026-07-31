import { z } from "zod";

import { parseAreaCellKey } from "../map-context";
import { utcInstantSchema, uuidV7Schema } from "../../truth/v1/schemas";

export const THERMAL_ANOMALY_SCHEMA_VERSION = 3 as const;
export const THERMAL_ANOMALY_WINDOW_MS = 7 * 24 * 60 * 60_000;
export const THERMAL_ANOMALY_MAX_PAGE_SIZE = 100;
export const THERMAL_ANOMALY_MAX_CURSOR_LENGTH = 1_024;
export const THERMAL_ANOMALY_ORDERING =
  "acquired-at-desc-detection-id-desc" as const;

const canonicalInstantSchema = utcInstantSchema.refine(
  (value) => new Date(value).toISOString() === value,
  "Expected a canonical millisecond UTC instant",
);
const longitudeSchema = z.number().finite().min(-180).max(180);
const latitudeSchema = z.number().finite().min(-90).max(90);
const positiveMeasurementSchema = z.number().finite().positive();
const limitationSchema = z
  .string()
  .regex(/^[a-z0-9]+(?:_[a-z0-9]+)*$/u)
  .max(128);
const limitationsSchema = z.array(limitationSchema).min(1).max(64);

export const thermalAnomalyAssessmentStateSchema = z.enum([
  "detected",
  "awaiting_later_assessment",
  "unknown",
]);

export const thermalAnomalyAssessmentReasonSchema = z.enum([
  "firms_detection_observed",
  "awaiting_later_complete_pass",
  "cmr_coverage_only_anomaly_not_assessed",
  "sensor_assessability_unknown",
  "firms_response_incomplete",
  "firms_response_stale",
  "firms_source_unconfigured",
  "schema_or_lineage_gap",
  "operator_withheld",
]);

const productSchema = z.discriminatedUnion("key", [
  z.strictObject({
    key: z.literal("VIIRS_SNPP_NRT"),
    platform: z.literal("Suomi-NPP"),
    instrument: z.literal("VIIRS"),
  }),
  z.strictObject({
    key: z.literal("VIIRS_NOAA20_NRT"),
    platform: z.literal("NOAA-20"),
    instrument: z.literal("VIIRS"),
  }),
  z.strictObject({
    key: z.literal("VIIRS_NOAA21_NRT"),
    platform: z.literal("NOAA-21"),
    instrument: z.literal("VIIRS"),
  }),
  z.strictObject({
    key: z.literal("MODIS_NRT"),
    platform: z.enum(["Aqua", "Terra"]),
    instrument: z.literal("MODIS"),
  }),
]);

const confidenceSchema = z.discriminatedUnion("encoding", [
  z.strictObject({
    encoding: z.literal("class"),
    value: z.enum(["low", "nominal", "high"]),
  }),
  z.strictObject({
    encoding: z.literal("percent"),
    value: z.number().finite().min(0).max(100),
  }),
]);

const assessmentSchema = z
  .strictObject({
    assessmentId: uuidV7Schema,
    basisDetailRevisionId: uuidV7Schema,
    state: thermalAnomalyAssessmentStateSchema,
    reason: thermalAnomalyAssessmentReasonSchema,
    rule: z.strictObject({
      id: z.string().regex(/^[a-z0-9]+(?:[._-][a-z0-9]+)*$/u).max(128),
      version: z.string().regex(/^\d+\.\d+\.\d+$/u).max(32),
    }),
    asOf: canonicalInstantSchema,
    knownAt: canonicalInstantSchema,
    recordedAt: canonicalInstantSchema,
    claimKind: z.literal("thermal_anomaly_observation_only"),
    operationalEffect: z.literal("none"),
    notificationEligible: z.literal(false),
    officialStatusEligible: z.literal(false),
    protectiveActionEligible: z.literal(false),
    incidentResolutionEligible: z.literal(false),
    limitations: limitationsSchema,
  })
  .superRefine((assessment, context) => {
    const reasonMatchesState =
      (assessment.state === "detected" &&
        assessment.reason === "firms_detection_observed") ||
      (assessment.state === "awaiting_later_assessment" &&
        [
          "awaiting_later_complete_pass",
          "cmr_coverage_only_anomaly_not_assessed",
          "sensor_assessability_unknown",
        ].includes(assessment.reason)) ||
      (assessment.state === "unknown" &&
        [
          "sensor_assessability_unknown",
          "firms_response_incomplete",
          "firms_response_stale",
          "firms_source_unconfigured",
          "schema_or_lineage_gap",
          "operator_withheld",
        ].includes(assessment.reason));
    if (!reasonMatchesState) {
      context.addIssue({
        code: "custom",
        message: "Assessment state and reason are inconsistent",
        path: ["reason"],
      });
    }
    if (Date.parse(assessment.knownAt) > Date.parse(assessment.recordedAt)) {
      context.addIssue({
        code: "custom",
        message: "Assessment was recorded before it was known",
        path: ["recordedAt"],
      });
    }
  });

const thermalAnomalyItemSchema = z
  .strictObject({
    detectionId: uuidV7Schema,
    detailRevision: z.strictObject({
      id: uuidV7Schema,
      version: z.number().int().positive().safe(),
      role: z.literal("assessment-basis"),
    }),
    contractVersion: z.literal("1.1.0"),
    identityVersion: z.literal("firms-detection-v1"),
    source: z.strictObject({
      id: uuidV7Schema,
      key: z.literal("nasa-firms"),
    }),
    product: productSchema,
    times: z.strictObject({
      acquiredAt: canonicalInstantSchema,
      sourcePrecision: z.literal("minute"),
      publishedAt: canonicalInstantSchema.nullable(),
      retrievedAt: canonicalInstantSchema,
      detectionRecordedAt: canonicalInstantSchema,
      itemKnownAt: canonicalInstantSchema,
      timeZone: z.literal("UTC"),
    }),
    centroid: z.strictObject({
      latitude: latitudeSchema,
      longitude: longitudeSchema,
      meaning: z.literal("source-reported-thermal-pixel-centroid"),
    }),
    pixel: z.strictObject({
      scanKm: positiveMeasurementSchema.max(20),
      trackKm: positiveMeasurementSchema.max(20),
      dimensionsMeaning: z.literal(
        "source-reported-kilometres-without-orientation",
      ),
      spatialSupportMethod: z.literal(
        "centroid_with_circumscribed_radius_v1",
      ),
    }),
    confidence: confidenceSchema,
    measurements: z.strictObject({
      brightnessPrimaryK: z.number().finite().min(100).max(1_000),
      brightnessSecondaryK: z.number().finite().min(100).max(1_000),
      brightnessContract: z.enum([
        "viirs_bright_ti4_ti5",
        "modis_brightness_t31",
      ]),
      frpMw: z.number().finite().nonnegative(),
      dayNight: z.enum(["day", "night"]),
      sourceDatasetVersion: z.string().trim().min(1).max(128),
    }),
    assessment: assessmentSchema,
    limitations: limitationsSchema,
  })
  .superRefine((item, context) => {
    if (
      (item.product.instrument === "VIIRS" &&
        (item.confidence.encoding !== "class" ||
          item.measurements.brightnessContract !== "viirs_bright_ti4_ti5")) ||
      (item.product.instrument === "MODIS" &&
        (item.confidence.encoding !== "percent" ||
          item.measurements.brightnessContract !== "modis_brightness_t31"))
    ) {
      context.addIssue({
        code: "custom",
        message: "Thermal measurements do not match their product contract",
        path: ["measurements"],
      });
    }
    if (
      item.assessment.basisDetailRevisionId !== item.detailRevision.id ||
      (item.detailRevision.version === 1) !==
        (item.detailRevision.id === item.detectionId) ||
      Date.parse(item.times.acquiredAt) > Date.parse(item.times.retrievedAt) ||
      (item.times.publishedAt !== null &&
        Date.parse(item.times.publishedAt) >
          Date.parse(item.times.retrievedAt)) ||
      Date.parse(item.times.retrievedAt) >
        Date.parse(item.times.detectionRecordedAt) ||
      Date.parse(item.times.detectionRecordedAt) >
        Date.parse(item.times.itemKnownAt) ||
      Date.parse(item.assessment.knownAt) >
        Date.parse(item.times.itemKnownAt) ||
      Date.parse(item.assessment.recordedAt) >
        Date.parse(item.times.itemKnownAt) ||
      Date.parse(item.assessment.asOf) < Date.parse(item.times.acquiredAt) ||
      Date.parse(item.assessment.asOf) > Date.parse(item.assessment.knownAt)
    ) {
      context.addIssue({
        code: "custom",
        message: "Thermal retrieval and knowledge clocks are inconsistent",
        path: ["times"],
      });
    }
  });

export const thermalAnomalyPayloadSchema = z
  .strictObject({
    schemaVersion: z.literal(THERMAL_ANOMALY_SCHEMA_VERSION),
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
    time: z.strictObject({
      asOf: canonicalInstantSchema,
      knownAt: canonicalInstantSchema,
      observedWindow: z.strictObject({
        from: canonicalInstantSchema,
        to: canonicalInstantSchema,
      }),
      normalizedTimeZone: z.literal("UTC"),
      semantics: z.strictObject({
        asOf: z.literal("source-acquisition-time-cutoff"),
        knownAt: z.literal("Firewatch-knowledge-time-cutoff"),
        acquiredAt: z.literal("source-acquisition-time-minute-precision"),
        publishedAt: z.literal("source-publication-time-when-supplied"),
        retrievedAt: z.literal("Firewatch-evidence-retrieval-time"),
      }),
    }),
    coverage: z.strictObject({
      state: z.literal("not_assessed"),
      meaning: z.literal("row-availability-only"),
    }),
    result: z.strictObject({
      state: z.enum(["items", "indeterminate"]),
      count: z.strictObject({
        value: z.number().int().nonnegative().safe(),
        relation: z.enum(["exact", "at-least"]),
      }),
      allClearAssessment: z.literal("not_assessed"),
      message: z.string().trim().min(1).max(1_000),
    }),
    safety: z.strictObject({
      thermalPixelMeaning: z.literal("satellite-thermal-anomaly-observation"),
      flameLocation: z.literal(false),
      incidentConfirmation: z.literal(false),
      firePerimeter: z.literal(false),
      officialStatus: z.literal(false),
      protectiveAction: z.literal(false),
      incidentResolution: z.literal(false),
      allClear: z.literal(false),
    }),
    anomalies: z.array(thermalAnomalyItemSchema).max(
      THERMAL_ANOMALY_MAX_PAGE_SIZE,
    ),
    page: z.strictObject({
      limit: z.number().int().min(1).max(THERMAL_ANOMALY_MAX_PAGE_SIZE),
      ordering: z.literal(THERMAL_ANOMALY_ORDERING),
      isFirstPage: z.boolean(),
      hasMore: z.boolean(),
      nextCursor: z
        .string()
        .min(1)
        .max(THERMAL_ANOMALY_MAX_CURSOR_LENGTH)
        .nullable(),
    }),
  })
  .superRefine((payload, context) => {
    const cell = parseAreaCellKey(payload.scope.cell);
    if (
      cell === null ||
      cell.bounds.west !== payload.scope.bounds.west ||
      cell.bounds.south !== payload.scope.bounds.south ||
      cell.bounds.east !== payload.scope.bounds.east ||
      cell.bounds.north !== payload.scope.bounds.north
    ) {
      context.addIssue({
        code: "custom",
        message: "Thermal anomaly scope must match its canonical coarse cell",
        path: ["scope", "bounds"],
      });
    }
    const asOf = Date.parse(payload.time.asOf);
    const knownAt = Date.parse(payload.time.knownAt);
    const observedFrom = Date.parse(payload.time.observedWindow.from);
    if (
      asOf > knownAt ||
      payload.time.observedWindow.to !== payload.time.asOf ||
      asOf - observedFrom !== THERMAL_ANOMALY_WINDOW_MS
    ) {
      context.addIssue({
        code: "custom",
        message: "Thermal anomaly temporal cutoffs are inconsistent",
        path: ["time"],
      });
    }
    const ids = new Set<string>();
    for (const [index, anomaly] of payload.anomalies.entries()) {
      if (
        ids.has(anomaly.detectionId) ||
        Date.parse(anomaly.times.acquiredAt) <= observedFrom ||
        Date.parse(anomaly.times.acquiredAt) > asOf ||
        Date.parse(anomaly.times.itemKnownAt) > knownAt ||
        Date.parse(anomaly.assessment.asOf) > asOf ||
        Date.parse(anomaly.assessment.knownAt) > knownAt ||
        Date.parse(anomaly.assessment.recordedAt) > knownAt
      ) {
        context.addIssue({
          code: "custom",
          message: "Thermal anomaly falls outside its response cutoffs",
          path: ["anomalies", index],
        });
      }
      ids.add(anomaly.detectionId);
      const prior = payload.anomalies[index - 1];
      if (
        prior &&
        (Date.parse(prior.times.acquiredAt) <
          Date.parse(anomaly.times.acquiredAt) ||
          (prior.times.acquiredAt === anomaly.times.acquiredAt &&
            prior.detectionId < anomaly.detectionId))
      ) {
        context.addIssue({
          code: "custom",
          message: "Thermal anomalies are not in canonical page order",
          path: ["anomalies", index],
        });
      }
    }
    if (
      payload.anomalies.length > payload.page.limit ||
      payload.result.count.value !== payload.anomalies.length ||
      payload.result.count.relation !==
        (payload.page.hasMore ? "at-least" : "exact") ||
      (payload.page.hasMore &&
        payload.anomalies.length !== payload.page.limit) ||
      (payload.page.nextCursor !== null) !== payload.page.hasMore ||
      (payload.anomalies.length > 0) !== (payload.result.state === "items")
    ) {
      context.addIssue({
        code: "custom",
        message: "Thermal anomaly result metadata is inconsistent",
        path: ["result"],
      });
    }
  });

export const thermalAnomalyErrorSchema = z.strictObject({
  schemaVersion: z.literal(THERMAL_ANOMALY_SCHEMA_VERSION),
  error: z.strictObject({
    code: z.enum(["invalid_request", "read_model_unavailable"]),
    message: z.string().trim().min(1).max(500),
  }),
});

export type ThermalAnomalyPayload = z.output<
  typeof thermalAnomalyPayloadSchema
>;
export type ThermalAnomalyItem = ThermalAnomalyPayload["anomalies"][number];

export function parseThermalAnomalyPayload(value: unknown) {
  return thermalAnomalyPayloadSchema.parse(value);
}
