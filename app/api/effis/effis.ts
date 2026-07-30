// Copernicus EFFIS WFS — near-real-time burnt-area polygons (issue #18).
// The weekly window (`modis.ba.poly.week`) carries the fires currently or
// recently burning, with date, commune, province, and mapped hectares —
// perimeter-shaped context the point-based FIRMS feed cannot provide.

export const EFFIS_ENDPOINT = "https://maps.effis.emergency.copernicus.eu/effis";
export const EFFIS_DOCS = "https://forest-fire.emergency.copernicus.eu/";
export const BURNT_AREA_LAYER = "ms:modis.ba.poly.week";

export type BurntArea = {
  id: string;
  fireDate: string | null;
  lastUpdate: string | null;
  country: string | null;
  province: string | null;
  commune: string | null;
  areaHa: number | null;
  // Outer ring per polygon, latitude/longitude order for Leaflet.
  rings: Array<Array<[number, number]>>;
};

export function buildBurntAreaUrl(
  bbox: [number, number, number, number],
  count = 200,
) {
  const url = new URL(EFFIS_ENDPOINT);
  url.searchParams.set("service", "WFS");
  url.searchParams.set("version", "2.0.0");
  url.searchParams.set("request", "GetFeature");
  url.searchParams.set("typename", BURNT_AREA_LAYER);
  url.searchParams.set("outputformat", "geojson");
  url.searchParams.set("srsname", "EPSG:4326");
  url.searchParams.set("bbox", `${bbox.join(",")},EPSG:4326`);
  url.searchParams.set("count", String(count));
  return url;
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() !== "" ? value.trim() : null;
}

function ringToLatLng(ring: unknown): Array<[number, number]> {
  if (!Array.isArray(ring)) return [];
  return ring.flatMap((position): Array<[number, number]> => {
    if (
      Array.isArray(position) &&
      typeof position[0] === "number" &&
      typeof position[1] === "number"
    ) {
      // GeoJSON is lon,lat; Leaflet wants lat,lng.
      return [[position[1], position[0]]];
    }
    return [];
  });
}

// Outer rings only: burnt-area holes are irrelevant at overview zoom.
function outerRings(geometry: unknown): Array<Array<[number, number]>> {
  if (!geometry || typeof geometry !== "object") return [];
  const record = geometry as { type?: unknown; coordinates?: unknown };
  if (record.type === "Polygon" && Array.isArray(record.coordinates)) {
    const ring = ringToLatLng(record.coordinates[0]);
    return ring.length >= 3 ? [ring] : [];
  }
  if (record.type === "MultiPolygon" && Array.isArray(record.coordinates)) {
    return record.coordinates.flatMap((polygon) => {
      if (!Array.isArray(polygon)) return [];
      const ring = ringToLatLng(polygon[0]);
      return ring.length >= 3 ? [ring] : [];
    });
  }
  return [];
}

export function normalizeBurntAreas(payload: unknown): BurntArea[] {
  if (!payload || typeof payload !== "object") return [];
  const features = (payload as { features?: unknown }).features;
  if (!Array.isArray(features)) return [];
  return features
    .flatMap((feature): BurntArea[] => {
      if (!feature || typeof feature !== "object") return [];
      const record = feature as {
        geometry?: unknown;
        properties?: Record<string, unknown>;
      };
      const props = record.properties ?? {};
      const rings = outerRings(record.geometry);
      if (rings.length === 0) return [];
      const areaRaw = text(props.AREA_HA);
      const areaHa = areaRaw === null ? NaN : Number.parseFloat(areaRaw);
      return [
        {
          id: text(props.id) ?? JSON.stringify(rings[0]?.[0] ?? []),
          fireDate: text(props.FIREDATE),
          lastUpdate: text(props.LASTUPDATE),
          country: text(props.COUNTRY),
          province: text(props.PROVINCE),
          commune: text(props.COMMUNE),
          areaHa: Number.isFinite(areaHa) ? areaHa : null,
          rings,
        },
      ];
    })
    .sort((left, right) =>
      (right.fireDate ?? "").localeCompare(left.fireDate ?? ""),
    );
}
