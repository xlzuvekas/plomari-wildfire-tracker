import {
  GLOBAL_DISCOVERY_ORDERING,
  GLOBAL_DISCOVERY_POLICY_VERSION,
  GLOBAL_DISCOVERY_SCHEMA_VERSION,
  exploreDiscoveryResponseForRequestSchema,
} from "../../../../../lib/firewatch/v3";
import { parseAreaCellKey } from "../../../../../lib/firewatch/map-context";
import {
  decodeGlobalCandidateCursor,
  encodeGlobalCandidateCursor,
  GLOBAL_CANDIDATE_CURSOR_VERSION,
  InvalidGlobalCandidateCursorError,
} from "../../../../../lib/firewatch/v3/global-discovery-cursor.server";
import {
  boundedDiscoveryJson,
  discoveryObservedFrom,
  discoveryTimeContext,
  globalDiscoveryErrorResponse,
  InvalidGlobalDiscoveryRequestError,
  parseExploreDiscoveryHttpRequest,
} from "../../../../../lib/firewatch/v3/discovery-route.server";
import {
  readGlobalCandidateProjectionPage,
  type GlobalCandidateProjectionItem,
} from "../../../../../lib/supabase/global-discovery-read-model";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 8;

function publicCandidate(row: GlobalCandidateProjectionItem) {
  const cell = parseAreaCellKey(row.cell_key);
  if (cell === null) throw new Error("Persisted candidate cell became invalid.");
  return Object.freeze({
    kind: "wildfire-candidate" as const,
    candidateId: row.candidate_id,
    classification: "unconfirmed-signal" as const,
    displayArea: {
      kind: "coarse-area" as const,
      gridVersion: cell.gridVersion,
      cell: cell.cellKey,
      bounds: cell.bounds,
      minimumSpanM: cell.minimumSpanM,
      timeZone: row.display_timezone,
    },
    basis: {
      signalKinds: row.signal_kinds,
      observationCount: row.observation_count,
      sourceCount: row.source_count,
    },
    times: {
      firstObservedAt: row.first_observed_at === null
        ? { precision: "unknown" as const }
        : { precision: "exact" as const, instant: row.first_observed_at },
      latestObservedAt: {
        precision: "exact" as const,
        instant: row.latest_observed_at,
      },
      knownAt: row.item_known_at,
    },
  });
}

/** Reads only an immutable persisted projection; no provider is contacted. */
export async function GET(request: Request) {
  try {
    const query = parseExploreDiscoveryHttpRequest(request);
    let cursor = null;
    if (query.page.after !== null) {
      try {
        cursor = decodeGlobalCandidateCursor(query.page.after, {
          ...query.time,
          limit: query.page.limit,
        });
      } catch (error) {
        if (error instanceof InvalidGlobalCandidateCursorError) {
          throw new InvalidGlobalDiscoveryRequestError();
        }
        throw error;
      }
    }
    const observedFrom = discoveryObservedFrom(query.time.asOf);
    const page = await readGlobalCandidateProjectionPage({
      observedFrom,
      ...query.time,
      limit: query.page.limit + 1,
      ...(cursor === null
        ? {}
        : {
            continuation: {
              snapshotId: cursor.snapshotId,
              snapshotDigest: cursor.snapshotDigest,
              publicationGateDigest: cursor.publicationGateDigest,
              afterItemKnownAt: cursor.afterItemKnownAt,
              afterCandidateId: cursor.afterCandidateId,
            },
          }),
    });
    const hasMore = page.candidates.length > query.page.limit;
    const pageRows = page.candidates.slice(0, query.page.limit);
    const candidates = pageRows.map(publicCandidate);
    const lastRow = pageRows.at(-1);
    const nextCursor = hasMore && page.snapshot !== null && lastRow !== undefined
      ? encodeGlobalCandidateCursor({
          version: GLOBAL_CANDIDATE_CURSOR_VERSION,
          ...query.time,
          limit: query.page.limit,
          snapshotId: page.snapshot.snapshot_id,
          snapshotDigest: page.snapshot.snapshot_digest,
          publicationGateDigest: page.snapshot.publication_gate_digest,
          afterItemKnownAt: lastRow.item_known_at,
          afterCandidateId: lastRow.candidate_id,
        })
      : null;
    const payload = exploreDiscoveryResponseForRequestSchema(query).parse({
      schemaVersion: GLOBAL_DISCOVERY_SCHEMA_VERSION,
      kind: "explore-candidates",
      scope: {
        kind: "global",
        gridVersion: "web-mercator-adaptive-v1",
      },
      time: discoveryTimeContext({
        ...query.time,
        timeZone: "UTC",
        basis: "utc-fallback",
      }),
      coverage: {
        state: page.snapshot === null ? "unconfigured" : "not_assessed",
        policyVersion: GLOBAL_DISCOVERY_POLICY_VERSION,
        scope: {
          kind: "global",
          gridVersion: "web-mercator-adaptive-v1",
        },
      },
      // Projection publication proves positive items, not sensing completeness.
      // Therefore zero candidates never becomes valid-empty in this endpoint.
      result: candidates.length > 0
        ? { state: "items" }
        : { state: "indeterminate" },
      candidates,
      ordering: GLOBAL_DISCOVERY_ORDERING,
      page: {
        limit: query.page.limit,
        isFirstPage: cursor === null,
        hasMore,
        nextCursor,
      },
    });
    return boundedDiscoveryJson(payload);
  } catch (error) {
    return globalDiscoveryErrorResponse(error);
  }
}
