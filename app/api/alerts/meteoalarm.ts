// Meteoalarm legacy ATOM feeds (CAP-in-ATOM). Per issue #18: Spain and
// Greece route weather CAP through Meteoalarm; France carries no forest-fire
// entries (heat only), so high-temperature warnings double as the
// fire-weather proxy everywhere and EFFIS covers the FR fire-danger gap.

export type AlertCountry = "gr" | "es" | "fr";

export const METEOALARM_FEEDS: Record<AlertCountry, string> = {
  gr: "https://feeds.meteoalarm.org/feeds/meteoalarm-legacy-atom-greece",
  es: "https://feeds.meteoalarm.org/feeds/meteoalarm-legacy-atom-spain",
  fr: "https://feeds.meteoalarm.org/feeds/meteoalarm-legacy-atom-france",
};

export type AlertEntry = {
  event: string;
  kind: "forest-fire" | "heat" | "other";
  severity: "Extreme" | "Severe" | "Moderate" | "Minor" | "Unknown";
  areaDesc: string;
  onset: string | null;
  expires: string | null;
};

export type AlertSummary = {
  total: number;
  forestFire: { count: number; maxSeverity: string | null };
  heat: { count: number; maxSeverity: string | null };
};

const SEVERITY_RANK: Record<string, number> = {
  Extreme: 4,
  Severe: 3,
  Moderate: 2,
  Minor: 1,
};

function tag(block: string, name: string) {
  return (
    block.match(new RegExp(`<${name}[^>]*>([^<]*)</${name}>`, "i"))?.[1] ?? ""
  );
}

function classifyEvent(event: string): AlertEntry["kind"] {
  const normalized = event.toLowerCase();
  if (/forest[ -]?fire|wild[ -]?fire/.test(normalized)) return "forest-fire";
  if (/high[ -]?temperature|heat/.test(normalized)) return "heat";
  return "other";
}

function severityOf(block: string, event: string): AlertEntry["severity"] {
  const explicit = tag(block, "cap:severity");
  if (SEVERITY_RANK[explicit]) return explicit as AlertEntry["severity"];
  const fromEvent = event.match(/^(Extreme|Severe|Moderate|Minor)/i)?.[1];
  if (fromEvent) {
    const cased =
      fromEvent[0]?.toUpperCase() + fromEvent.slice(1).toLowerCase();
    if (SEVERITY_RANK[cased]) return cased as AlertEntry["severity"];
  }
  return "Unknown";
}

export function parseMeteoalarm(xml: string, nowMs: number): AlertEntry[] {
  const entries: AlertEntry[] = [];
  for (const match of xml.matchAll(/<entry>([\s\S]*?)<\/entry>/g)) {
    const block = match[1] ?? "";
    if (tag(block, "cap:status") !== "Actual") continue;
    // "Update" amends a live warning and stays in force; only "Cancel"
    // (and unknown types) should drop the entry.
    const messageType = tag(block, "cap:message_type");
    if (messageType !== "Alert" && messageType !== "Update") continue;
    const event = tag(block, "cap:event").trim();
    if (!event) continue;
    const expires = tag(block, "cap:expires") || null;
    if (expires) {
      const expiresMs = Date.parse(expires);
      if (Number.isFinite(expiresMs) && expiresMs < nowMs) continue;
    }
    entries.push({
      event,
      kind: classifyEvent(event),
      severity: severityOf(block, event),
      areaDesc: tag(block, "cap:areaDesc").trim(),
      onset: tag(block, "cap:onset") || null,
      expires,
    });
  }
  return entries;
}

export function summarizeAlerts(entries: AlertEntry[]): AlertSummary {
  const bucket = (kind: AlertEntry["kind"]) => {
    const subset = entries.filter((entry) => entry.kind === kind);
    let max: string | null = null;
    for (const entry of subset) {
      if (
        (SEVERITY_RANK[entry.severity] ?? 0) > (max ? SEVERITY_RANK[max]! : 0)
      ) {
        max = entry.severity;
      }
    }
    return { count: subset.length, maxSeverity: max };
  };
  return {
    total: entries.length,
    forestFire: bucket("forest-fire"),
    heat: bucket("heat"),
  };
}
