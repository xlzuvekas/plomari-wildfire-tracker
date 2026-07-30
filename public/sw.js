/*
 * Firewatch service worker.
 *
 * Goals, in field-usability order:
 *  1. App shell and static chunks survive a signal drop (cache-first for
 *     immutable /_next/static, network-first for navigations).
 *  2. The last good /api/wind|updates|thermal responses are served when the
 *     network fails, so the "OFFLINE — LAST SNAPSHOT" banner shows real data.
 *  3. Recently viewed basemap/overlay tiles keep the map readable offline,
 *     capped so the cache cannot grow without bound.
 */

// v3 keeps cache writes off the response-critical path and retires earlier
// caches whose misses could delay tiles while Cache Storage was updated.
const VERSION = "firewatch-v3";
const SHELL_CACHE = `${VERSION}-shell`;
const ASSET_CACHE = `${VERSION}-assets`;
const DATA_CACHE = `${VERSION}-data`;
const TILE_CACHE = `${VERSION}-tiles`;
const SHELL_LIMIT = 1;
const ASSET_LIMIT = 80;
const TILE_LIMIT = 400;
const DATA_LIMIT = 24;
const PUBLIC_DATA_PATHS = new Set([
  "/api/wind",
  "/api/updates",
  "/api/thermal",
]);

const TILE_HOSTS = [
  "basemaps.cartocdn.com",
  "server.arcgisonline.com",
  "services.arcgisonline.com",
  "tile.opentopomap.org",
  "gibs.earthdata.nasa.gov",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(SHELL_CACHE)
      .then((cache) => cache.addAll(["/"]))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => !key.startsWith(VERSION))
            .map((key) => caches.delete(key)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

function offlineSnapshot(response) {
  const headers = new Headers(response.headers);
  headers.set("X-Firewatch-Snapshot", "offline-cache");
  headers.set("Cache-Control", "no-store");
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

async function networkFirst(
  request,
  cacheName,
  limit = 0,
  tagCachedFallback = false,
  cacheKey = request,
) {
  const cache = await caches.open(cacheName);
  try {
    const response = await fetch(request);
    const cacheable =
      response.ok &&
      (!tagCachedFallback ||
        response.headers.get("X-Firewatch-Cacheable") === "1");
    if (cacheable) {
      try {
        await cache.put(cacheKey, response.clone());
        if (limit) await trimCache(cacheName, limit);
      } catch {
        // A quota/cache failure must not replace a valid live response.
      }
      return response;
    }

    if (response.ok) return response;

    const cached = await cache.match(cacheKey);
    if (cached) {
      return tagCachedFallback ? offlineSnapshot(cached) : cached;
    }
    return response;
  } catch (error) {
    const cached = await cache.match(cacheKey);
    if (cached) {
      return tagCachedFallback ? offlineSnapshot(cached) : cached;
    }
    throw error;
  }
}

const activeTrims = new Map();

async function trimCache(cacheName, limit) {
  const active = activeTrims.get(cacheName);
  if (active) return active;

  // Let a burst of tile writes settle, then enumerate and prune once. Running
  // cache.keys() after every tile made uncached imagery wait behind Cache
  // Storage bookkeeping on the response-critical path.
  const trim = new Promise((resolve) => setTimeout(resolve, 250))
    .then(async () => {
      const cache = await caches.open(cacheName);
      const keys = await cache.keys();
      const excess = keys.length - limit;
      if (excess <= 0) return;
      await Promise.all(keys.slice(0, excess).map((key) => cache.delete(key)));
    })
    .finally(() => {
      activeTrims.delete(cacheName);
    });

  activeTrims.set(cacheName, trim);
  return trim;
}

async function cacheFirst(request, cacheName, limit) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);
  if (cached) {
    return { response: cached, cacheWrite: Promise.resolve() };
  }

  const response = await fetch(request);
  let cacheWrite = Promise.resolve();
  if (response.ok || response.type === "opaque") {
    cacheWrite = cache
      .put(request, response.clone())
      .then(() => (limit ? trimCache(cacheName, limit) : undefined))
      .catch(() => {
        // A quota/cache failure must not replace a valid live response.
      });
  }
  return { response, cacheWrite };
}

function respondCacheFirst(event, request, cacheName, limit) {
  const result = cacheFirst(request, cacheName, limit);
  // Return the network response as soon as headers arrive. Cache population
  // remains durable through waitUntil, but never delays the tile or JS chunk.
  event.respondWith(result.then(({ response }) => response));
  event.waitUntil(result.then(({ cacheWrite }) => cacheWrite).catch(() => {}));
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;
  const url = new URL(request.url);

  if (url.origin === self.location.origin) {
    if (PUBLIC_DATA_PATHS.has(url.pathname)) {
      event.respondWith(
        networkFirst(request, DATA_CACHE, DATA_LIMIT, true),
      );
      return;
    }
    if (url.pathname.startsWith("/_next/static/")) {
      respondCacheFirst(event, request, ASSET_CACHE, ASSET_LIMIT);
      return;
    }
    if (request.mode === "navigate") {
      // Cache successful navigations under one key so query variants cannot
      // grow the shell cache without bound. The actual request still goes to
      // the network whenever connectivity is available.
      event.respondWith(
        networkFirst(request, SHELL_CACHE, SHELL_LIMIT, false, "/"),
      );
    }
    return;
  }

  if (TILE_HOSTS.some((host) => url.hostname.endsWith(host))) {
    respondCacheFirst(event, request, TILE_CACHE, TILE_LIMIT);
  }
});
