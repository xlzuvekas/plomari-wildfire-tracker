// Pure geodesy helpers shared by map surfaces. This module deliberately has no
// rendering, network, or incident-specific knowledge.

/** Mutable coordinate tuple used for newly computed geometry. */
export type LatLngTuple = [latitude: number, longitude: number];

/** Coordinate input. Callers may safely pass tuples declared with `as const`. */
export type LatLngInput = readonly [latitude: number, longitude: number];

const EARTH_RADIUS_KM = 6_371;
const COINCIDENT_HAVERSINE_EPSILON = 1e-24;
const ANTIPODAL_HAVERSINE_EPSILON = 1e-15;

function toRadians(degrees: number): number {
  return (degrees * Math.PI) / 180;
}

function toDegrees(radians: number): number {
  return (radians * 180) / Math.PI;
}

function normalizeLongitude(longitude: number): number {
  const normalized = ((((longitude + 180) % 360) + 360) % 360) - 180;
  return Object.is(normalized, -0) ? 0 : normalized;
}

function shortestLongitudeDelta(from: number, to: number): number {
  return normalizeLongitude(to - from);
}

function longitudeNear(reference: number, longitude: number): number {
  return reference + shortestLongitudeDelta(reference, longitude);
}

export function destination(
  origin: LatLngInput,
  bearingDegrees: number,
  distanceKm: number,
): LatLngTuple {
  const bearing = toRadians(bearingDegrees);
  const angularDistance = distanceKm / EARTH_RADIUS_KM;
  const latitude = toRadians(origin[0]);
  const longitude = toRadians(origin[1]);
  const nextLatitude = Math.asin(
    Math.sin(latitude) * Math.cos(angularDistance) +
      Math.cos(latitude) * Math.sin(angularDistance) * Math.cos(bearing),
  );
  const nextLongitude =
    longitude +
    Math.atan2(
      Math.sin(bearing) * Math.sin(angularDistance) * Math.cos(latitude),
      Math.cos(angularDistance) -
        Math.sin(latitude) * Math.sin(nextLatitude),
    );

  return [
    toDegrees(nextLatitude),
    normalizeLongitude(toDegrees(nextLongitude)),
  ];
}

export function distanceKm(a: LatLngInput, b: LatLngInput): number {
  const latA = toRadians(a[0]);
  const latB = toRadians(b[0]);
  const dLat = toRadians(b[0] - a[0]);
  const dLon = toRadians(shortestLongitudeDelta(a[1], b[1]));
  const haversine =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(latA) * Math.cos(latB) * Math.sin(dLon / 2) ** 2;

  // Floating-point error can put an antipodal result microscopically above 1.
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.sqrt(Math.min(1, haversine)));
}

/**
 * Returns the initial great-circle bearing in [0, 360), or `null` when no
 * stable, unique bearing exists. Coincident points have no direction and an
 * antipodal pair has infinitely many shortest paths; coordinates within the
 * floating-point tolerance of either degeneracy are treated the same way.
 */
export function bearingDeg(a: LatLngInput, b: LatLngInput): number | null {
  const latA = toRadians(a[0]);
  const latB = toRadians(b[0]);
  const dLon = toRadians(shortestLongitudeDelta(a[1], b[1]));
  const dLat = latB - latA;
  const haversine =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(latA) * Math.cos(latB) * Math.sin(dLon / 2) ** 2;

  // Identical locations have no direction, while antipodes have infinitely
  // many equally short initial bearings. Returning north for either case is
  // dangerously plausible in a navigation readout, so make both explicit.
  const boundedHaversine = Math.max(0, Math.min(1, haversine));
  if (
    boundedHaversine <= COINCIDENT_HAVERSINE_EPSILON ||
    1 - boundedHaversine <= ANTIPODAL_HAVERSINE_EPSILON
  ) {
    return null;
  }

  const y = Math.sin(dLon) * Math.cos(latB);
  const x =
    Math.cos(latA) * Math.sin(latB) -
    Math.sin(latA) * Math.cos(latB) * Math.cos(dLon);

  return (toDegrees(Math.atan2(y, x)) + 360) % 360;
}

// Equirectangular approximation is appropriate for short map segments. It is
// intentionally not used for global distance or bearing calculations.
export function nearestPointOnSegment(
  point: LatLngInput,
  a: LatLngInput,
  b: LatLngInput,
): LatLngTuple {
  const cosLat = Math.cos(toRadians(point[0]));
  const pointToALongitude = shortestLongitudeDelta(point[1], a[1]);
  const aToBLongitude = shortestLongitudeDelta(a[1], b[1]);
  const ax = pointToALongitude * cosLat;
  const ay = a[0] - point[0];
  const dx = aToBLongitude * cosLat;
  const dy = b[0] - a[0];
  const lengthSq = dx * dx + dy * dy;
  const t =
    lengthSq === 0
      ? 0
      : Math.max(0, Math.min(1, -(ax * dx + ay * dy) / lengthSq));

  return [
    a[0] + (b[0] - a[0]) * t,
    normalizeLongitude(a[1] + aToBLongitude * t),
  ];
}

export function nearestPointOnPolyline(
  point: LatLngInput,
  line: readonly LatLngInput[],
): LatLngTuple {
  const first = line[0];
  let nearest: LatLngTuple = first
    ? [first[0], first[1]]
    : [point[0], point[1]];
  let nearestKm = distanceKm(point, nearest);

  for (let index = 1; index < line.length; index += 1) {
    const start = line[index - 1];
    const end = line[index];
    if (!start || !end) continue;

    const candidate = nearestPointOnSegment(point, start, end);
    const candidateKm = distanceKm(point, candidate);
    if (candidateKm < nearestKm) {
      nearest = candidate;
      nearestKm = candidateKm;
    }
  }

  return nearest;
}

/**
 * Builds a closed, tapered scenario wedge in a continuous longitude frame.
 * A zero half-angle is represented as an origin-tip-origin centerline;
 * positive half-angles must be less than 180 degrees so the ring stays simple.
 */
export function scenarioShape(
  origin: LatLngInput,
  heading: number,
  distanceKm: number,
  halfAngle = 58,
): LatLngTuple[] {
  const originPoint = (): LatLngTuple => [origin[0], origin[1]];
  if (!Number.isFinite(halfAngle) || halfAngle < 0 || halfAngle >= 180) {
    throw new RangeError(
      "scenario halfAngle must be at least 0 and less than 180 degrees",
    );
  }
  if (distanceKm <= 0) return [originPoint(), originPoint(), originPoint()];

  if (halfAngle === 0) {
    const tip = destination(origin, heading, distanceKm);
    return [
      originPoint(),
      [tip[0], longitudeNear(origin[1], tip[1])],
      originPoint(),
    ];
  }

  const points: LatLngTuple[] = [originPoint()];
  // Always include both edges and the centerline. Even very narrow wedges
  // therefore remain a finite, closed polygon rather than producing NaNs or
  // silently dropping one side.
  let segmentCount = Math.max(2, Math.ceil((halfAngle * 2) / 8));
  if (segmentCount % 2 !== 0) segmentCount += 1;
  for (let index = 0; index <= segmentCount; index += 1) {
    const offset = -halfAngle + (halfAngle * 2 * index) / segmentCount;
    const taper =
      0.38 +
      0.62 * Math.cos((Math.abs(offset) / halfAngle) * (Math.PI / 2));
    const vertex = destination(
      origin,
      heading + offset,
      distanceKm * taper,
    );
    // Keep the entire ring in the origin's longitude frame. A normalized
    // vertex on the other side of the antimeridian would otherwise introduce
    // a roughly 360-degree edge and render the envelope across the world.
    points.push([
      vertex[0],
      longitudeNear(origin[1], vertex[1]),
    ]);
  }
  points.push(originPoint());

  return points;
}

export function midpoint(a: LatLngInput, b: LatLngInput): LatLngTuple {
  return [
    (a[0] + b[0]) / 2,
    normalizeLongitude(a[1] + shortestLongitudeDelta(a[1], b[1]) / 2),
  ];
}
