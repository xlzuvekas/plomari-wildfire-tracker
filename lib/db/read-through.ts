// Read-through orchestration over the store. No Next.js imports — this
// module must run under plain `node --test`.
//
// Invariants:
// - Unconfigured (no FIREWATCH_DATABASE_URL) => pure passthrough; behavior
//   identical to the app before this layer existed.
// - A store failure of any kind can never fail or delay the route beyond the
//   read timeout: reads race READ_TIMEOUT_MS, writes are individually caught.
// - Stored payloads are never mutated; staleness is reported via StoreMeta.

import { getDb, storeConfigured, withTimeout, type Queryable } from "./client.ts";
import {
  appendSnapshot,
  contentHash,
  isUndefinedTableError,
  readCache,
  writeCache,
} from "./store.ts";

const READ_TIMEOUT_MS = 1_500;

export type StoreMeta = {
  env: "FIREWATCH_DATABASE_URL";
  configured: boolean;
  servedFrom: "upstream" | "store" | "store-stale";
  storedAt: string | null;
  ageSeconds: number | null;
  ttlSeconds: number;
  error: "unavailable" | "not-initialized" | "timeout" | null;
};

function meta(overrides: Partial<StoreMeta> & { ttlSeconds: number }): StoreMeta {
  return {
    env: "FIREWATCH_DATABASE_URL",
    configured: true,
    servedFrom: "upstream",
    storedAt: null,
    ageSeconds: null,
    error: null,
    ...overrides,
  };
}

function storeError(error: unknown): "not-initialized" | "timeout" | "unavailable" {
  if (isUndefinedTableError(error)) return "not-initialized";
  if (error instanceof Error && /timed out/.test(error.message)) return "timeout";
  return "unavailable";
}

function ageSeconds(storedAt: string, now: number): number {
  return Math.max(0, Math.floor((now - Date.parse(storedAt)) / 1000));
}

async function resolveDb(
  injected: Queryable | null | undefined,
): Promise<Queryable | null> {
  if (injected !== undefined) return injected;
  if (!storeConfigured()) return null;
  return getDb();
}

export type ReadThroughOptions<T> = {
  key: string;
  ttlSeconds: number;
  staleMaxSeconds: number;
  /** Route payload builders never throw at top level; they return error-shaped payloads. */
  fetchUpstream: () => Promise<T>;
  upstreamOk: (payload: T) => boolean;
  status: (payload: T) => string;
  /** Skip persisting entirely (e.g. thermal "unconfigured" placeholder payloads). */
  skipStore?: (payload: T) => boolean;
  /** Trim the payload stored in the snapshot log (e.g. thermal drops detections[]). */
  snapshotPayload?: (payload: T) => unknown;
  /** Stable content signature for snapshot dedupe; omit to skip the snapshot log. */
  snapshotSignature?: (payload: T) => unknown;
  /** Extra normalized persistence (thermal detections, wire items). */
  onUpstreamSuccess?: (db: Queryable, payload: T) => Promise<void>;
  /** Test injection; `null` forces unconfigured behavior, `undefined` uses getDb(). */
  db?: Queryable | null;
};

export async function readThrough<T>(
  options: ReadThroughOptions<T>,
): Promise<{ payload: T; store: StoreMeta }> {
  const now = Date.now();
  let db: Queryable | null = null;
  let readError: StoreMeta["error"] = null;

  try {
    db = await resolveDb(options.db);
  } catch {
    db = null;
    readError = "unavailable";
  }

  if (db === null) {
    const payload = await options.fetchUpstream();
    return {
      payload,
      store: meta({
        configured: false,
        ttlSeconds: options.ttlSeconds,
        error: readError,
      }),
    };
  }

  let cached: Awaited<ReturnType<typeof readCache>> = null;
  try {
    cached = await withTimeout(
      readCache(db, options.key),
      READ_TIMEOUT_MS,
      `store read ${options.key}`,
    );
  } catch (error) {
    readError = storeError(error);
  }

  if (
    cached !== null &&
    cached.upstreamOk &&
    ageSeconds(cached.storedAt, now) < options.ttlSeconds
  ) {
    return {
      payload: cached.payload as T,
      store: meta({
        servedFrom: "store",
        storedAt: cached.storedAt,
        ageSeconds: ageSeconds(cached.storedAt, now),
        ttlSeconds: options.ttlSeconds,
      }),
    };
  }

  const payload = await options.fetchUpstream();
  const ok = options.upstreamOk(payload);
  const skip = options.skipStore?.(payload) ?? false;

  if (ok && !skip) {
    try {
      await writeCache(db, options.key, payload, options.status(payload), ok);
    } catch {
      // Store write failures never affect the response.
    }
    if (options.snapshotSignature) {
      try {
        await appendSnapshot(db, {
          source: options.key,
          payload: options.snapshotPayload?.(payload) ?? payload,
          status: options.status(payload),
          upstreamOk: ok,
          contentHash: contentHash(options.snapshotSignature(payload)),
        });
      } catch {
        // ignore
      }
    }
    if (options.onUpstreamSuccess) {
      try {
        await options.onUpstreamSuccess(db, payload);
      } catch {
        // ignore
      }
    }
    return {
      payload,
      store: meta({ ttlSeconds: options.ttlSeconds, error: readError }),
    };
  }

  if (
    !ok &&
    cached !== null &&
    cached.upstreamOk &&
    ageSeconds(cached.storedAt, now) < options.staleMaxSeconds
  ) {
    return {
      payload: cached.payload as T,
      store: meta({
        servedFrom: "store-stale",
        storedAt: cached.storedAt,
        ageSeconds: ageSeconds(cached.storedAt, now),
        ttlSeconds: options.ttlSeconds,
      }),
    };
  }

  return {
    payload,
    store: meta({ ttlSeconds: options.ttlSeconds, error: readError }),
  };
}

export type ReadThroughThrowingOptions<T> = {
  key: string;
  source: string;
  ttlSeconds: number;
  staleMaxSeconds: number;
  /** Throws on failure (e.g. fetchFireServiceIncident). */
  fetchUpstream: () => Promise<T>;
  snapshotSignature?: (payload: T) => unknown;
  db?: Queryable | null;
};

/**
 * Variant for upstream functions that THROW on failure. Fresh cache hit =>
 * stored value; otherwise fetch, persist on success, and on throw serve a
 * stale stored value within the cap — or rethrow so the caller's existing
 * error handling stays authoritative.
 */
export async function readThroughThrowing<T>(
  options: ReadThroughThrowingOptions<T>,
): Promise<T> {
  const now = Date.now();
  let db: Queryable | null = null;
  try {
    db = await resolveDb(options.db);
  } catch {
    db = null;
  }
  if (db === null) return options.fetchUpstream();

  let cached: Awaited<ReturnType<typeof readCache>> = null;
  try {
    cached = await withTimeout(
      readCache(db, options.key),
      READ_TIMEOUT_MS,
      `store read ${options.key}`,
    );
  } catch {
    cached = null;
  }

  if (
    cached !== null &&
    cached.upstreamOk &&
    ageSeconds(cached.storedAt, now) < options.ttlSeconds
  ) {
    return cached.payload as T;
  }

  try {
    const payload = await options.fetchUpstream();
    try {
      await writeCache(db, options.key, payload, "ok", true);
      if (options.snapshotSignature) {
        await appendSnapshot(db, {
          source: options.source,
          payload,
          status: "ok",
          upstreamOk: true,
          contentHash: contentHash(options.snapshotSignature(payload)),
        });
      }
    } catch {
      // Store write failures never affect the response.
    }
    return payload;
  } catch (error) {
    if (
      cached !== null &&
      cached.upstreamOk &&
      ageSeconds(cached.storedAt, now) < options.staleMaxSeconds
    ) {
      return cached.payload as T;
    }
    throw error;
  }
}
