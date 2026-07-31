import { z } from "zod";

import type { CoarseAreaCell } from "../firewatch/map-context";
import {
  THERMAL_ANOMALY_WINDOW_MS,
  thermalAnomalyAssessmentReasonSchema,
  thermalAnomalyAssessmentStateSchema,
} from "../firewatch/v3/thermal-anomaly-contract";
import { uuidV7Schema } from "../truth/v1/schemas";

import {
  readPostgrestRpcRows,
  SupabasePostgrestReadError,
  type PostgrestReadOptions,
} from "./postgrest";
import { readSupabaseDiscoveryReaderApiKey } from "./server-env";

const MAX_THERMAL_ANOMALY_ROWS = 101;
const THERMAL_ANOMALY_RESPONSE_BYTES = 1_000_000;
const THERMAL_ANOMALY_READER_TIMEOUT_MS = 5_000;
const limitationSchema = z
  .string()
  .regex(/^[a-z0-9]+(?:_[a-z0-9]+)*$/u)
  .max(128);
const limitationsSchema = z.array(limitationSchema).min(1).max(64);
const postgresInstantSchema = z
  .string()
  .refine((value) => Number.isFinite(Date.parse(value)))
  .transform((value) => new Date(value).toISOString());
const nullablePostgresInstantSchema = postgresInstantSchema.nullable();

const productSchema = z.enum([
  "VIIRS_SNPP_NRT",
  "VIIRS_NOAA20_NRT",
  "VIIRS_NOAA21_NRT",
  "MODIS_NRT",
]);
const gateSnapshotSchema = z.string().regex(/^[a-f0-9]{64}$/u);

export const thermalAnomalyReadRowSchema = z
  .strictObject({
    detection_id: uuidV7Schema,
    basis_detection_id: uuidV7Schema,
    basis_version_no: z.number().int().positive().safe(),
    assessment_id: uuidV7Schema,
    source_id: uuidV7Schema,
    source_key: z.literal("nasa-firms"),
    contract_version: z.literal("1.1.0"),
    identity_version: z.literal("firms-detection-v1"),
    product_key: productSchema,
    platform: z.enum(["Suomi-NPP", "NOAA-20", "NOAA-21", "Aqua", "Terra"]),
    instrument: z.enum(["VIIRS", "MODIS"]),
    acquired_at: postgresInstantSchema,
    source_time_precision: z.literal("minute"),
    published_at: nullablePostgresInstantSchema,
    retrieved_at: postgresInstantSchema,
    detection_recorded_at: postgresInstantSchema,
    latitude: z.number().finite().min(-90).max(90),
    longitude: z.number().finite().min(-180).max(180),
    scan_km: z.number().finite().positive().max(20),
    track_km: z.number().finite().positive().max(20),
    spatial_support_method: z.literal(
      "centroid_with_circumscribed_radius_v1",
    ),
    confidence_class: z.enum(["low", "nominal", "high"]).nullable(),
    confidence_percent: z.number().finite().min(0).max(100).nullable(),
    brightness_primary_k: z.number().finite().min(100).max(1_000),
    brightness_secondary_k: z.number().finite().min(100).max(1_000),
    brightness_contract: z.enum([
      "viirs_bright_ti4_ti5",
      "modis_brightness_t31",
    ]),
    frp_mw: z.number().finite().nonnegative(),
    day_night: z.enum(["day", "night"]),
    source_dataset_version: z.string().trim().min(1).max(128),
    detection_limitations: limitationsSchema,
    assessment_state: thermalAnomalyAssessmentStateSchema,
    assessment_reason: thermalAnomalyAssessmentReasonSchema,
    assessment_rule_id: z
      .string()
      .regex(/^[a-z0-9]+(?:[._-][a-z0-9]+)*$/u)
      .max(128),
    assessment_rule_version: z.string().regex(/^\d+\.\d+\.\d+$/u).max(32),
    assessment_as_of: postgresInstantSchema,
    assessment_known_at: postgresInstantSchema,
    assessment_recorded_at: postgresInstantSchema,
    assessment_limitations: limitationsSchema,
    claim_kind: z.literal("thermal_anomaly_observation_only"),
    operational_effect: z.literal("none"),
    notification_eligible: z.literal(false),
    official_status_eligible: z.literal(false),
    protective_action_eligible: z.literal(false),
    incident_resolution_eligible: z.literal(false),
    item_known_at: postgresInstantSchema,
    gate_snapshot: gateSnapshotSchema,
  })
  .superRefine((row, context) => {
    const platformForProduct = {
      VIIRS_SNPP_NRT: "Suomi-NPP",
      VIIRS_NOAA20_NRT: "NOAA-20",
      VIIRS_NOAA21_NRT: "NOAA-21",
    } as const;
    const productMatches =
      row.product_key === "MODIS_NRT"
        ? row.instrument === "MODIS" &&
          (row.platform === "Aqua" || row.platform === "Terra") &&
          row.confidence_class === null &&
          row.confidence_percent !== null &&
          row.brightness_contract === "modis_brightness_t31"
        : row.instrument === "VIIRS" &&
          row.platform === platformForProduct[row.product_key] &&
          row.confidence_class !== null &&
          row.confidence_percent === null &&
          row.brightness_contract === "viirs_bright_ti4_ti5";
    if (!productMatches) {
      context.addIssue({
        code: "custom",
        message: "FIRMS product, platform, and measurement fields disagree",
        path: ["product_key"],
      });
    }

    if (
      (row.basis_version_no === 1) !==
      (row.basis_detection_id === row.detection_id)
    ) {
      context.addIssue({
        code: "custom",
        message: "Assessment basis revision does not match stable identity",
        path: ["basis_detection_id"],
      });
    }

    const requiredDetectionLimitations = [
      "thermal_pixel_not_flame_location",
      "not_incident_confirmation",
      "pixel_orientation_not_source_supplied",
      "not_official_status",
      "not_protective_guidance",
      "not_all_clear",
    ];
    const requiredAssessmentLimitations = [
      "thermal_detection_not_incident_confirmation",
      "sensor_assessability_unknown",
      "not_official_status",
      "not_protective_guidance",
      "not_incident_resolution",
      "not_all_clear",
    ];
    if (
      !requiredDetectionLimitations.every((value) =>
        row.detection_limitations.includes(value),
      ) ||
      !requiredAssessmentLimitations.every((value) =>
        row.assessment_limitations.includes(value),
      )
    ) {
      context.addIssue({
        code: "custom",
        message: "Thermal anomaly safety limitations are incomplete",
        path: ["assessment_limitations"],
      });
    }

    if (
      Date.parse(row.acquired_at) > Date.parse(row.retrieved_at) ||
      Date.parse(row.retrieved_at) > Date.parse(row.detection_recorded_at) ||
      (row.published_at !== null &&
        Date.parse(row.published_at) > Date.parse(row.retrieved_at)) ||
      Date.parse(row.assessment_as_of) < Date.parse(row.acquired_at) ||
      Date.parse(row.assessment_as_of) > Date.parse(row.assessment_known_at) ||
      Date.parse(row.assessment_known_at) >
        Date.parse(row.assessment_recorded_at) ||
      Date.parse(row.detection_recorded_at) > Date.parse(row.item_known_at) ||
      Date.parse(row.assessment_recorded_at) > Date.parse(row.item_known_at)
    ) {
      context.addIssue({
        code: "custom",
        message: "Thermal anomaly row clocks are inconsistent",
        path: ["item_known_at"],
      });
    }
  });

export type ThermalAnomalyReadRow = z.output<
  typeof thermalAnomalyReadRowSchema
>;

const readInputSchema = z
  .strictObject({
    asOf: postgresInstantSchema,
    knownAt: postgresInstantSchema,
    limit: z.number().int().min(1).max(MAX_THERMAL_ANOMALY_ROWS),
    after: z
      .strictObject({
        acquiredAt: postgresInstantSchema,
        detectionId: uuidV7Schema,
        gateSnapshot: gateSnapshotSchema,
      })
      .nullable(),
  })
  .superRefine((input, context) => {
    if (Date.parse(input.asOf) > Date.parse(input.knownAt)) {
      context.addIssue({
        code: "custom",
        message: "Thermal anomaly cutoffs are invalid",
        path: ["asOf"],
      });
    }
  });

export type ThermalAnomalyReadInput = Readonly<{
  cell: CoarseAreaCell;
  asOf: string;
  knownAt: string;
  limit: number;
  after?: Readonly<{
    acquiredAt: string;
    detectionId: string;
    gateSnapshot: string;
  }>;
}>;

function invalidResponse(): never {
  throw new SupabasePostgrestReadError("invalid_response");
}

function validateRows(
  rows: readonly ThermalAnomalyReadRow[],
  input: z.output<typeof readInputSchema>,
) {
  const ids = new Set<string>();
  const observedFrom = Date.parse(input.asOf) - THERMAL_ANOMALY_WINDOW_MS;
  const expectedGateSnapshot =
    input.after?.gateSnapshot ?? rows[0]?.gate_snapshot;
  for (const [index, row] of rows.entries()) {
    if (
      ids.has(row.detection_id) ||
      row.gate_snapshot !== expectedGateSnapshot ||
      Date.parse(row.acquired_at) <= observedFrom ||
      Date.parse(row.acquired_at) > Date.parse(input.asOf) ||
      Date.parse(row.assessment_as_of) > Date.parse(input.asOf) ||
      Date.parse(row.item_known_at) > Date.parse(input.knownAt) ||
      Date.parse(row.assessment_known_at) > Date.parse(input.knownAt) ||
      Date.parse(row.assessment_recorded_at) > Date.parse(input.knownAt)
    ) {
      invalidResponse();
    }
    if (
      input.after !== null &&
      (Date.parse(row.acquired_at) > Date.parse(input.after.acquiredAt) ||
        (row.acquired_at === input.after.acquiredAt &&
          row.detection_id >= input.after.detectionId))
    ) {
      invalidResponse();
    }
    ids.add(row.detection_id);
    const prior = rows[index - 1];
    if (
      prior &&
      (Date.parse(prior.acquired_at) < Date.parse(row.acquired_at) ||
        (prior.acquired_at === row.acquired_at &&
          prior.detection_id < row.detection_id))
    ) {
      invalidResponse();
    }
  }
}

/**
 * Reads only the allowlisted, cutoff-checked FIRMS assessment projection. The
 * response is intentionally item-only: zero rows carry no coverage or
 * all-clear meaning and must remain indeterminate at the HTTP boundary.
 */
export async function readThermalAnomalyRows(
  input: ThermalAnomalyReadInput,
  options: PostgrestReadOptions = {},
): Promise<ThermalAnomalyReadRow[]> {
  const parsed = readInputSchema.parse({
    asOf: input.asOf,
    knownAt: input.knownAt,
    limit: input.limit,
    after: input.after ?? null,
  });
  const query: Record<string, string> = {
    p_z: String(input.cell.zoom),
    p_x: String(input.cell.x),
    p_y: String(input.cell.y),
    p_as_of: parsed.asOf,
    p_known_at: parsed.knownAt,
    p_limit: String(parsed.limit),
  };
  if (parsed.after !== null) {
    query.p_after_acquired_at = parsed.after.acquiredAt;
    query.p_after_detection_id = parsed.after.detectionId;
    query.p_gate_snapshot = parsed.after.gateSnapshot;
  }
  const rows = await readPostgrestRpcRows({
    ...options,
    apiKey: options.apiKey ?? readSupabaseDiscoveryReaderApiKey(),
    rpc: "thermal_anomalies_v3",
    query,
    rowSchema: thermalAnomalyReadRowSchema,
    maxResponseBytes:
      options.maxResponseBytes ?? THERMAL_ANOMALY_RESPONSE_BYTES,
    timeoutMs: options.timeoutMs ?? THERMAL_ANOMALY_READER_TIMEOUT_MS,
    expectedDatabaseErrors: [
      {
        postgresCode: "54000",
        mapsTo: "scan_cap",
      },
      {
        postgresCode: "57014",
        mapsTo: "database_timeout",
      },
      ...(parsed.after === null
        ? []
        : [
            {
              postgresCode: "22023",
              details: "firewatch_snapshot_changed_v1",
              mapsTo: "snapshot_changed" as const,
            },
          ]),
    ],
  });
  validateRows(rows, parsed);
  return rows;
}

export const thermalAnomalyReadLimits = Object.freeze({
  maximumRows: MAX_THERMAL_ANOMALY_ROWS,
  timeoutMs: THERMAL_ANOMALY_READER_TIMEOUT_MS,
});
