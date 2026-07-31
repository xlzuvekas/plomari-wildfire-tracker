import { describe, expect, it } from "vitest";

import { satellitePassPresentationState } from "../lib/firewatch/v3/satellite-pass-presentation";

const completeEmpty = {
  isLive: true,
  loading: false,
  unavailable: false,
  stale: false,
  validEmpty: true,
  indeterminateEmpty: false,
} as const;

describe("satellite pass presentation precedence", () => {
  it("qualifies a cached valid-empty snapshot as stale", () => {
    expect(
      satellitePassPresentationState({ ...completeEmpty, stale: true }),
    ).toBe("stale-valid-empty");
  });

  it("uses an unqualified valid-empty label only for a current completed read", () => {
    expect(satellitePassPresentationState(completeEmpty)).toBe("valid-empty");
  });

  it("withholds current catalog data in history before other states", () => {
    expect(
      satellitePassPresentationState({
        ...completeEmpty,
        isLive: false,
        stale: true,
      }),
    ).toBe("current-only-withheld");
  });
});
