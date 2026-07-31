import {
  GLOBAL_DISCOVERY_ORDERING,
  GLOBAL_DISCOVERY_POLICY_VERSION,
  GLOBAL_DISCOVERY_SCHEMA_VERSION,
  nearbyDiscoveryResponseForRequestSchema,
  type PublicDiscoveryTime,
} from "../../../../../lib/firewatch/v3";
import { parseAreaCellKey } from "../../../../../lib/firewatch/map-context";
import {
  boundedDiscoveryJson,
  discoveryObservedFrom,
  discoveryTimeContext,
  globalDiscoveryErrorResponse,
  localDateAt,
  parseNearbyDiscoveryHttpRequest,
} from "../../../../../lib/firewatch/v3/discovery-route.server";
import {
  readNearbyIncidentRows,
  sanitizeIncidentDisplayNames,
  type NearbyIncidentReadRow,
} from "../../../../../lib/supabase/global-discovery-read-model";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 8;

function startedAt(
  row: NearbyIncidentReadRow,
  asOf: string,
): PublicDiscoveryTime {
  if (
    row.started_precision === "exact" &&
    row.started_at !== null &&
    Date.parse(row.started_at) <= Date.parse(asOf) &&
    Date.parse(row.started_at) <= Date.parse(row.item_known_at)
  ) {
    return { precision: "exact", instant: row.started_at };
  }
  if (
    row.started_precision === "date_only" &&
    row.started_date !== null &&
    row.started_timezone !== null &&
    row.started_date <= localDateAt(asOf, row.started_timezone) &&
    row.started_date <=
      localDateAt(row.item_known_at, row.started_timezone)
  ) {
    return {
      precision: "date_only",
      date: row.started_date,
      calendarTimeZone: row.started_timezone,
    };
  }
  return { precision: "unknown" };
}

function latestObservedAt(row: NearbyIncidentReadRow) {
  return row.latest_observed_precision === "exact"
    ? {
        precision: "exact" as const,
        instant: row.latest_observed_at as string,
      }
    : {
        precision: "date_only" as const,
        date: row.latest_observed_date as string,
        calendarTimeZone: row.latest_observed_timezone as string,
      };
}

export async function GET(request: Request) {
  try {
    const query = parseNearbyDiscoveryHttpRequest(request);
    const cell = parseAreaCellKey(query.cell);
    if (cell === null) throw new Error("Parsed Nearby cell became invalid.");
    const observedFrom = discoveryObservedFrom(query.time.asOf);
    const rows = await readNearbyIncidentRows({
      cell,
      observedFrom,
      ...query.time,
      limit: query.page.limit + 1,
    });

    const hasMore = rows.length > query.page.limit;
    if (hasMore) {
      throw new Error("Nearby cell exceeds the snapshot-safe one-page bound.");
    }
    const pageRows = rows.slice(0, query.page.limit);
    const scopeTimeZone =
      pageRows[0]?.resolved_scope_timezone ??
      "UTC";

    const incidents = pageRows.map((row) => ({
      kind: "incident" as const,
      contractVersion: row.contract_version,
      incidentId: row.incident_id,
      slug: row.slug,
      displayNames: sanitizeIncidentDisplayNames(row),
      incidentKind: "wildfire" as const,
      lifecycle: row.lifecycle,
      areaRelationship: { kind: "intersects-cell" as const },
      times: {
        startedAt: startedAt(row, query.time.asOf),
        latestObservedAt: latestObservedAt(row),
        knownAt: row.item_known_at,
      },
    }));
    const hasResolvedScope = pageRows.length > 0;
    const payload = nearbyDiscoveryResponseForRequestSchema(query).parse({
      schemaVersion: GLOBAL_DISCOVERY_SCHEMA_VERSION,
      kind: "nearby-incidents",
      scope: {
        kind: "coarse-area",
        gridVersion: cell.gridVersion,
        cell: cell.cellKey,
        bounds: cell.bounds,
        minimumSpanM: cell.minimumSpanM,
        timeZone: scopeTimeZone,
      },
      time: discoveryTimeContext({
        ...query.time,
        timeZone: scopeTimeZone,
        basis: hasResolvedScope ? "scope" : "utc-fallback",
      }),
      // Persisted public items and ingestion-coverage proof are independent.
      // Until collectors persist a policy watermark, never invent one from an
      // item/publication clock or let metadata drift between identical reads.
      coverage: {
        state: "not_assessed",
        policyVersion: GLOBAL_DISCOVERY_POLICY_VERSION,
        scope: {
          kind: "coarse-area",
          gridVersion: cell.gridVersion,
          cell: cell.cellKey,
        },
      },
      result: incidents.length > 0
        ? { state: "items" }
        : { state: "indeterminate" },
      incidents,
      ordering: GLOBAL_DISCOVERY_ORDERING,
      page: {
        limit: query.page.limit,
        isFirstPage: true,
        hasMore: false,
        nextCursor: null,
      },
    });
    return boundedDiscoveryJson(payload);
  } catch (error) {
    return globalDiscoveryErrorResponse(error);
  }
}
