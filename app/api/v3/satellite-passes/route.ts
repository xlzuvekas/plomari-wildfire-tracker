import { Buffer } from "node:buffer";
import { createHash } from "node:crypto";

import { z } from "zod";

import { parseAreaCellKey } from "../../../../lib/firewatch/map-context";
import {
  readSatellitePassArea,
  satellitePassReadLimits,
} from "../../../../lib/supabase/satellite-pass-read-model";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SUCCESS_CACHE_CONTROL =
  "public, max-age=0, s-maxage=300, stale-while-revalidate=600";
const ERROR_CACHE_CONTROL = "no-store";
const MAX_PUBLIC_RESPONSE_BYTES = 1_500_000;
const CURRENT_WINDOW_MS = 36 * 60 * 60_000;
const CURRENT_BUCKET_MS = 5 * 60_000;
const ALLOWED_QUERY_NAMES = new Set(["cell", "limit"]);
const querySchema = z.strictObject({
  cell: z.string().trim().min(1).max(64),
  limit: z
    .string()
    .regex(/^[1-9]\d{0,2}$/u)
    .transform(Number)
    .pipe(
      z.number().int().min(1).max(satellitePassReadLimits.maximumAreaPasses),
    )
    .default(50),
});

class InvalidSatellitePassRequestError extends Error {
  constructor() {
    super("Invalid satellite-pass request.");
    this.name = "InvalidSatellitePassRequestError";
  }
}

function parseRequest(request: Request) {
  const parameters = new URL(request.url).searchParams;
  for (const name of parameters.keys()) {
    if (!ALLOWED_QUERY_NAMES.has(name) || parameters.getAll(name).length !== 1) {
      throw new InvalidSatellitePassRequestError();
    }
  }

  const parsed = querySchema.safeParse({
    cell: parameters.get("cell") ?? undefined,
    limit: parameters.get("limit") ?? undefined,
  });
  if (!parsed.success) throw new InvalidSatellitePassRequestError();
  const cell = parseAreaCellKey(parsed.data.cell);
  if (!cell) throw new InvalidSatellitePassRequestError();
  return { cell, limit: parsed.data.limit };
}

function entityTag(body: string) {
  const digest = createHash("sha256").update(body).digest("base64url");
  return `"${digest}"`;
}

function currentRequestedWindow(nowMs: number) {
  const observedToMs = Math.floor(nowMs / CURRENT_BUCKET_MS) * CURRENT_BUCKET_MS;
  return Object.freeze({
    observedFrom: new Date(observedToMs - CURRENT_WINDOW_MS).toISOString(),
    observedTo: new Date(observedToMs).toISOString(),
  });
}

function matchesEntityTag(value: string | null, etag: string) {
  if (!value) return false;
  return value.split(",").some((candidate) => {
    const normalized = candidate.trim();
    return normalized === "*" || normalized === etag || normalized === `W/${etag}`;
  });
}

function resultMessage(
  state: string,
  count: number,
  truncated: boolean,
) {
  if (state === "catalog-footprints") {
    const countLabel = truncated ? `At least ${count}` : String(count);
    return `${countLabel} CMR FireMask catalog footprint${count === 1 ? "" : "s"} intersect this area in the catalog window.`;
  }
  if (state === "valid-empty") {
    return "No CMR FireMask granule footprints intersect this area in the completed catalog window.";
  }
  if (state === "complete-not-eligible") {
    return "The completed catalog scan cannot support an empty-area statement.";
  }
  if (state === "complete_stale") {
    return "The latest complete catalog scan is stale; an empty result is not a current coverage statement.";
  }
  if (state === "partial") {
    return "The catalog scan is partial; missing footprints cannot be interpreted as empty coverage.";
  }
  if (state === "disabled") {
    return "Persisted satellite pass collection is disabled.";
  }
  if (state === "unconfigured") {
    return "Persisted satellite pass collection is not configured.";
  }
  return "Persisted satellite pass coverage is temporarily unavailable.";
}

function errorResponse(error: unknown) {
  const invalidRequest = error instanceof InvalidSatellitePassRequestError;
  return Response.json(
    {
      schemaVersion: 3,
      error: invalidRequest
        ? {
            code: "invalid_request",
            message: "The satellite-pass request is invalid.",
          }
        : {
            code: "read_model_unavailable",
            message: "Persisted satellite pass data is temporarily unavailable.",
          },
    },
    {
      status: invalidRequest ? 400 : 503,
      headers: {
        "Cache-Control": ERROR_CACHE_CONTROL,
        "X-Content-Type-Options": "nosniff",
      },
    },
  );
}

/**
 * Localized, persisted CMR catalog metadata. The browser supplies only a
 * canonical coarse cell; PostGIS derives its polygon and performs the exact
 * footprint intersection. This route never calls NASA.
 */
export async function GET(request: Request) {
  try {
    const query = parseRequest(request);
    const requestedWindow = currentRequestedWindow(Date.now());
    const page = await readSatellitePassArea({
      ...query,
      ...requestedWindow,
    });
    const { scan, passes } = page;
    const validEmpty =
      passes.length === 0 &&
      !page.truncated &&
      scan.covers_requested_window &&
      scan.valid_empty_eligible;
    const resultState =
      passes.length > 0
        ? "catalog-footprints"
        : validEmpty
          ? "valid-empty"
          : scan.coverage_status === "complete_current"
            ? "complete-not-eligible"
            : scan.coverage_status;
    const payload = {
      schemaVersion: 3 as const,
      mode: "persisted" as const,
      scope: {
        kind: "coarse-area" as const,
        gridVersion: query.cell.gridVersion,
        cell: query.cell.cellKey,
        bounds: query.cell.bounds,
      },
      timeSemantics: {
        format: "RFC3339" as const,
        normalizedTimeZone: "UTC" as const,
        observed: "source granule coverage interval" as const,
        produced: "source production time when supplied" as const,
        cataloged: "source CMR catalog revision time" as const,
        retrieved: "Firewatch evidence retrieval time" as const,
      },
      requestedWindow: {
        from: requestedWindow.observedFrom,
        to: requestedWindow.observedTo,
        timeZone: "UTC" as const,
      },
      scan: {
        source: { id: scan.source_id, key: scan.source_slug },
        collectionTarget: {
          id: scan.collection_target_id,
          revisionId: scan.collection_target_revision_id,
        },
        healthId: scan.health_id,
        scanHealthId: scan.scan_health_id,
        healthState: scan.health_status,
        coverageState: scan.coverage_status,
        scanKind: scan.scan_kind,
        sourceRequestWindow: {
          from: scan.requested_from,
          to: scan.requested_to,
          timeZone: "UTC" as const,
        },
        watermark: {
          from: scan.watermark_from,
          updatedSince: scan.updated_since,
          to: scan.watermark_to,
          timeZone: "UTC" as const,
        },
        continuousCoverage: {
          from: scan.continuous_coverage_from,
          to: scan.continuous_coverage_to,
          timeZone: "UTC" as const,
        },
        lineage: {
          predecessorHealthId: scan.predecessor_health_id,
          baselineHealthId: scan.baseline_health_id,
          depth: scan.lineage_depth,
          coversRequestedWindow: scan.covers_requested_window,
        },
        freshness: {
          checkedAt: scan.checked_at,
          lastSuccessAt: scan.last_success_at,
          latestSourceObservedAt: scan.latest_source_observed_at,
          scanCheckedAt: scan.scan_checked_at,
          deadline: scan.freshness_deadline,
          isCurrent: scan.is_current,
          timeZone: "UTC" as const,
        },
        completeness: {
          expectedProducts: [
            "VNP14IMG_NRT",
            "VJ114IMG_NRT",
            "VJ214IMG_NRT",
          ],
          completedProducts: scan.completed_products,
          pageCount: scan.page_count,
          upstreamHitCount: scan.upstream_hit_count,
          acceptedGranuleCount: scan.accepted_granule_count,
          geographic: scan.geographic_completeness,
          schemaFailureCount: scan.schema_failure_count,
        },
      },
      result: {
        state: resultState,
        validEmpty,
        count: {
          value: passes.length,
          relation: page.truncated ? "at-least" as const : "exact" as const,
        },
        coverage: "catalog-footprint-intersection" as const,
        anomalyAssessment: "not_assessed" as const,
        message: resultMessage(resultState, passes.length, page.truncated),
      },
      passes: passes.map((pass) => ({
        observationId: pass.observation_id,
        contractVersion: pass.contract_version,
        identityVersion: pass.identity_version,
        source: { id: pass.source_id, key: pass.source_slug },
        catalogGranuleId: pass.catalog_granule_id,
        catalogCollectionId: pass.catalog_collection_id,
        cmrRevisionId: pass.cmr_revision_id,
        ummGVersion: pass.umm_g_version,
        product: pass.product,
        productVersion: pass.product_version,
        satellite: pass.satellite,
        sensor: pass.sensor,
        dayNight: pass.day_night,
        times: {
          observedFrom: pass.observed_from,
          observedTo: pass.observed_to,
          producedAt: pass.produced_at,
          catalogedAt: pass.cataloged_at,
          retrievedAt: pass.retrieved_at,
          timeZone: "UTC" as const,
        },
        coverage: {
          basis: pass.footprint_basis,
          relationship: pass.spatial_relationship,
          footprint: pass.footprint_geojson,
          geometryPrecisionM: pass.geometry_precision_m,
          geometryPrecisionSource: pass.geometry_precision_source,
        },
        anomalyAssessment: pass.anomaly_assessment,
      })),
      page: { limit: query.limit, truncated: page.truncated },
    };
    const body = JSON.stringify(payload);
    if (Buffer.byteLength(body, "utf8") > MAX_PUBLIC_RESPONSE_BYTES) {
      throw new Error("Satellite pass response exceeded its public bound.");
    }

    const cacheable =
      scan.coverage_status === "complete_current" &&
      scan.is_current &&
      scan.covers_requested_window &&
      (passes.length > 0 || validEmpty);
    const cacheControl = cacheable
      ? SUCCESS_CACHE_CONTROL
      : ERROR_CACHE_CONTROL;
    const etag = entityTag(body);
    const headers = {
      "Cache-Control": cacheControl,
      ...(cacheable ? { ETag: etag, "X-Firewatch-Cacheable": "1" } : {}),
      "X-Content-Type-Options": "nosniff",
    };

    if (
      cacheable &&
      matchesEntityTag(request.headers.get("if-none-match"), etag)
    ) {
      return new Response(null, { status: 304, headers });
    }

    return new Response(body, {
      status: 200,
      headers: {
        ...headers,
        "Content-Type": "application/json; charset=utf-8",
      },
    });
  } catch (error) {
    return errorResponse(error);
  }
}
