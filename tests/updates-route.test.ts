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
          "The updates endpoint accepts only realtime=0 or realtime=1.",
      });
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("supports a slower feeds-only snapshot without spending X API calls", async () => {
    vi.stubEnv("X_BEARER_TOKEN", "server-only-test-token");
    const fetchMock = vi.fn(
      async (input: Parameters<typeof fetch>[0]) => {
        void input;
        return new Response("upstream unavailable", { status: 503 });
      },
    );
    vi.stubGlobal("fetch", fetchMock);

    const response = await GET(
      new Request("http://localhost/api/updates?realtime=0"),
    );
    const payload = await response.json();
    const requestedUrls = fetchMock.mock.calls.map(([input]) => String(input));

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toContain("s-maxage=300");
    expect(payload.collectionMode).toBe("feeds-only");
    expect(payload.freshnessPolicy.officialAccountRead.enabled).toBe(false);
    expect(payload.officialAlert.status).toBe(
      "manual-alert-snapshot-realtime-feed-not-requested",
    );
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
});
