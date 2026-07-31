import { AREA_GRID_VERSION, parseAreaCellKey } from "../map-context";
import {
  GLOBAL_DISCOVERY_ORDERING,
  GLOBAL_DISCOVERY_POLICY_VERSION,
  GLOBAL_DISCOVERY_SCHEMA_VERSION,
  coarseAreaScopeSchema,
  exploreDiscoveryRequestSchema,
  exploreDiscoveryResponseForRequestSchema,
  nearbyDiscoveryRequestSchema,
  nearbyDiscoveryResponseForRequestSchema,
  type ExploreDiscoveryRequest,
  type ExploreDiscoveryResponse,
  type NearbyDiscoveryRequest,
  type NearbyDiscoveryResponse,
} from "./discovery-contracts";
import type { GlobalDiscoveryClient } from "./global-discovery-client";

const SYNTHETIC_MARSEILLE_CELL = "wm/10/527/375";
const ONE_DAY_MS = 24 * 60 * 60_000;
const FIVE_MINUTES_MS = 5 * 60_000;

export type DevelopmentDiscoveryClientOptions = Readonly<{
  environment?: string;
}>;

function instantBefore(instant: string, milliseconds: number): string {
  return new Date(Date.parse(instant) - milliseconds).toISOString();
}

function instantAfter(instant: string, milliseconds: number): string {
  return new Date(Date.parse(instant) + milliseconds).toISOString();
}

function timeContext(
  request: ExploreDiscoveryRequest | NearbyDiscoveryRequest,
  timeZone: string,
  basis: "scope" | "utc-fallback",
) {
  return {
    asOf: request.time.asOf,
    knownAt: request.time.knownAt,
    observedWindow: {
      from: instantBefore(request.time.asOf, ONE_DAY_MS),
      to: request.time.asOf,
    },
    timeZone: {
      id: timeZone,
      basis,
      utcOffsetMinutesAtAsOf: 0,
    },
    normalizedTimeZone: "UTC" as const,
    semantics: {
      asOf: "event-time-cutoff" as const,
      knownAt: "knowledge-time-cutoff" as const,
      observedWindow: "event-time-inclusion-window" as const,
      timeZone: "display-only" as const,
    },
  };
}

function completeCoverage(
  request: ExploreDiscoveryRequest | NearbyDiscoveryRequest,
  scope:
    | Readonly<{ kind: "global"; gridVersion: typeof AREA_GRID_VERSION }>
    | Readonly<{
        kind: "coarse-area";
        gridVersion: typeof AREA_GRID_VERSION;
        cell: string;
      }>,
) {
  return {
    state: "complete" as const,
    policyVersion: GLOBAL_DISCOVERY_POLICY_VERSION,
    scope,
    checkedAt: request.time.knownAt,
    freshnessDeadline: instantAfter(request.time.knownAt, FIVE_MINUTES_MS),
    coveredEventWindow: {
      from: instantBefore(request.time.asOf, ONE_DAY_MS),
      through: request.time.asOf,
    },
    requiredPartitionCount: 1,
    completedPartitionCount: 1,
  };
}

function syntheticExploreResponse(
  request: ExploreDiscoveryRequest,
): ExploreDiscoveryResponse {
  const cell = parseAreaCellKey(SYNTHETIC_MARSEILLE_CELL);
  if (!cell) throw new Error("Synthetic Marseille cell is invalid.");
  const scope = {
    kind: "global" as const,
    gridVersion: AREA_GRID_VERSION,
  };
  const response = {
    schemaVersion: GLOBAL_DISCOVERY_SCHEMA_VERSION,
    kind: "explore-candidates" as const,
    scope,
    time: timeContext(request, "UTC", "utc-fallback"),
    coverage: completeCoverage(request, scope),
    result: { state: "items" as const },
    candidates: [
      {
        kind: "wildfire-candidate" as const,
        candidateId: "01900000-0000-7000-8000-000000000301",
        classification: "unconfirmed-signal" as const,
        displayArea: coarseAreaScopeSchema.parse({
          kind: "coarse-area",
          gridVersion: AREA_GRID_VERSION,
          cell: cell.cellKey,
          bounds: cell.bounds,
          minimumSpanM: cell.minimumSpanM,
          timeZone: "Europe/Paris",
        }),
        basis: {
          signalKinds: ["thermal_detection" as const],
          observationCount: 2,
          sourceCount: 1,
        },
        times: {
          firstObservedAt: {
            precision: "exact" as const,
            instant: instantBefore(request.time.asOf, 30 * 60_000),
          },
          latestObservedAt: {
            precision: "exact" as const,
            instant: instantBefore(request.time.asOf, FIVE_MINUTES_MS),
          },
          knownAt: request.time.knownAt,
        },
      },
    ],
    ordering: GLOBAL_DISCOVERY_ORDERING,
    page: {
      limit: request.page.limit,
      isFirstPage: request.page.after === null,
      hasMore: false,
      nextCursor: null,
    },
  };
  return exploreDiscoveryResponseForRequestSchema(request).parse(response);
}

function syntheticNearbyResponse(
  request: NearbyDiscoveryRequest,
): NearbyDiscoveryResponse {
  const cell = parseAreaCellKey(request.cell);
  if (!cell || cell.cellKey !== request.cell) {
    throw new TypeError("Synthetic Nearby fixture requires a canonical cell.");
  }
  const scope = coarseAreaScopeSchema.parse({
    kind: "coarse-area",
    gridVersion: AREA_GRID_VERSION,
    cell: cell.cellKey,
    bounds: cell.bounds,
    minimumSpanM: cell.minimumSpanM,
    timeZone: "UTC",
  });
  const response = {
    schemaVersion: GLOBAL_DISCOVERY_SCHEMA_VERSION,
    kind: "nearby-incidents" as const,
    scope,
    time: timeContext(request, "UTC", "scope"),
    coverage: completeCoverage(request, {
      kind: "coarse-area",
      gridVersion: AREA_GRID_VERSION,
      cell: cell.cellKey,
    }),
    result: { state: "items" as const },
    incidents: [
      {
        kind: "incident" as const,
        contractVersion: "1.1.0",
        incidentId: "01900000-0000-7000-8000-000000000302",
        slug: "synthetic-wildfire-exercise",
        displayNames: {
          "en-GB": "Synthetic wildfire exercise",
          "el-GR": "Συνθετική άσκηση πυρκαγιάς",
        },
        incidentKind: "wildfire" as const,
        lifecycle: "monitoring" as const,
        areaRelationship: { kind: "intersects-cell" as const },
        times: {
          startedAt: {
            precision: "exact" as const,
            instant: instantBefore(request.time.asOf, 6 * 60 * 60_000),
          },
          latestObservedAt: {
            precision: "exact" as const,
            instant: instantBefore(request.time.asOf, FIVE_MINUTES_MS),
          },
          knownAt: request.time.knownAt,
        },
      },
    ],
    ordering: GLOBAL_DISCOVERY_ORDERING,
    page: {
      limit: request.page.limit,
      isFirstPage: request.page.after === null,
      hasMore: false,
      nextCursor: null,
    },
  };
  return nearbyDiscoveryResponseForRequestSchema(request).parse(response);
}

/**
 * Explicit development-only synthetic data. Production construction throws,
 * and every successful response retains the visible `fixture` transport.
 */
export function createDevelopmentGlobalDiscoveryClient(
  options: DevelopmentDiscoveryClientOptions = {},
): GlobalDiscoveryClient {
  if ((options.environment ?? process.env.NODE_ENV) !== "development") {
    throw new Error("Synthetic discovery is restricted to development.");
  }

  return {
    async exploreCandidates(request, requestOptions) {
      if (requestOptions?.signal?.aborted) {
        return { kind: "cancelled", retryable: false };
      }
      const parsed = exploreDiscoveryRequestSchema.safeParse(request);
      if (!parsed.success) {
        return { kind: "invalid-request", retryable: false };
      }
      return {
        kind: "snapshot",
        transport: "fixture",
        data: syntheticExploreResponse(parsed.data),
      };
    },

    async nearbyIncidents(request, requestOptions) {
      if (requestOptions?.signal?.aborted) {
        return { kind: "cancelled", retryable: false };
      }
      const parsed = nearbyDiscoveryRequestSchema.safeParse(request);
      if (!parsed.success) {
        return { kind: "invalid-request", retryable: false };
      }
      return {
        kind: "snapshot",
        transport: "fixture",
        data: syntheticNearbyResponse(parsed.data),
      };
    },
  };
}
