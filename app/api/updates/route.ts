const INCIDENT_STARTED_AT = "2026-07-29T10:30:00Z";
const INCIDENT_STARTED_MS = Date.parse(INCIDENT_STARTED_AT);
const LOCAL_TIME_ZONE = "Europe/Athens";

type SourceKind =
  | "official-alert"
  | "official-status"
  | "official-context"
  | "local-reporting"
  | "public-broadcaster";
type SourceTier = "official" | "publisher";
type TimeQuality = "exact" | "date-only" | "feed-order-only";
type SourceStatus = "ok" | "error" | "unconfigured";
type FreshnessBasis =
  | "source-exact-timestamp"
  | "source-date-in-europe-athens"
  | "live-page-metadata";
type IntelCategory =
  | "evacuation"
  | "readiness"
  | "road"
  | "smoke"
  | "rekindling"
  | "containment"
  | "response"
  | "incident";
type Severity = "critical" | "high" | "medium" | "low";

const FEEDS = [
  {
    id: "stonisi",
    label: "StoNisi",
    url: "https://feeds.feedburner.com/stonisigr",
    kind: "local-reporting",
    tier: "publisher",
    timeQuality: "feed-order-only",
    contentMode: "headline-link-only",
  },
  {
    id: "aeolos-lesvos",
    label: "Aeolos Lesvos",
    url: "https://aeolos.tv/category/voreio-aigaio/lesvos/feed/",
    kind: "local-reporting",
    tier: "publisher",
    timeQuality: "exact",
    contentMode: "headline-link-only",
  },
  {
    id: "aeolos-breaking",
    label: "Aeolos Breaking",
    url: "https://aeolos.tv/category/ektakto/feed/",
    kind: "local-reporting",
    tier: "publisher",
    timeQuality: "exact",
    contentMode: "headline-link-only",
  },
  {
    id: "ert-north-aegean",
    label: "ERT North Aegean",
    url: "https://www.ertnews.gr/news/perifereiakoi-stathmoi/voreio_aigaio/feed/",
    kind: "public-broadcaster",
    tier: "publisher",
    timeQuality: "exact",
    contentMode: "headline-link-only",
  },
  {
    id: "mytilene-civil-protection",
    label: "Municipality Civil Protection",
    url: "https://www.mytilene.gr/category/politiki-prostasia/feed/",
    kind: "official-context",
    tier: "official",
    timeQuality: "exact",
    contentMode: "summary",
  },
  {
    id: "mytilene-plomari",
    label: "Municipality of Mytilene · Plomari",
    url: "https://www.mytilene.gr/category/dimos/dimotiki-enotita-plomariou/feed/",
    kind: "official-context",
    tier: "official",
    timeQuality: "exact",
    contentMode: "summary",
  },
  {
    id: "civil-protection",
    label: "Greek Civil Protection press feed",
    url: "https://civilprotection.gov.gr/deltia-tupou.rss",
    kind: "official-context",
    tier: "official",
    timeQuality: "date-only",
    contentMode: "summary",
  },
] as const;

const X_ACCOUNTS = [
  {
    id: "112-greece",
    label: "112 Greece",
    username: "112Greece",
    kind: "official-alert",
  },
  {
    id: "hellenic-fire-service",
    label: "Hellenic Fire Service",
    username: "pyrosvestiki",
    kind: "official-status",
  },
] as const;

const STONISI_LIVE_URL =
  "https://www.stonisi.gr/post/114624/stamathsan-oi-ripseis-apo-aeros-sthn-fwtia-toy-plwmarioy";
const FIRE_SERVICE_BOARD_URL =
  "https://www.fireservice.gr/apps/fire2019/symvanta/page.php";

type FeedConfig = (typeof FEEDS)[number];
type XAccount = (typeof X_ACCOUNTS)[number];

type FeedItem = {
  id: string;
  title: string;
  /** @deprecated Use summaryEn or summaryEl. */
  summary: string;
  summaryEn: string;
  summaryEl: string;
  url: string;
  sourceId: string;
  sourceLabel: string;
  sourceKind: SourceKind;
  sourceTier: SourceTier;
  publishedAt: string | null;
  modifiedAt: string | null;
  timeQuality: TimeQuality;
  latestUpdateLabel: string | null;
  ageMinutes: number | null;
  freshnessBasis: FreshnessBasis;
  category: IntelCategory;
  severity: Severity;
  actionRequired: boolean;
};

type SourceSnapshot = {
  id: string;
  label: string;
  url: string;
  kind: SourceKind;
  tier: SourceTier;
  timeQuality: TimeQuality;
  fetchedAt: string | null;
  channelUpdatedAt: string | null;
  latestItemAt: string | null;
  status: SourceStatus;
  itemCount: number;
  errorCode: string | null;
  freshnessPolicy:
    | "source-timestamp-at-or-after-incident-start"
    | "athens-calendar-date-at-or-after-incident-start"
    | "undated-items-excluded"
    | "live-board-observation-at-fetch-time";
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
  return plainText(value, 30_000)
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase();
}

function relevant(value: string) {
  const normalized = normalizeSearch(value);
  const localPlaces = [
    "πλωμαρ",
    "plomari",
    "αγιου αντωνιου",
    "αγιος αντωνιος",
    "μεγαλοχωρι",
    "πλαγια",
    "αγιος ισιδωρος",
    "μελιντα",
    "μηλιες",
    "χαλκελι",
  ];
  const incident = [
    "φωτια",
    "πυρκαγ",
    "αναζωπυρ",
    "εστια",
    "φλογ",
    "καπν",
    "εκκεν",
    "απομακρυν",
    "112",
    "πυροσβεστ",
    "κατασβεσ",
    "μετωπο",
    "wildfire",
    "fire",
    "smoke",
    "evacuat",
  ];

  return (
    localPlaces.some((term) => normalized.includes(term)) &&
    incident.some((term) => normalized.includes(term))
  );
}

function classify(value: string): {
  category: IntelCategory;
  severity: Severity;
} {
  const normalized = normalizeSearch(value);
  if (
    /(εκκεν|απομακρυν|evacuat)/.test(normalized) &&
    /(112|πολιτικη προστασια|civil protection)/.test(normalized)
  ) {
    return { category: "evacuation", severity: "critical" };
  }
  if (/(ετοιμοτητ|readiness|stay alert|παραμεινετε)/.test(normalized)) {
    return { category: "readiness", severity: "high" };
  }
  if (/(κυκλοφορ|κλειστ.*δρομ|εκτροπ|road clos|traffic)/.test(normalized)) {
    return { category: "road", severity: "high" };
  }
  if (/(καπν|smoke|pm2\.?5|αερολυ)/.test(normalized)) {
    return { category: "smoke", severity: "medium" };
  }
  if (/(αναζωπυρ|διασπαρτ.*εστι|hotspot|rekindl)/.test(normalized)) {
    return { category: "rekindling", severity: "medium" };
  }
  if (
    /(πληρη.*ελεγχ|μερικ.*ελεγχ|οριοθετ|χωρις ενεργο μετωπο|ληξη|contained|under control|all.clear)/.test(
      normalized,
    )
  ) {
    return { category: "containment", severity: "low" };
  }
  if (/(πυροσβεστ|εναερι|επιχειρ|fire service|crew|aircraft)/.test(normalized)) {
    return { category: "response", severity: "low" };
  }
  return { category: "incident", severity: "medium" };
}

function hasProtectiveImperative(value: string) {
  const normalized = normalizeSearch(value);
  return /(απομακρυνθειτε|εκκενωστε|παραμεινετε σε ετοιμοτητα|ακολουθειτε τις οδηγιες|move away|evacuate now|stay ready|follow the instructions)/.test(
    normalized,
  );
}

const athensDateFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: LOCAL_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

function athensDateKey(value: Date) {
  const parts = athensDateFormatter.formatToParts(value);
  const year = parts.find((part) => part.type === "year")?.value;
  const month = parts.find((part) => part.type === "month")?.value;
  const day = parts.find((part) => part.type === "day")?.value;
  return year && month && day ? `${year}-${month}-${day}` : null;
}

const INCIDENT_STARTED_ATHENS_DATE = athensDateKey(
  new Date(INCIDENT_STARTED_AT),
);

function dateKeyFromSource(value: string) {
  const cleaned = plainText(value, 120);
  const yearFirst = cleaned.match(
    /(?:^|\D)(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})(?:\D|$)/,
  );
  if (yearFirst) {
    return `${yearFirst[1]}-${yearFirst[2].padStart(2, "0")}-${yearFirst[3].padStart(2, "0")}`;
  }

  const dayFirst = cleaned.match(
    /(?:^|\D)(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})(?:\D|$)/,
  );
  if (dayFirst) {
    return `${dayFirst[3]}-${dayFirst[2].padStart(2, "0")}-${dayFirst[1].padStart(2, "0")}`;
  }

  const timestamp = Date.parse(cleaned);
  return Number.isFinite(timestamp) ? athensDateKey(new Date(timestamp)) : null;
}

function athensNoonIso(dateKey: string) {
  const [year, month, day] = dateKey.split("-").map(Number);
  if (![year, month, day].every(Number.isFinite)) return null;

  const desiredUtcShape = Date.UTC(year, month - 1, day, 12);
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: LOCAL_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  });
  const observedParts = formatter.formatToParts(new Date(desiredUtcShape));
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    Number(observedParts.find((candidate) => candidate.type === type)?.value);
  const observedUtcShape = Date.UTC(
    part("year"),
    part("month") - 1,
    part("day"),
    part("hour"),
    part("minute"),
    part("second"),
  );
  const offsetMs = observedUtcShape - desiredUtcShape;
  const timestamp = desiredUtcShape - offsetMs;
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : null;
}

function parsedDate(value: string, timeQuality: TimeQuality = "exact") {
  if (timeQuality === "date-only") {
    const dateKey = dateKeyFromSource(value);
    return dateKey ? athensNoonIso(dateKey) : null;
  }

  const timestamp = Date.parse(plainText(value, 120));
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : null;
}

function itemAgeMinutes(value: string | null) {
  if (!value) return null;
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return null;
  return Math.max(0, Math.round((Date.now() - timestamp) / 60_000));
}

function sourceErrorCode(error: unknown) {
  if (error instanceof Error && error.name === "AbortError") return "timeout";
  if (error instanceof Error && /HTTP 401|HTTP 403/.test(error.message)) {
    return "authentication";
  }
  if (error instanceof Error && /HTTP 429/.test(error.message)) {
    return "rate_limit";
  }
  return "unavailable";
}

function feedSummary(feed: FeedConfig) {
  if (feed.tier === "official") {
    return {
      summaryEn:
        "Item from an official source. Open the direct source for the full statement and any instructions.",
      summaryEl:
        "Ανάρτηση από επίσημη πηγή. Ανοίξτε την απευθείας πηγή για την πλήρη ανακοίνωση και τυχόν οδηγίες.",
    };
  }

  return {
    summaryEn:
      "Headline link from the publisher; open the direct source for the full report.",
    summaryEl:
      "Σύνδεσμος τίτλου από τον εκδότη· ανοίξτε την απευθείας πηγή για ολόκληρο το ρεπορτάζ.",
  };
}

async function fetchText(
  url: string,
  headers: Record<string, string> = {},
  timeoutMs = 9_000,
) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      cache: "no-store",
      headers: {
        Accept:
          "application/rss+xml, application/xml, text/xml, text/html;q=0.8",
        "User-Agent": "PlomariFirewatch/2.0 public-safety-feed-reader",
        ...headers,
      },
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return await response.text();
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchJson<T>(
  url: string,
  headers: Record<string, string>,
  cache: RequestCache = "no-store",
) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 9_000);
  try {
    const response = await fetch(url, {
      cache,
      headers: {
        Accept: "application/json",
        "User-Agent": "PlomariFirewatch/2.0 public-safety-feed-reader",
        ...headers,
      },
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return (await response.json()) as T;
  } finally {
    clearTimeout(timeout);
  }
}

function recentEnough(item: FeedItem) {
  const timestamp = Date.parse(item.modifiedAt ?? item.publishedAt ?? "");
  if (!Number.isFinite(timestamp)) return false;
  if (item.freshnessBasis === "source-date-in-europe-athens") {
    const itemDate = athensDateKey(new Date(timestamp));
    return Boolean(
      itemDate &&
        INCIDENT_STARTED_ATHENS_DATE &&
        itemDate >= INCIDENT_STARTED_ATHENS_DATE,
    );
  }
  return timestamp >= INCIDENT_STARTED_MS;
}

async function fetchFeed(feed: FeedConfig) {
  const xml = await fetchText(feed.url);
  const channelUpdatedAt = parsedDate(tag(xml, "lastBuildDate"));
  const blocks = Array.from(
    xml.matchAll(/<item(?:\s[^>]*)?>([\s\S]*?)<\/item>/gi),
  );

  const items = blocks
    .map((match): FeedItem | null => {
      const block = match[1];
      const title = plainText(tag(block, "title"), 240);
      const description =
        tag(block, "content:encoded") || tag(block, "description");
      const url = plainText(tag(block, "link"), 600);
      const guid = plainText(tag(block, "guid"), 600);
      const categories = tags(block, "category").join(" ");
      const publishedAt = parsedDate(
        tag(block, "pubDate"),
        feed.timeQuality === "feed-order-only" ? "exact" : feed.timeQuality,
      );
      if (!title || !url || !relevant(`${title} ${description} ${categories}`)) {
        return null;
      }

      const headlineAnalysis = classify(`${title} ${categories}`);
      const bodyAnalysis = classify(`${title} ${description} ${categories}`);
      const analysis =
        headlineAnalysis.category !== "incident" ||
        bodyAnalysis.category === "evacuation" ||
        bodyAnalysis.category === "readiness"
          ? headlineAnalysis
          : bodyAnalysis;
      const { summaryEn, summaryEl } = feedSummary(feed);
      const itemTimeQuality =
        feed.timeQuality === "feed-order-only" && publishedAt
          ? ("exact" as const)
          : feed.timeQuality;
      const freshnessBasis =
        feed.timeQuality === "date-only"
          ? ("source-date-in-europe-athens" as const)
          : ("source-exact-timestamp" as const);

      return {
        id: `${feed.id}-${guid || url}`,
        title,
        summary: summaryEn,
        summaryEn,
        summaryEl,
        url,
        sourceId: feed.id,
        sourceLabel: feed.label,
        sourceKind: feed.kind,
        sourceTier: feed.tier,
        publishedAt,
        modifiedAt: null,
        timeQuality: itemTimeQuality,
        latestUpdateLabel: null,
        ageMinutes:
          feed.timeQuality === "date-only" || !publishedAt
            ? null
            : itemAgeMinutes(publishedAt),
        freshnessBasis,
        category: analysis.category,
        severity: analysis.severity,
        // RSS/news classification is descriptive. Only a validated official
        // alert stream can create a protective-action flag.
        actionRequired: false,
      };
    })
    .filter((item): item is FeedItem => item !== null)
    .filter(recentEnough)
    .slice(0, 10);

  return {
    source: {
      id: feed.id,
      label: feed.label,
      url: feed.url,
      kind: feed.kind,
      tier: feed.tier,
      timeQuality: feed.timeQuality,
      fetchedAt: new Date().toISOString(),
      channelUpdatedAt,
      latestItemAt:
        items
          .map((item) => item.modifiedAt ?? item.publishedAt)
          .filter((value): value is string => value !== null)
          .sort()
          .at(-1) ?? null,
      status: "ok" as const,
      itemCount: items.length,
      errorCode: null,
      freshnessPolicy:
        feed.timeQuality === "date-only"
          ? "athens-calendar-date-at-or-after-incident-start"
          : feed.timeQuality === "feed-order-only"
            ? "undated-items-excluded"
            : "source-timestamp-at-or-after-incident-start",
    } satisfies SourceSnapshot,
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

  const datePublished =
    typeof article?.datePublished === "string" ? article.datePublished : "";
  const dateModified =
    typeof article?.dateModified === "string" ? article.dateModified : "";
  const headline =
    typeof article?.headline === "string"
      ? article.headline
      : "StoNisi live Plomari fire report";
  const publishedAt = parsedDate(datePublished);
  const modifiedAt = parsedDate(dateModified);
  const analysis = classify(headline);
  const summaryEn =
    "Live local-reporting page; open the direct source for the full chronology and field details.";
  const summaryEl =
    "Ζωντανή σελίδα τοπικού ρεπορτάζ· ανοίξτε την απευθείας πηγή για ολόκληρο το χρονικό και τις πληροφορίες από το πεδίο.";

  return {
    id: "stonisi-live-114624",
    title: plainText(headline, 240),
    summary: summaryEn,
    summaryEn,
    summaryEl,
    url: STONISI_LIVE_URL,
    sourceId: "stonisi",
    sourceLabel: "StoNisi",
    sourceKind: "local-reporting",
    sourceTier: "publisher",
    publishedAt,
    modifiedAt,
    timeQuality: "exact",
    latestUpdateLabel: null,
    ageMinutes: itemAgeMinutes(modifiedAt ?? publishedAt),
    freshnessBasis: "live-page-metadata",
    category: analysis.category,
    severity: analysis.severity,
    actionRequired: false,
  };
}

type XUserLookup = {
  data?: { id?: string };
};

type XTimeline = {
  data?: Array<{
    id: string;
    text: string;
    created_at?: string;
  }>;
};

async function fetchXAccount(
  account: XAccount,
  bearerToken: string,
): Promise<{ source: SourceSnapshot; items: FeedItem[] }> {
  const headers = { Authorization: `Bearer ${bearerToken}` };
  const user = await fetchJson<XUserLookup>(
    `https://api.x.com/2/users/by/username/${account.username}?user.fields=id`,
    headers,
    "force-cache",
  );
  const userId = user.data?.id;
  if (!userId) throw new Error("X user lookup returned no id");

  const timelineQuery = new URLSearchParams({
    max_results: "10",
    start_time: INCIDENT_STARTED_AT,
    exclude: "retweets,replies",
    "tweet.fields": "created_at,lang",
  });
  const timeline = await fetchJson<XTimeline>(
    `https://api.x.com/2/users/${userId}/tweets?${timelineQuery.toString()}`,
    headers,
  );
  const items =
    timeline.data
      ?.filter((post) => relevant(post.text))
      .map((post): FeedItem => {
        const publishedAt = parsedDate(post.created_at ?? "");
        const analysis = classify(post.text);
        const summaryEn =
          "Direct post from an official account. Follow the linked instruction and authorities on the ground.";
        const summaryEl =
          "Απευθείας ανάρτηση από επίσημο λογαριασμό. Ακολουθήστε τη συνδεδεμένη οδηγία και τις αρχές στο πεδίο.";
        return {
          id: `x-${account.username}-${post.id}`,
          title: plainText(post.text, 240),
          summary: summaryEn,
          summaryEn,
          summaryEl,
          url: `https://x.com/${account.username}/status/${post.id}`,
          sourceId: account.id,
          sourceLabel: account.label,
          sourceKind: account.kind,
          sourceTier: "official",
          publishedAt,
          modifiedAt: null,
          timeQuality: "exact",
          latestUpdateLabel: null,
          ageMinutes: itemAgeMinutes(publishedAt),
          freshnessBasis: "source-exact-timestamp",
          category: analysis.category,
          severity: analysis.severity,
          actionRequired:
            account.kind === "official-alert" &&
            hasProtectiveImperative(post.text) &&
            (analysis.category === "evacuation" ||
              analysis.category === "readiness"),
        };
      })
      .filter(recentEnough) ?? [];

  return {
    source: {
      id: account.id,
      label: account.label,
      url: `https://x.com/${account.username}`,
      kind: account.kind,
      tier: "official",
      timeQuality: "exact",
      fetchedAt: new Date().toISOString(),
      channelUpdatedAt: null,
      latestItemAt:
        items
          .map((item) => item.publishedAt)
          .filter((value): value is string => value !== null)
          .sort()
          .at(-1) ?? null,
      status: "ok",
      itemCount: items.length,
      errorCode: null,
      freshnessPolicy: "source-timestamp-at-or-after-incident-start",
    },
    items,
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
    incidentType: "Wildfire incident",
    sourceAge,
    fetchedAt: new Date().toISOString(),
    sourceUrl: FIRE_SERVICE_BOARD_URL,
    official: true,
  };
}

function normalizeTitle(value: string) {
  return normalizeSearch(value)
    .replace(/\b(φωτια|πυρκαγια|fire|wildfire)\b/g, "")
    .replace(/[^a-z0-9α-ω]+/g, " ")
    .trim();
}

export async function GET() {
  const requestStartedAt = new Date().toISOString();
  const xBearerToken = process.env.X_BEARER_TOKEN?.trim();
  const [feedResults, liveStoryResult, fireServiceResult, xResults] =
    await Promise.all([
      Promise.allSettled(FEEDS.map((feed) => fetchFeed(feed))),
      fetchStoNisiLiveStory().then(
        (value) => ({ status: "fulfilled" as const, value }),
        (reason) => ({ status: "rejected" as const, reason }),
      ),
      fetchFireServiceIncident().then(
        (value) => ({ status: "fulfilled" as const, value }),
        (reason) => ({ status: "rejected" as const, reason }),
      ),
      xBearerToken
        ? Promise.allSettled(
            X_ACCOUNTS.map((account) =>
              fetchXAccount(account, xBearerToken),
            ),
          )
        : Promise.resolve(null),
    ]);

  const sources: SourceSnapshot[] = feedResults.map((result, index) => {
    if (result.status === "fulfilled") return result.value.source;
    const feed = FEEDS[index];
    return {
      id: feed.id,
      label: feed.label,
      url: feed.url,
      kind: feed.kind,
      tier: feed.tier,
      timeQuality: feed.timeQuality,
      fetchedAt: null,
      channelUpdatedAt: null,
      latestItemAt: null,
      status: "error",
      itemCount: 0,
      errorCode: sourceErrorCode(result.reason),
      freshnessPolicy:
        feed.timeQuality === "date-only"
          ? "athens-calendar-date-at-or-after-incident-start"
          : feed.timeQuality === "feed-order-only"
            ? "undated-items-excluded"
            : "source-timestamp-at-or-after-incident-start",
    };
  });

  if (fireServiceResult.status === "fulfilled") {
    sources.push({
      id: "fire-service-board",
      label: "Hellenic Fire Service incident board",
      url: FIRE_SERVICE_BOARD_URL,
      kind: "official-status",
      tier: "official",
      timeQuality: "exact",
      fetchedAt: fireServiceResult.value.fetchedAt,
      channelUpdatedAt: null,
      latestItemAt: fireServiceResult.value.fetchedAt,
      status: "ok",
      itemCount: 1,
      errorCode: null,
      freshnessPolicy: "live-board-observation-at-fetch-time",
    });
  } else {
    sources.push({
      id: "fire-service-board",
      label: "Hellenic Fire Service incident board",
      url: FIRE_SERVICE_BOARD_URL,
      kind: "official-status",
      tier: "official",
      timeQuality: "exact",
      fetchedAt: null,
      channelUpdatedAt: null,
      latestItemAt: null,
      status: "error",
      itemCount: 0,
      errorCode: sourceErrorCode(fireServiceResult.reason),
      freshnessPolicy: "live-board-observation-at-fetch-time",
    });
  }

  if (xResults) {
    xResults.forEach((result, index) => {
      if (result.status === "fulfilled") {
        sources.push(result.value.source);
        return;
      }
      const account = X_ACCOUNTS[index];
      sources.push({
        id: account.id,
        label: account.label,
        url: `https://x.com/${account.username}`,
        kind: account.kind,
        tier: "official",
        timeQuality: "exact",
        fetchedAt: null,
        channelUpdatedAt: null,
        latestItemAt: null,
        status: "error",
        itemCount: 0,
        errorCode: sourceErrorCode(result.reason),
        freshnessPolicy: "source-timestamp-at-or-after-incident-start",
      });
    });
  } else {
    X_ACCOUNTS.forEach((account) =>
      sources.push({
        id: account.id,
        label: account.label,
        url: `https://x.com/${account.username}`,
        kind: account.kind,
        tier: "official",
        timeQuality: "exact",
        fetchedAt: null,
        channelUpdatedAt: null,
        latestItemAt: null,
        status: "unconfigured",
        itemCount: 0,
        errorCode: "missing_X_BEARER_TOKEN",
        freshnessPolicy: "source-timestamp-at-or-after-incident-start",
      }),
    );
  }

  const items = [
    ...feedResults.flatMap((result) =>
      result.status === "fulfilled" ? result.value.items : [],
    ),
    ...(xResults?.flatMap((result) =>
      result.status === "fulfilled" ? result.value.items : [],
    ) ?? []),
  ];

  if (
    liveStoryResult.status === "fulfilled" &&
    recentEnough(liveStoryResult.value)
  ) {
    const liveStory = liveStoryResult.value;
    const existing = items.findIndex(
      (item) => item.sourceId === "stonisi" && item.url.includes("/post/114624/"),
    );
    if (existing >= 0) items.splice(existing, 1);
    items.unshift(liveStory);
    const source = sources.find((candidate) => candidate.id === "stonisi");
    if (source) {
      source.itemCount = items.filter(
        (candidate) => candidate.sourceId === "stonisi",
      ).length;
      source.latestItemAt =
        [source.latestItemAt, liveStory.modifiedAt, liveStory.publishedAt]
          .filter((value): value is string => value !== null)
          .sort()
          .at(-1) ?? null;
    }
  }

  const deduplicated = items
    .filter((item, index, rows) => {
      const normalized = normalizeTitle(item.title);
      return (
        rows.findIndex(
          (candidate) =>
            candidate.url === item.url ||
            (normalized.length > 24 &&
              normalizeTitle(candidate.title) === normalized),
        ) === index
      );
    })
    .sort((left, right) => {
      const leftTime = Date.parse(
        left.modifiedAt ?? left.publishedAt ?? "1970-01-01T00:00:00Z",
      );
      const rightTime = Date.parse(
        right.modifiedAt ?? right.publishedAt ?? "1970-01-01T00:00:00Z",
      );
      if (rightTime !== leftTime) return rightTime - leftTime;
      return left.sourceTier === "official" ? -1 : 1;
    })
    .slice(0, 16);

  const retrievedAt = new Date().toISOString();
  const onlineSources = sources.filter((source) => source.status === "ok").length;
  const failedSources = sources.filter(
    (source) => source.status === "error",
  ).length;
  const unconfiguredSources = sources.filter(
    (source) => source.status === "unconfigured",
  ).length;
  const officialAlertSource = sources.find(
    (source) => source.id === "112-greece",
  );
  const officialAlertAutomaticallyChecked =
    officialAlertSource?.status === "ok"
      ? officialAlertSource.fetchedAt
      : null;

  return Response.json(
    {
      schemaVersion: 2,
      requestStartedAt,
      retrievedAt,
      localTimeZone: LOCAL_TIME_ZONE,
      refreshSeconds: 60,
      freshnessPolicy: {
        incidentStartedAt: INCIDENT_STARTED_AT,
        exactTimestamps: "accepted at or after incidentStartedAt",
        dateOnlyTimestamps:
          "compared as Europe/Athens calendar dates; displayed timestamp is local noon and ageMinutes is null",
        undatedItems: "excluded",
        officialAccountRead: {
          postsPerAccount: 10,
          startTime: INCIDENT_STARTED_AT,
        },
      },
      officialAlert: {
        issuedAt: "2026-07-29T13:58:00Z",
        lastManuallyVerifiedAt: "2026-07-29T20:33:00Z",
        lastAutomaticallyCheckedAt: officialAlertAutomaticallyChecked,
        automaticOfficialFeedConfigured: Boolean(xBearerToken),
        automaticOfficialFeedHealthy:
          officialAlertSource?.status === "ok",
        status: officialAlertAutomaticallyChecked
          ? "manual-alert-snapshot-plus-live-official-feed"
          : "manual-alert-snapshot-not-currently-verified",
        manual: true,
        action:
          "Move toward Plomari beach in the direction of Agios Isidoros; follow authorities on the ground.",
        sourceUrl: "https://x.com/112Greece/status/2082468150189167080",
      },
      fireServiceIncident:
        fireServiceResult.status === "fulfilled"
          ? fireServiceResult.value
          : null,
      sourceSummary: {
        total: sources.length,
        online: onlineSources,
        failed: failedSources,
        unconfigured: unconfiguredSources,
      },
      sources,
      items: deduplicated,
      errors: [
        ...sources
          .filter((source) => source.status === "error")
          .map((source) => ({
            sourceId: source.id,
            code: source.errorCode,
            message: `${source.label} unavailable`,
          })),
        ...(liveStoryResult.status === "rejected"
          ? [
              {
                sourceId: "stonisi-live",
                code: sourceErrorCode(liveStoryResult.reason),
                message: "StoNisi live story unavailable",
              },
            ]
          : []),
      ],
    },
    {
      headers: {
        "Cache-Control":
          "public, max-age=10, s-maxage=45, stale-while-revalidate=120",
      },
    },
  );
}
