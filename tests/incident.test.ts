import { describe, expect, it } from "vitest";

import { distanceKm } from "../lib/geo";
import {
  AGIOS_ISIDOROS,
  EVACUATION_ROUTE,
  FIELD_REPORT_OCCURRED_AT,
  INCIDENT,
  INCIDENT_STARTED_AT,
  INCIDENT_STARTED_EPOCH,
  LANDFILL_FOOTPRINT,
  OFFICIAL_ALERT_ISSUED_AT,
  PLOMARI_BEACH,
} from "../lib/incident";

describe("incident definition", () => {
  it("keeps the documented incident timeline ordered", () => {
    const started = Date.parse(INCIDENT_STARTED_AT);
    const alerted = Date.parse(OFFICIAL_ALERT_ISSUED_AT);
    const reported = Date.parse(FIELD_REPORT_OCCURRED_AT);
    expect(Number.isNaN(started)).toBe(false);
    expect(Number.isNaN(alerted)).toBe(false);
    expect(Number.isNaN(reported)).toBe(false);
    expect(INCIDENT_STARTED_EPOCH).toBe(started);
    expect(started).toBeLessThan(alerted);
    expect(alerted).toBeLessThan(reported);
  });

  it("keeps reference points within the incident area", () => {
    // Every named settlement/reference sits within the 8 km incident radius
    // documented for the thermal route, except Perama/Megalochori which are
    // nearby-context references still on Lesvos (< 20 km).
    expect(distanceKm(INCIDENT, PLOMARI_BEACH)).toBeLessThan(8);
    expect(distanceKm(INCIDENT, AGIOS_ISIDOROS)).toBeLessThan(8);
  });

  it("keeps the archived route anchored to its named endpoints", () => {
    const first = EVACUATION_ROUTE[0];
    const last = EVACUATION_ROUTE[EVACUATION_ROUTE.length - 1];
    expect(first).toBeDefined();
    expect(last).toBeDefined();
    if (!first || !last) return;
    // The archived 112 instruction named Plomari beach -> Agios Isidoros.
    expect(distanceKm(first, PLOMARI_BEACH)).toBeLessThan(0.25);
    expect(distanceKm(last, AGIOS_ISIDOROS)).toBeLessThan(1.0);
    expect(EVACUATION_ROUTE.length).toBeGreaterThan(50);
  });

  it("keeps the landfill footprint a closed ring near the incident", () => {
    const first = LANDFILL_FOOTPRINT[0];
    const last = LANDFILL_FOOTPRINT[LANDFILL_FOOTPRINT.length - 1];
    expect(first).toEqual(last);
    for (const vertex of LANDFILL_FOOTPRINT) {
      expect(distanceKm(INCIDENT, vertex)).toBeLessThan(2);
    }
  });
});
