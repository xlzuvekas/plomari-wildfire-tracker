import {
  GLOBAL_DISCOVERY_ORDERING,
  GLOBAL_DISCOVERY_POLICY_VERSION,
  GLOBAL_DISCOVERY_SCHEMA_VERSION,
  exploreDiscoveryResponseForRequestSchema,
} from "../../../../../lib/firewatch/v3";
import {
  boundedDiscoveryJson,
  discoveryTimeContext,
  globalDiscoveryErrorResponse,
  InvalidGlobalDiscoveryRequestError,
  parseExploreDiscoveryHttpRequest,
} from "../../../../../lib/firewatch/v3/discovery-route.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The candidate read model does not exist yet. Exposing this honest v3 shape
 * lets the renderer cut over without calling providers or interpreting an
 * empty database as a global all-clear.
 */
export async function GET(request: Request) {
  try {
    const query = parseExploreDiscoveryHttpRequest(request);
    if (query.page.after !== null) {
      throw new InvalidGlobalDiscoveryRequestError();
    }
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
        state: "unconfigured",
        policyVersion: GLOBAL_DISCOVERY_POLICY_VERSION,
        scope: {
          kind: "global",
          gridVersion: "web-mercator-adaptive-v1",
        },
      },
      result: { state: "indeterminate" },
      candidates: [],
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
