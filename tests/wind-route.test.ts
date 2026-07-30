import { afterEach, describe, expect, it, vi } from "vitest";

import { GET } from "../app/api/wind/route";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("GET /api/wind", () => {
  it("rejects query variants before starting any upstream request", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const response = await GET(
      new Request("http://localhost/api/wind?cache-bust=1"),
    );
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(payload).toEqual({
      error: "unsupported_query",
      message: "The wind endpoint does not accept query parameters.",
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
