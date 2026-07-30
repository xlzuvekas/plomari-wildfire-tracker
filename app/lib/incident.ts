// Single source of truth for the incident's location, size, and start time.
// These values were previously duplicated across app/page.tsx and the
// app/api/{thermal,wind,updates} routes; keep them here so the incident can be
// re-pointed in one place without the copies drifting apart.

export const INCIDENT_CENTER = {
  lat: 38.989013,
  lon: 26.382489,
} as const;

export const INCIDENT_RADIUS_KM = 8;

export const INCIDENT_STARTED_AT = "2026-07-29T10:30:00Z";

export const LOCAL_TIME_ZONE = "Europe/Athens";
