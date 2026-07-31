import { z } from "zod";

import { parseAreaCellKey } from "../map-context";
import { utcInstantSchema } from "../../truth/v1/schemas";
import {
  THERMAL_ANOMALY_SCHEMA_VERSION,
  thermalAnomalyErrorSchema,
  thermalAnomalyPayloadSchema,
  type ThermalAnomalyPayload,
} from "./thermal-anomaly-contract";

const MAX_RESPONSE_BYTES = 1_000_000;
export const THERMAL_ANOMALY_FIRST_PAGE_MAX_LIMIT = 50;

const canonicalInstantSchema = utcInstantSchema.refine(
  (value) => new Date(value).toISOString() === value,
  "Expected a canonical millisecond UTC instant",
);

const firstPageRequestSchema = z
  .strictObject({
    cell: z.string().trim().min(1).max(64),
    asOf: canonicalInstantSchema,
    knownAt: canonicalInstantSchema,
    limit: z
      .number()
      .int()
      .min(1)
      .max(THERMAL_ANOMALY_FIRST_PAGE_MAX_LIMIT)
      .default(THERMAL_ANOMALY_FIRST_PAGE_MAX_LIMIT),
  })
  .superRefine((request, context) => {
    const cell = parseAreaCellKey(request.cell);
    if (cell?.cellKey !== request.cell) {
      context.addIssue({
        code: "custom",
        message: "Expected an exact canonical coarse-area cell",
        path: ["cell"],
      });
    }
    if (Date.parse(request.asOf) > Date.parse(request.knownAt)) {
      context.addIssue({
        code: "custom",
        message: "The event-time cutoff must not follow the knowledge cutoff",
        path: ["asOf"],
      });
    }
  });

export type ThermalAnomalyFirstPageRequest = Readonly<
  z.input<typeof firstPageRequestSchema>
>;

export type NormalizedThermalAnomalyFirstPageRequest = Readonly<
  z.output<typeof firstPageRequestSchema>
>;

export type ThermalAnomalyFetch = (
  input: string,
  init: RequestInit,
) => Promise<Response>;

export type ThermalAnomalyRequestOptions = Readonly<{
  signal?: AbortSignal;
}>;

export type ThermalAnomalyClientResult =
  | Readonly<{ kind: "snapshot"; data: ThermalAnomalyPayload }>
  | Readonly<{ kind: "invalid-request"; retryable: false }>
  | Readonly<{ kind: "cancelled"; retryable: false }>
  | Readonly<{
      kind: "snapshot-changed";
      retryable: true;
      restartFromFirstPage: true;
    }>
  | Readonly<{ kind: "unavailable"; retryable: true }>
  | Readonly<{ kind: "invalid-response"; retryable: true }>;

export interface ThermalAnomalyClient {
  readFirstPage(
    request: ThermalAnomalyFirstPageRequest,
    options?: ThermalAnomalyRequestOptions,
  ): Promise<ThermalAnomalyClientResult>;
}

export type HttpThermalAnomalyClientOptions = Readonly<{
  fetch: ThermalAnomalyFetch;
}>;

function normalizeRequest(
  request: ThermalAnomalyFirstPageRequest,
): NormalizedThermalAnomalyFirstPageRequest | null {
  const parsed = firstPageRequestSchema.safeParse(request);
  return parsed.success ? Object.freeze(parsed.data) : null;
}

export function normalizeThermalAnomalyFirstPageRequest(
  request: ThermalAnomalyFirstPageRequest,
): NormalizedThermalAnomalyFirstPageRequest {
  const parsed = normalizeRequest(request);
  if (parsed === null) {
    throw new TypeError("Thermal anomaly first-page request is invalid.");
  }
  return parsed;
}

export function buildThermalAnomalyFirstPagePath(
  request: ThermalAnomalyFirstPageRequest,
): string {
  const parsed = normalizeThermalAnomalyFirstPageRequest(request);
  const parameters = new URLSearchParams({
    cell: parsed.cell,
    schemaVersion: String(THERMAL_ANOMALY_SCHEMA_VERSION),
    asOf: parsed.asOf,
    knownAt: parsed.knownAt,
    limit: String(parsed.limit),
  });
  return `/api/v3/thermal-anomalies?${parameters.toString()}`;
}

function isJsonContentType(value: string | null): boolean {
  if (value === null) return false;
  const mediaType = value.split(";", 1)[0]?.trim().toLowerCase() ?? "";
  return mediaType === "application/json" || mediaType.endsWith("+json");
}

function isAbortError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "name" in error &&
    error.name === "AbortError"
  );
}

async function readBoundedJson(response: Response): Promise<unknown> {
  const declaredLength = response.headers.get("content-length");
  if (declaredLength !== null) {
    const bytes = Number(declaredLength);
    if (
      !Number.isSafeInteger(bytes) ||
      bytes < 0 ||
      bytes > MAX_RESPONSE_BYTES
    ) {
      throw new Error("Thermal anomaly response exceeds its byte budget.");
    }
  }

  if (response.body === null) {
    throw new Error("Thermal anomaly response body is missing.");
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let receivedBytes = 0;
  let text = "";

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      receivedBytes += value.byteLength;
      if (receivedBytes > MAX_RESPONSE_BYTES) {
        try {
          await reader.cancel();
        } catch {
          // Preserve the bounded-response classification after a stream failure.
        }
        throw new Error("Thermal anomaly response exceeds its byte budget.");
      }
      text += decoder.decode(value, { stream: true });
    }
    text += decoder.decode();
  } finally {
    reader.releaseLock();
  }

  return JSON.parse(text) as unknown;
}

function responseMatchesRequest(
  payload: ThermalAnomalyPayload,
  request: NormalizedThermalAnomalyFirstPageRequest,
): boolean {
  return (
    payload.scope.cell === request.cell &&
    payload.time.asOf === request.asOf &&
    payload.time.knownAt === request.knownAt &&
    payload.page.limit === request.limit &&
    payload.page.isFirstPage
  );
}

/**
 * Browser-facing, first-page-only persisted read. The path is fixed and
 * same-origin; no provider credential, retry, cache, or continuation cursor is
 * available at this boundary.
 */
export function createHttpThermalAnomalyClient(
  options: HttpThermalAnomalyClientOptions,
): ThermalAnomalyClient {
  const requestFetch = options.fetch;
  return {
    async readFirstPage(request, requestOptions) {
      const parsedRequest = normalizeRequest(request);
      if (parsedRequest === null) {
        return { kind: "invalid-request", retryable: false };
      }
      if (requestOptions?.signal?.aborted) {
        return { kind: "cancelled", retryable: false };
      }

      let response: Response;
      try {
        response = await requestFetch(
          buildThermalAnomalyFirstPagePath(parsedRequest),
          {
            method: "GET",
            headers: { Accept: "application/json" },
            cache: "no-store",
            credentials: "omit",
            mode: "same-origin",
            redirect: "error",
            referrerPolicy: "same-origin",
            signal: requestOptions?.signal,
          },
        );
      } catch (error) {
        if (requestOptions?.signal?.aborted || isAbortError(error)) {
          return { kind: "cancelled", retryable: false };
        }
        return { kind: "unavailable", retryable: true };
      }

      if (requestOptions?.signal?.aborted) {
        return { kind: "cancelled", retryable: false };
      }
      if (response.status === 409) {
        if (!isJsonContentType(response.headers.get("content-type"))) {
          return { kind: "invalid-response", retryable: true };
        }
        try {
          const body = await readBoundedJson(response);
          if (requestOptions?.signal?.aborted) {
            return { kind: "cancelled", retryable: false };
          }
          const parsedError = thermalAnomalyErrorSchema.safeParse(body);
          return parsedError.success &&
            parsedError.data.error.code === "snapshot_changed"
            ? {
                kind: "snapshot-changed",
                retryable: true,
                restartFromFirstPage: true,
              }
            : { kind: "invalid-response", retryable: true };
        } catch (error) {
          if (requestOptions?.signal?.aborted || isAbortError(error)) {
            return { kind: "cancelled", retryable: false };
          }
          return { kind: "invalid-response", retryable: true };
        }
      }
      if ([408, 425, 429].includes(response.status)) {
        return { kind: "unavailable", retryable: true };
      }
      if (response.status >= 400 && response.status < 500) {
        return { kind: "invalid-request", retryable: false };
      }
      if (response.status >= 500) {
        return { kind: "unavailable", retryable: true };
      }
      if (
        !response.ok ||
        !isJsonContentType(response.headers.get("content-type"))
      ) {
        return { kind: "invalid-response", retryable: true };
      }

      try {
        const body = await readBoundedJson(response);
        if (requestOptions?.signal?.aborted) {
          return { kind: "cancelled", retryable: false };
        }
        const parsedPayload = thermalAnomalyPayloadSchema.safeParse(body);
        if (
          !parsedPayload.success ||
          !responseMatchesRequest(parsedPayload.data, parsedRequest)
        ) {
          return { kind: "invalid-response", retryable: true };
        }
        return { kind: "snapshot", data: parsedPayload.data };
      } catch (error) {
        if (requestOptions?.signal?.aborted || isAbortError(error)) {
          return { kind: "cancelled", retryable: false };
        }
        return { kind: "invalid-response", retryable: true };
      }
    },
  };
}
