import { Buffer } from "node:buffer";
import { createHash } from "node:crypto";

import { z } from "zod";

import { uuidV7Schema } from "../../../../../lib/truth/v1";
import { readSourceShadowPage } from "../../../../../lib/supabase/source-read-model";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SUCCESS_CACHE_CONTROL =
  "public, max-age=0, s-maxage=30, stale-while-revalidate=60";
const ERROR_CACHE_CONTROL = "no-store";
const MAX_PUBLIC_RESPONSE_BYTES = 1_000_000;
const ALLOWED_QUERY_NAMES = new Set(["after", "limit"]);
const encodedCursorSchema = z
  .string()
  .min(1)
  .max(512)
  .regex(/^[A-Za-z0-9_-]+$/);
const cursorSchema = z.strictObject({
  version: z.literal(1),
  collectionTargetId: uuidV7Schema,
});
const querySchema = z.strictObject({
  after: encodedCursorSchema.optional(),
  limit: z
    .string()
    .regex(/^[1-9]\d{0,2}$/u)
    .transform(Number)
    .pipe(z.number().int().min(1).max(100))
    .default(50),
});

class InvalidShadowReadRequestError extends Error {
  constructor() {
    super("Invalid shadow source-read request.");
    this.name = "InvalidShadowReadRequestError";
  }
}

function parseRequest(request: Request) {
  const parameters = new URL(request.url).searchParams;
  for (const name of parameters.keys()) {
    if (!ALLOWED_QUERY_NAMES.has(name) || parameters.getAll(name).length !== 1) {
      throw new InvalidShadowReadRequestError();
    }
  }

  const parsed = querySchema.safeParse({
    after: parameters.get("after") ?? undefined,
    limit: parameters.get("limit") ?? undefined,
  });
  if (!parsed.success) throw new InvalidShadowReadRequestError();

  let after: string | null = null;
  if (parsed.data.after) {
    try {
      const decoded = Buffer.from(parsed.data.after, "base64url");
      if (decoded.toString("base64url") !== parsed.data.after) {
        throw new InvalidShadowReadRequestError();
      }
      const cursor = cursorSchema.safeParse(
        JSON.parse(decoded.toString("utf8")),
      );
      if (!cursor.success) throw new InvalidShadowReadRequestError();
      after = cursor.data.collectionTargetId;
    } catch (error) {
      if (error instanceof InvalidShadowReadRequestError) throw error;
      throw new InvalidShadowReadRequestError();
    }
  }

  return { after, limit: parsed.data.limit };
}

function encodeCursor(collectionTargetId: string | null) {
  if (!collectionTargetId) return null;
  return Buffer.from(
    JSON.stringify({ version: 1, collectionTargetId }),
    "utf8",
  ).toString("base64url");
}

function entityTag(body: string) {
  const digest = createHash("sha256").update(body).digest("base64url");
  return `"${digest}"`;
}

function matchesEntityTag(value: string | null, etag: string) {
  if (!value) return false;
  return value.split(",").some((candidate) => {
    const normalized = candidate.trim();
    return normalized === "*" || normalized === etag || normalized === `W/${etag}`;
  });
}

function errorResponse(error: unknown) {
  const invalidRequest = error instanceof InvalidShadowReadRequestError;
  return Response.json(
    {
      schemaVersion: 3,
      error: invalidRequest
        ? {
            code: "invalid_request",
            message: "The shadow source-read request is invalid.",
          }
        : {
            code: "read_model_unavailable",
            message: "Persisted source data is temporarily unavailable.",
          },
    },
    {
      status: invalidRequest ? 400 : 503,
      headers: {
        "Cache-Control": ERROR_CACHE_CONTROL,
        "X-Content-Type-Options": "nosniff",
      },
    },
  );
}

/**
 * Bounded global shadow inventory. The future incident-scoped `/sources`
 * contract must wait for an incident-aware health projection; this route does
 * not fabricate that relationship and is not used by the version 2 UI.
 */
export async function GET(request: Request) {
  try {
    const query = parseRequest(request);
    const page = await readSourceShadowPage(query);
    const payload = {
      schemaVersion: page.schemaVersion,
      mode: page.mode,
      scope: page.scope,
      asOf: page.asOf,
      items: page.items,
      page: { nextCursor: encodeCursor(page.nextAfter) },
    };
    const body = JSON.stringify(payload);
    if (Buffer.byteLength(body, "utf8") > MAX_PUBLIC_RESPONSE_BYTES) {
      throw new Error("Shadow source response exceeded its public bound.");
    }
    const etag = entityTag(body);
    const headers = {
      "Cache-Control": SUCCESS_CACHE_CONTROL,
      ETag: etag,
      "X-Content-Type-Options": "nosniff",
    };

    if (matchesEntityTag(request.headers.get("if-none-match"), etag)) {
      return new Response(null, { status: 304, headers });
    }

    return new Response(body, {
      status: 200,
      headers: {
        ...headers,
        "Content-Type": "application/json; charset=utf-8",
      },
    });
  } catch (error) {
    return errorResponse(error);
  }
}
