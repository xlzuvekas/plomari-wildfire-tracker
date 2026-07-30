import {
  AIR_QUALITY_DOCS,
  AIR_QUALITY_ENDPOINT,
  normalizeAirQuality,
} from "../wind/airquality";
import { regionById } from "../../lib/regions";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const region = regionById(searchParams.get("region"));
  if (!region) {
    return Response.json({ error: "unknown_region" }, { status: 400 });
  }

  const url = new URL(AIR_QUALITY_ENDPOINT);
  url.searchParams.set("latitude", String(region.center[0]));
  url.searchParams.set("longitude", String(region.center[1]));
  url.searchParams.set(
    "current",
    "pm2_5,pm10,european_aqi,aerosol_optical_depth",
  );

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 9_000);
  try {
    const response = await fetch(url, {
      headers: {
        Accept: "application/json",
        "User-Agent": "PlomariFirewatch/2.0 public-safety-feed-reader",
      },
      signal: controller.signal,
      next: { revalidate: 900 },
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const [reading] = normalizeAirQuality(await response.json(), [
      { id: region.id, label: region.id },
    ]);
    return Response.json(
      {
        region: region.id,
        retrievedAt: new Date().toISOString(),
        source: "Open-Meteo air quality · region viewport center",
        docs: AIR_QUALITY_DOCS,
        reading: reading ?? null,
      },
      {
        headers: {
          "Cache-Control":
            "public, max-age=300, s-maxage=900, stale-while-revalidate=1800",
        },
      },
    );
  } catch {
    return Response.json(
      { region: region.id, error: "airquality_unavailable" },
      { status: 502 },
    );
  } finally {
    clearTimeout(timeout);
  }
}
