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

const TOPOLOGY_EPSILON = 1e-10;

function orientation(
  a: LatLngTuple,
  b: LatLngTuple,
  c: LatLngTuple,
): number {
  const ax = a[1];
  const ay = a[0];
  const bx = b[1];
  const by = b[0];
  const cx = c[1];
  const cy = c[0];
  return (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
}

function pointOnSegment(
  point: LatLngTuple,
  start: LatLngTuple,
  end: LatLngTuple,
): boolean {
  if (Math.abs(orientation(start, end, point)) > TOPOLOGY_EPSILON) {
    return false;
  }

  return (
    point[1] >= Math.min(start[1], end[1]) - TOPOLOGY_EPSILON &&
    point[1] <= Math.max(start[1], end[1]) + TOPOLOGY_EPSILON &&
    point[0] >= Math.min(start[0], end[0]) - TOPOLOGY_EPSILON &&
    point[0] <= Math.max(start[0], end[0]) + TOPOLOGY_EPSILON
  );
}

function segmentsIntersect(
  a: LatLngTuple,
  b: LatLngTuple,
  c: LatLngTuple,
  d: LatLngTuple,
): boolean {
  const abc = orientation(a, b, c);
  const abd = orientation(a, b, d);
  const cda = orientation(c, d, a);
  const cdb = orientation(c, d, b);

  if (
    ((abc > TOPOLOGY_EPSILON && abd < -TOPOLOGY_EPSILON) ||
      (abc < -TOPOLOGY_EPSILON && abd > TOPOLOGY_EPSILON)) &&
    ((cda > TOPOLOGY_EPSILON && cdb < -TOPOLOGY_EPSILON) ||
      (cda < -TOPOLOGY_EPSILON && cdb > TOPOLOGY_EPSILON))
  ) {
    return true;
  }

  return (
    (Math.abs(abc) <= TOPOLOGY_EPSILON && pointOnSegment(c, a, b)) ||
    (Math.abs(abd) <= TOPOLOGY_EPSILON && pointOnSegment(d, a, b)) ||
    (Math.abs(cda) <= TOPOLOGY_EPSILON && pointOnSegment(a, c, d)) ||
    (Math.abs(cdb) <= TOPOLOGY_EPSILON && pointOnSegment(b, c, d))
  );
}

function signedArea(shape: readonly LatLngTuple[]): number {
  let twiceArea = 0;
  for (let index = 0; index < shape.length - 1; index += 1) {
    const current = shape[index];
    const next = shape[index + 1];
    if (!current || !next) continue;
    twiceArea += current[1] * next[0] - next[1] * current[0];
  }
  return twiceArea / 2;
}

function expectSimpleClosedPolygon(shape: readonly LatLngTuple[]): void {
  expect(shape.length).toBeGreaterThanOrEqual(4);
  expect(shape.at(-1)).toEqual(shape[0]);
  expect(shape.flat().every(Number.isFinite)).toBe(true);
  expect(Math.abs(signedArea(shape))).toBeGreaterThan(TOPOLOGY_EPSILON);

  const edgeCount = shape.length - 1;
  for (let edgeIndex = 0; edgeIndex < edgeCount; edgeIndex += 1) {
    const start = shape[edgeIndex];
    const end = shape[edgeIndex + 1];
    expect(start).toBeDefined();
    expect(end).toBeDefined();
    if (!start || !end) continue;

    expect(start).not.toEqual(end);
    expect(Math.abs(end[1] - start[1])).toBeLessThan(180);

    for (
      let otherEdgeIndex = edgeIndex + 1;
      otherEdgeIndex < edgeCount;
      otherEdgeIndex += 1
    ) {
      const edgesAreAdjacent =
        otherEdgeIndex === edgeIndex + 1 ||
        (edgeIndex === 0 && otherEdgeIndex === edgeCount - 1);
      if (edgesAreAdjacent) continue;

      const otherStart = shape[otherEdgeIndex];
      const otherEnd = shape[otherEdgeIndex + 1];
      expect(otherStart).toBeDefined();
      expect(otherEnd).toBeDefined();
      if (!otherStart || !otherEnd) continue;
      expect(segmentsIntersect(start, end, otherStart, otherEnd)).toBe(false);
    }
  }
}

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
    expect(bearing).not.toBeNull();
    if (bearing === null) return;
    expect(bearing).toBeGreaterThanOrEqual(0);
    expect(bearing).toBeLessThan(360);
  });

  it("returns null when a unique bearing does not exist", () => {
    expect(bearingDeg(INCIDENT, INCIDENT)).toBeNull();
    expect(bearingDeg([0, 0], [0, 360])).toBeNull();
    expect(bearingDeg([0, 0], [0, 180])).toBeNull();
    expect(bearingDeg([23, 41], [-23, -139])).toBeNull();
  });

  it("still returns a bearing outside the documented degeneracy tolerance", () => {
    expect(bearingDeg([0, 0], [0, 0.000_000_01])).toBeCloseTo(90, 6);
    expect(bearingDeg([0, 0], [0, 179.999])).toBeCloseTo(90, 6);
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

  it("projects across the antimeridian instead of across the world", () => {
    const nearest = nearestPointOnSegment([1, 180], [0, 179], [0, -179]);
    expect(nearest[0]).toBeCloseTo(0, 9);
    expect(Math.abs(nearest[1])).toBeCloseTo(180, 9);
    expect(distanceKm(nearest, [0, 180])).toBeLessThan(1e-6);
    expect(distanceKm(nearest, [0, 0])).toBeGreaterThan(19_000);
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

  it("uses wrapped segments in an antimeridian-crossing line", () => {
    const antimeridianLine = [
      [0, 178],
      [0, -179],
    ] as const;
    const nearest = nearestPointOnPolyline([1, 180], antimeridianLine);
    expect(nearest[0]).toBeCloseTo(0, 9);
    expect(Math.abs(nearest[1])).toBeCloseTo(180, 9);
  });
});

describe("scenarioShape", () => {
  it("returns a degenerate triangle for non-positive distance", () => {
    expect(scenarioShape(INCIDENT, 45, 0)).toEqual([
      INCIDENT,
      INCIDENT,
      INCIDENT,
    ]);
    expect(scenarioShape(INCIDENT, 45, -2.5)).toEqual([
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

  it("keeps eastbound and westbound dateline polygons simple and continuous", () => {
    const eastbound = scenarioShape([10, 179.95], 90, 40, 20);
    const westbound = scenarioShape([-10, -179.95], 270, 40, 20);

    expect(eastbound[0]).toEqual([10, 179.95]);
    expect(westbound[0]).toEqual([-10, -179.95]);
    expect(eastbound.slice(1, -1).some((vertex) => vertex[1] > 180)).toBe(
      true,
    );
    expect(westbound.slice(1, -1).some((vertex) => vertex[1] < -180)).toBe(
      true,
    );
    expectSimpleClosedPolygon(eastbound);
    expectSimpleClosedPolygon(westbound);
  });

  it("produces simple topology across representative headings and widths", () => {
    for (const heading of [0, 90, 180, 270]) {
      for (const halfAngle of [0.001, 17, 58, 120, 179]) {
        expectSimpleClosedPolygon(
          scenarioShape([38.989013, 179.99], heading, 5, halfAngle),
        );
      }
    }
  });

  it("defines zero angle as a closed centerline", () => {
    const shape = scenarioShape(INCIDENT, 45, 2.5, 0);
    expect(shape).toHaveLength(3);
    expect(shape[0]).toEqual(INCIDENT);
    expect(shape[2]).toEqual(INCIDENT);
    expect(distanceKm(INCIDENT, shape[1]!)).toBeCloseTo(2.5, 6);
    expect(bearingDeg(INCIDENT, shape[1]!)).toBeCloseTo(45, 6);
  });

  it("keeps both edges and the centerline for a tiny positive angle", () => {
    const halfAngle = 0.001;
    const shape = scenarioShape(INCIDENT, 90, 2.5, halfAngle);
    const vertices = shape.slice(1, -1);

    expect(shape).toHaveLength(5);
    expect(shape[shape.length - 1]).toEqual(shape[0]);
    expect(bearingDeg(INCIDENT, vertices[0]!)).toBeCloseTo(
      90 - halfAngle,
      5,
    );
    expect(bearingDeg(INCIDENT, vertices[1]!)).toBeCloseTo(90, 6);
    expect(bearingDeg(INCIDENT, vertices[2]!)).toBeCloseTo(
      90 + halfAngle,
      5,
    );
    expect(distanceKm(INCIDENT, vertices[1]!)).toBeCloseTo(2.5, 6);
    expect(vertices.flat().every(Number.isFinite)).toBe(true);
  });

  it("rejects invalid scenario half angles", () => {
    expect(() => scenarioShape(INCIDENT, 45, 2.5, -0.001)).toThrow(RangeError);
    expect(() => scenarioShape(INCIDENT, 45, 2.5, 180)).toThrow(RangeError);
    expect(() => scenarioShape(INCIDENT, 45, 2.5, 181)).toThrow(RangeError);
    expect(() => scenarioShape(INCIDENT, 45, 2.5, Number.NaN)).toThrow(
      RangeError,
    );
    expect(() => scenarioShape(INCIDENT, 45, 2.5, Infinity)).toThrow(
      RangeError,
    );
  });
});

describe("midpoint", () => {
  it("averages coordinates", () => {
    expect(midpoint([38, 26], [40, 28])).toEqual([39, 27]);
  });

  it("takes the short path across the antimeridian", () => {
    const eastToWest = midpoint([0, 179], [0, -179]);
    const westToEast = midpoint([0, -179], [0, 179]);
    expect(Math.abs(eastToWest[1])).toBe(180);
    expect(Math.abs(westToEast[1])).toBe(180);
    expect(distanceKm(eastToWest, [0, 180])).toBeLessThan(1e-6);
    expect(distanceKm(westToEast, [0, 180])).toBeLessThan(1e-6);
  });
});

describe("readonly inputs", () => {
  it("accepts readonly coordinates while returning mutable tuples", () => {
    const a = Object.freeze([38, 26] as const);
    const b = Object.freeze([40, 28] as const);
    const line = [a, b] as const;

    const outputs: LatLngTuple[] = [
      destination(a, 90, 1),
      nearestPointOnSegment(a, a, b),
      nearestPointOnPolyline(a, line),
      midpoint(a, b),
      ...scenarioShape(a, 90, 1),
    ];
    outputs[0]![0] += 0;

    expect(outputs.every((coordinate) => Array.isArray(coordinate))).toBe(true);
  });
});
