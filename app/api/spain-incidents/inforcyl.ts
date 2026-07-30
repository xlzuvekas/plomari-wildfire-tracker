// Castilla y León INFORCYL open-data incident records (issue #18) — the
// verified official Spanish incident API: coordinates, status, severity
// level, and affected surface, updated twice daily in season. The
// Andalusian INFOCA ArcGIS endpoint from the issue could not be re-verified
// live, so it is deliberately not wired here.

export const INFORCYL_ENDPOINT =
  "https://jcyl.opendatasoft.com/api/explore/v2.1/catalog/datasets/incendios-forestales/records";
export const INFORCYL_DOCS =
  "https://datosabiertos.jcyl.es/web/jcyl/set/es/medio-ambiente/incendios-forestales/1284941252651";

export type SpainIncident = {
  startDate: string | null;
  province: string | null;
  municipality: string | null;
  status: string | null;
  level: number | null;
  maxLevel: number | null;
  surface: string | null;
  lat: number;
  lon: number;
};

export function buildInforcylUrl(sinceIsoDate: string, limit = 100) {
  const url = new URL(INFORCYL_ENDPOINT);
  url.searchParams.set("limit", String(limit));
  url.searchParams.set("order_by", "fecha_de_inicio desc");
  url.searchParams.set("where", `fecha_de_inicio >= date'${sinceIsoDate}'`);
  return url;
}

function text(value: unknown): string | null {
  if (Array.isArray(value)) value = value[0];
  return typeof value === "string" && value.trim() !== "" ? value.trim() : null;
}

function integer(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : typeof value === "string" && /^\d+$/.test(value)
      ? Number.parseInt(value, 10)
      : null;
}

export function normalizeInforcyl(payload: unknown): SpainIncident[] {
  if (!payload || typeof payload !== "object") return [];
  const results = (payload as { results?: unknown }).results;
  if (!Array.isArray(results)) return [];
  return results.flatMap((entry): SpainIncident[] => {
    if (!entry || typeof entry !== "object") return [];
    const row = entry as Record<string, unknown>;
    const position = row.posicion as { lat?: unknown; lon?: unknown } | null;
    const lat = position?.lat;
    const lon = position?.lon;
    if (typeof lat !== "number" || typeof lon !== "number") return [];
    return [
      {
        startDate: text(row.fecha_de_inicio),
        province: text(row.provincia),
        municipality: text(row.termino_municipal),
        status: text(row.situacion_actual),
        level: integer(row.nivel),
        maxLevel: integer(row.nivel_maximo_alcanzado),
        surface: text(row.tipo_y_has_de_superficie_afectada),
        lat,
        lon,
      },
    ];
  });
}
