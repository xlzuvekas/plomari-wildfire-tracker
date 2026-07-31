import { describe, expect, it } from "vitest";

import {
  buildExploreDiscoveryRequest,
  buildNearbyDiscoveryRequest,
  exploreDiscoveryResponseForRequestSchema,
  nearbyDiscoveryResponseForRequestSchema,
} from "../lib/firewatch/v3";
import { createDevelopmentGlobalDiscoveryClient } from "../lib/firewatch/v3/development-discovery-client";

describe("development discovery client", () => {
  it("cannot be constructed outside an explicit development environment", () => {
    expect(() =>
      createDevelopmentGlobalDiscoveryClient({ environment: "production" }),
    ).toThrow(/restricted to development/u);
    expect(() =>
      createDevelopmentGlobalDiscoveryClient({ environment: "test" }),
    ).toThrow(/restricted to development/u);
  });

  it("generates visibly synthetic, request-bound current snapshots", async () => {
    const client = createDevelopmentGlobalDiscoveryClient({
      environment: "development",
    });
    const now = Date.parse("2026-07-31T18:07:12.000Z");
    const exploreRequest = buildExploreDiscoveryRequest(now);
    const nearbyRequest = buildNearbyDiscoveryRequest("wm/10/587/391", now);

    const explore = await client.exploreCandidates(exploreRequest);
    const nearby = await client.nearbyIncidents(nearbyRequest);

    expect(explore.kind).toBe("snapshot");
    expect(nearby.kind).toBe("snapshot");
    if (explore.kind === "snapshot") {
      expect(explore.transport).toBe("fixture");
      expect(
        exploreDiscoveryResponseForRequestSchema(exploreRequest).safeParse(
          explore.data,
        ).success,
      ).toBe(true);
    }
    if (nearby.kind === "snapshot") {
      expect(nearby.transport).toBe("fixture");
      expect(
        nearbyDiscoveryResponseForRequestSchema(nearbyRequest).safeParse(
          nearby.data,
        ).success,
      ).toBe(true);
    }
  });

  it("returns cancellation before generating synthetic data", async () => {
    const client = createDevelopmentGlobalDiscoveryClient({
      environment: "development",
    });
    const abort = new AbortController();
    abort.abort();
    const result = await client.exploreCandidates(
      buildExploreDiscoveryRequest(Date.parse("2026-07-31T18:07:12.000Z")),
      { signal: abort.signal },
    );
    expect(result).toEqual({ kind: "cancelled", retryable: false });
  });
});
