export const AIR_QUALITY_ENDPOINT =
  "https://air-quality-api.open-meteo.com/v1/air-quality";
export const AIR_QUALITY_DOCS =
  "https://open-meteo.com/en/docs/air-quality-api";

export type AirQualityLocation = {
  id: string;
  label: string;
};

export type NormalizedAirQuality = {
  id: string;
  label: string;
  provider: "open-meteo";
  time: string | null;
  pm25: number | null;
  pm10: number | null;
  europeanAqi: number | null;
  aerosolOpticalDepth: number | null;
};

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function number(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

// Open-Meteo returns a bare object for a single location and an array for a
// comma-separated multi-location query, index-aligned with the request order.
export function normalizeAirQuality(
  payload: unknown,
  locations: readonly AirQualityLocation[],
): NormalizedAirQuality[] {
  const entries = Array.isArray(payload) ? payload : [payload];

  return locations.flatMap((location, index) => {
    const current = record(record(entries[index])?.current);
    if (!current) return [];
    const time = current.time;

    return [
      {
        id: location.id,
        label: location.label,
        provider: "open-meteo" as const,
        time: typeof time === "string" ? time : null,
        pm25: number(current.pm2_5),
        pm10: number(current.pm10),
        europeanAqi: number(current.european_aqi),
        aerosolOpticalDepth: number(current.aerosol_optical_depth),
      },
    ];
  });
}
