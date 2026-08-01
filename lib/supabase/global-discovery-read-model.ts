import { z } from "zod";

import type { CoarseAreaCell } from "../firewatch/map-context";
import { parseAreaCellKey } from "../firewatch/map-context";
import { GLOBAL_DISCOVERY_MAX_PAGE_SIZE } from "../firewatch/v3/discovery-contracts";
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

const MAX_GLOBAL_CANDIDATE_ROWS = GLOBAL_DISCOVERY_MAX_PAGE_SIZE + 1;
const GLOBAL_CANDIDATE_RESPONSE_BYTES = 1_000_000;
const GLOBAL_CANDIDATE_READER_TIMEOUT_MS = 5_000;
const digestSchema = z.string().regex(/^[a-f0-9]{64}$/u);
const signalKindSchema = z.enum([
  "thermal_detection",
  "incident_summary",
  "hazard_advisory",
]);

const MAX_NEARBY_ROWS = 101;
const NEARBY_RESPONSE_BYTES = 1_000_000;

const postgresInstantSchema = z
  .string()
  .refine((value) => Number.isFinite(Date.parse(value)))
  .transform((value) => new Date(value).toISOString());

// Cursor positions are serialized at JavaScript millisecond precision. Fail
// closed instead of silently truncating a Postgres microsecond that could
// otherwise duplicate or skip a keyset row on continuation.
const postgresMillisecondInstantSchema = z
  .string()
  .refine((value) => Number.isFinite(Date.parse(value)))
  .refine((value) => {
    const fractional = /T\d{2}:\d{2}:\d{2}\.(\d+)/u.exec(value)?.[1];
    return fractional === undefined || fractional.length <= 3;
  }, "Expected a timestamp no more precise than milliseconds")
  .transform((value) => new Date(value).toISOString());

const ianaTimeZoneSchema = z.string().trim().min(1).max(100).refine((value) => {
  try {
    new Intl.DateTimeFormat("en", { timeZone: value }).format(0);
    return true;
  } catch {
    return false;
  }
}, "Expected an IANA time-zone identifier");

const canonicalUuidV7Schema = uuidV7Schema.refine(
  (value) => value === value.toLowerCase(),
  "Expected a canonical lowercase UUIDv7",
);
const canonicalCellKeySchema = z
  .string()
  .trim()
  .min(1)
  .max(64)
  .refine((value) => {
    const cell = parseAreaCellKey(value);
    return (
      cell?.cellKey === value &&
      cell.minimumSpanM >= 8_000 &&
      cell.minimumSpanM <= 80_000
    );
  }, { message: "Expected a canonical Firewatch coarse-area cell key" });

const globalCandidateSnapshotShape = {
  snapshot_id: canonicalUuidV7Schema,
  snapshot_as_of: postgresMillisecondInstantSchema,
  snapshot_known_at: postgresMillisecondInstantSchema,
  snapshot_observed_from: postgresMillisecondInstantSchema,
  snapshot_digest: digestSchema,
  publication_gate_digest: digestSchema,
} as const;

const globalCandidateNullShape = {
  candidate_id: z.null(),
  cell_key: z.null(),
  display_timezone: z.null(),
  signal_kinds: z.null(),
  observation_count: z.null(),
  source_count: z.null(),
  first_observed_at: z.null(),
  latest_observed_at: z.null(),
  item_known_at: z.null(),
} as const;

const globalCandidateSnapshotRowSchema = z.strictObject({
  row_kind: z.literal("snapshot"),
  ...globalCandidateSnapshotShape,
  ...globalCandidateNullShape,
});

const globalCandidateItemRowSchema = z
  .strictObject({
    row_kind: z.literal("candidate"),
    ...globalCandidateSnapshotShape,
    candidate_id: canonicalUuidV7Schema,
    cell_key: canonicalCellKeySchema,
    display_timezone: ianaTimeZoneSchema,
    signal_kinds: z.array(signalKindSchema).min(1).max(8),
    observation_count: z.number().int().positive().max(1_000_000),
    source_count: z.number().int().positive().max(1_000),
    first_observed_at: postgresMillisecondInstantSchema.nullable(),
    latest_observed_at: postgresMillisecondInstantSchema,
    item_known_at: postgresMillisecondInstantSchema,
  })
  .superRefine((row, context) => {
    if (new Set(row.signal_kinds).size !== row.signal_kinds.length) {
      context.addIssue({
        code: "custom",
        message: "Candidate signal kinds must be unique",
        path: ["signal_kinds"],
      });
    }
    if (row.source_count > row.observation_count) {
      context.addIssue({
        code: "custom",
        message: "Candidate source count cannot exceed observation count",
        path: ["source_count"],
      });
    }
    if (
      (row.first_observed_at !== null &&
        Date.parse(row.first_observed_at) > Date.parse(row.latest_observed_at)) ||
      Date.parse(row.latest_observed_at) > Date.parse(row.item_known_at)
    ) {
      context.addIssue({
        code: "custom",
        message: "Candidate observation and knowledge clocks are inconsistent",
        path: ["item_known_at"],
      });
    }
  });

export const globalCandidateProjectionRowSchema = z.discriminatedUnion(
  "row_kind",
  [globalCandidateSnapshotRowSchema, globalCandidateItemRowSchema],
);

export type GlobalCandidateProjectionRow = z.output<
  typeof globalCandidateProjectionRowSchema
>;
export type GlobalCandidateProjectionSnapshot = Readonly<
  Pick<
    GlobalCandidateProjectionRow,
    | "snapshot_id"
    | "snapshot_as_of"
    | "snapshot_known_at"
    | "snapshot_observed_from"
    | "snapshot_digest"
    | "publication_gate_digest"
  >
>;
export type GlobalCandidateProjectionItem = z.output<
  typeof globalCandidateItemRowSchema
>;

const globalCandidateReadInputSchema = z
  .strictObject({
    observedFrom: postgresInstantSchema,
    asOf: postgresInstantSchema,
    knownAt: postgresInstantSchema,
    limit: z.number().int().min(1).max(MAX_GLOBAL_CANDIDATE_ROWS),
    continuation: z
      .strictObject({
        snapshotId: canonicalUuidV7Schema,
        snapshotDigest: digestSchema,
        publicationGateDigest: digestSchema,
        afterItemKnownAt: postgresInstantSchema,
        afterCandidateId: canonicalUuidV7Schema,
      })
      .nullable(),
  })
  .superRefine((input, context) => {
    if (
      Date.parse(input.observedFrom) >= Date.parse(input.asOf) ||
      Date.parse(input.asOf) > Date.parse(input.knownAt) ||
      Date.parse(input.asOf) - Date.parse(input.observedFrom) !==
        7 * 24 * 60 * 60_000 ||
      (input.continuation !== null &&
        Date.parse(input.continuation.afterItemKnownAt) >
          Date.parse(input.knownAt))
    ) {
      context.addIssue({
        code: "custom",
        message: "Global candidate read cutoffs are invalid",
        path: ["asOf"],
      });
    }
  });

export type GlobalCandidateReadInput = Readonly<{
  observedFrom: string;
  asOf: string;
  knownAt: string;
  limit: number;
  continuation?: Readonly<{
    snapshotId: string;
    snapshotDigest: string;
    publicationGateDigest: string;
    afterItemKnownAt: string;
    afterCandidateId: string;
  }>;
}>;

export type GlobalCandidateProjectionPage = Readonly<{
  snapshot: GlobalCandidateProjectionSnapshot | null;
  candidates: readonly GlobalCandidateProjectionItem[];
}>;

function invalidGlobalCandidateResponse(): never {
  throw new SupabasePostgrestReadError("invalid_response");
}

function snapshotFromRow(
  row: GlobalCandidateProjectionRow,
): GlobalCandidateProjectionSnapshot {
  return Object.freeze({
    snapshot_id: row.snapshot_id,
    snapshot_as_of: row.snapshot_as_of,
    snapshot_known_at: row.snapshot_known_at,
    snapshot_observed_from: row.snapshot_observed_from,
    snapshot_digest: row.snapshot_digest,
    publication_gate_digest: row.publication_gate_digest,
  });
}

function sameSnapshot(
  left: GlobalCandidateProjectionSnapshot,
  right: GlobalCandidateProjectionSnapshot,
) {
  return (
    left.snapshot_id === right.snapshot_id &&
    left.snapshot_as_of === right.snapshot_as_of &&
    left.snapshot_known_at === right.snapshot_known_at &&
    left.snapshot_observed_from === right.snapshot_observed_from &&
    left.snapshot_digest === right.snapshot_digest &&
    left.publication_gate_digest === right.publication_gate_digest
  );
}

function validateGlobalCandidateRows(
  rows: readonly GlobalCandidateProjectionRow[],
  input: z.output<typeof globalCandidateReadInputSchema>,
): GlobalCandidateProjectionPage {
  // The sentinel is metadata, not a candidate, and is extra to p_limit.
  if (rows.length > input.limit + 1) invalidGlobalCandidateResponse();
  if (rows.length === 0) {
    if (input.continuation !== null) invalidGlobalCandidateResponse();
    return Object.freeze({ snapshot: null, candidates: Object.freeze([]) });
  }
  const metadataRow = rows[0];
  if (metadataRow?.row_kind !== "snapshot") {
    return invalidGlobalCandidateResponse();
  }
  const snapshot = snapshotFromRow(metadataRow);
  if (
    snapshot.snapshot_observed_from !== input.observedFrom ||
    snapshot.snapshot_as_of !== input.asOf ||
    snapshot.snapshot_known_at !== input.knownAt ||
    Date.parse(snapshot.snapshot_as_of) > Date.parse(snapshot.snapshot_known_at)
  ) {
    return invalidGlobalCandidateResponse();
  }
  if (
    input.continuation !== null &&
    (snapshot.snapshot_id !== input.continuation.snapshotId ||
      snapshot.snapshot_digest !== input.continuation.snapshotDigest ||
      snapshot.publication_gate_digest !==
        input.continuation.publicationGateDigest)
  ) {
    return invalidGlobalCandidateResponse();
  }

  const candidates: GlobalCandidateProjectionItem[] = [];
  const candidateIds = new Set<string>();
  for (const row of rows.slice(1)) {
    if (
      row.row_kind !== "candidate" ||
      !sameSnapshot(snapshot, snapshotFromRow(row)) ||
      candidateIds.has(row.candidate_id) ||
      Date.parse(row.latest_observed_at) < Date.parse(input.observedFrom) ||
      Date.parse(row.latest_observed_at) > Date.parse(input.asOf) ||
      Date.parse(row.item_known_at) > Date.parse(input.knownAt)
    ) {
      return invalidGlobalCandidateResponse();
    }
    if (
      input.continuation !== null &&
      (Date.parse(row.item_known_at) >
        Date.parse(input.continuation.afterItemKnownAt) ||
        (row.item_known_at === input.continuation.afterItemKnownAt &&
          row.candidate_id >= input.continuation.afterCandidateId))
    ) {
      return invalidGlobalCandidateResponse();
    }
    const prior = candidates.at(-1);
    if (
      prior !== undefined &&
      (Date.parse(prior.item_known_at) < Date.parse(row.item_known_at) ||
        (prior.item_known_at === row.item_known_at &&
          prior.candidate_id < row.candidate_id))
    ) {
      return invalidGlobalCandidateResponse();
    }
    candidateIds.add(row.candidate_id);
    candidates.push(row);
  }
  if (candidates.length > input.limit) {
    return invalidGlobalCandidateResponse();
  }
  return Object.freeze({
    snapshot,
    candidates: Object.freeze(candidates),
  });
}

/**
 * Reads one immutable, precomputed projection page. A metadata sentinel keeps
 * "no published snapshot" distinct from a published snapshot with zero
 * candidates; neither state is interpreted as global sensing completeness.
 */
export async function readGlobalCandidateProjectionPage(
  input: GlobalCandidateReadInput,
  options: PostgrestReadOptions = {},
): Promise<GlobalCandidateProjectionPage> {
  const parsed = globalCandidateReadInputSchema.parse({
    observedFrom: input.observedFrom,
    asOf: input.asOf,
    knownAt: input.knownAt,
    limit: input.limit,
    continuation: input.continuation ?? null,
  });
  const query: Record<string, string> = {
    p_observed_from: parsed.observedFrom,
    p_as_of: parsed.asOf,
    p_known_at: parsed.knownAt,
    p_limit: String(parsed.limit),
  };
  if (parsed.continuation !== null) {
    query.p_snapshot_id = parsed.continuation.snapshotId;
    query.p_snapshot_digest = parsed.continuation.snapshotDigest;
    query.p_publication_gate_digest =
      parsed.continuation.publicationGateDigest;
    query.p_after_item_known_at = parsed.continuation.afterItemKnownAt;
    query.p_after_candidate_id = parsed.continuation.afterCandidateId;
  }
  const rows = await readPostgrestRpcRows({
    ...options,
    apiKey: options.apiKey ?? readSupabaseDiscoveryReaderApiKey(),
    rpc: "explore_candidate_cells_v3",
    query,
    rowSchema: globalCandidateProjectionRowSchema,
    maxResponseBytes:
      options.maxResponseBytes ?? GLOBAL_CANDIDATE_RESPONSE_BYTES,
    timeoutMs: options.timeoutMs ?? GLOBAL_CANDIDATE_READER_TIMEOUT_MS,
    expectedDatabaseErrors: [
      { postgresCode: "54000", mapsTo: "scan_cap" },
      { postgresCode: "57014", mapsTo: "database_timeout" },
      ...(parsed.continuation === null
        ? []
        : [
            {
              postgresCode: "22023",
              details: "firewatch_snapshot_changed_v1",
              mapsTo: "snapshot_changed" as const,
            },
          ]),
    ],
  });
  return validateGlobalCandidateRows(rows, parsed);
}

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
  maximumGlobalCandidateRows: MAX_GLOBAL_CANDIDATE_ROWS,
  globalCandidateTimeoutMs: GLOBAL_CANDIDATE_READER_TIMEOUT_MS,
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
