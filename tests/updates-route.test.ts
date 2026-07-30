import { afterEach, describe, expect, it, vi } from "vitest";

import { GET } from "../app/api/updates/route";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("GET /api/updates", () => {
  it("rejects unbounded query variants before starting any upstream request", async () => {
    vi.stubEnv("X_BEARER_TOKEN", "server-only-test-token");
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    for (const url of [
      "http://localhost/api/updates?cache-bust=1",
      "http://localhost/api/updates?realtime=1",
      "http://localhost/api/updates?realtime=2",
      "http://localhost/api/updates?realtime=0&realtime=1",
      "http://localhost/api/updates?realtime=0&nonce=1",
    ]) {
      const response = await GET(new Request(url));
      const payload = await response.json();

      expect(response.status).toBe(400);
      expect(response.headers.get("cache-control")).toBe("no-store");
      expect(payload).toEqual({
        error: "unsupported_query",
        message:
          "The public updates endpoint accepts only realtime=0; realtime provider collection is disabled until the durable worker is provisioned.",
      });
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([
    "http://localhost/api/updates",
    "http://localhost/api/updates?realtime=0",
  ])("defaults %s to a feeds-only snapshot without spending X API calls", async (url) => {
    vi.stubEnv("X_BEARER_TOKEN", "server-only-test-token");
    const fetchMock = vi.fn(
      async (input: Parameters<typeof fetch>[0]) => {
        void input;
        return new Response("upstream unavailable", { status: 503 });
      },
    );
    vi.stubGlobal("fetch", fetchMock);

    const response = await GET(new Request(url));
    const payload = await response.json();
    const requestedUrls = fetchMock.mock.calls.map(([input]) => String(input));

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("x-firewatch-cacheable")).toBeNull();
    expect(payload.collectionMode).toBe("feeds-only");
    expect(payload.freshnessPolicy.officialAccountRead.enabled).toBe(false);
    expect(payload.officialAlert.status).toBe(
      "manual-alert-snapshot-realtime-feed-not-requested",
    );
    expect(payload.officialAlert.automaticOfficialFeedConfigured).toBe(false);
    expect(
      payload.sources.some((source: { id: string }) =>
        ["112-greece", "hellenic-fire-service", "civil-protection-x"].includes(
          source.id,
        ),
      ),
    ).toBe(false);
    expect(requestedUrls.some((url) => url.startsWith("https://api.x.com/")))
      .toBe(false);
  });

  it("keeps successful active-incident feeds on the advertised five-minute cache", async () => {
    vi.stubEnv("X_BEARER_TOKEN", "server-only-test-token");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response("<rss><channel></channel></rss>", {
          status: 200,
          headers: { "Content-Type": "application/xml" },
        }),
      ),
    );

    const response = await GET(new Request("http://localhost/api/updates"));
    const payload = await response.json();

    expect(response.headers.get("cache-control")).toContain("s-maxage=300");
    expect(response.headers.get("x-firewatch-cacheable")).toBe("1");
    expect(payload.refreshSeconds).toBe(300);
    expect(payload.collectionMode).toBe("feeds-only");
  });
});
