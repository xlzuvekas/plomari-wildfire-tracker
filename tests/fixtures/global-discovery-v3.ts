import {
  AREA_GRID_VERSION,
  parseAreaCellKey,
} from "../../lib/firewatch/map-context";
import {
  coarseAreaScopeSchema,
  GLOBAL_DISCOVERY_ORDERING,
  GLOBAL_DISCOVERY_POLICY_VERSION,
  GLOBAL_DISCOVERY_SCHEMA_VERSION,
  type CoarseAreaScope,
  type ExploreDiscoveryResponse,
  type NearbyDiscoveryResponse,
} from "../../lib/firewatch/v3";

function syntheticCoarseScope(
  cell: string,
  timeZone: string,
): CoarseAreaScope {
  const area = parseAreaCellKey(cell);
  if (!area) throw new Error(`Synthetic fixture cell is invalid: ${cell}`);
  return coarseAreaScopeSchema.parse({
    kind: "coarse-area",
    gridVersion: AREA_GRID_VERSION,
    cell: area.cellKey,
    bounds: area.bounds,
    minimumSpanM: area.minimumSpanM,
    timeZone,
  });
}

/** Sanitized synthetic data: no provider payload, credential, or row ID. */
export const SYNTHETIC_MARSEILLE_EXPLORE: ExploreDiscoveryResponse = {
  schemaVersion: GLOBAL_DISCOVERY_SCHEMA_VERSION,
  kind: "explore-candidates",
  scope: {
    kind: "global",
    gridVersion: AREA_GRID_VERSION,
  },
  time: {
    asOf: "2026-07-31T17:00:00.000Z",
    knownAt: "2026-07-31T17:05:00.000Z",
    observedWindow: {
      from: "2026-07-30T17:00:00.000Z",
      to: "2026-07-31T17:00:00.000Z",
    },
    timeZone: {
      id: "UTC",
      basis: "utc-fallback",
    },
    normalizedTimeZone: "UTC",
    semantics: {
      asOf: "event-time-cutoff",
      knownAt: "knowledge-time-cutoff",
      observedWindow: "event-time-inclusion-window",
      timeZone: "display-only",
    },
  },
  coverage: {
    state: "complete",
    policyVersion: GLOBAL_DISCOVERY_POLICY_VERSION,
    checkedAt: "2026-07-31T17:04:00.000Z",
    freshnessDeadline: "2026-07-31T17:20:00.000Z",
    requiredPartitionCount: 3,
    completedPartitionCount: 3,
  },
  result: { state: "items" },
  candidates: [
    {
      kind: "wildfire-candidate",
      candidateId: "01900000-0000-7000-8000-000000000201",
      classification: "unconfirmed-signal",
      displayArea: syntheticCoarseScope("wm/10/527/375", "Europe/Paris"),
      basis: {
        signalKinds: ["thermal_detection"],
        observationCount: 2,
        sourceCount: 1,
      },
      times: {
        firstObservedAt: {
          precision: "exact",
          instant: "2026-07-31T16:35:00.000Z",
        },
        latestObservedAt: {
          precision: "exact",
          instant: "2026-07-31T16:50:00.000Z",
        },
        knownAt: "2026-07-31T16:55:00.000Z",
      },
    },
  ],
  ordering: GLOBAL_DISCOVERY_ORDERING,
  page: {
    limit: 50,
    isFirstPage: true,
    hasMore: false,
    nextCursor: null,
  },
};

/** Sanitized synthetic incident summary, not a claim about current conditions. */
export const SYNTHETIC_PLOMARI_NEARBY: NearbyDiscoveryResponse = {
  schemaVersion: GLOBAL_DISCOVERY_SCHEMA_VERSION,
  kind: "nearby-incidents",
  scope: syntheticCoarseScope("wm/10/587/391", "Europe/Athens"),
  time: {
    asOf: "2026-07-31T18:00:00.000Z",
    knownAt: "2026-07-31T18:05:00.000Z",
    observedWindow: {
      from: "2026-07-30T18:00:00.000Z",
      to: "2026-07-31T18:00:00.000Z",
    },
    timeZone: {
      id: "Europe/Athens",
      basis: "scope",
    },
    normalizedTimeZone: "UTC",
    semantics: {
      asOf: "event-time-cutoff",
      knownAt: "knowledge-time-cutoff",
      observedWindow: "event-time-inclusion-window",
      timeZone: "display-only",
    },
  },
  coverage: {
    state: "complete",
    policyVersion: GLOBAL_DISCOVERY_POLICY_VERSION,
    checkedAt: "2026-07-31T18:04:00.000Z",
    freshnessDeadline: "2026-07-31T18:20:00.000Z",
    requiredPartitionCount: 4,
    completedPartitionCount: 4,
  },
  result: { state: "items" },
  incidents: [
    {
      kind: "incident",
      contractVersion: "1.1.0",
      incidentId: "01900000-0000-7000-8000-000000000101",
      slug: "synthetic-plomari-wildfire",
      displayNames: {
        "el-GR": "Συνθετικό συμβάν Πλωμαρίου",
        "en-GB": "Synthetic Plomari incident",
      },
      incidentKind: "wildfire",
      lifecycle: "monitoring",
      areaRelationship: { kind: "intersects-cell" },
      times: {
        startedAt: {
          precision: "exact",
          instant: "2026-07-29T10:00:00.000Z",
        },
        latestObservedAt: {
          precision: "exact",
          instant: "2026-07-31T17:50:00.000Z",
        },
        knownAt: "2026-07-31T18:01:00.000Z",
      },
    },
  ],
  ordering: GLOBAL_DISCOVERY_ORDERING,
  page: {
    limit: 50,
    isFirstPage: true,
    hasMore: false,
    nextCursor: null,
  },
};

/**
 * Sanitized synthetic empty proof. Its semantics are deliberately “no known
 * incidents,” never “no fire,” “safe,” or an all-clear assessment.
 */
export const SYNTHETIC_PARIS_VALID_EMPTY: NearbyDiscoveryResponse = {
  schemaVersion: GLOBAL_DISCOVERY_SCHEMA_VERSION,
  kind: "nearby-incidents",
  scope: syntheticCoarseScope("wm/10/518/352", "Europe/Paris"),
  time: {
    asOf: "2026-07-31T15:00:00.000Z",
    knownAt: "2026-07-31T15:05:00.000Z",
    observedWindow: {
      from: "2026-07-30T15:00:00.000Z",
      to: "2026-07-31T15:00:00.000Z",
    },
    timeZone: {
      id: "Europe/Paris",
      basis: "scope",
    },
    normalizedTimeZone: "UTC",
    semantics: {
      asOf: "event-time-cutoff",
      knownAt: "knowledge-time-cutoff",
      observedWindow: "event-time-inclusion-window",
      timeZone: "display-only",
    },
  },
  coverage: {
    state: "complete",
    policyVersion: GLOBAL_DISCOVERY_POLICY_VERSION,
    checkedAt: "2026-07-31T15:04:00.000Z",
    freshnessDeadline: "2026-07-31T15:20:00.000Z",
    requiredPartitionCount: 3,
    completedPartitionCount: 3,
  },
  result: {
    state: "valid-empty",
    messageCode: "no_known_incidents_in_area",
    assessment: "known_incident_discovery_only",
    allClearAssessment: "not_assessed",
  },
  incidents: [],
  ordering: GLOBAL_DISCOVERY_ORDERING,
  page: {
    limit: 50,
    isFirstPage: true,
    hasMore: false,
    nextCursor: null,
  },
};

export const SYNTHETIC_GLOBAL_DISCOVERY_FIXTURES = [
  SYNTHETIC_MARSEILLE_EXPLORE,
  SYNTHETIC_PLOMARI_NEARBY,
  SYNTHETIC_PARIS_VALID_EMPTY,
];
