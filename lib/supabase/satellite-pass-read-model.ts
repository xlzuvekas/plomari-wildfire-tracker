import { z } from "zod";

import type { CoarseAreaCell } from "../firewatch/map-context";
import { uuidV7Schema } from "../truth/v1";

import {
  readPostgrestRpcRows,
  SupabasePostgrestReadError,
  type PostgrestReadOptions,
} from "./postgrest";

const CMR_SOURCE_SLUG = "nasa-cmr-firemask";
const MAX_AREA_PASSES = 100;
const SATELLITE_RESPONSE_BYTES = 2_000_000;

const PRODUCTS = [
  "VNP14IMG_NRT",
  "VJ114IMG_NRT",
  "VJ214IMG_NRT",
] as const;
const productSchema = z.enum(PRODUCTS);
const satelliteSchema = z.enum(["Suomi-NPP", "NOAA-20", "NOAA-21"]);
const productSatellite = new Map<string, string>([
  ["VNP14IMG_NRT", "Suomi-NPP"],
  ["VJ114IMG_NRT", "NOAA-20"],
  ["VJ214IMG_NRT", "NOAA-21"],
]);

const postgresInstantSchema = z
  .string()
  .refine((value) => Number.isFinite(Date.parse(value)))
  .transform((value) => new Date(value).toISOString());
const nullablePostgresInstantSchema = postgresInstantSchema.nullable();
const nonnegativeSafeIntegerSchema = z.number().int().nonnegative().safe();
const nullableNonnegativeSafeIntegerSchema = nonnegativeSafeIntegerSchema.nullable();
const ratioSchema = z.number().finite().min(0).max(1);

const longitudeSchema = z.number().finite().min(-180).max(180);
const latitudeSchema = z.number().finite().min(-90).max(90);
const positionSchema = z.tuple([longitudeSchema, latitudeSchema]);
const linearRingSchema = z.array(positionSchema).min(4).max(4_096);
const polygonCoordinatesSchema = z.array(linearRingSchema).min(1).max(128);
const footprintGeoJsonSchema = z.discriminatedUnion("type", [
  z.strictObject({
    type: z.literal("Polygon"),
    coordinates: polygonCoordinatesSchema,
  }),
  z.strictObject({
    type: z.literal("MultiPolygon"),
    coordinates: z.array(polygonCoordinatesSchema).min(1).max(128),
  }),
]);

export const satelliteScanStatusRowSchema = z.strictObject({
  source_id: uuidV7Schema,
  source_slug: z.string().trim().min(1).max(128),
  collection_target_id: uuidV7Schema,
  collection_target_revision_id: uuidV7Schema,
  health_id: uuidV7Schema.nullable(),
  scan_health_id: uuidV7Schema.nullable(),
  health_status: z.enum([
    "healthy",
    "stale",
    "failed",
    "rate_limited",
    "authentication_failed",
    "unconfigured",
    "disabled",
    "unknown",
  ]),
  scan_kind: z.enum(["bootstrap", "incremental", "reconciliation"]).nullable(),
  requested_from: nullablePostgresInstantSchema,
  requested_to: nullablePostgresInstantSchema,
  watermark_from: nullablePostgresInstantSchema,
  updated_since: nullablePostgresInstantSchema,
  watermark_to: nullablePostgresInstantSchema,
  predecessor_health_id: uuidV7Schema.nullable(),
  baseline_health_id: uuidV7Schema.nullable(),
  continuous_coverage_from: nullablePostgresInstantSchema,
  continuous_coverage_to: nullablePostgresInstantSchema,
  lineage_depth: nullableNonnegativeSafeIntegerSchema,
  completed_products: z.array(productSchema).max(PRODUCTS.length).nullable(),
  page_count: nullableNonnegativeSafeIntegerSchema,
  upstream_hit_count: nullableNonnegativeSafeIntegerSchema,
  accepted_granule_count: nullableNonnegativeSafeIntegerSchema,
  checked_at: nullablePostgresInstantSchema,
  last_success_at: nullablePostgresInstantSchema,
  latest_source_observed_at: nullablePostgresInstantSchema,
  scan_checked_at: nullablePostgresInstantSchema,
  geographic_completeness: ratioSchema.nullable(),
  schema_failure_count: nullableNonnegativeSafeIntegerSchema,
  freshness_deadline: nullablePostgresInstantSchema,
  coverage_status: z.enum([
    "disabled",
    "unconfigured",
    "complete_current",
    "complete_stale",
    "partial",
    "unavailable",
  ]),
  is_current: z.boolean(),
  covers_requested_window: z.boolean(),
  valid_empty_eligible: z.boolean(),
  anomaly_assessment: z.literal("not_assessed"),
});

export const satellitePassAreaRowSchema = z
  .strictObject({
    observation_id: uuidV7Schema,
    contract_version: z.literal("1.1.0"),
    identity_version: z.enum(["1.0.0", "2.0.0"]),
    source_id: uuidV7Schema,
    source_slug: z.string().trim().min(1).max(128),
    catalog_granule_id: z.string().trim().min(1).max(256),
    catalog_collection_id: z.string().trim().min(1).max(256),
    cmr_revision_id: z.number().int().positive().safe(),
    umm_g_version: z.literal("1.6.7"),
    product: productSchema,
    product_version: z.literal("2"),
    satellite: satelliteSchema,
    sensor: z.literal("VIIRS"),
    observed_from: postgresInstantSchema,
    observed_to: postgresInstantSchema,
    produced_at: nullablePostgresInstantSchema,
    cataloged_at: postgresInstantSchema,
    retrieved_at: postgresInstantSchema,
    day_night: z.enum(["day", "night", "both", "unknown"]),
    footprint_geojson: footprintGeoJsonSchema,
    geometry_precision_m: z.number().finite().nonnegative().nullable(),
    geometry_precision_source: z.enum([
      "declared",
      "estimated",
      "not_applicable",
    ]),
    footprint_basis: z.literal("cmr_catalog_metadata"),
    anomaly_assessment: z.literal("not_assessed"),
    spatial_relationship: z.literal("catalog_footprint_intersection"),
  })
  .superRefine((row, refinement) => {
    if (productSatellite.get(row.product) !== row.satellite) {
      refinement.addIssue({
        code: "custom",
        message: "CMR product and satellite do not match",
        path: ["satellite"],
      });
    }
    if (Date.parse(row.observed_to) < Date.parse(row.observed_from)) {
      refinement.addIssue({
        code: "custom",
        message: "Pass end precedes pass start",
        path: ["observed_to"],
      });
    }
    if (
      (row.geometry_precision_m === null) !==
      (row.geometry_precision_source === "not_applicable")
    ) {
      refinement.addIssue({
        code: "custom",
        message: "CMR footprint precision value and provenance do not match",
        path: ["geometry_precision_m"],
      });
    }
  });

const SATELLITE_SCAN_STATUS_SELECT = [
  "source_id",
  "source_slug",
  "collection_target_id",
  "collection_target_revision_id",
  "health_id",
  "scan_health_id",
  "health_status",
  "scan_kind",
  "requested_from",
  "requested_to",
  "watermark_from",
  "updated_since",
  "watermark_to",
  "predecessor_health_id",
  "baseline_health_id",
  "continuous_coverage_from",
  "continuous_coverage_to",
  "lineage_depth",
  "completed_products",
  "page_count",
  "upstream_hit_count",
  "accepted_granule_count",
  "checked_at",
  "last_success_at",
  "latest_source_observed_at",
  "scan_checked_at",
  "geographic_completeness",
  "schema_failure_count",
  "freshness_deadline",
  "coverage_status",
  "is_current",
  "covers_requested_window",
  "valid_empty_eligible",
  "anomaly_assessment",
].join(",");

const SATELLITE_PASS_AREA_SELECT = [
  "observation_id",
  "contract_version",
  "identity_version",
  "source_id",
  "source_slug",
  "catalog_granule_id",
  "catalog_collection_id",
  "cmr_revision_id",
  "umm_g_version",
  "product",
  "product_version",
  "satellite",
  "sensor",
  "observed_from",
  "observed_to",
  "produced_at",
  "cataloged_at",
  "retrieved_at",
  "day_night",
  "footprint_geojson",
  "geometry_precision_m",
  "geometry_precision_source",
  "footprint_basis",
  "anomaly_assessment",
  "spatial_relationship",
].join(",");

function invalidResponse(): never {
  throw new SupabasePostgrestReadError("invalid_response");
}

function isOrderedPair(from: string | null, to: string | null) {
  return (
    (from === null && to === null) ||
    (from !== null && to !== null && Date.parse(from) <= Date.parse(to))
  );
}

function isOrderedWatermark(from: string | null, to: string | null) {
  return (
    from === null ||
    (to !== null && Date.parse(from) <= Date.parse(to))
  );
}

function validateScanStatus(
  scan: z.output<typeof satelliteScanStatusRowSchema>,
  observedFrom: string,
  observedTo: string,
) {
  if (scan.source_slug !== CMR_SOURCE_SLUG) invalidResponse();

  if (
    !isOrderedPair(scan.requested_from, scan.requested_to) ||
    !isOrderedWatermark(scan.watermark_from, scan.watermark_to) ||
    !isOrderedPair(
      scan.continuous_coverage_from,
      scan.continuous_coverage_to,
    )
  ) {
    invalidResponse();
  }

  if (scan.scan_kind === null) {
    if (
      scan.scan_health_id !== null ||
      scan.requested_from !== null ||
      scan.requested_to !== null ||
      scan.watermark_from !== null ||
      scan.updated_since !== null ||
      scan.watermark_to !== null ||
      scan.predecessor_health_id !== null ||
      scan.baseline_health_id !== null ||
      scan.continuous_coverage_from !== null ||
      scan.continuous_coverage_to !== null ||
      scan.lineage_depth !== null ||
      scan.completed_products !== null ||
      scan.page_count !== null ||
      scan.upstream_hit_count !== null ||
      scan.accepted_granule_count !== null ||
      scan.scan_checked_at !== null ||
      scan.freshness_deadline !== null
    ) {
      invalidResponse();
    }
  } else {
    if (
      scan.scan_health_id === null ||
      scan.requested_from === null ||
      scan.requested_to === null ||
      scan.watermark_to === null ||
      scan.continuous_coverage_from === null ||
      scan.continuous_coverage_to === null ||
      scan.baseline_health_id === null ||
      scan.lineage_depth === null ||
      scan.completed_products === null ||
      scan.page_count === null ||
      scan.page_count < PRODUCTS.length ||
      scan.upstream_hit_count === null ||
      scan.accepted_granule_count === null ||
      scan.scan_checked_at === null ||
      scan.freshness_deadline === null
    ) {
      invalidResponse();
    }

    const completed = new Set(scan.completed_products);
    if (
      completed.size !== PRODUCTS.length ||
      !PRODUCTS.every((product) => completed.has(product))
    ) {
      invalidResponse();
    }

    if (scan.scan_kind === "incremental") {
      if (
        scan.predecessor_health_id === null ||
        scan.watermark_from === null ||
        scan.updated_since !== scan.watermark_from ||
        scan.lineage_depth < 1
      ) {
        invalidResponse();
      }
    } else if (
      scan.predecessor_health_id !== null ||
      scan.watermark_from !== null ||
      scan.updated_since !== null ||
      scan.lineage_depth !== 0 ||
      scan.baseline_health_id !== scan.scan_health_id
    ) {
      invalidResponse();
    }

    if (
      Date.parse(scan.watermark_to) !==
        Date.parse(scan.requested_to) - 10 * 60_000
    ) {
      invalidResponse();
    }
  }

  if (scan.accepted_granule_count !== scan.upstream_hit_count) {
    invalidResponse();
  }

  const coverageContainsWindow =
    scan.continuous_coverage_from !== null &&
    scan.continuous_coverage_to !== null &&
    Date.parse(scan.continuous_coverage_from) <= Date.parse(observedFrom) &&
    Date.parse(scan.continuous_coverage_to) >= Date.parse(observedTo);
  if (scan.covers_requested_window !== coverageContainsWindow) {
    invalidResponse();
  }

  if (!scan.valid_empty_eligible) return;
  if (
    scan.coverage_status !== "complete_current" ||
    scan.health_status !== "healthy" ||
    !scan.is_current ||
    !scan.covers_requested_window ||
    !coverageContainsWindow ||
    scan.geographic_completeness !== 1 ||
    scan.schema_failure_count !== 0 ||
    scan.scan_health_id === null ||
    scan.scan_kind === null ||
    scan.baseline_health_id === null ||
    scan.lineage_depth === null ||
    scan.checked_at === null ||
    scan.last_success_at === null ||
    scan.scan_checked_at === null ||
    scan.freshness_deadline === null
  ) {
    invalidResponse();
  }
}

function validatePassRows(
  rows: readonly z.output<typeof satellitePassAreaRowSchema>[],
  scan: z.output<typeof satelliteScanStatusRowSchema>,
) {
  const observationIds = new Set<string>();
  for (const row of rows) {
    if (
      row.source_id !== scan.source_id ||
      row.source_slug !== scan.source_slug ||
      observationIds.has(row.observation_id)
    ) {
      invalidResponse();
    }
    observationIds.add(row.observation_id);
  }
}

export type SatellitePassAreaReadInput = Readonly<{
  cell: CoarseAreaCell;
  observedFrom: string;
  observedTo: string;
  limit?: number;
}>;

const requestedWindowSchema = z
  .strictObject({
    observedFrom: postgresInstantSchema,
    observedTo: postgresInstantSchema,
  })
  .superRefine((window, refinement) => {
    const duration =
      Date.parse(window.observedTo) - Date.parse(window.observedFrom);
    if (duration <= 0 || duration > 36 * 60 * 60_000) {
      refinement.addIssue({
        code: "custom",
        message: "Satellite read window must be positive and at most 36 hours",
        path: ["observedTo"],
      });
    }
  });

/**
 * Reads a current global scan summary first, then asks PostGIS for exact
 * intersections with the canonical coarse cell. No provider network request
 * occurs in this path.
 */
export async function readSatellitePassArea(
  input: SatellitePassAreaReadInput,
  options: PostgrestReadOptions = {},
) {
  const limit = z.number().int().min(1).max(MAX_AREA_PASSES).parse(
    input.limit ?? 50,
  );
  const window = requestedWindowSchema.parse({
    observedFrom: input.observedFrom,
    observedTo: input.observedTo,
  });
  const scans = await readPostgrestRpcRows({
    ...options,
    rpc: "satellite_scan_status_for_window",
    query: {
      select: SATELLITE_SCAN_STATUS_SELECT,
      p_observed_from: window.observedFrom,
      p_observed_to: window.observedTo,
    },
    rowSchema: satelliteScanStatusRowSchema,
  });
  if (scans.length !== 1) invalidResponse();
  const scan = scans[0];
  if (!scan) invalidResponse();
  validateScanStatus(scan, window.observedFrom, window.observedTo);

  if (
    scan.coverage_status === "disabled" ||
    scan.coverage_status === "unconfigured"
  ) {
    return Object.freeze({ scan, passes: Object.freeze([]), truncated: false });
  }

  const rows = await readPostgrestRpcRows({
    ...options,
    maxResponseBytes: SATELLITE_RESPONSE_BYTES,
    rpc: "satellite_passes_for_cell",
    query: {
      select: SATELLITE_PASS_AREA_SELECT,
      p_z: String(input.cell.zoom),
      p_x: String(input.cell.x),
      p_y: String(input.cell.y),
      p_observed_from: window.observedFrom,
      p_observed_to: window.observedTo,
      p_limit: String(limit + 1),
    },
    rowSchema: satellitePassAreaRowSchema,
  });
  validatePassRows(rows, scan);

  return Object.freeze({
    scan,
    passes: Object.freeze(rows.slice(0, limit)),
    truncated: rows.length > limit,
  });
}

export const satellitePassReadLimits = Object.freeze({
  maximumAreaPasses: MAX_AREA_PASSES,
});

export type SatellitePassAreaRead = Awaited<
  ReturnType<typeof readSatellitePassArea>
>;
