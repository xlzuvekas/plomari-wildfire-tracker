import { Buffer } from "node:buffer";

import { z } from "zod";

import {
  exploreDiscoveryRequestSchema,
  nearbyDiscoveryRequestSchema,
  type ExploreDiscoveryRequest,
  type NearbyDiscoveryRequest,
} from "./discovery-contracts";

export const DISCOVERY_OBSERVATION_WINDOW_MS = 7 * 24 * 60 * 60_000;
const MAX_DISCOVERY_HISTORY_MS = 31 * 24 * 60 * 60_000;
const MAX_FUTURE_SKEW_MS = 5 * 60_000;
const MAX_PUBLIC_RESPONSE_BYTES = 1_000_000;

const baseQuerySchema = z.strictObject({
  schemaVersion: z.literal("3"),
  asOf: z.string(),
  knownAt: z.string(),
  limit: z
    .string()
    .regex(/^[1-9]\d{0,2}$/u)
    .transform(Number)
    .pipe(z.number().int().min(1).max(100))
    .default(50),
  after: z.string().min(16).max(512).nullable().default(null),
});

const exploreQuerySchema = baseQuerySchema;
const nearbyQuerySchema = baseQuerySchema.extend({
  cell: z.string().trim().min(1).max(64),
});

export class InvalidGlobalDiscoveryRequestError extends Error {
  constructor() {
    super("The global discovery request is invalid.");
    this.name = "InvalidGlobalDiscoveryRequestError";
  }
}

function exactParameters(
  request: Request,
  allowed: ReadonlySet<string>,
): Record<string, string | null> {
  const parameters = new URL(request.url).searchParams;
  for (const name of parameters.keys()) {
    if (!allowed.has(name) || parameters.getAll(name).length !== 1) {
      throw new InvalidGlobalDiscoveryRequestError();
    }
  }
  return Object.fromEntries(
    [...allowed].map((name) => [name, parameters.get(name)]),
  );
}

function validateBoundedCutoffs(
  request: ExploreDiscoveryRequest | NearbyDiscoveryRequest,
  nowMs: number,
) {
  const asOfMs = Date.parse(request.time.asOf);
  const knownAtMs = Date.parse(request.time.knownAt);
  if (
    !Number.isFinite(nowMs) ||
    asOfMs < nowMs - MAX_DISCOVERY_HISTORY_MS ||
    knownAtMs < nowMs - MAX_DISCOVERY_HISTORY_MS ||
    knownAtMs > nowMs + MAX_FUTURE_SKEW_MS ||
    knownAtMs - asOfMs > MAX_DISCOVERY_HISTORY_MS
  ) {
    throw new InvalidGlobalDiscoveryRequestError();
  }
  return request;
}

export function parseExploreDiscoveryHttpRequest(
  request: Request,
  nowMs = Date.now(),
): ExploreDiscoveryRequest {
  const raw = exactParameters(
    request,
    new Set(["schemaVersion", "asOf", "knownAt", "limit", "after"]),
  );
  const query = exploreQuerySchema.safeParse({
    schemaVersion: raw.schemaVersion ?? undefined,
    asOf: raw.asOf ?? undefined,
    knownAt: raw.knownAt ?? undefined,
    limit: raw.limit ?? undefined,
    after: raw.after,
  });
  if (!query.success) throw new InvalidGlobalDiscoveryRequestError();
  const parsed = exploreDiscoveryRequestSchema.safeParse({
    schemaVersion: 3,
    kind: "explore-candidates",
    time: { asOf: query.data.asOf, knownAt: query.data.knownAt },
    page: { limit: query.data.limit, after: query.data.after },
  });
  if (!parsed.success) throw new InvalidGlobalDiscoveryRequestError();
  return validateBoundedCutoffs(parsed.data, nowMs) as ExploreDiscoveryRequest;
}

export function parseNearbyDiscoveryHttpRequest(
  request: Request,
  nowMs = Date.now(),
): NearbyDiscoveryRequest {
  const raw = exactParameters(
    request,
    new Set([
      "cell",
      "schemaVersion",
      "asOf",
      "knownAt",
      "limit",
      "after",
    ]),
  );
  const query = nearbyQuerySchema.safeParse({
    cell: raw.cell ?? undefined,
    schemaVersion: raw.schemaVersion ?? undefined,
    asOf: raw.asOf ?? undefined,
    knownAt: raw.knownAt ?? undefined,
    limit: raw.limit ?? undefined,
    after: raw.after,
  });
  if (!query.success) throw new InvalidGlobalDiscoveryRequestError();
  const parsed = nearbyDiscoveryRequestSchema.safeParse({
    schemaVersion: 3,
    kind: "nearby-incidents",
    cell: query.data.cell,
    time: { asOf: query.data.asOf, knownAt: query.data.knownAt },
    page: { limit: query.data.limit, after: query.data.after },
  });
  if (!parsed.success) throw new InvalidGlobalDiscoveryRequestError();
  if (parsed.data.page.after !== null) {
    throw new InvalidGlobalDiscoveryRequestError();
  }
  return validateBoundedCutoffs(parsed.data, nowMs) as NearbyDiscoveryRequest;
}

export function discoveryObservedFrom(asOf: string) {
  return new Date(Date.parse(asOf) - DISCOVERY_OBSERVATION_WINDOW_MS).toISOString();
}

function utcOffsetMinutesAt(instant: string, timeZone: string) {
  const offset = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    timeZoneName: "longOffset",
  })
    .formatToParts(Date.parse(instant))
    .find((part) => part.type === "timeZoneName")?.value;
  if (offset === "GMT") return 0;
  const match = /^GMT([+-])(\d{2}):(\d{2})$/u.exec(offset ?? "");
  if (!match) throw new TypeError("Unable to resolve discovery time zone.");
  const hours = Number(match[2]);
  const minutes = Number(match[3]);
  const absolute = hours * 60 + minutes;
  return match[1] === "-" ? -absolute : absolute;
}

export function discoveryTimeContext(input: Readonly<{
  asOf: string;
  knownAt: string;
  timeZone: string;
  basis: "scope" | "utc-fallback";
}>) {
  return Object.freeze({
    asOf: input.asOf,
    knownAt: input.knownAt,
    observedWindow: Object.freeze({
      from: discoveryObservedFrom(input.asOf),
      to: input.asOf,
    }),
    timeZone: Object.freeze({
      id: input.timeZone,
      basis: input.basis,
      utcOffsetMinutesAtAsOf: utcOffsetMinutesAt(
        input.asOf,
        input.timeZone,
      ),
    }),
    normalizedTimeZone: "UTC" as const,
    semantics: Object.freeze({
      asOf: "event-time-cutoff" as const,
      knownAt: "knowledge-time-cutoff" as const,
      observedWindow: "event-time-inclusion-window" as const,
      timeZone: "display-only" as const,
    }),
  });
}

export function localDateAt(instant: string, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(Date.parse(instant));
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((entry) => entry.type === type)?.value;
  return `${part("year")}-${part("month")}-${part("day")}`;
}

export function boundedDiscoveryJson(payload: unknown, status = 200) {
  const body = JSON.stringify(payload);
  if (Buffer.byteLength(body, "utf8") > MAX_PUBLIC_RESPONSE_BYTES) {
    throw new Error("Global discovery response exceeded its public bound.");
  }
  return new Response(body, {
    status,
    headers: {
      "Cache-Control": "no-store",
      "Content-Type": "application/json; charset=utf-8",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

export function globalDiscoveryErrorResponse(error: unknown) {
  const invalid = error instanceof InvalidGlobalDiscoveryRequestError;
  return boundedDiscoveryJson(
    {
      schemaVersion: 3,
      error: invalid
        ? {
            code: "invalid_request",
            message: "The global discovery request is invalid.",
          }
        : {
            code: "read_model_unavailable",
            message: "Persisted global discovery data is temporarily unavailable.",
          },
    },
    invalid ? 400 : 503,
  );
}
