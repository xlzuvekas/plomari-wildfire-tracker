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

  it("prunes the bounded data cache by its stable cache name", async () => {
    const cache = {
      match: vi.fn().mockResolvedValue(undefined),
      put: vi.fn().mockResolvedValue(undefined),
      keys: vi.fn().mockResolvedValue([]),
      delete: vi.fn().mockResolvedValue(true),
    };
    const open = vi.fn().mockResolvedValue(cache);
    const listeners = new Map<string, (event: unknown) => void>();
    const response = new Response("{}", {
      status: 200,
      headers: {
        "Content-Type": "application/json",
        "X-Firewatch-Cacheable": "1",
      },
    });

    runInNewContext(serviceWorkerSource, {
      self: {
        location: { origin: "https://firewatch.test" },
        addEventListener: (
          type: string,
          listener: (event: unknown) => void,
        ) => listeners.set(type, listener),
      },
      caches: { open },
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
    listeners.get("fetch")?.({
      request: new Request(
        "https://firewatch.test/api/v3/satellite-passes?cell=wm%2F11%2F1174%2F807",
      ),
      respondWith: (promise: Promise<unknown>) => {
        responsePromise = promise;
      },
    });

    expect(await responsePromise).toBe(response);
    expect(open).toHaveBeenNthCalledWith(1, "firewatch-v3-data");
    expect(open).toHaveBeenNthCalledWith(2, "firewatch-v3-data");
    expect(cache.keys).toHaveBeenCalledOnce();
  });

  it("does not replace a data snapshot with a failure-shaped 200", async () => {
    const cache = {
      match: vi.fn().mockResolvedValue(undefined),
      put: vi.fn().mockResolvedValue(undefined),
      keys: vi.fn().mockResolvedValue([]),
      delete: vi.fn().mockResolvedValue(true),
    };
    const listeners = new Map<string, (event: unknown) => void>();
    const response = new Response('{"status":"upstream-error"}', {
      status: 200,
      headers: { "Cache-Control": "no-store" },
    });

    runInNewContext(serviceWorkerSource, {
      self: {
        location: { origin: "https://firewatch.test" },
        addEventListener: (
          type: string,
          listener: (event: unknown) => void,
        ) => listeners.set(type, listener),
      },
      caches: { open: vi.fn().mockResolvedValue(cache) },
      fetch: vi.fn().mockResolvedValue(response),
      Headers,
      Response,
      URL,
      Map,
      Promise,
      setTimeout,
    });

    let responsePromise: Promise<unknown> | undefined;
    listeners.get("fetch")?.({
      request: new Request("https://firewatch.test/api/thermal"),
      respondWith: (promise: Promise<unknown>) => {
        responsePromise = promise;
      },
    });

    expect(await responsePromise).toBe(response);
    expect(cache.put).not.toHaveBeenCalled();
  });

  it("serves a revalidated data snapshot without labeling it offline", async () => {
    const cached = new Response('{"mode":"persisted"}', {
      status: 200,
      headers: { "X-Firewatch-Cacheable": "1" },
    });
    const cache = {
      match: vi.fn().mockResolvedValue(cached),
      put: vi.fn(),
      keys: vi.fn().mockResolvedValue([]),
      delete: vi.fn().mockResolvedValue(true),
    };
    const listeners = new Map<string, (event: unknown) => void>();

    runInNewContext(serviceWorkerSource, {
      self: {
        location: { origin: "https://firewatch.test" },
        addEventListener: (
          type: string,
          listener: (event: unknown) => void,
        ) => listeners.set(type, listener),
      },
      caches: { open: vi.fn().mockResolvedValue(cache) },
      fetch: vi.fn().mockResolvedValue(new Response(null, { status: 304 })),
      Headers,
      Response,
      URL,
      Map,
      Promise,
      setTimeout,
    });

    let responsePromise: Promise<Response> | undefined;
    listeners.get("fetch")?.({
      request: new Request(
        "https://firewatch.test/api/v3/satellite-passes?cell=wm%2F11%2F1174%2F807",
      ),
      respondWith: (promise: Promise<Response>) => {
        responsePromise = promise;
      },
    });

    const response = await responsePromise;
    expect(response).toBe(cached);
    expect(response?.headers.get("x-firewatch-snapshot")).toBeNull();
    expect(cache.put).not.toHaveBeenCalled();
  });
});
