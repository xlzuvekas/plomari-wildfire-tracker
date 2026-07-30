import { Buffer } from "node:buffer";

import { z } from "zod";

import {
  readSupabaseServerEnvironment,
  type SupabaseServerEnvironment,
} from "./server-env";

const apiResourceSchema = z.enum([
  "source_catalog",
  "source_health",
]);
const apiRpcSchema = z.enum([
  "satellite_passes_for_cell",
  "satellite_scan_status_for_window",
]);
const timeoutSchema = z.number().int().min(1).max(10_000);
const responseByteLimitSchema = z.number().int().min(1).max(8_000_000);

const DEFAULT_TIMEOUT_MS = 5_000;
const MAX_RESPONSE_BYTES = 512_000;

export type SupabaseApiResource = z.infer<typeof apiResourceSchema>;
export type SupabaseApiRpc = z.infer<typeof apiRpcSchema>;
export type SupabasePostgrestReadErrorCode =
  | "timeout"
  | "unavailable"
  | "invalid_response";

export class SupabasePostgrestReadError extends Error {
  constructor(readonly code: SupabasePostgrestReadErrorCode) {
    super(
      code === "timeout"
        ? "Supabase Data API read timed out."
        : code === "unavailable"
          ? "Supabase Data API read is unavailable."
          : "Supabase Data API returned an invalid response.",
    );
    this.name = "SupabasePostgrestReadError";
  }
}

export type PostgrestReadOptions = Readonly<{
  environment?: SupabaseServerEnvironment;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  maxResponseBytes?: number;
}>;

type ReadPostgrestRowsInput<Schema extends z.ZodType> =
  PostgrestReadOptions &
    Readonly<{
      resource: SupabaseApiResource;
      query: Readonly<Record<string, string>>;
      rowSchema: Schema;
    }>;

type ReadPostgrestRpcRowsInput<Schema extends z.ZodType> =
  PostgrestReadOptions &
    Readonly<{
      rpc: SupabaseApiRpc;
      query: Readonly<Record<string, string>>;
      rowSchema: Schema;
    }>;

type ReadPostgrestJsonRowsInput<Schema extends z.ZodType> =
  PostgrestReadOptions &
    Readonly<{
      pathname: string;
      query: Readonly<Record<string, string>>;
      rowSchema: Schema;
    }>;

async function readPostgrestJsonRows<Schema extends z.ZodType>(
  input: ReadPostgrestJsonRowsInput<Schema>,
): Promise<Array<z.output<Schema>>> {
  const timeoutMs = timeoutSchema.parse(input.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  const maxResponseBytes = responseByteLimitSchema.parse(
    input.maxResponseBytes ?? MAX_RESPONSE_BYTES,
  );
  const environment =
    input.environment ?? readSupabaseServerEnvironment();
  const fetchImpl = input.fetchImpl ?? fetch;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  const endpoint = new URL(input.pathname, environment.url);

  Object.entries(input.query).forEach(([name, value]) => {
    endpoint.searchParams.set(name, value);
  });

  try {
    const response = await fetchImpl(endpoint, {
      method: "GET",
      cache: "no-store",
      headers: {
        Accept: "application/json",
        "Accept-Profile": "api",
        apikey: environment.publishableKey,
      },
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new SupabasePostgrestReadError("unavailable");
    }

    const declaredBytes = Number(response.headers.get("content-length"));
    if (
      Number.isFinite(declaredBytes) &&
      declaredBytes > maxResponseBytes
    ) {
      throw new SupabasePostgrestReadError("invalid_response");
    }

    const body = await response.text();
    if (Buffer.byteLength(body, "utf8") > maxResponseBytes) {
      throw new SupabasePostgrestReadError("invalid_response");
    }

    let decoded: unknown;
    try {
      decoded = JSON.parse(body);
    } catch {
      throw new SupabasePostgrestReadError("invalid_response");
    }

    const rows = z.array(input.rowSchema).safeParse(decoded);
    if (!rows.success) {
      throw new SupabasePostgrestReadError("invalid_response");
    }

    return rows.data;
  } catch (error) {
    if (error instanceof SupabasePostgrestReadError) throw error;
    if (controller.signal.aborted) {
      throw new SupabasePostgrestReadError("timeout");
    }
    throw new SupabasePostgrestReadError("unavailable");
  } finally {
    clearTimeout(timeout);
  }
}

export async function readPostgrestRows<Schema extends z.ZodType>(
  input: ReadPostgrestRowsInput<Schema>,
): Promise<Array<z.output<Schema>>> {
  const resource = apiResourceSchema.parse(input.resource);
  return readPostgrestJsonRows({
    ...input,
    pathname: `/rest/v1/${resource}`,
  });
}

/**
 * Reads a stable, read-only function through PostgREST using the same
 * publishable-key and bounded-response boundary as curated views.
 */
export async function readPostgrestRpcRows<Schema extends z.ZodType>(
  input: ReadPostgrestRpcRowsInput<Schema>,
): Promise<Array<z.output<Schema>>> {
  const rpc = apiRpcSchema.parse(input.rpc);
  return readPostgrestJsonRows({
    ...input,
    pathname: `/rest/v1/rpc/${rpc}`,
  });
}
