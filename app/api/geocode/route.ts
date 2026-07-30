import {
  NOMINATIM_DOCS,
  NOMINATIM_ENDPOINT,
  SEARCH_VIEWBOX,
  normalizeNominatim,
} from "./nominatim";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const query = searchParams.get("q")?.trim() ?? "";
  const lang = searchParams.get("lang")?.trim() || "en";
  if (query.length < 2) {
    return Response.json(
      { results: [], error: "query_too_short" },
      { status: 400 },
    );
  }

  const upstream = new URL(NOMINATIM_ENDPOINT);
  upstream.searchParams.set("q", query);
  upstream.searchParams.set("format", "jsonv2");
  upstream.searchParams.set("limit", "5");
  upstream.searchParams.set("viewbox", SEARCH_VIEWBOX);
  upstream.searchParams.set("accept-language", lang);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 9_000);
  try {
    const response = await fetch(upstream, {
      headers: {
        "User-Agent": "PlomariFirewatch/2.0 public-safety-locator",
      },
      signal: controller.signal,
      // Nominatim asks heavy users to cache; identical queries are served
      // from the CDN for a day instead of hitting the upstream again.
      next: { revalidate: 86_400 },
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const results = normalizeNominatim(await response.json());
    return Response.json(
      { results, attribution: "OpenStreetMap / Nominatim", docs: NOMINATIM_DOCS },
      {
        headers: {
          "Cache-Control":
            "public, max-age=3600, s-maxage=86400, stale-while-revalidate=86400",
        },
      },
    );
  } catch {
    return Response.json(
      { results: [], error: "geocode_unavailable" },
      { status: 502 },
    );
  } finally {
    clearTimeout(timeout);
  }
}
