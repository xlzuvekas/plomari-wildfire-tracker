const MINUTE_MS = 60_000;

export type DemandMode = "quiet" | "watch" | "incident";

/**
 * Request-time demand is scoped to a canonical coarse cell. Exact device
 * coordinates must be reduced to this key before reaching the policy.
 */
export type DemandPolicyInput = Readonly<{
  cellKey: string;
  mode: DemandMode;
  visible: boolean;
  online: boolean;
  recentlyInteractive: boolean;
  incidentBound: boolean;
}>;

export type PollingSchedule = Readonly<{
  enabled: boolean;
  intervalMs: number | null;
}>;

export type DemandPollingPolicy = Readonly<{
  thermal: PollingSchedule;
  wind: PollingSchedule;
  updates: PollingSchedule;
  x: PollingSchedule;
}>;

export const DEMAND_INTERVALS_MS = Object.freeze({
  quiet: Object.freeze({
    thermal: 15 * MINUTE_MS,
  }),
  watch: Object.freeze({
    thermal: 5 * MINUTE_MS,
    wind: 10 * MINUTE_MS,
    updates: 5 * MINUTE_MS,
  }),
  incident: Object.freeze({
    thermal: 2 * MINUTE_MS,
    wind: 5 * MINUTE_MS,
    updates: 1 * MINUTE_MS,
    x: 1 * MINUTE_MS,
  }),
} as const);

const DISABLED = Object.freeze({
  enabled: false,
  intervalMs: null,
}) satisfies PollingSchedule;

const ALL_DISABLED = Object.freeze({
  thermal: DISABLED,
  wind: DISABLED,
  updates: DISABLED,
  x: DISABLED,
}) satisfies DemandPollingPolicy;

function enabled(intervalMs: number): PollingSchedule {
  return Object.freeze({ enabled: true, intervalMs });
}

/**
 * Produces the client request-time polling schedule for one coarse area.
 *
 * This deliberately does not schedule background alerting or durable source
 * ingestion. Those belong to a separately leased server worker. X is the
 * highest-cost source and is only activated for an incident-bound, recently
 * interactive client.
 */
export function demandPollingPolicy(
  input: DemandPolicyInput,
): DemandPollingPolicy {
  if (!input.visible || !input.online) return ALL_DISABLED;

  if (input.mode === "quiet") {
    return Object.freeze({
      thermal: enabled(DEMAND_INTERVALS_MS.quiet.thermal),
      wind: DISABLED,
      updates: DISABLED,
      x: DISABLED,
    });
  }

  if (input.mode === "watch") {
    return Object.freeze({
      thermal: enabled(DEMAND_INTERVALS_MS.watch.thermal),
      wind: enabled(DEMAND_INTERVALS_MS.watch.wind),
      updates: enabled(DEMAND_INTERVALS_MS.watch.updates),
      x: DISABLED,
    });
  }

  const realtimeEligible =
    input.incidentBound && input.recentlyInteractive;

  return Object.freeze({
    thermal: enabled(
      realtimeEligible
        ? DEMAND_INTERVALS_MS.incident.thermal
        : DEMAND_INTERVALS_MS.watch.thermal,
    ),
    wind: enabled(
      realtimeEligible
        ? DEMAND_INTERVALS_MS.incident.wind
        : DEMAND_INTERVALS_MS.watch.wind,
    ),
    updates: realtimeEligible
      ? enabled(DEMAND_INTERVALS_MS.incident.updates)
      : DISABLED,
    x: realtimeEligible
      ? enabled(DEMAND_INTERVALS_MS.incident.x)
      : DISABLED,
  });
}
