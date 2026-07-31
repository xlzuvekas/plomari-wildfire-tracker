import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { describe, expect, it, vi } from "vitest";

const serviceWorkerSource = readFileSync(
  new URL("../public/sw.js", import.meta.url),
  "utf8",
);

describe("service worker caching", () => {
  it("never intercepts or caches persisted thermal-anomaly snapshots", () => {
    const listeners = new Map<string, (event: unknown) => void>();
    runInNewContext(serviceWorkerSource, {
      self: {
        location: { origin: "https://firewatch.test" },
        addEventListener: (
          type: string,
          listener: (event: unknown) => void,
        ) => listeners.set(type, listener),
      },
      caches: { open: vi.fn() },
      fetch: vi.fn(),
      Headers,
      Response,
      URL,
      Map,
      Promise,
      setTimeout,
    });
    const respondWith = vi.fn();

    listeners.get("fetch")?.({
      request: new Request(
        "https://firewatch.test/api/v3/thermal-anomalies?cell=wm%2F10%2F587%2F391",
      ),
      respondWith,
    });

    expect(respondWith).not.toHaveBeenCalled();
    expect(serviceWorkerSource).not.toContain(
      '"/api/v3/thermal-anomalies"',
    );
  });

  it("pre-caches the exact versioned MapLibre worker pair", async () => {
    const shellCache = { addAll: vi.fn().mockResolvedValue(undefined) };
    const assetCache = { addAll: vi.fn().mockResolvedValue(undefined) };
    const open = vi.fn((name: string) =>
      Promise.resolve(name.endsWith("-shell") ? shellCache : assetCache),
    );
    const skipWaiting = vi.fn().mockResolvedValue(undefined);
    const listeners = new Map<string, (event: unknown) => void>();

    runInNewContext(serviceWorkerSource, {
      self: {
        location: { origin: "https://firewatch.test" },
        skipWaiting,
        addEventListener: (
          type: string,
          listener: (event: unknown) => void,
        ) => listeners.set(type, listener),
      },
      caches: { open },
      fetch: vi.fn(),
      Headers,
      Response,
      URL,
      Map,
      Promise,
      setTimeout,
    });

    let installPromise: Promise<unknown> | undefined;
    listeners.get("install")?.({
      waitUntil: (promise: Promise<unknown>) => {
        installPromise = promise;
      },
    });
    await installPromise;

    expect(open).toHaveBeenNthCalledWith(1, "firewatch-v4-shell");
    expect(open).toHaveBeenNthCalledWith(2, "firewatch-v4-maplibre");
    expect(shellCache.addAll).toHaveBeenCalledWith(["/"]);
    expect(assetCache.addAll).toHaveBeenCalledWith([
      "/vendor/maplibre-gl/6.1.0/maplibre-gl-worker.mjs",
      "/vendor/maplibre-gl/6.1.0/maplibre-gl-shared.mjs",
    ]);
    expect(skipWaiting).toHaveBeenCalledOnce();
  });

  it("serves the versioned MapLibre prefix cache-first", async () => {
    const cached = new Response("worker", { status: 200 });
    const cache = {
      match: vi.fn().mockResolvedValue(cached),
      put: vi.fn(),
      keys: vi.fn(),
      delete: vi.fn(),
    };
    const fetch = vi.fn();
    const listeners = new Map<string, (event: unknown) => void>();

    const open = vi.fn().mockResolvedValue(cache);
    runInNewContext(serviceWorkerSource, {
      self: {
        location: { origin: "https://firewatch.test" },
        addEventListener: (
          type: string,
          listener: (event: unknown) => void,
        ) => listeners.set(type, listener),
      },
      caches: { open },
      fetch,
      Headers,
      Response,
      URL,
      Map,
      Promise,
      setTimeout,
    });

    let responsePromise: Promise<Response> | undefined;
    let backgroundPromise: Promise<unknown> | undefined;
    const request = new Request(
      "https://firewatch.test/vendor/maplibre-gl/6.1.0/maplibre-gl-worker.mjs",
    );
    listeners.get("fetch")?.({
      request,
      respondWith: (promise: Promise<Response>) => {
        responsePromise = promise;
      },
      waitUntil: (promise: Promise<unknown>) => {
        backgroundPromise = promise;
      },
    });

    expect(await responsePromise).toBe(cached);
    await backgroundPromise;
    expect(open).toHaveBeenCalledOnce();
    expect(open).toHaveBeenCalledWith("firewatch-v4-maplibre");
    expect(cache.match).toHaveBeenCalledWith(request);
    expect(cache.keys).not.toHaveBeenCalled();
    expect(cache.delete).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("keeps navigation snapshots isolated by the full query-bound request", async () => {
    const cache = {
      match: vi.fn().mockResolvedValue(undefined),
      put: vi.fn().mockResolvedValue(undefined),
      keys: vi.fn().mockResolvedValue([]),
      delete: vi.fn().mockResolvedValue(true),
    };
    const listeners = new Map<string, (event: unknown) => void>();
    const response = new Response("<!doctype html>", { status: 200 });

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
      setTimeout: (callback: () => void) => {
        callback();
        return 0;
      },
    });

    let responsePromise: Promise<Response> | undefined;
    const firstRequest = {
      method: "GET",
      mode: "navigate",
      url: "https://firewatch.test/explore?cell=wm%2F10%2F587%2F391",
    };
    listeners.get("fetch")?.({
      request: firstRequest,
      respondWith: (promise: Promise<Response>) => {
        responsePromise = promise;
      },
    });

    expect(await responsePromise).toBe(response);
    const secondRequest = {
      method: "GET",
      mode: "navigate",
      url: "https://firewatch.test/explore?cell=wm%2F10%2F518%2F352",
    };
    listeners.get("fetch")?.({
      request: secondRequest,
      respondWith: (promise: Promise<Response>) => {
        responsePromise = promise;
      },
    });
    expect(await responsePromise).toBe(response);

    expect(cache.put).toHaveBeenNthCalledWith(
      1,
      firstRequest,
      expect.any(Response),
    );
    expect(cache.put).toHaveBeenNthCalledWith(
      2,
      secondRequest,
      expect.any(Response),
    );
    expect(firstRequest.url).not.toBe(secondRequest.url);
  });

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
    expect(open).toHaveBeenNthCalledWith(1, "firewatch-v4-data");
    expect(open).toHaveBeenNthCalledWith(2, "firewatch-v4-data");
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
