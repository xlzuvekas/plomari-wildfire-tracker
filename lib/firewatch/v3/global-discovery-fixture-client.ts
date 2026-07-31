import {
  exploreDiscoveryRequestSchema,
  exploreDiscoveryResponseForRequestSchema,
  exploreDiscoveryResponseSchema,
  nearbyDiscoveryRequestSchema,
  nearbyDiscoveryResponseForRequestSchema,
  nearbyDiscoveryResponseSchema,
  type ExploreDiscoveryResponse,
  type NearbyDiscoveryResponse,
} from "./discovery-contracts";
import type { GlobalDiscoveryClient } from "./global-discovery-client";

export type GlobalDiscoveryFixtureSet = Readonly<{
  explore: ExploreDiscoveryResponse;
  nearby: readonly NearbyDiscoveryResponse[];
}>;

/**
 * Deterministic adapter for stories, server-rendered examples, and tests. It
 * never contacts a provider or API and labels every result as synthetic.
 */
export function createFixtureGlobalDiscoveryClient(
  fixtureSet: GlobalDiscoveryFixtureSet,
): GlobalDiscoveryClient {
  const exploreFixture = exploreDiscoveryResponseSchema.parse(
    structuredClone(fixtureSet.explore),
  );
  const nearbyFixtures = new Map<string, NearbyDiscoveryResponse>();

  for (const fixture of fixtureSet.nearby) {
    const parsed = nearbyDiscoveryResponseSchema.parse(structuredClone(fixture));
    if (nearbyFixtures.has(parsed.scope.cell)) {
      throw new Error(`Duplicate Nearby fixture for ${parsed.scope.cell}`);
    }
    nearbyFixtures.set(parsed.scope.cell, parsed);
  }

  return {
    async exploreCandidates(request, options) {
      if (options?.signal?.aborted) {
        return { kind: "cancelled", retryable: false };
      }
      const parsedRequest = exploreDiscoveryRequestSchema.safeParse(request);
      if (!parsedRequest.success) {
        return { kind: "invalid-request", retryable: false };
      }
      const parsedResponse = exploreDiscoveryResponseForRequestSchema(
        parsedRequest.data,
      ).safeParse(structuredClone(exploreFixture));
      if (!parsedResponse.success) {
        return { kind: "invalid-response", retryable: true };
      }
      return {
        kind: "snapshot",
        transport: "fixture",
        data: parsedResponse.data,
      };
    },

    async nearbyIncidents(request, options) {
      if (options?.signal?.aborted) {
        return { kind: "cancelled", retryable: false };
      }
      const parsedRequest = nearbyDiscoveryRequestSchema.safeParse(request);
      if (!parsedRequest.success) {
        return { kind: "invalid-request", retryable: false };
      }
      const fixture = nearbyFixtures.get(parsedRequest.data.cell);
      if (!fixture) {
        return { kind: "unavailable", retryable: true };
      }
      const parsedResponse = nearbyDiscoveryResponseForRequestSchema(
        parsedRequest.data,
      ).safeParse(structuredClone(fixture));
      if (!parsedResponse.success) {
        return { kind: "invalid-response", retryable: true };
      }
      return {
        kind: "snapshot",
        transport: "fixture",
        data: parsedResponse.data,
      };
    },
  };
}
