// Pure geodesy helpers shared by the map UI. Extracted unchanged from
// app/page.tsx; no rendering, network, or incident-specific knowledge.

export type LatLngTuple = [number, number];

const EARTH_RADIUS_KM = 6371;

export function destination(
  origin: LatLngTuple,
  bearingDegrees: number,
  distanceKm: number,
): LatLngTuple {
  const bearing = (bearingDegrees * Math.PI) / 180;
  const angularDistance = distanceKm / EARTH_RADIUS_KM;
  const latitude = (origin[0] * Math.PI) / 180;
  const longitude = (origin[1] * Math.PI) / 180;
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
    (nextLatitude * 180) / Math.PI,
    (nextLongitude * 180) / Math.PI,
  ];
}

export function distanceKm(a: LatLngTuple, b: LatLngTuple) {
  const latA = (a[0] * Math.PI) / 180;
  const latB = (b[0] * Math.PI) / 180;
  const dLat = ((b[0] - a[0]) * Math.PI) / 180;
  const dLon = ((b[1] - a[1]) * Math.PI) / 180;
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(latA) * Math.cos(latB) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.sqrt(h));
}

export function bearingDeg(a: LatLngTuple, b: LatLngTuple) {
  const latA = (a[0] * Math.PI) / 180;
  const latB = (b[0] * Math.PI) / 180;
  const dLon = ((b[1] - a[1]) * Math.PI) / 180;
  const y = Math.sin(dLon) * Math.cos(latB);
  const x =
    Math.cos(latA) * Math.sin(latB) -
    Math.sin(latA) * Math.cos(latB) * Math.cos(dLon);
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}

// Equirectangular approximation is fine at incident scale (< 10 km spans).
export function nearestPointOnSegment(
  point: LatLngTuple,
  a: LatLngTuple,
  b: LatLngTuple,
): LatLngTuple {
  const cosLat = Math.cos((point[0] * Math.PI) / 180);
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
