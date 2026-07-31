import { z } from "zod";

import type { CoarseAreaCell } from "../firewatch/map-context";
import {
  incidentLifecycleSchema,
  languageTagSchema,
  localDateSchema,
  utcInstantSchema,
  uuidV7Schema,
} from "../truth/v1";

import {
  readPostgrestRpcRows,
  SupabasePostgrestReadError,
  type PostgrestReadOptions,
} from "./postgrest";
import { readSupabaseDiscoveryReaderApiKey } from "./server-env";

const MAX_NEARBY_ROWS = 101;
const NEARBY_RESPONSE_BYTES = 1_000_000;

const postgresInstantSchema = z
  .string()
  .refine((value) => Number.isFinite(Date.parse(value)))
  .transform((value) => new Date(value).toISOString());

const ianaTimeZoneSchema = z.string().trim().min(1).max(100).refine((value) => {
  try {
    new Intl.DateTimeFormat("en", { timeZone: value }).format(0);
    return true;
  } catch {
    return false;
  }
}, "Expected an IANA time-zone identifier");

const localizedNamesSchema = z
  .record(z.string(), z.string())
  .refine((value) => Object.keys(value).length <= 32, {
    message: "Localized incident names exceed their read-model bound",
  });

export const nearbyIncidentReadRowSchema = z
  .strictObject({
    incident_id: uuidV7Schema,
    contract_version: z.literal("1.1.0"),
    slug: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/u).max(128),
    name: z.string().trim().min(1).max(256),
    localized_names: localizedNamesSchema,
    default_timezone: ianaTimeZoneSchema,
    incident_kind: z.literal("wildfire"),
    lifecycle: incidentLifecycleSchema,
    started_at: postgresInstantSchema.nullable(),
    started_date: localDateSchema.nullable(),
    started_precision: z.enum(["exact", "date_only", "unknown"]),
    started_timezone: ianaTimeZoneSchema.nullable(),
    latest_observed_at: postgresInstantSchema.nullable(),
    latest_observed_date: localDateSchema.nullable(),
    latest_observed_precision: z.enum(["exact", "date_only"]),
    latest_observed_timezone: ianaTimeZoneSchema.nullable(),
    item_known_at: postgresInstantSchema,
    resolved_scope_timezone: ianaTimeZoneSchema,
  })
  .superRefine((row, context) => {
    const validStarted =
      (row.started_precision === "exact" &&
        row.started_at !== null &&
        row.started_date === null) ||
      (row.started_precision === "date_only" &&
        row.started_at === null &&
        row.started_date !== null) ||
      (row.started_precision === "unknown" &&
        row.started_at === null &&
        row.started_date === null);
    if (!validStarted) {
      context.addIssue({
        code: "custom",
        message: "Incident start precision and value do not match",
        path: ["started_precision"],
      });
    }

    const validLatest =
      (row.latest_observed_precision === "exact" &&
        row.latest_observed_at !== null &&
        row.latest_observed_date === null) ||
      (row.latest_observed_precision === "date_only" &&
        row.latest_observed_at === null &&
        row.latest_observed_date !== null);
    if (!validLatest) {
      context.addIssue({
        code: "custom",
        message: "Latest observation precision and value do not match",
        path: ["latest_observed_precision"],
      });
    }
    if (
      row.latest_observed_precision === "date_only" &&
      row.latest_observed_timezone === null
    ) {
      context.addIssue({
        code: "custom",
        message: "Date-only observation requires its source calendar zone",
        path: ["latest_observed_timezone"],
      });
    }

  });

export type NearbyIncidentReadRow = z.output<
  typeof nearbyIncidentReadRowSchema
>;

const readInputSchema = z
  .strictObject({
    observedFrom: utcInstantSchema,
    asOf: utcInstantSchema,
    knownAt: utcInstantSchema,
    scopeTimeZone: ianaTimeZoneSchema.nullable().default(null),
    limit: z.number().int().min(1).max(MAX_NEARBY_ROWS),
  })
  .superRefine((input, context) => {
    if (
      Date.parse(input.observedFrom) >= Date.parse(input.asOf) ||
      Date.parse(input.asOf) > Date.parse(input.knownAt) ||
      Date.parse(input.asOf) - Date.parse(input.observedFrom) >
        7 * 24 * 60 * 60_000
    ) {
      context.addIssue({
        code: "custom",
        message: "Nearby read cutoffs are invalid",
        path: ["asOf"],
      });
    }
  });

export type NearbyIncidentReadInput = Readonly<{
  cell: CoarseAreaCell;
  observedFrom: string;
  asOf: string;
  knownAt: string;
  scopeTimeZone?: string | null;
  limit: number;
}>;

function invalidResponse(): never {
  throw new SupabasePostgrestReadError("invalid_response");
}

function validateRows(
  rows: readonly NearbyIncidentReadRow[],
  input: z.output<typeof readInputSchema>,
) {
  const ids = new Set<string>();
  const resolvedScopeTimeZone = rows[0]?.resolved_scope_timezone;
  for (const [index, row] of rows.entries()) {
    if (
      ids.has(row.incident_id) ||
      Date.parse(row.item_known_at) > Date.parse(input.knownAt) ||
      row.resolved_scope_timezone !== resolvedScopeTimeZone ||
      (input.scopeTimeZone !== null &&
        row.resolved_scope_timezone !== input.scopeTimeZone)
    ) {
      invalidResponse();
    }
    ids.add(row.incident_id);
    const prior = rows[index - 1];
    if (
      prior &&
      (Date.parse(prior.item_known_at) < Date.parse(row.item_known_at) ||
        (prior.item_known_at === row.item_known_at &&
          prior.incident_id < row.incident_id))
    ) {
      invalidResponse();
    }
  }
}

/**
 * Reads only the bounded, cutoff-checked Supabase RPC. The RPC is deliberately
 * partial: current persisted projections and state checks can omit superseded
 * historical rows, and an
 * empty result therefore never authorizes an empty-area claim.
 */
export async function readNearbyIncidentRows(
  input: NearbyIncidentReadInput,
  options: PostgrestReadOptions = {},
): Promise<NearbyIncidentReadRow[]> {
  const parsed = readInputSchema.parse({
    observedFrom: input.observedFrom,
    asOf: input.asOf,
    knownAt: input.knownAt,
    scopeTimeZone: input.scopeTimeZone,
    limit: input.limit,
  });

  const query: Record<string, string> = {
    p_z: String(input.cell.zoom),
    p_x: String(input.cell.x),
    p_y: String(input.cell.y),
    p_observed_from: parsed.observedFrom,
    p_as_of: parsed.asOf,
    p_known_at: parsed.knownAt,
    p_limit: String(parsed.limit),
  };
  if (parsed.scopeTimeZone !== null) {
    query.p_scope_timezone = parsed.scopeTimeZone;
  }
  const rows = await readPostgrestRpcRows({
    ...options,
    apiKey: options.apiKey ?? readSupabaseDiscoveryReaderApiKey(),
    rpc: "nearby_incidents_v3",
    query,
    rowSchema: nearbyIncidentReadRowSchema,
    maxResponseBytes: options.maxResponseBytes ?? NEARBY_RESPONSE_BYTES,
  });
  validateRows(rows, parsed);
  return rows;
}

export const globalDiscoveryReadLimits = Object.freeze({
  maximumNearbyRows: MAX_NEARBY_ROWS,
});

export function sanitizeIncidentDisplayNames(
  row: Pick<NearbyIncidentReadRow, "name" | "localized_names">,
): Readonly<Record<string, string>> {
  const names: Record<string, string> = { und: row.name };
  for (const [tag, value] of Object.entries(row.localized_names).sort()) {
    if (
      Object.keys(names).length >= 6 ||
      tag === "und" ||
      !languageTagSchema.safeParse(tag).success
    ) {
      continue;
    }
    const normalized = value.trim();
    if (normalized.length >= 1 && normalized.length <= 256) {
      names[tag] = normalized;
    }
  }
  return Object.freeze(names);
}
