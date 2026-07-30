import {
  NEWS_FEEDS,
  mergeNews,
  parseFeedItems,
  type NewsCountry,
} from "./feeds";

async function fetchFeed(url: string) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10_000);
  try {
    const response = await fetch(url, {
      headers: {
        Accept: "*/*",
        "User-Agent": "PlomariFirewatch/2.0 public-safety-feed-reader",
      },
      signal: controller.signal,
      next: { revalidate: 600 },
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return await response.text();
  } finally {
    clearTimeout(timeout);
  }
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const country = searchParams.get("country") as NewsCountry | null;
  if (!country || !(country in NEWS_FEEDS)) {
    return Response.json({ error: "unknown_country" }, { status: 400 });
  }

  const feeds = NEWS_FEEDS[country];
  const settled = await Promise.allSettled(
    feeds.map(async (feed) => parseFeedItems(await fetchFeed(feed.url), feed)),
  );
  const batches = settled.flatMap((result) =>
    result.status === "fulfilled" ? [result.value] : [],
  );
  const failed = feeds.filter(
    (feed, index) => settled[index]?.status === "rejected",
  );

  return Response.json(
    {
      country,
      retrievedAt: new Date().toISOString(),
      sources: feeds.map((feed) => ({
        id: feed.id,
        label: feed.label,
        status: failed.includes(feed) ? "error" : "ok",
      })),
      items: mergeNews(batches),
    },
    {
      headers: {
        "Cache-Control":
          "public, max-age=120, s-maxage=600, stale-while-revalidate=1800",
      },
    },
  );
}
