import {
  INFORCYL_DOCS,
  buildInforcylUrl,
  normalizeInforcyl,
} from "./inforcyl";

const WINDOW_DAYS = 14;

export async function GET() {
  const since = new Date(Date.now() - WINDOW_DAYS * 86_400_000)
    .toISOString()
    .slice(0, 10);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15_000);
  try {
    const response = await fetch(buildInforcylUrl(since), {
      headers: {
        Accept: "application/json",
        "User-Agent": "PlomariFirewatch/2.0 public-safety-feed-reader",
      },
      signal: controller.signal,
      next: { revalidate: 1800 },
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const incidents = normalizeInforcyl(await response.json());
    return Response.json(
      {
        retrievedAt: new Date().toISOString(),
        source: "INFORCYL · Junta de Castilla y León open data",
        docs: INFORCYL_DOCS,
        coverage: "Castilla y León only; other regions lack public APIs",
        windowDays: WINDOW_DAYS,
        incidents,
      },
      {
        headers: {
          "Cache-Control":
            "public, max-age=300, s-maxage=1800, stale-while-revalidate=3600",
        },
      },
    );
  } catch {
    return Response.json({ error: "inforcyl_unavailable" }, { status: 502 });
  } finally {
    clearTimeout(timeout);
  }
}
