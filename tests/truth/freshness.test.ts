import { describe, expect, it } from "vitest";

import {
  calculateSourceFreshness,
  getSourceDefinition,
  type FreshnessInput,
} from "../../lib/truth";

const source = getSourceDefinition("fire-service-board");
if (!source) throw new Error("Fire Service source missing");

const healthyInput: FreshnessInput = {
  now: "2026-07-30T00:10:00Z",
  enabled: true,
  configured: true,
  lastAttemptAt: "2026-07-30T00:09:59Z",
  lastSuccessAt: "2026-07-30T00:09:00Z",
  lastChangedPayloadAt: "2026-07-30T00:08:00Z",
  latestSourcePublicationAt: "2026-07-30T00:08:00Z",
  consecutiveFailures: 0,
  errorClass: null,
};

describe("source freshness state machine", () => {
  it.each([
    [{ enabled: false }, "disabled", "disabled"],
    [{ configured: false }, "unconfigured", "unconfigured"],
    [
      { errorClass: "authentication" },
      "authentication_failed",
      "authentication_failed",
    ],
    [{ errorClass: "rate_limit" }, "rate_limited", "rate_limited"],
    [{ lastSuccessAt: null }, "unknown", "never_succeeded"],
    [
      { lastSuccessAt: "2026-07-30T00:04:59Z" },
      "stale",
      "collector_stale",
    ],
    [{ consecutiveFailures: 1 }, "failed", "collector_failed"],
    [{}, "healthy", "healthy"],
  ] as const)(
    "maps %o to %s",
    (overrides, expectedState, expectedReason) => {
      const result = calculateSourceFreshness(source, {
        ...healthyInput,
        ...overrides,
      });
      expect(result.state).toBe(expectedState);
      expect(result.reason).toBe(expectedReason);
    },
  );

  it("remains healthy exactly at the stale threshold", () => {
    const result = calculateSourceFreshness(source, {
      ...healthyInput,
      lastSuccessAt: "2026-07-30T00:05:00Z",
    });
    expect(result.collectorAgeSeconds).toBe(source.staleAfterSeconds);
    expect(result.state).toBe("healthy");
  });
});
