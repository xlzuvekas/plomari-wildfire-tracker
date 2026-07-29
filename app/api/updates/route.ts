const FEEDS = [
  {
    id: "stonisi",
    label: "StoNisi",
    url: "https://feeds.feedburner.com/stonisigr",
    kind: "local-reporting",
    timeQuality: "feed-order-only",
  },
  {
    id: "aeolos",
    label: "Aeolos Lesvos",
    url: "https://aeolos.tv/category/lesvos/feed/",
    kind: "local-reporting",
    timeQuality: "exact",
  },
  {
    id: "mytilene-civil-protection",
    label: "Municipality Civil Protection",
    url: "https://www.mytilene.gr/category/politiki-prostasia/feed/",
    kind: "official-context",
    timeQuality: "exact",
  },
  {
    id: "mytilene-plomari",
    label: "Municipality of Mytilene · Plomari",
    url: "https://www.mytilene.gr/category/dimos/dimotiki-enotita-plomariou/feed/",
    kind: "official-context",
    timeQuality: "exact",
  },
  {
    id: "civil-protection",
    label: "Greek Civil Protection press feed",
    url: "https://civilprotection.gov.gr/deltia-tupou.rss",
    kind: "official-context",
    timeQuality: "date-only",
  },
] as const;

const STONISI_LIVE_URL =
  "https://www.stonisi.gr/post/114624/stamathsan-oi-ripseis-apo-aeros-sthn-fwtia-toy-plwmarioy";
const FIRE_SERVICE_BOARD_URL =
  "https://www.fireservice.gr/apps/fire2019/symvanta/page.php";

type FeedConfig = (typeof FEEDS)[number];

type FeedItem = {
  id: string;
  title: string;
  summary: string;
  url: string;
  sourceId: string;
  sourceLabel: string;
  sourceKind: "local-reporting" | "official-context";
  publishedAt: string | null;
  modifiedAt: string | null;
  timeQuality: "exact" | "date-only" | "feed-order-only";
  latestUpdateLabel: string | null;
};

function decodeXml(value: string) {
  const named: Record<string, string> = {
    amp: "&",
    apos: "'",
    gt: ">",
    lt: "<",
    nbsp: " ",
    quot: '"',
  };

  return value
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&#(x?[0-9a-f]+);/gi, (_match, code: string) => {
      const radix = code.toLowerCase().startsWith("x") ? 16 : 10;
      const digits = radix === 16 ? code.slice(1) : code;
      const point = Number.parseInt(digits, radix);
      return Number.isFinite(point) ? String.fromCodePoint(point) : "";
    })
    .replace(/&([a-z]+);/gi, (_match, entity: string) => named[entity] ?? "");
}

function plainText(value: string, limit = 500) {
  return decodeXml(value)
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, limit);
}

function tag(block: string, name: string) {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return (
    block.match(
      new RegExp(
        `<${escaped}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${escaped}>`,
        "i",
      ),
    )?.[1] ?? ""
  );
}

function tags(block: string, name: string) {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return Array.from(
    block.matchAll(
      new RegExp(
        `<${escaped}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${escaped}>`,
        "gi",
      ),
    ),
    (match) => match[1],
  );
}

function normalizeSearch(value: string) {
  return plainText(value, 20_000)
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase();
}

function relevant(value: string) {
  const normalized = normalizeSearch(value);
  const places = [
    "πλωμαρ",
    "plomari",
    "λεσβ",
    "lesvos",
    "αγιου αντωνιου",
    "μεγαλοχωρι",
    "πλαγια",
    "αγιος ισιδωρος",
    "μελιντα",
    "μηλιες",
  ];
  const incident = [
    "φωτια",
    "πυρκαγ",
    "αναζωπυρ",
    "εστια",
    "φλογ",
    "καπν",
    "εκκεν",
    "112",
    "πυροσβεστ",
    "κατασβεσ",
    "μετωπο",
    "wildfire",
    "fire",
    "smoke",
  ];

  return (
    places.some((term) => normalized.includes(term)) &&
    incident.some((term) => normalized.includes(term))
  );
}

function parseDate(value: string, quality: FeedConfig["timeQuality"]) {
  if (!value || quality !== "exact") return null;
  const timestamp = Date.parse(plainText(value, 100));
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : null;
}

async function fetchText(url: string) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8_000);
  try {
    const response = await fetch(url, {
      cache: "no-store",
      headers: {
        Accept:
          "application/rss+xml, application/xml, text/xml, text/html;q=0.8",
        "User-Agent": "PlomariFirewatch/1.0 public-safety-feed-reader",
      },
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return await response.text();
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchFeed(feed: FeedConfig) {
  const xml = await fetchText(feed.url);
  const channelUpdatedRaw = tag(xml, "lastBuildDate");
  const channelUpdatedTimestamp = Date.parse(plainText(channelUpdatedRaw, 100));
  const channelUpdatedAt = Number.isFinite(channelUpdatedTimestamp)
    ? new Date(channelUpdatedTimestamp).toISOString()
    : null;
  const blocks = Array.from(xml.matchAll(/<item(?:\s[^>]*)?>([\s\S]*?)<\/item>/gi));

  const items = blocks
    .map((match): FeedItem | null => {
      const block = match[1];
      const title = plainText(tag(block, "title"), 220);
      const description =
        tag(block, "content:encoded") || tag(block, "description");
      const summary = plainText(description, 520);
      const url = plainText(tag(block, "link"), 600);
      const guid = plainText(tag(block, "guid"), 600);
      const categories = tags(block, "category").join(" ");
      if (!title || !url || !relevant(`${title} ${summary} ${categories}`)) {
        return null;
      }

      return {
        id: `${feed.id}-${guid || url}`,
        title,
        summary:
          feed.kind === "official-context"
            ? `${summary} Official context feed; not a 112 dispatch stream.`
            : summary,
        url,
        sourceId: feed.id,
        sourceLabel: feed.label,
        sourceKind: feed.kind,
        publishedAt: parseDate(tag(block, "pubDate"), feed.timeQuality),
        modifiedAt: null,
        timeQuality: feed.timeQuality,
        latestUpdateLabel: null,
      };
    })
    .filter((item): item is FeedItem => item !== null)
    .slice(0, 8);

  return {
    id: feed.id,
    label: feed.label,
    url: feed.url,
    kind: feed.kind,
    timeQuality: feed.timeQuality,
    fetchedAt: new Date().toISOString(),
    channelUpdatedAt,
    items,
  };
}

function findArticle(value: unknown): Record<string, unknown> | null {
  if (Array.isArray(value)) {
    for (const child of value) {
      const match = findArticle(child);
      if (match) return match;
    }
    return null;
  }
  if (!value || typeof value !== "object") return null;

  const record = value as Record<string, unknown>;
  const type = record["@type"];
  const types = Array.isArray(type) ? type : [type];
  if (
    types.some(
      (candidate) =>
        typeof candidate === "string" &&
        /article|newsarticle|reportagenewsarticle/i.test(candidate),
    )
  ) {
    return record;
  }

  for (const child of Object.values(record)) {
    const match = findArticle(child);
    if (match) return match;
  }
  return null;
}

async function fetchStoNisiLiveStory(): Promise<FeedItem> {
  const html = await fetchText(STONISI_LIVE_URL);
  const scripts = Array.from(
    html.matchAll(
      /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi,
    ),
  );
  let article: Record<string, unknown> | null = null;

  for (const script of scripts) {
    try {
      article = findArticle(JSON.parse(script[1]));
      if (article) break;
    } catch {
      // Ignore unrelated malformed metadata blocks.
    }
  }

  const body =
    typeof article?.articleBody === "string"
      ? article.articleBody
      : plainText(html, 30_000);
  const updateMatches = Array.from(body.matchAll(/UPDATE\s+(\d{1,2}:\d{2})/gi));
  const latestUpdateLabel = updateMatches.at(-1)?.[1] ?? null;
  const datePublished =
    typeof article?.datePublished === "string" ? article.datePublished : "";
  const dateModified =
    typeof article?.dateModified === "string" ? article.dateModified : "";
  const headline =
    typeof article?.headline === "string"
      ? article.headline
      : "StoNisi live Plomari fire report";
  const description =
    typeof article?.description === "string"
      ? article.description
      : body;

  return {
    id: "stonisi-live-114624",
    title: plainText(headline, 220),
    summary: plainText(description, 520),
    url: STONISI_LIVE_URL,
    sourceId: "stonisi",
    sourceLabel: "StoNisi",
    sourceKind: "local-reporting",
    publishedAt: parseDate(datePublished, "exact"),
    modifiedAt: parseDate(dateModified, "exact"),
    timeQuality: "exact",
    latestUpdateLabel,
  };
}

async function fetchFireServiceIncident() {
  const html = await fetchText(FIRE_SERVICE_BOARD_URL);
  const text = normalizeSearch(html);
  const incidentIndex = text.indexOf("δ. λεσβου - πλωμαριου");
  if (incidentIndex < 0) {
    throw new Error("Plomari row not found");
  }

  const before = text.slice(0, incidentIndex);
  const headings = Array.from(
    before.matchAll(
      /(σε εξελιξη|μερικος ελεγχος|πληρης ελεγχος|ληξη)\s*\(\d+\)/g,
    ),
  );
  const heading = headings.at(-1)?.[1];
  const status =
    heading === "σε εξελιξη"
      ? "in-progress"
      : heading === "μερικος ελεγχος"
        ? "partial-control"
        : heading === "πληρης ελεγχος"
          ? "full-control"
          : heading === "ληξη"
            ? "ended"
            : null;

  if (!status) {
    throw new Error("Plomari status not parsed");
  }

  const after = text.slice(incidentIndex, incidentIndex + 700);
  const sourceAge =
    after.match(
      /τελευταια ενημερωση πριν απο\s+(\d+\s+(?:δευτερολεπτ(?:ο|α)|λεπτ(?:ο|α)|ωρ(?:α|ες)))/,
    )?.[1] ?? null;

  return {
    status,
    statusLabel:
      status === "in-progress"
        ? "IN PROGRESS"
        : status === "partial-control"
          ? "PARTIAL CONTROL"
          : status === "full-control"
            ? "FULL CONTROL"
            : "ENDED",
    municipality: "Lesvos · Plomari",
    incidentType: "Landfill / waste area fire",
    sourceAge,
    fetchedAt: new Date().toISOString(),
    sourceUrl: FIRE_SERVICE_BOARD_URL,
    official: true,
  };
}

export async function GET() {
  const generatedAt = new Date().toISOString();
  const [sourceResults, [liveStoryResult], [fireServiceResult]] =
    await Promise.all([
      Promise.allSettled(FEEDS.map((feed) => fetchFeed(feed))),
      Promise.allSettled([fetchStoNisiLiveStory()]),
      Promise.allSettled([fetchFireServiceIncident()]),
    ]);
  const sources = sourceResults.map((result, index) => {
    if (result.status === "fulfilled") {
      return {
        id: result.value.id,
        label: result.value.label,
        url: result.value.url,
        kind: result.value.kind,
        timeQuality: result.value.timeQuality,
        fetchedAt: result.value.fetchedAt,
        channelUpdatedAt: result.value.channelUpdatedAt,
        status: "ok" as const,
      };
    }
    return {
      id: FEEDS[index].id,
      label: FEEDS[index].label,
      url: FEEDS[index].url,
      kind: FEEDS[index].kind,
      timeQuality: FEEDS[index].timeQuality,
      fetchedAt: null,
      channelUpdatedAt: null,
      status: "error" as const,
    };
  });

  const items = sourceResults.flatMap((result) =>
    result.status === "fulfilled" ? result.value.items : [],
  );
  if (liveStoryResult?.status === "fulfilled") {
    const liveStory = liveStoryResult.value;
    const existing = items.findIndex(
      (item) => item.sourceId === "stonisi" && item.url.includes("/post/114624/"),
    );
    if (existing >= 0) items.splice(existing, 1);
    items.unshift(liveStory);
  }

  const deduplicated = items
    .filter(
      (item, index, rows) =>
        rows.findIndex((candidate) => candidate.url === item.url) === index,
    )
    .sort((left, right) => {
      const leftTime = Date.parse(
        left.modifiedAt ?? left.publishedAt ?? "1970-01-01T00:00:00Z",
      );
      const rightTime = Date.parse(
        right.modifiedAt ?? right.publishedAt ?? "1970-01-01T00:00:00Z",
      );
      return rightTime - leftTime;
    })
    .slice(0, 12);

  return Response.json(
    {
      generatedAt,
      localTimeZone: "Europe/Athens",
      refreshSeconds: 60,
      officialAlert: {
        issuedAt: "2026-07-29T13:58:00Z",
        lastManuallyVerifiedAt: "2026-07-29T20:33:00Z",
        status: "no-cancellation-in-manual-record",
        manual: true,
        action:
          "Move toward Plomari beach in the direction of Agios Isidoros; follow authorities on the ground.",
        sourceUrl: "https://x.com/112Greece/status/2082468150189167080",
      },
      fireServiceIncident:
        fireServiceResult?.status === "fulfilled"
          ? fireServiceResult.value
          : null,
      sources,
      items: deduplicated,
      errors: [
        ...sourceResults.flatMap((result, index) =>
          result.status === "rejected"
            ? [`${FEEDS[index].label} unavailable`]
            : [],
        ),
        ...(liveStoryResult?.status === "rejected"
          ? ["StoNisi live story unavailable"]
          : []),
        ...(fireServiceResult?.status === "rejected"
          ? ["Hellenic Fire Service incident board unavailable"]
          : []),
      ],
    },
    {
      headers: {
        "Cache-Control":
          "public, max-age=15, s-maxage=60, stale-while-revalidate=300",
      },
    },
  );
}
