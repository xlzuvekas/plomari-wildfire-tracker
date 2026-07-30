// Country RSS packs from issue #18, all verified live. Items are filtered to
// fire-related headlines with per-language term lists (Castilian, Galician,
// Catalan/Valencian, French) and merged newest-first.

export type NewsCountry = "fr" | "es";

export type NewsFeed = {
  id: string;
  label: string;
  url: string;
  official?: boolean;
};

export const NEWS_FEEDS: Record<NewsCountry, NewsFeed[]> = {
  fr: [
    {
      id: "franceinfo-fires",
      label: "franceinfo · Incendies",
      url: "https://www.franceinfo.fr/monde/environnement/incendies-et-feux-de-foret.rss",
    },
    {
      id: "ici-provence",
      label: "ici Provence",
      url: "https://www.ici.fr/rss/provence/a-la-une.xml",
    },
    {
      id: "ici-corse",
      label: "ici RCFM (Corse)",
      url: "https://www.ici.fr/rss/rcfm/a-la-une.xml",
    },
    // Region-level "occitanie" slug 404s; station slugs are the live ones.
    {
      id: "ici-herault",
      label: "ici Hérault",
      url: "https://www.ici.fr/rss/herault/a-la-une.xml",
    },
    {
      id: "ici-gard-lozere",
      label: "ici Gard Lozère",
      url: "https://www.ici.fr/rss/gard-lozere/a-la-une.xml",
    },
  ],
  es: [
    {
      id: "canalsur",
      label: "Canal Sur",
      url: "https://www.canalsur.es/rss/",
    },
    {
      id: "lavozdegalicia",
      label: "La Voz de Galicia",
      url: "https://www.lavozdegalicia.es/galicia/index.xml",
    },
    {
      id: "elnortedecastilla",
      label: "El Norte de Castilla",
      url: "https://www.elnortedecastilla.es/rss/2.0/?section=/castillayleon",
    },
    {
      id: "levante-emv",
      label: "Levante-EMV",
      url: "https://www.levante-emv.com/rss/",
    },
    // Official government voice: Junta de Andalucía press feeds (verified
    // live; discovered via the /noticias page's alternate-link tags).
    {
      id: "junta-andalucia",
      label: "Junta de Andalucía · Oficial",
      url: "https://www.juntadeandalucia.es/presidencia/portavoz/rss?seccion=portadaprincipal",
      official: true,
    },
    {
      id: "junta-tierraymar",
      label: "Junta de Andalucía · Tierra y Mar",
      url: "https://www.juntadeandalucia.es/presidencia/portavoz/rss?seccion=tierraymar",
      official: true,
    },
  ],
};

// The franceinfo feed is editorially fire-only; regional feeds are general
// news and need the keyword filter.
const PREFILTERED_FEEDS = new Set(["franceinfo-fires"]);

const FIRE_TERMS = [
  // French
  "incendie",
  "feu de forêt",
  "feux de forêt",
  "flammes",
  "brûlé",
  "pyromane",
  "canadair",
  // Castilian
  "incendio",
  "fuego",
  "llamas",
  "quemad",
  "hectáreas calcinadas",
  "calcinad",
  // Galician
  "lume",
  "queimad",
  // Catalan / Valencian
  "incendi ",
  "el foc",
  "cremad",
  // English (agency wires)
  "wildfire",
];

export type NewsItem = {
  title: string;
  url: string;
  publishedAt: string | null;
  sourceId: string;
  sourceLabel: string;
  official: boolean;
};

function tag(block: string, name: string) {
  const match = block.match(
    new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`, "i"),
  );
  const value = match?.[1] ?? "";
  return value
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/<[^>]+>/g, "")
    .trim();
}

export function fireRelated(text: string) {
  const normalized = text.toLowerCase();
  return FIRE_TERMS.some((term) => normalized.includes(term));
}

export function parseFeedItems(xml: string, feed: NewsFeed): NewsItem[] {
  const items: NewsItem[] = [];
  for (const match of xml.matchAll(/<item(?:\s[^>]*)?>([\s\S]*?)<\/item>/gi)) {
    const block = match[1] ?? "";
    const title = tag(block, "title");
    const url = tag(block, "link");
    if (!title || !url) continue;
    if (!PREFILTERED_FEEDS.has(feed.id)) {
      const description = tag(block, "description");
      if (!fireRelated(`${title} ${description}`)) continue;
    }
    const pubDate = tag(block, "pubDate");
    const timestamp = Date.parse(pubDate);
    items.push({
      title,
      url,
      publishedAt: Number.isFinite(timestamp)
        ? new Date(timestamp).toISOString()
        : null,
      sourceId: feed.id,
      sourceLabel: feed.label,
      official: feed.official === true,
    });
  }
  return items;
}

// Official statements post far less often than media headlines; without a
// reserved quota they never survive the newest-first cap during a busy fire.
const OFFICIAL_RESERVED_SLOTS = 3;

export function mergeNews(batches: NewsItem[][], limit = 16): NewsItem[] {
  const deduped = batches
    .flat()
    .filter(
      (item, index, rows) =>
        rows.findIndex((candidate) => candidate.url === item.url) === index,
    )
    .sort((left, right) =>
      (right.publishedAt ?? "").localeCompare(left.publishedAt ?? ""),
    );
  const head = deduped.slice(0, limit);
  const missingOfficials = deduped
    .filter((item) => item.official && !head.includes(item))
    .slice(0, OFFICIAL_RESERVED_SLOTS);
  if (missingOfficials.length === 0) return head;
  return [...head.slice(0, limit - missingOfficials.length), ...missingOfficials]
    .sort((left, right) =>
      (right.publishedAt ?? "").localeCompare(left.publishedAt ?? ""),
    );
}
