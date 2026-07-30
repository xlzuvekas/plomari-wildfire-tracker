// Distance math and the indicative proximity level for a user-chosen point.
// The level is a distance-based heuristic only — it is NOT an official
// warning or evacuation product and the UI must always say so.

const EARTH_RADIUS_KM = 6371;

export type ProximityLevel = "critical" | "high" | "elevated" | "monitor";

export type ProximityAssessment = {
  distanceToIncidentKm: number;
  bearingToIncidentDeg: number;
  nearestDetectionKm: number | null;
  nearestDetectionAgeMinutes: number | null;
  level: ProximityLevel;
};

export function haversineKm(
  fromLat: number,
  fromLon: number,
  toLat: number,
  toLon: number,
) {
  const toRad = (value: number) => (value * Math.PI) / 180;
  const dLat = toRad(toLat - fromLat);
  const dLon = toRad(toLon - fromLon);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(fromLat)) * Math.cos(toRad(toLat)) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.sqrt(a));
}

export function initialBearingDeg(
  fromLat: number,
  fromLon: number,
  toLat: number,
  toLon: number,
) {
  const toRad = (value: number) => (value * Math.PI) / 180;
  const dLon = toRad(toLon - fromLon);
  const y = Math.sin(dLon) * Math.cos(toRad(toLat));
  const x =
    Math.cos(toRad(fromLat)) * Math.sin(toRad(toLat)) -
    Math.sin(toRad(fromLat)) * Math.cos(toRad(toLat)) * Math.cos(dLon);
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}

// Detections older than this no longer influence the level; satellite passes
// are snapshots and a stale hot pixel is not evidence of current fire there.
const RECENT_DETECTION_MINUTES = 6 * 60;

// ponytail: fixed distance rings, no terrain or spread modeling — matches the
// app's "indicative only" framing; upgrade path is a real hazard model.
const LEVEL_RINGS: Array<[ProximityLevel, number]> = [
  ["critical", 2],
  ["high", 5],
  ["elevated", 12],
];

export function assessProximity(
  point: { lat: number; lon: number },
  incidentCenter: { lat: number; lon: number },
  detections: Array<{ lat: number; lon: number; ageMinutes: number }>,
): ProximityAssessment {
  const distanceToIncidentKm = haversineKm(
    point.lat,
    point.lon,
    incidentCenter.lat,
    incidentCenter.lon,
  );
  const bearingToIncidentDeg = initialBearingDeg(
    point.lat,
    point.lon,
    incidentCenter.lat,
    incidentCenter.lon,
  );

  let nearestDetectionKm: number | null = null;
  let nearestDetectionAgeMinutes: number | null = null;
  for (const detection of detections) {
    const distanceKm = haversineKm(
      point.lat,
      point.lon,
      detection.lat,
      detection.lon,
    );
    if (nearestDetectionKm === null || distanceKm < nearestDetectionKm) {
      nearestDetectionKm = distanceKm;
      nearestDetectionAgeMinutes = detection.ageMinutes;
    }
  }

  const recentDetectionKm =
    nearestDetectionKm !== null &&
    nearestDetectionAgeMinutes !== null &&
    nearestDetectionAgeMinutes <= RECENT_DETECTION_MINUTES
      ? nearestDetectionKm
      : null;
  const effectiveKm =
    recentDetectionKm === null
      ? distanceToIncidentKm
      : Math.min(distanceToIncidentKm, recentDetectionKm);

  let level: ProximityLevel = "monitor";
  for (const [ring, maxKm] of LEVEL_RINGS) {
    if (effectiveKm <= maxKm) {
      level = ring;
      break;
    }
  }

  return {
    distanceToIncidentKm,
    bearingToIncidentDeg,
    nearestDetectionKm,
    nearestDetectionAgeMinutes,
    level,
  };
}
