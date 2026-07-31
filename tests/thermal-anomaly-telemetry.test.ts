import { describe, expect, it, vi } from "vitest";

import {
  createThermalTelemetryEvent,
  reportThermalTelemetry,
  safelyReportThermalTelemetry,
  type ThermalTelemetryEvent,
} from "../lib/firewatch/v3/thermal-anomaly-telemetry.server";

const INPUT = {
  status: 503,
  outcome: "database_timeout",
  pageType: "continuation",
  durationMs: 90_000,
  zoom: 10,
  rows: null,
  hasMore: null,
  databaseSqlstate: "57014",
  leaseRelease: "released",
} as const;

describe("thermal v3 telemetry", () => {
  it("clamps duration and emits only the bounded schema", () => {
    const event = createThermalTelemetryEvent(INPUT);
    expect(event).toEqual({
      event: "firewatch.thermal_v3.request",
      schemaVersion: 1,
      ...INPUT,
      durationMs: 60_000,
    });
    expect(Object.keys(event).sort()).toEqual([
      "databaseSqlstate",
      "durationMs",
      "event",
      "hasMore",
      "leaseRelease",
      "outcome",
      "pageType",
      "rows",
      "schemaVersion",
      "status",
      "zoom",
    ]);
  });

  it("rejects raw cell, cursor, or IP fields instead of logging them", () => {
    for (const extra of [
      { cell: "wm/10/587/391" },
      { cursor: "opaque-secret" },
      { ip: "203.0.113.42" },
    ]) {
      expect(() =>
        createThermalTelemetryEvent({
          ...INPUT,
          ...extra,
        } as unknown as Parameters<typeof createThermalTelemetryEvent>[0]),
      ).toThrow();
    }
  });

  it("cannot let a telemetry sink failure alter route control flow", () => {
    const event = createThermalTelemetryEvent(INPUT);
    const reporter = vi.fn<(event: ThermalTelemetryEvent) => void>(() => {
      throw new Error("sink unavailable");
    });
    expect(() => safelyReportThermalTelemetry(reporter, event)).not.toThrow();
    expect(reporter).toHaveBeenCalledWith(event);
  });

  it("serializes one validated JSON object for the default log sink", () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => undefined);
    const event = createThermalTelemetryEvent(INPUT);
    reportThermalTelemetry(event);
    expect(info).toHaveBeenCalledWith(JSON.stringify(event));
    info.mockRestore();
  });
});
