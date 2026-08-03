import { Buffer } from "node:buffer";

import { z } from "zod";

import {
  isSupabaseDiscoveryReaderLegacyJwt,
  readSupabaseServerEnvironment,
  type SupabaseServerEnvironment,
} from "./server-env";

const apiResourceSchema = z.enum([
  "source_catalog",
  "source_health",
]);
const apiRpcSchema = z.enum([
  "explore_candidate_cells_v3",
  "nearby_incidents_v3",
  "satellite_passes_for_cell",
  "satellite_scan_status_for_window",
  "thermal_anomalies_v3",
]);
const timeoutSchema = z.number().int().min(1).max(10_000);
const responseByteLimitSchema = z.number().int().min(1).max(8_000_000);
const apiKeySchema = z.string().trim().min(16).max(8_192);

const DEFAULT_TIMEOUT_MS = 5_000;
const MAX_RESPONSE_BYTES = 512_000;

export type SupabaseApiResource = z.infer<typeof apiResourceSchema>;
export type SupabaseApiRpc = z.infer<typeof apiRpcSchema>;
export type SupabasePostgrestReadErrorCode =
  | "timeout"
  | "unavailable"
  | "invalid_response"
  | "snapshot_changed"
  | "database_timeout"
  | "scan_cap";

export class SupabasePostgrestReadError extends Error {
  constructor(readonly code: SupabasePostgrestReadErrorCode) {
    super(
      code === "timeout"
        ? "Supabase Data API read timed out."
        : code === "database_timeout"
          ? "Supabase canceled the database read at its statement boundary."
          : code === "scan_cap"
            ? "Supabase stopped the database read at its candidate scan bound."
            : code === "snapshot_changed"
              ? "Supabase Data API snapshot changed."
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
  apiKey?: string;
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
      expectedDatabaseErrors?: readonly ExpectedPostgrestError[];
    }>;

type ReadPostgrestJsonRowsInput<Schema extends z.ZodType> =
  PostgrestReadOptions &
    Readonly<{
      pathname: string;
      query: Readonly<Record<string, string>>;
      rowSchema: Schema;
      expectedDatabaseErrors?: readonly ExpectedPostgrestError[];
    }>;

type ExpectedPostgrestError = Readonly<{
  postgresCode: string;
  details?: string;
  mapsTo: SupabasePostgrestReadErrorCode;
}>;

const postgrestErrorEnvelopeSchema = z
  .object({
    code: z.string(),
    details: z.string().nullable().optional(),
  })
  .passthrough();

async function readBoundedResponseBody(
  response: Response,
  maxResponseBytes: number,
): Promise<string> {
  const declaredBytes = Number(response.headers.get("content-length"));
  if (
    Number.isFinite(declaredBytes) &&
    declaredBytes > maxResponseBytes
  ) {
    throw new SupabasePostgrestReadError("invalid_response");
  }

  if (response.body === null) {
    const body = await response.text();
    if (Buffer.byteLength(body, "utf8") > maxResponseBytes) {
      throw new SupabasePostgrestReadError("invalid_response");
    }
    return body;
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let receivedBytes = 0;
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      receivedBytes += chunk.value.byteLength;
      if (receivedBytes > maxResponseBytes) {
        await reader.cancel();
        throw new SupabasePostgrestReadError("invalid_response");
      }
      chunks.push(chunk.value);
    }
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks, receivedBytes).toString("utf8");
}

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
  const apiKey = apiKeySchema.parse(
    input.apiKey ?? environment.publishableKey,
  );
  const legacyDiscoveryReaderJwt =
    input.apiKey !== undefined &&
    isSupabaseDiscoveryReaderLegacyJwt(apiKey, environment.url);
  const headers: Record<string, string> = {
    Accept: "application/json",
    "Accept-Profile": "api",
    apikey: legacyDiscoveryReaderJwt
      ? environment.publishableKey
      : apiKey,
  };
  if (legacyDiscoveryReaderJwt) {
    headers.Authorization = `Bearer ${apiKey}`;
  }

  Object.entries(input.query).forEach(([name, value]) => {
    endpoint.searchParams.set(name, value);
  });

  try {
    const response = await fetchImpl(endpoint, {
      method: "GET",
      cache: "no-store",
      headers,
      signal: controller.signal,
    });

    if (!response.ok) {
      if ((input.expectedDatabaseErrors?.length ?? 0) > 0) {
        const errorBody = await readBoundedResponseBody(
          response,
          Math.min(maxResponseBytes, 16_384),
        );
        let decodedError: unknown;
        try {
          decodedError = JSON.parse(errorBody);
        } catch {
          throw new SupabasePostgrestReadError("unavailable");
        }
        const parsedError = postgrestErrorEnvelopeSchema.safeParse(decodedError);
        if (parsedError.success) {
          const expected = input.expectedDatabaseErrors?.find(
            (candidate) =>
              candidate.postgresCode === parsedError.data.code &&
              (candidate.details === undefined ||
                candidate.details === parsedError.data.details),
          );
          if (expected !== undefined) {
            throw new SupabasePostgrestReadError(expected.mapsTo);
          }
        }
      }
      throw new SupabasePostgrestReadError("unavailable");
    }

    const body = await readBoundedResponseBody(response, maxResponseBytes);

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
 * Reads an allowlisted function through PostgREST using either the standard
 * publishable key or an explicitly supplied scoped API key, plus a streaming
 * byte bound.
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
