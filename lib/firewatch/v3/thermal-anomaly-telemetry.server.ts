import { z } from "zod";

const MAX_REPORTED_DURATION_MS = 60_000;

const thermalTelemetryEventSchema = z.strictObject({
  event: z.literal("firewatch.thermal_v3.request"),
  schemaVersion: z.literal(1),
  status: z.number().int().min(100).max(599),
  outcome: z.enum([
    "success",
    "invalid_request",
    "snapshot_changed",
    "rate_limited_burst",
    "rate_limited_sustained",
    "capacity_limited",
    "admission_unavailable",
    "database_timeout",
    "database_scan_cap",
    "reader_timeout",
    "read_model_unavailable",
    "invalid_response",
  ]),
  pageType: z.enum(["first", "continuation", "unknown"]),
  durationMs: z.number().int().min(0).max(MAX_REPORTED_DURATION_MS),
  zoom: z.number().int().min(7).max(11).nullable(),
  rows: z.number().int().min(0).max(100).nullable(),
  hasMore: z.boolean().nullable(),
  databaseSqlstate: z.enum(["54000", "57014"]).nullable(),
  leaseRelease: z.enum(["not_acquired", "released", "expired_fallback"]),
});

export type ThermalTelemetryEvent = z.output<
  typeof thermalTelemetryEventSchema
>;

export type ThermalTelemetryReporter = (
  event: ThermalTelemetryEvent,
) => void;

function clampDuration(durationMs: number) {
  if (!Number.isFinite(durationMs)) return MAX_REPORTED_DURATION_MS;
  return Math.min(
    MAX_REPORTED_DURATION_MS,
    Math.max(0, Math.round(durationMs)),
  );
}

/**
 * Emits one low-cardinality operational event. It intentionally accepts no
 * URL, cell, cursor, IP, request headers, credentials, or exception text.
 */
export function reportThermalTelemetry(event: ThermalTelemetryEvent) {
  console.info(JSON.stringify(thermalTelemetryEventSchema.parse(event)));
}

export function safelyReportThermalTelemetry(
  reporter: ThermalTelemetryReporter,
  event: ThermalTelemetryEvent,
) {
  try {
    reporter(event);
  } catch {
    // Observability must never change a public safety-data response.
  }
}

export function createThermalTelemetryEvent(
  input: Omit<ThermalTelemetryEvent, "event" | "schemaVersion" | "durationMs"> &
    Readonly<{ durationMs: number }>,
) {
  return thermalTelemetryEventSchema.parse({
    ...input,
    event: "firewatch.thermal_v3.request",
    schemaVersion: 1,
    durationMs: clampDuration(input.durationMs),
  });
}

export const thermalTelemetryBounds = Object.freeze({
  maximumDurationMs: MAX_REPORTED_DURATION_MS,
});
