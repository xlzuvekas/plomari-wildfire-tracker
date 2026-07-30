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

// v2 retires the earlier broad /api/* data cache so responses outside the
// explicit public-data allowlist cannot linger after this worker activates.
const VERSION = "firewatch-v2";
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
    if (response.ok) {
      try {
        await cache.put(cacheKey, response.clone());
        if (limit) await trimCache(cache, limit);
      } catch {
        // A quota/cache failure must not replace a valid live response.
      }
      return response;
    }

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

async function cacheFirst(request, cacheName, limit) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  if (response.ok || response.type === "opaque") {
    try {
      await cache.put(request, response.clone());
      if (limit) await trimCache(cache, limit);
    } catch {
      // A quota/cache failure must not replace a valid live response.
    }
  }
  return response;
}

async function trimCache(cache, limit) {
  const keys = await cache.keys();
  if (keys.length <= limit) return;
  await cache.delete(keys[0]);
  await trimCache(cache, limit);
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
      event.respondWith(cacheFirst(request, ASSET_CACHE, ASSET_LIMIT));
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
    event.respondWith(cacheFirst(request, TILE_CACHE, TILE_LIMIT));
  }
});
