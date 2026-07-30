import type {
  IsoDateTime,
  SourceDefinition,
  SourceHealthState,
} from "./domain";

export type FreshnessInput = {
  readonly now: IsoDateTime;
  readonly enabled: boolean;
  readonly configured: boolean;
  readonly lastAttemptAt: IsoDateTime | null;
  readonly lastSuccessAt: IsoDateTime | null;
  readonly lastChangedPayloadAt: IsoDateTime | null;
  readonly latestSourcePublicationAt: IsoDateTime | null;
  readonly consecutiveFailures: number;
  readonly errorClass: string | null;
};

export type FreshnessResult = {
  readonly state: SourceHealthState;
  readonly collectorAgeSeconds: number | null;
  readonly publicationAgeSeconds: number | null;
  readonly staleAfterSeconds: number;
  readonly reason:
    | "disabled"
    | "unconfigured"
    | "authentication_failed"
    | "rate_limited"
    | "never_succeeded"
    | "collector_stale"
    | "collector_failed"
    | "healthy";
};

function ageSeconds(
  now: IsoDateTime,
  timestamp: IsoDateTime | null,
): number | null {
  if (!timestamp) return null;
  const nowMs = Date.parse(now);
  const timestampMs = Date.parse(timestamp);
  if (!Number.isFinite(nowMs) || !Number.isFinite(timestampMs)) return null;
  return Math.max(0, Math.floor((nowMs - timestampMs) / 1000));
}

export function calculateSourceFreshness(
  source: SourceDefinition,
  input: FreshnessInput,
): FreshnessResult {
  const collectorAgeSeconds = ageSeconds(input.now, input.lastSuccessAt);
  const publicationAgeSeconds = ageSeconds(
    input.now,
    input.latestSourcePublicationAt,
  );
  const base = {
    collectorAgeSeconds,
    publicationAgeSeconds,
    staleAfterSeconds: source.staleAfterSeconds,
  };

  if (!input.enabled) {
    return { ...base, state: "disabled", reason: "disabled" };
  }
  if (!input.configured) {
    return { ...base, state: "unconfigured", reason: "unconfigured" };
  }
  if (input.errorClass === "authentication") {
    return {
      ...base,
      state: "authentication_failed",
      reason: "authentication_failed",
    };
  }
  if (input.errorClass === "rate_limit") {
    return { ...base, state: "rate_limited", reason: "rate_limited" };
  }
  if (collectorAgeSeconds === null) {
    return { ...base, state: "unknown", reason: "never_succeeded" };
  }
  if (collectorAgeSeconds > source.staleAfterSeconds) {
    return { ...base, state: "stale", reason: "collector_stale" };
  }
  if (input.consecutiveFailures > 0) {
    return { ...base, state: "failed", reason: "collector_failed" };
  }
  return { ...base, state: "healthy", reason: "healthy" };
}
