import { describe, expect, it } from "vitest";
import {
  assessProximity,
  haversineKm,
  initialBearingDeg,
} from "../app/lib/proximity";
import { normalizeNominatim } from "../app/api/geocode/nominatim";

const INCIDENT = { lat: 38.989013, lon: 26.382489 };

// ~1 degree of latitude is ~111 km; use small offsets for known distances.
const kmNorth = (km: number) => ({
  lat: INCIDENT.lat + km / 111.32,
  lon: INCIDENT.lon,
});

describe("haversineKm", () => {
  it("is zero for identical points", () => {
    expect(haversineKm(38.9, 26.3, 38.9, 26.3)).toBe(0);
  });

  it("matches a known latitude offset", () => {
    const point = kmNorth(10);
    const distance = haversineKm(
      point.lat,
      point.lon,
      INCIDENT.lat,
      INCIDENT.lon,
    );
    expect(distance).toBeGreaterThan(9.9);
    expect(distance).toBeLessThan(10.1);
  });
});

describe("initialBearingDeg", () => {
  it("points south from a point north of the incident", () => {
    const point = kmNorth(5);
    const bearing = initialBearingDeg(
      point.lat,
      point.lon,
      INCIDENT.lat,
      INCIDENT.lon,
    );
    expect(Math.abs(bearing - 180)).toBeLessThan(1);
  });
});

describe("assessProximity", () => {
  it("grades by distance ring from the incident center", () => {
    expect(assessProximity(kmNorth(1), INCIDENT, []).level).toBe("critical");
    expect(assessProximity(kmNorth(4), INCIDENT, []).level).toBe("high");
    expect(assessProximity(kmNorth(9), INCIDENT, []).level).toBe("elevated");
    expect(assessProximity(kmNorth(30), INCIDENT, []).level).toBe("monitor");
  });

  it("escalates when a recent detection is closer than the incident center", () => {
    const point = kmNorth(30);
    const nearbyDetection = { ...kmNorth(29), ageMinutes: 60 };
    const result = assessProximity(point, INCIDENT, [nearbyDetection]);
    expect(result.level).toBe("critical");
    expect(result.nearestDetectionKm).toBeLessThan(1.5);
  });

  it("ignores stale detections for the level but still reports them", () => {
    const point = kmNorth(30);
    const staleDetection = { ...kmNorth(29), ageMinutes: 24 * 60 };
    const result = assessProximity(point, INCIDENT, [staleDetection]);
    expect(result.level).toBe("monitor");
    expect(result.nearestDetectionKm).not.toBeNull();
    expect(result.nearestDetectionAgeMinutes).toBe(24 * 60);
  });
});

describe("normalizeNominatim", () => {
  it("extracts labeled coordinates and drops malformed entries", () => {
    const results = normalizeNominatim([
      { display_name: "Plomari, Lesvos", lat: "38.97897", lon: "26.36596" },
      { display_name: "missing coords" },
      { lat: "38.9", lon: "26.3" },
      null,
      "junk",
    ]);
    expect(results).toEqual([
      { label: "Plomari, Lesvos", lat: 38.97897, lon: 26.36596 },
    ]);
  });

  it("returns empty for a non-array payload", () => {
    expect(normalizeNominatim({ error: "x" })).toEqual([]);
    expect(normalizeNominatim(null)).toEqual([]);
  });
});
