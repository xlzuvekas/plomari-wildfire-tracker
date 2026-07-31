import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import {
  initialThermalAnomalyAreaState,
  reduceThermalAnomalyAreaState,
  thermalAnomalyAreaTarget,
  type ThermalAnomalyAreaState,
  type ThermalAnomalyAreaTarget,
} from "../hooks/use-thermal-anomaly-area";
import {
  THERMAL_CLIENT_AS_OF,
  THERMAL_CLIENT_CELL,
  THERMAL_CLIENT_KNOWN_AT,
  thermalAnomalyClientFixture,
} from "./fixtures/thermal-anomaly-v3-client";

const TARGET = Object.freeze({
  cell: THERMAL_CLIENT_CELL,
  asOf: THERMAL_CLIENT_AS_OF,
  knownAt: THERMAL_CLIENT_KNOWN_AT,
  limit: 50,
}) satisfies ThermalAnomalyAreaTarget;

const NEW_TARGET = Object.freeze({
  ...TARGET,
  knownAt: "2026-07-31T12:10:00.000Z",
}) satisfies ThermalAnomalyAreaTarget;

function readyState(): ThermalAnomalyAreaState {
  const loading = reduceThermalAnomalyAreaState(
    initialThermalAnomalyAreaState(),
    { type: "load", target: TARGET },
  );
  return reduceThermalAnomalyAreaState(loading, {
    type: "settle",
    target: TARGET,
    result: { kind: "snapshot", data: thermalAnomalyClientFixture() },
  });
}

describe("thermal anomaly area hook state", () => {
  it("distinguishes disabled and incomplete activation without data", () => {
    expect(initialThermalAnomalyAreaState()).toEqual({
      status: "idle",
      reason: "disabled",
      target: null,
    });
    expect(initialThermalAnomalyAreaState("incomplete-target")).toEqual({
      status: "idle",
      reason: "incomplete-target",
      target: null,
    });
    expect(
      thermalAnomalyAreaTarget({
        enabled: false,
        cell: TARGET.cell,
        asOf: TARGET.asOf,
        knownAt: TARGET.knownAt,
      }),
    ).toBeNull();
    expect(
      thermalAnomalyAreaTarget({
        enabled: true,
        cell: TARGET.cell,
        asOf: null,
        knownAt: TARGET.knownAt,
      }),
    ).toBeNull();
    expect(
      thermalAnomalyAreaTarget({
        enabled: true,
        cell: TARGET.cell,
        asOf: TARGET.asOf,
        knownAt: TARGET.knownAt,
      }),
    ).toEqual(TARGET);
  });

  it("keeps a valid empty page indeterminate and explicitly not all-clear", () => {
    const ready = readyState();
    expect(ready.status).toBe("ready");
    if (ready.status !== "ready") throw new Error("Expected ready state");
    expect(ready.data.anomalies).toEqual([]);
    expect(ready.data.coverage.state).toBe("not_assessed");
    expect(ready.data.result.state).toBe("indeterminate");
    expect(ready.data.result.allClearAssessment).toBe("not_assessed");
    expect(ready.data.safety.allClear).toBe(false);
  });

  it("drops prior not-assessed data before loading or failing a new tuple", () => {
    const ready = readyState();
    const loading = reduceThermalAnomalyAreaState(ready, {
      type: "load",
      target: NEW_TARGET,
    });
    expect(loading).toEqual({ status: "loading", target: NEW_TARGET });
    expect(loading).not.toHaveProperty("data");

    const failed = reduceThermalAnomalyAreaState(loading, {
      type: "settle",
      target: NEW_TARGET,
      result: { kind: "unavailable", retryable: true },
    });
    expect(failed).toEqual({
      status: "error",
      target: NEW_TARGET,
      issue: "unavailable",
      retryable: true,
      restartFromFirstPage: false,
    });
    expect(failed).not.toHaveProperty("data");
  });

  it("does not let an old cell or cutoff response win the active request", () => {
    const loading = reduceThermalAnomalyAreaState(
      initialThermalAnomalyAreaState(),
      { type: "load", target: NEW_TARGET },
    );
    const stale = reduceThermalAnomalyAreaState(loading, {
      type: "settle",
      target: TARGET,
      result: { kind: "snapshot", data: thermalAnomalyClientFixture() },
    });
    expect(stale).toBe(loading);
  });

  it("fails closed if an injected client returns a mismatched snapshot", () => {
    const loading = reduceThermalAnomalyAreaState(
      initialThermalAnomalyAreaState(),
      { type: "load", target: TARGET },
    );
    const mismatched = reduceThermalAnomalyAreaState(loading, {
      type: "settle",
      target: TARGET,
      result: {
        kind: "snapshot",
        data: thermalAnomalyClientFixture({ limit: 49 }),
      },
    });
    expect(mismatched).toEqual({
      status: "error",
      target: TARGET,
      issue: "invalid-response",
      retryable: true,
      restartFromFirstPage: false,
    });
  });

  it("exposes an exact 409 as restartable and never surfaces cancellation", () => {
    const loading = reduceThermalAnomalyAreaState(
      initialThermalAnomalyAreaState(),
      { type: "load", target: TARGET },
    );
    const restart = reduceThermalAnomalyAreaState(loading, {
      type: "settle",
      target: TARGET,
      result: {
        kind: "snapshot-changed",
        retryable: true,
        restartFromFirstPage: true,
      },
    });
    expect(restart).toMatchObject({
      status: "error",
      issue: "snapshot-changed",
      retryable: true,
      restartFromFirstPage: true,
    });

    const cancelled = reduceThermalAnomalyAreaState(loading, {
      type: "settle",
      target: TARGET,
      result: { kind: "cancelled", retryable: false },
    });
    expect(cancelled).toBe(loading);
  });

  it("contains no polling, offline fallback, or client persistence path", () => {
    const source = readFileSync(
      new URL("../hooks/use-thermal-anomaly-area.ts", import.meta.url),
      "utf8",
    );
    expect(source).toContain("controller.abort()");
    expect(source).not.toMatch(
      /setInterval|navigator\.onLine|localStorage|sessionStorage|indexedDB|document\.cookie/iu,
    );
    expect(source).not.toMatch(/lastGood|cachedSnapshot/iu);
  });
});
