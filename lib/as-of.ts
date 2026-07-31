import { parseZonedInstant } from "./area-time";

export type AsOfSelection =
  | { mode: "live" }
  | { mode: "historical"; epochMs: number };

export const LIVE_AS_OF: AsOfSelection = Object.freeze({ mode: "live" });

export function timestampEpoch(value: string | null | undefined) {
  return parseZonedInstant(value)?.getTime() ?? null;
}

export function clampAsOfEpoch(
  value: number,
  incidentStartedAt: number,
  currentTime: number,
) {
  if (
    !Number.isFinite(incidentStartedAt) ||
    !Number.isFinite(currentTime) ||
    currentTime < incidentStartedAt
  ) {
    throw new RangeError("Invalid as-of bounds");
  }

  if (!Number.isFinite(value)) return incidentStartedAt;
  return Math.min(currentTime, Math.max(incidentStartedAt, value));
}

/**
 * Returns the first range step at or after currentTime. Keeping the maximum on
 * the range's min-anchored step grid prevents browsers from sanitizing the
 * visual right edge backward into a historical value.
 */
export function liveAsOfRangeMaximum(
  incidentStartedAt: number,
  currentTime: number,
  stepMs: number,
): number {
  if (!Number.isFinite(stepMs) || stepMs <= 0) {
    throw new RangeError("Invalid as-of range step");
  }
  clampAsOfEpoch(incidentStartedAt, incidentStartedAt, currentTime);
  return (
    incidentStartedAt +
    Math.ceil((currentTime - incidentStartedAt) / stepMs) * stepMs
  );
}

/**
 * Converts the range control's numeric value into the application's explicit
 * Live/null sentinel. The final half-step is reserved for Live so a thumb at
 * the visual right edge can never leave polling paused in a near-current
 * historical state.
 */
export function asOfEpochFromRangeValue(
  value: number,
  incidentStartedAt: number,
  currentTime: number,
  stepMs: number,
): number | null {
  const liveMaximum = liveAsOfRangeMaximum(
    incidentStartedAt,
    currentTime,
    stepMs,
  );
  if (value >= liveMaximum - stepMs / 2) return null;
  const clamped = clampAsOfEpoch(value, incidentStartedAt, currentTime);
  return clamped;
}

export function effectiveAsOfEpoch(
  selection: AsOfSelection,
  currentTime: number,
) {
  return selection.mode === "live" ? currentTime : selection.epochMs;
}

export function isTimestampVisibleAt(
  value: string | null | undefined,
  selection: AsOfSelection,
) {
  if (selection.mode === "live") return true;
  const epochMs = timestampEpoch(value);
  return epochMs !== null && epochMs <= selection.epochMs;
}

export function filterAtOrBefore<T>(
  items: readonly T[],
  getTimestamp: (item: T) => string | null | undefined,
  selection: AsOfSelection,
) {
  if (selection.mode === "live") return [...items];
  return items.filter((item) =>
    isTimestampVisibleAt(getTimestamp(item), selection),
  );
}

export function latestAtOrBefore<T>(
  items: readonly T[],
  getTimestamp: (item: T) => string | null | undefined,
  selection: AsOfSelection,
) {
  let latest: T | null = null;
  let latestEpoch = Number.NEGATIVE_INFINITY;

  for (const item of items) {
    const epochMs = timestampEpoch(getTimestamp(item));
    if (epochMs === null) continue;
    if (selection.mode === "historical" && epochMs > selection.epochMs) continue;
    if (epochMs > latestEpoch) {
      latest = item;
      latestEpoch = epochMs;
    }
  }

  return latest;
}
