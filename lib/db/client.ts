// Postgres connection for the optional persistence layer. Everything here is
// server-only and degrades to "no store" when DATABASE_URL is absent.
//
// Pooler constraints (Supabase Supavisor transaction mode, port 6543):
// parameterized pool.query() uses unnamed prepared statements, which are
// safe; never pass a query `name`, never SET session state, never take
// session-scoped advisory locks through this pool.

export type QueryResultLike = { rows: Record<string, unknown>[] };

export type Queryable = {
  query(text: string, values?: unknown[]): Promise<QueryResultLike>;
};

export function databaseUrl(): string | null {
  // Strictly app-scoped: no DATABASE_URL/POSTGRES_URL fallback. A generic
  // DATABASE_URL inherited from a shared environment was observed pointing at
  // an unrelated project's production database; only an explicit
  // FIREWATCH_DATABASE_URL may select this app's store.
  const url = process.env.FIREWATCH_DATABASE_URL?.trim();
  return url ? url : null;
}

export function storeConfigured(): boolean {
  return databaseUrl() !== null;
}

function sslConfig(url: string): false | { rejectUnauthorized: boolean } {
  try {
    const parsed = new URL(url);
    if (parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1") {
      return false;
    }
    if (parsed.searchParams.get("sslmode") === "disable") {
      return false;
    }
  } catch {
    // Unparseable URL: fall through to SSL-on and let pg surface the error.
  }
  // Encrypted transport without CA pinning; works across Supabase pooler,
  // Neon, and Vercel Postgres, whose managed certs differ.
  return { rejectUnauthorized: false };
}

let poolPromise: Promise<Queryable> | null = null;

export async function getDb(): Promise<Queryable | null> {
  const url = databaseUrl();
  if (!url) return null;
  if (!poolPromise) {
    poolPromise = import("pg").then((pg) => {
      const pool = new pg.default.Pool({
        connectionString: url,
        max: 1,
        idleTimeoutMillis: 10_000,
        connectionTimeoutMillis: 5_000,
        allowExitOnIdle: true,
        query_timeout: 4_000,
        ssl: sslConfig(url),
      });
      // Idle-client errors (pooler restarts, network drops) must never crash
      // the process; the next query creates a fresh connection.
      pool.on("error", () => {});
      return pool;
    });
  }
  return poolPromise;
}

export function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
  label: string,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`${label} timed out after ${ms}ms`)),
      ms,
    );
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}
