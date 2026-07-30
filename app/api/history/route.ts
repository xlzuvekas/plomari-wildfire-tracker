// Historical read API over the persistence layer. Serves only what the store
// has accumulated; it never fetches upstream and never fabricates data.

import { getDb, storeConfigured } from "@/lib/db/client";
import {
  isUndefinedTableError,
  queryThermalPasses,
  querySnapshotLog,
  queryWireItems,
} from "@/lib/db/store";

const KINDS = ["thermal-passes", "snapshots", "wire"] as const;
type HistoryKind = (typeof KINDS)[number];

const MAX_SINCE_HOURS = 336;
const MAX_LIMIT = 2_000;

function clampedInt(
  value: string | null,
  fallback: number,
  max: number,
): number {
  const parsed = value === null ? NaN : Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.min(Math.floor(parsed), max);
}

function headers() {
  return {
    "Cache-Control":
      "public, max-age=30, s-maxage=60, stale-while-revalidate=120",
  };
}

export async function GET(request: Request) {
  const requestStartedAt = new Date().toISOString();
  const params = new URL(request.url).searchParams;
  const kindParam = params.get("kind") ?? "thermal-passes";
  const sinceHours = clampedInt(params.get("sinceHours"), 72, MAX_SINCE_HOURS);
  const limit = clampedInt(params.get("limit"), 500, MAX_LIMIT);
  const source = params.get("source");

  const nowMs = Date.now();
  const query = {
    kind: kindParam,
    from: new Date(nowMs - sinceHours * 3_600_000).toISOString(),
    to: new Date(nowMs).toISOString(),
    sinceHours,
    limit,
    source,
  };

  const base = {
    schemaVersion: 1,
    requestStartedAt,
    retrievedAt: new Date().toISOString(),
    query,
  };

  if (!KINDS.includes(kindParam as HistoryKind)) {
    return Response.json(
      {
        ...base,
        status: "error",
        store: { env: "FIREWATCH_DATABASE_URL", configured: storeConfigured() },
        errors: [
          {
            code: "unknown_kind",
            message: `kind must be one of: ${KINDS.join(", ")}`,
          },
        ],
      },
      { status: 400, headers: headers() },
    );
  }
  const kind = kindParam as HistoryKind;

  if (!storeConfigured()) {
    return Response.json(
      {
        ...base,
        status: "unconfigured",
        store: { env: "FIREWATCH_DATABASE_URL", configured: false },
        passes: [],
        snapshots: [],
        items: [],
        errors: [
          {
            code: "store_unconfigured",
            message:
              "FIREWATCH_DATABASE_URL is not set; no historical record is being kept. See docs/db/README.md.",
          },
        ],
      },
      { headers: headers() },
    );
  }

  try {
    const db = await getDb();
    if (db === null) {
      throw new Error("store unavailable");
    }
    if (kind === "thermal-passes") {
      const passes = await queryThermalPasses(db, {
        from: query.from,
        to: query.to,
        limit,
      });
      return Response.json(
        {
          ...base,
          status: "ok",
          store: { env: "FIREWATCH_DATABASE_URL", configured: true },
          passes,
          errors: [],
        },
        { headers: headers() },
      );
    }
    if (kind === "snapshots") {
      const snapshots = await querySnapshotLog(db, {
        source,
        from: query.from,
        to: query.to,
        limit,
      });
      return Response.json(
        {
          ...base,
          status: "ok",
          store: { env: "FIREWATCH_DATABASE_URL", configured: true },
          snapshots,
          errors: [],
        },
        { headers: headers() },
      );
    }
    const items = await queryWireItems(db, {
      from: query.from,
      to: query.to,
      limit,
    });
    return Response.json(
      {
        ...base,
        status: "ok",
        store: { env: "FIREWATCH_DATABASE_URL", configured: true },
        items,
        errors: [],
      },
      { headers: headers() },
    );
  } catch (error) {
    const notInitialized = isUndefinedTableError(error);
    return Response.json(
      {
        ...base,
        status: "error",
        store: { env: "FIREWATCH_DATABASE_URL", configured: true },
        errors: [
          notInitialized
            ? {
                code: "store_not_initialized",
                message:
                  "The schema has not been created; run docs/db/setup.sql.",
              }
            : {
                code: "store_unavailable",
                message: "The historical store is temporarily unavailable.",
              },
        ],
      },
      { status: 503, headers: headers() },
    );
  }
}
