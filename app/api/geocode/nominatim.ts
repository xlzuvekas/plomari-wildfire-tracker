// Nominatim (OpenStreetMap) forward geocoding, proxied server-side so the
// browser only talks to same-origin APIs and the request carries the
// User-Agent that Nominatim's usage policy requires.

export const NOMINATIM_ENDPOINT = "https://nominatim.openstreetmap.org/search";
export const NOMINATIM_DOCS = "https://nominatim.org/release-docs/latest/api/Search/";

// Lesvos and the surrounding north-east Aegean; results here rank first but
// matches outside are still returned (bounded=0).
export const SEARCH_VIEWBOX = "25.8,39.5,26.8,38.7";

export type GeocodeResult = {
  label: string;
  lat: number;
  lon: number;
};

export function normalizeNominatim(payload: unknown): GeocodeResult[] {
  if (!Array.isArray(payload)) return [];
  return payload.flatMap((entry): GeocodeResult[] => {
    if (!entry || typeof entry !== "object") return [];
    const record = entry as Record<string, unknown>;
    const label =
      typeof record.display_name === "string" ? record.display_name : null;
    const lat =
      typeof record.lat === "string" ? Number.parseFloat(record.lat) : NaN;
    const lon =
      typeof record.lon === "string" ? Number.parseFloat(record.lon) : NaN;
    if (!label || !Number.isFinite(lat) || !Number.isFinite(lon)) return [];
    return [{ label, lat, lon }];
  });
}
