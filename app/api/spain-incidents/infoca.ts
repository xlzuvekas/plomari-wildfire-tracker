// Andalucía Plan INFOCA incident layer, recovered via ArcGIS Online item
// search (issue #18 carried a truncated URL). Point features with status,
// incident type, and deployed-resource counts, near-real-time. The service
// is a proxied AGOL utility endpoint, so filter defensively client-side
// per the issue's guidance rather than trusting server-side SQL.

export const INFOCA_ENDPOINT =
  "https://utility.arcgis.com/usrsvcs/servers/d6d1c0079ddd4c7f8876d58e13fcf1ac/rest/services/INFOCA/AN_INCIDENTES_PRO/FeatureServer/2/query";
export const INFOCA_DOCS =
  "https://www.juntadeandalucia.es/organismos/agriculturapescaaguaydesarrollorural/areas/politica-forestal/incendios-forestales.html";

import type { SpainIncident } from "./inforcyl";

export function buildInfocaUrl(limit = 200) {
  const url = new URL(INFOCA_ENDPOINT);
  url.searchParams.set("where", "1=1");
  url.searchParams.set("outFields", "*");
  url.searchParams.set("f", "json");
  url.searchParams.set("resultRecordCount", String(limit));
  url.searchParams.set("orderByFields", "FECHA DESC");
  url.searchParams.set("outSR", "4326");
  return url;
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() !== "" ? value.trim() : null;
}

export function normalizeInfoca(
  payload: unknown,
  sinceMs: number,
): SpainIncident[] {
  if (!payload || typeof payload !== "object") return [];
  const features = (payload as { features?: unknown }).features;
  if (!Array.isArray(features)) return [];
  return features.flatMap((feature): SpainIncident[] => {
    if (!feature || typeof feature !== "object") return [];
    const record = feature as {
      attributes?: Record<string, unknown>;
      geometry?: { x?: unknown; y?: unknown };
    };
    const attributes = record.attributes ?? {};
    const type = text(attributes.TIPO_INCIDENTE) ?? "";
    if (!/INCENDIO|IIFF/i.test(type)) return [];
    const lat = record.geometry?.y;
    const lon = record.geometry?.x;
    if (typeof lat !== "number" || typeof lon !== "number") return [];
    const epoch = attributes.FECHA;
    if (typeof epoch !== "number" || epoch < sinceMs) return [];
    const aerial = attributes.MEDIOS_AEREOS;
    return [
      {
        source: "INFOCA",
        startDate: new Date(epoch).toISOString().slice(0, 10),
        province: text(attributes.PROVINCIA),
        municipality: text(attributes.TERMINO_MUNICIPAL),
        status: text(attributes.ESTADO),
        level: null,
        maxLevel: null,
        surface: null,
        aerialUnits: typeof aerial === "number" ? aerial : null,
        lat,
        lon,
      },
    ];
  });
}
