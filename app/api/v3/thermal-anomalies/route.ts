import { Buffer } from "node:buffer";

import { z } from "zod";

import { parseAreaCellKey } from "../../../../lib/firewatch/map-context";
import {
  InvalidThermalAnomalyCursorError,
  THERMAL_ANOMALY_CURSOR_VERSION,
  decodeThermalAnomalyCursor,
  encodeThermalAnomalyCursor,
} from "../../../../lib/firewatch/v3/thermal-anomaly-cursor.server";
import {
  THERMAL_ANOMALY_MAX_CURSOR_LENGTH,
  THERMAL_ANOMALY_MAX_PAGE_SIZE,
  THERMAL_ANOMALY_ORDERING,
  THERMAL_ANOMALY_SCHEMA_VERSION,
  THERMAL_ANOMALY_WINDOW_MS,
  thermalAnomalyPayloadSchema,
} from "../../../../lib/firewatch/v3/thermal-anomaly-contract";
import {
  readThermalAnomalyRows,
  thermalAnomalyReadLimits,
} from "../../../../lib/supabase/thermal-anomaly-read-model";
import { SupabasePostgrestReadError } from "../../../../lib/supabase/postgrest";
import { utcInstantSchema } from "../../../../lib/truth/v1/schemas";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 8;

const MAX_HISTORY_MS = 31 * 24 * 60 * 60_000;
const MAX_FUTURE_SKEW_MS = 5 * 60_000;
const MAX_PUBLIC_RESPONSE_BYTES = 1_000_000;
const ALLOWED_QUERY_NAMES = new Set([
  "cell",
  "schemaVersion",
  "asOf",
  "knownAt",
  "limit",
  "after",
]);
const canonicalCutoffSchema = utcInstantSchema.refine(
  (value) => new Date(value).toISOString() === value,
  "Expected a canonical millisecond UTC cutoff",
);
const querySchema = z.strictObject({
  cell: z.string().trim().min(1).max(64),
  schemaVersion: z.literal(String(THERMAL_ANOMALY_SCHEMA_VERSION)),
  asOf: canonicalCutoffSchema,
  knownAt: canonicalCutoffSchema,
  limit: z
    .string()
    .regex(/^[1-9]\d{0,2}$/u)
    .transform(Number)
    .pipe(z.number().int().min(1).max(THERMAL_ANOMALY_MAX_PAGE_SIZE))
    .default(50),
  after: z
    .string()
    .min(1)
    .max(THERMAL_ANOMALY_MAX_CURSOR_LENGTH)
    .optional(),
});

class InvalidThermalAnomalyRequestError extends Error {
  constructor() {
    super("Invalid thermal anomaly request.");
    this.name = "InvalidThermalAnomalyRequestError";
  }
}

function parseRequest(request: Request, nowMs = Date.now()) {
  const parameters = new URL(request.url).searchParams;
  for (const name of parameters.keys()) {
    if (!ALLOWED_QUERY_NAMES.has(name) || parameters.getAll(name).length !== 1) {
      throw new InvalidThermalAnomalyRequestError();
    }
  }
  const parsed = querySchema.safeParse({
    cell: parameters.get("cell") ?? undefined,
    schemaVersion: parameters.get("schemaVersion") ?? undefined,
    asOf: parameters.get("asOf") ?? undefined,
    knownAt: parameters.get("knownAt") ?? undefined,
    limit: parameters.get("limit") ?? undefined,
    after: parameters.get("after") ?? undefined,
  });
  if (!parsed.success || !Number.isFinite(nowMs)) {
    throw new InvalidThermalAnomalyRequestError();
  }
  const cell = parseAreaCellKey(parsed.data.cell);
  const asOfMs = Date.parse(parsed.data.asOf);
  const knownAtMs = Date.parse(parsed.data.knownAt);
  if (
    cell === null ||
    asOfMs > knownAtMs ||
    asOfMs < nowMs - MAX_HISTORY_MS ||
    knownAtMs < nowMs - MAX_HISTORY_MS ||
    knownAtMs > nowMs + MAX_FUTURE_SKEW_MS ||
    knownAtMs - asOfMs > MAX_HISTORY_MS
  ) {
    throw new InvalidThermalAnomalyRequestError();
  }
  let cursor = null;
  if (parsed.data.after !== undefined) {
    try {
      cursor = decodeThermalAnomalyCursor(parsed.data.after, {
        cell: cell.cellKey,
        asOf: parsed.data.asOf,
        knownAt: parsed.data.knownAt,
        limit: parsed.data.limit,
      });
    } catch (error) {
      if (error instanceof InvalidThermalAnomalyCursorError) {
        throw new InvalidThermalAnomalyRequestError();
      }
      throw error;
    }
  }
  const { cell: _requestedCell, after: _after, ...data } = parsed.data;
  void _requestedCell;
  void _after;
  return Object.freeze({ cell, cursor, ...data });
}

function boundedJson(payload: unknown, status = 200) {
  const body = JSON.stringify(payload);
  if (Buffer.byteLength(body, "utf8") > MAX_PUBLIC_RESPONSE_BYTES) {
    throw new Error("Thermal anomaly response exceeded its public bound.");
  }
  return new Response(body, {
    status,
    headers: {
      "Cache-Control": "no-store",
      "Content-Type": "application/json; charset=utf-8",
      "X-Content-Type-Options": "nosniff",
      "X-Firewatch-Coverage": "not-assessed",
    },
  });
}

function errorResponse(error: unknown) {
  const invalid = error instanceof InvalidThermalAnomalyRequestError;
  const snapshotChanged =
    error instanceof SupabasePostgrestReadError &&
    error.code === "snapshot_changed";
  return boundedJson(
    {
      schemaVersion: THERMAL_ANOMALY_SCHEMA_VERSION,
      error: invalid
        ? {
            code: "invalid_request",
            message: "The thermal anomaly request is invalid.",
          }
        : snapshotChanged
          ? {
              code: "snapshot_changed",
              message:
                "The thermal anomaly snapshot changed. Restart pagination from the first page.",
            }
          : {
              code: "read_model_unavailable",
              message: "Persisted thermal anomaly data is temporarily unavailable.",
            },
    },
    invalid ? 400 : snapshotChanged ? 409 : 503,
  );
}

/**
 * Reads only persisted, assessed FIRMS evidence for one canonical coarse cell.
 * No upstream provider is contacted. An empty response remains indeterminate
 * because this slice does not publish sensing/completeness coverage.
 */
export async function GET(request: Request) {
  try {
    const query = parseRequest(request);
    const rows = await readThermalAnomalyRows({
      cell: query.cell,
      asOf: query.asOf,
      knownAt: query.knownAt,
      limit: Math.min(
        query.limit + 1,
        thermalAnomalyReadLimits.maximumRows,
      ),
      after: query.cursor === null
        ? undefined
        : {
            acquiredAt: query.cursor.afterAcquiredAt,
            detectionId: query.cursor.afterDetectionId,
            gateSnapshot: query.cursor.gateSnapshot,
          },
    });
    const hasMore = rows.length > query.limit;
    const pageRows = rows.slice(0, query.limit);
    const anomalies = pageRows.map((row) => ({
      detectionId: row.detection_id,
      detailRevision: {
        id: row.basis_detection_id,
        version: row.basis_version_no,
        role: "assessment-basis" as const,
      },
      contractVersion: row.contract_version,
      identityVersion: row.identity_version,
      source: { id: row.source_id, key: row.source_key },
      product: {
        key: row.product_key,
        platform: row.platform,
        instrument: row.instrument,
      },
      times: {
        acquiredAt: row.acquired_at,
        sourcePrecision: row.source_time_precision,
        publishedAt: row.published_at,
        retrievedAt: row.retrieved_at,
        detectionRecordedAt: row.detection_recorded_at,
        itemKnownAt: row.item_known_at,
        timeZone: "UTC" as const,
      },
      centroid: {
        latitude: row.latitude,
        longitude: row.longitude,
        meaning: "source-reported-thermal-pixel-centroid" as const,
      },
      pixel: {
        scanKm: row.scan_km,
        trackKm: row.track_km,
        dimensionsMeaning:
          "source-reported-kilometres-without-orientation" as const,
        spatialSupportMethod: row.spatial_support_method,
      },
      confidence: row.confidence_class !== null
        ? { encoding: "class" as const, value: row.confidence_class }
        : {
            encoding: "percent" as const,
            value: row.confidence_percent as number,
          },
      measurements: {
        brightnessPrimaryK: row.brightness_primary_k,
        brightnessSecondaryK: row.brightness_secondary_k,
        brightnessContract: row.brightness_contract,
        frpMw: row.frp_mw,
        dayNight: row.day_night,
        sourceDatasetVersion: row.source_dataset_version,
      },
      assessment: {
        assessmentId: row.assessment_id,
        basisDetailRevisionId: row.basis_detection_id,
        state: row.assessment_state,
        reason: row.assessment_reason,
        rule: {
          id: row.assessment_rule_id,
          version: row.assessment_rule_version,
        },
        asOf: row.assessment_as_of,
        knownAt: row.assessment_known_at,
        recordedAt: row.assessment_recorded_at,
        claimKind: row.claim_kind,
        operationalEffect: row.operational_effect,
        notificationEligible: row.notification_eligible,
        officialStatusEligible: row.official_status_eligible,
        protectiveActionEligible: row.protective_action_eligible,
        incidentResolutionEligible: row.incident_resolution_eligible,
        limitations: row.assessment_limitations,
      },
      limitations: row.detection_limitations,
    }));
    const observedFrom = new Date(
      Date.parse(query.asOf) - THERMAL_ANOMALY_WINDOW_MS,
    ).toISOString();
    const lastRow = pageRows.at(-1);
    const nextCursor = hasMore && lastRow !== undefined
      ? encodeThermalAnomalyCursor({
          v: THERMAL_ANOMALY_CURSOR_VERSION,
          cell: query.cell.cellKey,
          asOf: query.asOf,
          knownAt: query.knownAt,
          limit: query.limit,
          afterAcquiredAt: lastRow.acquired_at,
          afterDetectionId: lastRow.detection_id,
          gateSnapshot: lastRow.gate_snapshot,
        })
      : null;
    const payload = thermalAnomalyPayloadSchema.parse({
      schemaVersion: THERMAL_ANOMALY_SCHEMA_VERSION,
      mode: "persisted",
      scope: {
        kind: "coarse-area",
        gridVersion: query.cell.gridVersion,
        cell: query.cell.cellKey,
        bounds: query.cell.bounds,
      },
      time: {
        asOf: query.asOf,
        knownAt: query.knownAt,
        observedWindow: { from: observedFrom, to: query.asOf },
        normalizedTimeZone: "UTC",
        semantics: {
          asOf: "source-acquisition-time-cutoff",
          knownAt: "Firewatch-knowledge-time-cutoff",
          acquiredAt: "source-acquisition-time-minute-precision",
          publishedAt: "source-publication-time-when-supplied",
          retrievedAt: "Firewatch-evidence-retrieval-time",
        },
      },
      coverage: {
        state: "not_assessed",
        meaning: "row-availability-only",
      },
      result: {
        state: anomalies.length > 0 ? "items" : "indeterminate",
        count: {
          scope: "page",
          value: anomalies.length,
          relation: "exact",
        },
        allClearAssessment: "not_assessed",
        message: anomalies.length > 0
          ? `This page contains ${anomalies.length} assessed satellite thermal-pixel observation${anomalies.length === 1 ? "" : "s"} visible at both cutoffs.${hasMore ? " More observations are available on the next page." : ""}`
          : "No assessed thermal-pixel observations are visible at both cutoffs. Coverage is not assessed, so this is not an all-clear.",
      },
      safety: {
        thermalPixelMeaning: "satellite-thermal-anomaly-observation",
        flameLocation: false,
        incidentConfirmation: false,
        firePerimeter: false,
        officialStatus: false,
        protectiveAction: false,
        incidentResolution: false,
        allClear: false,
      },
      anomalies,
      page: {
        limit: query.limit,
        ordering: THERMAL_ANOMALY_ORDERING,
        isFirstPage: query.cursor === null,
        hasMore,
        nextCursor,
      },
    });
    return boundedJson(payload);
  } catch (error) {
    return errorResponse(error);
  }
}
