import {
  INFORCYL_DOCS,
  buildInforcylUrl,
  normalizeInforcyl,
  type SpainIncident,
} from "./inforcyl";
import { INFOCA_DOCS, buildInfocaUrl, normalizeInfoca } from "./infoca";

const WINDOW_DAYS = 14;

async function fetchJson(url: URL, timeoutMs = 15_000): Promise<unknown> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      headers: {
        Accept: "application/json",
        "User-Agent": "PlomariFirewatch/2.0 public-safety-feed-reader",
      },
      signal: controller.signal,
      next: { revalidate: 1800 },
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return await response.json();
  } finally {
    clearTimeout(timeout);
  }
}

export async function GET() {
  const sinceMs = Date.now() - WINDOW_DAYS * 86_400_000;
  const since = new Date(sinceMs).toISOString().slice(0, 10);

  const [inforcylResult, infocaResult] = await Promise.allSettled([
    fetchJson(buildInforcylUrl(since)).then(normalizeInforcyl),
    fetchJson(buildInfocaUrl()).then((payload) =>
      normalizeInfoca(payload, sinceMs),
    ),
  ]);

  const incidents: SpainIncident[] = [
    ...(inforcylResult.status === "fulfilled" ? inforcylResult.value : []),
    ...(infocaResult.status === "fulfilled" ? infocaResult.value : []),
  ].sort((left, right) =>
    (right.startDate ?? "").localeCompare(left.startDate ?? ""),
  );

  if (incidents.length === 0 && inforcylResult.status === "rejected") {
    return Response.json({ error: "spain_incidents_unavailable" }, {
      status: 502,
    });
  }

  return Response.json(
    {
      retrievedAt: new Date().toISOString(),
      sources: [
        {
          id: "inforcyl",
          label: "INFORCYL · Junta de Castilla y León",
          docs: INFORCYL_DOCS,
          status: inforcylResult.status === "fulfilled" ? "ok" : "error",
        },
        {
          id: "infoca",
          label: "Plan INFOCA · Junta de Andalucía",
          docs: INFOCA_DOCS,
          status: infocaResult.status === "fulfilled" ? "ok" : "error",
        },
      ],
      coverage:
        "Castilla y León + Andalucía; other Spanish regions lack public APIs",
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
}
