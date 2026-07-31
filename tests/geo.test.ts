import { describe, expect, it } from "vitest";

import {
  bearingDeg,
  destination,
  distanceKm,
  midpoint,
  nearestPointOnPolyline,
  nearestPointOnSegment,
  scenarioShape,
  type LatLngTuple,
} from "../lib/geo";

const INCIDENT: LatLngTuple = [38.989013, 26.382489];
const PLOMARI_BEACH: LatLngTuple = [38.9752, 26.3714];

describe("distanceKm", () => {
  it("is zero for identical points", () => {
    expect(distanceKm(INCIDENT, INCIDENT)).toBe(0);
  });

  it("is symmetric", () => {
    expect(distanceKm(INCIDENT, PLOMARI_BEACH)).toBeCloseTo(
      distanceKm(PLOMARI_BEACH, INCIDENT),
      12,
    );
  });

  it("matches a known incident-scale distance", () => {
    const km = distanceKm(INCIDENT, PLOMARI_BEACH);
    expect(km).toBeGreaterThan(1.5);
    expect(km).toBeLessThan(2.2);
  });

  it("matches one degree of latitude", () => {
    expect(distanceKm([38, 26], [39, 26])).toBeCloseTo(111.19, 1);
  });

  it("stays finite for antipodal points", () => {
    expect(distanceKm([0, 0], [0, 180])).toBeCloseTo(Math.PI * 6_371, 6);
  });
});

describe("bearingDeg", () => {
  it("returns cardinal bearings on meridians and parallels", () => {
    expect(bearingDeg([38, 26], [39, 26])).toBeCloseTo(0, 6);
    expect(bearingDeg([39, 26], [38, 26])).toBeCloseTo(180, 6);
    expect(bearingDeg([38, 26], [38, 27])).toBeGreaterThan(89);
    expect(bearingDeg([38, 26], [38, 27])).toBeLessThan(91);
  });

  it("stays in [0, 360)", () => {
    const bearing = bearingDeg(INCIDENT, PLOMARI_BEACH);
    expect(bearing).toBeGreaterThanOrEqual(0);
    expect(bearing).toBeLessThan(360);
  });
});

describe("destination", () => {
  it("round-trips distance and bearing", () => {
    const target = destination(INCIDENT, 217, 3.4);
    expect(distanceKm(INCIDENT, target)).toBeCloseTo(3.4, 6);
    expect(bearingDeg(INCIDENT, target)).toBeCloseTo(217, 4);
  });

  it("returns the origin for zero distance", () => {
    const target = destination(INCIDENT, 90, 0);
    expect(target[0]).toBeCloseTo(INCIDENT[0], 9);
    expect(target[1]).toBeCloseTo(INCIDENT[1], 9);
  });

  it("normalizes longitude when crossing the antimeridian", () => {
    const target = destination([0, 179.9], 90, 30);
    expect(target[1]).toBeGreaterThanOrEqual(-180);
    expect(target[1]).toBeLessThan(180);
    expect(target[1]).toBeLessThan(-179.8);
  });
});

describe("nearestPointOnSegment", () => {
  it("clamps to the nearer endpoint outside the segment", () => {
    const nearest = nearestPointOnSegment([0, -1], [0, 0], [0, 10]);
    expect(nearest[0]).toBeCloseTo(0, 9);
    expect(nearest[1]).toBeCloseTo(0, 9);
  });

  it("projects onto the segment interior", () => {
    const nearest = nearestPointOnSegment([1, 5], [0, 0], [0, 10]);
    expect(nearest[0]).toBeCloseTo(0, 9);
    expect(nearest[1]).toBeCloseTo(5, 6);
  });

  it("handles a degenerate zero-length segment", () => {
    expect(nearestPointOnSegment([1, 1], [2, 3], [2, 3])).toEqual([2, 3]);
  });
});

describe("nearestPointOnPolyline", () => {
  const line: LatLngTuple[] = [
    [0, 0],
    [0, 10],
    [5, 10],
  ];

  it("returns the query point for an empty line", () => {
    expect(nearestPointOnPolyline([4, 4], [])).toEqual([4, 4]);
  });

  it("finds the nearest point across segments", () => {
    const nearest = nearestPointOnPolyline([1, 5], line);
    expect(nearest[0]).toBeCloseTo(0, 9);
    expect(nearest[1]).toBeCloseTo(5, 6);

    const nearEnd = nearestPointOnPolyline([4.9, 11], line);
    expect(distanceKm(nearEnd, [4.9, 10])).toBeLessThan(
      distanceKm(nearEnd, [0, 10]),
    );
  });
});

describe("scenarioShape", () => {
  it("returns a degenerate triangle for non-positive distance", () => {
    expect(scenarioShape(INCIDENT, 45, 0)).toEqual([
      INCIDENT,
      INCIDENT,
      INCIDENT,
    ]);
  });

  it("produces a closed polygon bounded by the requested distance", () => {
    const shape = scenarioShape(INCIDENT, 45, 2.5);
    expect(shape[0]).toEqual(INCIDENT);
    expect(shape[shape.length - 1]).toEqual(INCIDENT);
    expect(shape.length).toBeGreaterThan(4);
    for (const vertex of shape.slice(1, -1)) {
      const reach = distanceKm(INCIDENT, vertex);
      expect(reach).toBeGreaterThan(0);
      expect(reach).toBeLessThanOrEqual(2.5 + 1e-9);
    }
  });
});

describe("midpoint", () => {
  it("averages coordinates", () => {
    expect(midpoint([38, 26], [40, 28])).toEqual([39, 27]);
  });
});
