// Pure geodesy helpers shared by map surfaces. This module deliberately has no
// rendering, network, or incident-specific knowledge.

export type LatLngTuple = [latitude: number, longitude: number];

const EARTH_RADIUS_KM = 6_371;

function toRadians(degrees: number): number {
  return (degrees * Math.PI) / 180;
}

function toDegrees(radians: number): number {
  return (radians * 180) / Math.PI;
}

function normalizeLongitude(longitude: number): number {
  return ((longitude + 540) % 360) - 180;
}

export function destination(
  origin: LatLngTuple,
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

export function distanceKm(a: LatLngTuple, b: LatLngTuple): number {
  const latA = toRadians(a[0]);
  const latB = toRadians(b[0]);
  const dLat = toRadians(b[0] - a[0]);
  const dLon = toRadians(b[1] - a[1]);
  const haversine =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(latA) * Math.cos(latB) * Math.sin(dLon / 2) ** 2;

  // Floating-point error can put an antipodal result microscopically above 1.
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.sqrt(Math.min(1, haversine)));
}

export function bearingDeg(a: LatLngTuple, b: LatLngTuple): number {
  const latA = toRadians(a[0]);
  const latB = toRadians(b[0]);
  const dLon = toRadians(b[1] - a[1]);
  const y = Math.sin(dLon) * Math.cos(latB);
  const x =
    Math.cos(latA) * Math.sin(latB) -
    Math.sin(latA) * Math.cos(latB) * Math.cos(dLon);

  return (toDegrees(Math.atan2(y, x)) + 360) % 360;
}

// Equirectangular approximation is appropriate for short map segments. It is
// intentionally not used for global distance or bearing calculations.
export function nearestPointOnSegment(
  point: LatLngTuple,
  a: LatLngTuple,
  b: LatLngTuple,
): LatLngTuple {
  const cosLat = Math.cos(toRadians(point[0]));
  const ax = (a[1] - point[1]) * cosLat;
  const ay = a[0] - point[0];
  const dx = (b[1] - a[1]) * cosLat;
  const dy = b[0] - a[0];
  const lengthSq = dx * dx + dy * dy;
  const t =
    lengthSq === 0
      ? 0
      : Math.max(0, Math.min(1, -(ax * dx + ay * dy) / lengthSq));

  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
}

export function nearestPointOnPolyline(
  point: LatLngTuple,
  line: readonly LatLngTuple[],
): LatLngTuple {
  let nearest = line[0] ?? point;
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

export function scenarioShape(
  origin: LatLngTuple,
  heading: number,
  distanceKm: number,
  halfAngle = 58,
): LatLngTuple[] {
  if (distanceKm <= 0) return [origin, origin, origin];

  const points: LatLngTuple[] = [origin];
  const step = Math.max(4, Math.round((halfAngle * 2) / 14));
  for (let offset = -halfAngle; offset <= halfAngle; offset += step) {
    const taper =
      0.38 +
      0.62 * Math.cos((Math.abs(offset) / halfAngle) * (Math.PI / 2));
    points.push(destination(origin, heading + offset, distanceKm * taper));
  }
  points.push(origin);

  return points;
}

export function midpoint(a: LatLngTuple, b: LatLngTuple): LatLngTuple {
  return [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
}
