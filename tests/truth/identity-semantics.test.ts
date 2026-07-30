import { describe, expect, it } from "vitest";

import {
  getSourceDefinition,
  SOURCE_REGISTRY,
} from "../../lib/truth/source-registry";
import {
  firmsDetectionNaturalKey,
  groupFirmsDetectionsIntoPasses,
  hashJson,
  normalizeCanonicalUrl,
  observationSchema,
  assertionSchema,
  stableJsonStringify,
  validateObservationTimes,
  validateProtectiveActionProvenance,
  validateTemporalValue,
} from "../../lib/truth/v1";
import {
  validAssertion,
  validObservation,
} from "../fixtures/canonical-entities";

const baseDetection = {
  product: "VIIRS",
  satellite: "NOAA-20",
  observedAt: "2026-07-29T15:40:00Z",
  latitude: 38.97514,
  longitude: 26.36624,
  scanKm: 0.39,
  trackKm: 0.36,
} as const;

describe("canonical identity", () => {
  it("hashes object keys independently of input order", () => {
    const left = { beta: 2, alpha: { zulu: true, bravo: "x" } };
    const right = { alpha: { bravo: "x", zulu: true }, beta: 2 };

    expect(stableJsonStringify(left)).toBe(stableJsonStringify(right));
    expect(hashJson(left)).toBe(hashJson(right));
  });

  it("normalizes URL fragments, parameter order, hostname, and trailing slash", () => {
    expect(
      normalizeCanonicalUrl(
        "https://EXAMPLE.org/fire/?z=2&a=1#temporary-fragment",
      ),
    ).toBe("https://example.org/fire?a=1&z=2");
  });

  it("uses documented FIRMS coordinate rounding without losing source values", () => {
    const withinRoundingCell = {
      ...baseDetection,
      latitude: 38.975139,
      longitude: 26.366239,
    };

    expect(firmsDetectionNaturalKey(withinRoundingCell)).toBe(
      firmsDetectionNaturalKey(baseDetection),
    );
    expect(withinRoundingCell.latitude).toBe(38.975139);
  });

  it("groups detections ten minutes apart in one pass and starts a new pass after that", () => {
    const passes = groupFirmsDetectionsIntoPasses([
      baseDetection,
      {
        ...baseDetection,
        observedAt: "2026-07-29T15:50:00Z",
        latitude: 38.98,
      },
      {
        ...baseDetection,
        observedAt: "2026-07-29T16:00:01Z",
        latitude: 38.99,
      },
    ]);

    expect(passes).toHaveLength(2);
    expect(passes[0].detections).toHaveLength(2);
    expect(passes[1].detections).toHaveLength(1);
  });
});

describe("semantic safety rules", () => {
  it("accepts a date-only value without manufacturing an exact age", () => {
    expect(
      validateTemporalValue(
        {
          precision: "date_only",
          date: "2026-07-29",
          sourceValue: "2026-07-29",
          sourceTimezone: "Europe/Athens",
        },
        "2026-07-30T00:30:00Z",
      ),
    ).toEqual({ state: "accepted", reasonCodes: [] });
  });

  it("quarantines implausibly future observation times", () => {
    const observation = observationSchema.parse({
      ...validObservation,
      observedTime: {
        precision: "exact",
        instant: "2026-07-31T00:30:00Z",
        sourceValue: "2026-07-31T03:30:00+03:00",
        sourceTimezone: "Europe/Athens",
      },
    });

    expect(
      validateObservationTimes(observation, "2026-07-30T00:30:00Z"),
    ).toEqual({
      state: "quarantined",
      reasonCodes: ["future_timestamp"],
    });
  });

  it("accepts protective actions only from a validated official-alert chain", () => {
    const source = getSourceDefinition("112-greece");
    if (!source) throw new Error("112 source missing");
    const observation = observationSchema.parse(validObservation);
    const assertion = assertionSchema.parse(validAssertion);

    expect(
      validateProtectiveActionProvenance({
        source,
        observation,
        assertion,
      }),
    ).toEqual({ state: "accepted", reasonCodes: [] });
  });

  it("rejects the same evacuation wording when it comes from a publisher", () => {
    const source = SOURCE_REGISTRY.find(
      (candidate) => candidate.key === "stonisi",
    );
    if (!source) throw new Error("StoNisi source missing");
    const observation = observationSchema.parse(validObservation);
    const assertion = assertionSchema.parse(validAssertion);

    const result = validateProtectiveActionProvenance({
      source,
      observation,
      assertion,
    });

    expect(result.state).toBe("rejected");
    expect(result.reasonCodes).toContain(
      "publisher_cannot_issue_protective_action",
    );
    expect(result.reasonCodes).toContain("untrusted_protective_instruction");
  });
});
