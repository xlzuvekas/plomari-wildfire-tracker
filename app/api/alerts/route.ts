import {
  METEOALARM_FEEDS,
  parseMeteoalarm,
  summarizeAlerts,
  type AlertCountry,
} from "./meteoalarm";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const country = searchParams.get("country") as AlertCountry | null;
  if (!country || !(country in METEOALARM_FEEDS)) {
    return Response.json({ error: "unknown_country" }, { status: 400 });
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12_000);
  try {
    const response = await fetch(METEOALARM_FEEDS[country], {
      headers: {
        // Meteoalarm answers 406 to specific XML Accept values; */* works.
        Accept: "*/*",
        "User-Agent": "PlomariFirewatch/2.0 public-safety-feed-reader",
      },
      signal: controller.signal,
      next: { revalidate: 600 },
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const entries = parseMeteoalarm(await response.text(), Date.now());
    return Response.json(
      {
        country,
        retrievedAt: new Date().toISOString(),
        source: "Meteoalarm (EUMETNET)",
        summary: summarizeAlerts(entries),
      },
      {
        headers: {
          "Cache-Control":
            "public, max-age=120, s-maxage=600, stale-while-revalidate=1800",
        },
      },
    );
  } catch {
    return Response.json(
      { country, error: "alerts_unavailable" },
      { status: 502 },
    );
  } finally {
    clearTimeout(timeout);
  }
}
