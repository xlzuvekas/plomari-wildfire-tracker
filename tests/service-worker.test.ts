import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { describe, expect, it, vi } from "vitest";

const serviceWorkerSource = readFileSync(
  new URL("../public/sw.js", import.meta.url),
  "utf8",
);

describe("service worker tile caching", () => {
  it("returns an uncached tile before its cache write and prune finish", async () => {
    let resolvePut: (() => void) | undefined;
    const putFinished = new Promise<void>((resolve) => {
      resolvePut = resolve;
    });
    const cache = {
      match: vi.fn().mockResolvedValue(undefined),
      put: vi.fn().mockReturnValue(putFinished),
      keys: vi.fn().mockResolvedValue([]),
      delete: vi.fn().mockResolvedValue(true),
    };
    const listeners = new Map<string, (event: unknown) => void>();
    const response = {
      ok: true,
      type: "basic",
      clone: vi.fn(),
    };
    response.clone.mockReturnValue(response);

    runInNewContext(serviceWorkerSource, {
      self: {
        location: { origin: "https://firewatch.test" },
        addEventListener: (
          type: string,
          listener: (event: unknown) => void,
        ) => listeners.set(type, listener),
      },
      caches: {
        open: vi.fn().mockResolvedValue(cache),
      },
      fetch: vi.fn().mockResolvedValue(response),
      Headers,
      Response,
      URL,
      Map,
      Promise,
      setTimeout: (callback: () => void) => {
        callback();
        return 0;
      },
    });

    let responsePromise: Promise<unknown> | undefined;
    let backgroundPromise: Promise<unknown> | undefined;
    const fetchListener = listeners.get("fetch");
    expect(fetchListener).toBeTypeOf("function");
    fetchListener?.({
      request: {
        method: "GET",
        mode: "no-cors",
        url: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/13/3131/4696",
      },
      respondWith: (promise: Promise<unknown>) => {
        responsePromise = promise;
      },
      waitUntil: (promise: Promise<unknown>) => {
        backgroundPromise = promise;
      },
    });

    expect(await responsePromise).toBe(response);
    expect(cache.put).toHaveBeenCalledOnce();

    let backgroundFinished = false;
    void backgroundPromise?.then(() => {
      backgroundFinished = true;
    });
    await Promise.resolve();
    expect(backgroundFinished).toBe(false);

    resolvePut?.();
    await backgroundPromise;
    expect(backgroundFinished).toBe(true);
    expect(cache.keys).toHaveBeenCalledOnce();
  });
});
