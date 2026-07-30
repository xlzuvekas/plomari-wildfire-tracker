import { describe, expect, it } from "vitest";

import {
  DEMAND_INTERVALS_MS,
  demandPollingPolicy,
  type DemandMode,
  type DemandPolicyInput,
} from "../lib/firewatch/demand-policy";

const AREA_CELL = "wm/11/1174/788";

function input(
  mode: DemandMode,
  overrides: Partial<DemandPolicyInput> = {},
): DemandPolicyInput {
  return {
    cellKey: AREA_CELL,
    mode,
    visible: true,
    online: true,
    recentlyInteractive: true,
    incidentBound: mode === "incident",
    ...overrides,
  };
}

function expectAllDisabled(policy: ReturnType<typeof demandPollingPolicy>) {
  expect(policy).toEqual({
    thermal: { enabled: false, intervalMs: null },
    wind: { enabled: false, intervalMs: null },
    updates: { enabled: false, intervalMs: null },
    x: { enabled: false, intervalMs: null },
  });
}

describe("demandPollingPolicy", () => {
  it.each(["quiet", "watch", "incident"] satisfies DemandMode[])(
    "disables every request-time poll while %s mode is hidden",
    (mode) => {
      expectAllDisabled(demandPollingPolicy(input(mode, { visible: false })));
    },
  );

  it.each(["quiet", "watch", "incident"] satisfies DemandMode[])(
    "disables every request-time poll while %s mode is offline",
    (mode) => {
      expectAllDisabled(demandPollingPolicy(input(mode, { online: false })));
    },
  );

  it("uses only slow thermal discovery in a quiet area", () => {
    expect(
      demandPollingPolicy(
        input("quiet", { incidentBound: true, recentlyInteractive: true }),
      ),
    ).toEqual({
      thermal: {
        enabled: true,
        intervalMs: DEMAND_INTERVALS_MS.quiet.thermal,
      },
      wind: { enabled: false, intervalMs: null },
      updates: { enabled: false, intervalMs: null },
      x: { enabled: false, intervalMs: null },
    });
  });

  it("uses bounded thermal, wind, and RSS polling in watch mode without X", () => {
    expect(
      demandPollingPolicy(
        input("watch", { incidentBound: true, recentlyInteractive: true }),
      ),
    ).toEqual({
      thermal: {
        enabled: true,
        intervalMs: DEMAND_INTERVALS_MS.watch.thermal,
      },
      wind: {
        enabled: true,
        intervalMs: DEMAND_INTERVALS_MS.watch.wind,
      },
      updates: {
        enabled: true,
        intervalMs: DEMAND_INTERVALS_MS.watch.updates,
      },
      x: { enabled: false, intervalMs: null },
    });
  });

  it("enables incident-rate updates and X only for active incident demand", () => {
    expect(demandPollingPolicy(input("incident"))).toEqual({
      thermal: {
        enabled: true,
        intervalMs: DEMAND_INTERVALS_MS.incident.thermal,
      },
      wind: {
        enabled: true,
        intervalMs: DEMAND_INTERVALS_MS.incident.wind,
      },
      updates: {
        enabled: true,
        intervalMs: DEMAND_INTERVALS_MS.incident.updates,
      },
      x: {
        enabled: true,
        intervalMs: DEMAND_INTERVALS_MS.incident.x,
      },
    });
  });

  it.each([
    ["unbound", { incidentBound: false }],
    ["not recently interactive", { recentlyInteractive: false }],
  ] as const)(
    "withholds incident updates and X when demand is %s",
    (_label, overrides) => {
      const policy = demandPollingPolicy(input("incident", overrides));

      expect(policy.thermal).toEqual({
        enabled: true,
        intervalMs: DEMAND_INTERVALS_MS.watch.thermal,
      });
      expect(policy.wind).toEqual({
        enabled: true,
        intervalMs: DEMAND_INTERVALS_MS.watch.wind,
      });
      expect(policy.updates).toEqual({ enabled: false, intervalMs: null });
      expect(policy.x).toEqual({ enabled: false, intervalMs: null });
    },
  );

  it("is deterministic and does not branch on the contents of a coarse cell key", () => {
    const plomari = demandPollingPolicy(input("watch"));
    const france = demandPollingPolicy(
      input("watch", { cellKey: "wm/11/1037/704" }),
    );

    expect(france).toEqual(plomari);
  });
});
