import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { ThermalEvidencePanel } from "../components/firewatch/ThermalEvidencePanel";
import {
  presentThermalAssessment,
  presentThermalConfidence,
  presentThermalPlatform,
} from "../components/firewatch/thermal-anomaly-presentation";
import type { ThermalAnomalyAreaState } from "../hooks/use-thermal-anomaly-area";
import type { ThermalAnomalyItem } from "../lib/firewatch/v3";
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
});

function observedItem(): ThermalAnomalyItem {
  const item = thermalAnomalyClientFixture({ withItem: true }).anomalies[0];
  if (!item) throw new Error("Missing thermal anomaly fixture");
  return item;
}

function render(state: ThermalAnomalyAreaState) {
  return renderToStaticMarkup(
    <ThermalEvidencePanel
      state={state}
      timeZone="Europe/Athens"
      locale="en-GB"
    />,
  );
}

describe("thermal evidence presentation", () => {
  it("keeps observed, awaiting, and unknown assessment states distinct", () => {
    const detected = observedItem();
    const awaiting: ThermalAnomalyItem = {
      ...detected,
      assessment: {
        ...detected.assessment,
        state: "awaiting_later_assessment",
        reason: "cmr_coverage_only_anomaly_not_assessed",
      },
    };
    const unknown: ThermalAnomalyItem = {
      ...detected,
      assessment: {
        ...detected.assessment,
        state: "unknown",
        reason: "firms_response_stale",
      },
    };

    expect(presentThermalAssessment(detected)).toMatchObject({
      label: "Thermal anomaly observed",
      tone: "observed",
    });
    expect(presentThermalAssessment(awaiting)).toMatchObject({
      label: "Waiting for a later assessment",
      tone: "waiting",
    });
    expect(presentThermalAssessment(awaiting).detail).toContain(
      "catalog coverage does not assess",
    );
    expect(presentThermalAssessment(unknown)).toMatchObject({
      label: "Latest assessment unknown",
      tone: "unknown",
    });
    expect(presentThermalPlatform(detected)).toBe("NOAA-20 · VIIRS");
    expect(presentThermalConfidence(detected)).toBe("high confidence");
  });

  it("shows full local and UTC dates with IANA zone and numeric offset", () => {
    const data = thermalAnomalyClientFixture({ withItem: true });
    const markup = render({ status: "ready", target: TARGET, data });

    expect(markup).toContain("31 Jul 2026");
    expect(markup).toContain("Europe/Athens · UTC+03:00");
    expect(markup).toContain("UTC");
    expect(markup).toContain("Events through");
    expect(markup).toContain("Knowledge through");
    expect(markup).toContain("Window starts");
    expect(markup).toContain(THERMAL_CLIENT_CELL);
    expect(markup).toContain('dateTime="2026-07-24T12:00:00.000Z"');
    expect(markup).toContain('dateTime="2026-07-31T12:00:00.000Z"');
    expect(markup).toContain('dateTime="2026-07-31T12:05:00.000Z"');
    expect(markup).toContain('dateTime="2026-07-31T11:45:00.000Z"');
    expect(markup).toContain("Thermal anomaly observed");
    expect(markup).toContain("not flame locations");
    expect(markup).toContain("or an all-clear");
  });

  it("does not turn an empty persisted page into an all-clear", () => {
    const data = {
      ...thermalAnomalyClientFixture(),
      result: {
        ...thermalAnomalyClientFixture().result,
        message: "ALL CLEAR. NO WILDFIRE. AREA IS SAFE.",
      },
    };
    const markup = render({ status: "ready", target: TARGET, data });

    expect(markup).toContain("Coverage not assessed");
    expect(markup).toContain("No assessed thermal-pixel rows are visible");
    expect(markup).toContain("not evidence that no wildfire exists");
    expect(markup).not.toContain("ALL CLEAR. NO WILDFIRE. AREA IS SAFE.");
    expect(markup).not.toMatch(/all clear|area is safe|no wildfire detected/iu);
  });

  it("never presents an unavailable pre-response state as zero observations", () => {
    const states: ThermalAnomalyAreaState[] = [
      { status: "idle", reason: "incomplete-target", target: null },
      { status: "loading", target: TARGET },
      {
        status: "error",
        target: TARGET,
        issue: "unavailable",
        retryable: true,
        restartFromFirstPage: false,
      },
    ];

    for (const state of states) {
      const markup = render(state);
      expect(markup).toContain("Observation count unavailable");
      expect(markup).not.toContain('aria-label="0 observations"');
    }
  });

  it("renders failures without leaking transport or provider details", () => {
    const markup = render({
      status: "error",
      target: TARGET,
      issue: "unavailable",
      retryable: true,
      restartFromFirstPage: false,
    });

    expect(markup).toContain("Persisted thermal evidence is unavailable");
    expect(markup).toContain("No thermal assessment can be made");
    expect(markup).not.toMatch(/supabase|postgres|service.role|apikey/iu);
  });
});
