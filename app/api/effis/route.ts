import { regionById } from "../../lib/regions";
import { EFFIS_DOCS, buildBurntAreaUrl, normalizeBurntAreas } from "./effis";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const region = regionById(searchParams.get("region"));
  if (!region) {
    return Response.json({ error: "unknown_region" }, { status: 400 });
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20_000);
  try {
    const response = await fetch(buildBurntAreaUrl(region.bbox), {
      headers: {
        Accept: "application/json",
        "User-Agent": "PlomariFirewatch/2.0 public-safety-feed-reader",
      },
      signal: controller.signal,
      next: { revalidate: 900 },
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const burntAreas = normalizeBurntAreas(await response.json());
    return Response.json(
      {
        region: region.id,
        retrievedAt: new Date().toISOString(),
        source: "Copernicus EFFIS · MODIS burnt areas · last 7 days",
        docs: EFFIS_DOCS,
        burntAreas,
      },
      {
        headers: {
          "Cache-Control":
            "public, max-age=300, s-maxage=900, stale-while-revalidate=3600",
        },
      },
    );
  } catch {
    return Response.json(
      { region: region.id, error: "effis_unavailable" },
      { status: 502 },
    );
  } finally {
    clearTimeout(timeout);
  }
}
