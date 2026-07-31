import { describe, expect, it } from "vitest";

import {
  failedSatellitePassAreaState,
  initialSatellitePassAreaState,
  satellitePassPollingAvailable,
} from "../hooks/use-satellite-pass-area";

describe("satellite pass area state", () => {
  it("preserves the error when the first request for a new cell fails", () => {
    const previousCell = initialSatellitePassAreaState("wm/10/587/391", false);

    expect(
      failedSatellitePassAreaState(
        previousCell,
        "wm/10/512/384",
        "unavailable",
      ),
    ).toEqual({
      cellKey: "wm/10/512/384",
      data: null,
      error: "unavailable",
      cachedSnapshot: false,
      loading: false,
    });
  });

  it("marks retained same-cell data as cached after a failed refresh", () => {
    const current = {
      ...initialSatellitePassAreaState("wm/10/587/391", false),
      data: { schemaVersion: 3 } as never,
    };

    expect(
      failedSatellitePassAreaState(
        current,
        "wm/10/587/391",
        "unavailable",
      ),
    ).toMatchObject({
      cellKey: "wm/10/587/391",
      data: current.data,
      error: "unavailable",
      cachedSnapshot: true,
      loading: false,
    });
  });

  it("allows an explicitly requested service-worker snapshot after an offline resume", () => {
    expect(satellitePassPollingAvailable("hidden", false, true)).toBe(false);
    expect(satellitePassPollingAvailable("visible", false, false)).toBe(false);
    expect(satellitePassPollingAvailable("visible", false, true)).toBe(true);
  });
});
