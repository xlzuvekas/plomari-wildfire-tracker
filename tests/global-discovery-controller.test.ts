import { describe, expect, it } from "vitest";

import {
  GlobalDiscoveryController,
  buildExploreDiscoveryRequest,
  buildNearbyDiscoveryRequest,
  canonicalDiscoveryCutoff,
  millisecondsUntilNextDiscoveryBucket,
  shouldRefreshDiscoveryOnVisible,
  type ExploreDiscoveryResponse,
  type GlobalDiscoveryClient,
  type GlobalDiscoveryClientResult,
} from "../lib/firewatch/v3";
import {
  SYNTHETIC_MARSEILLE_EXPLORE,
  SYNTHETIC_PARIS_VALID_EMPTY,
  SYNTHETIC_PLOMARI_NEARBY,
} from "./fixtures/global-discovery-v3";

function deferred<Value>() {
  let resolve!: (value: Value) => void;
  const promise = new Promise<Value>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

function unavailable() {
  return { kind: "unavailable", retryable: true } as const;
}

describe("global discovery current-time policy", () => {
  it("uses UTC-aligned five-minute knowledge and completed event buckets", () => {
    const beforeBoundary = Date.parse("2026-07-31T12:04:59.999Z");
    const onBoundary = Date.parse("2026-07-31T12:05:00.000Z");

    expect(canonicalDiscoveryCutoff(beforeBoundary)).toBe(
      "2026-07-31T12:00:00.000Z",
    );
    expect(buildExploreDiscoveryRequest(beforeBoundary).time).toEqual({
      asOf: "2026-07-31T11:55:00.000Z",
      knownAt: "2026-07-31T12:00:00.000Z",
    });
    expect(buildExploreDiscoveryRequest(onBoundary).time).toEqual({
      asOf: "2026-07-31T12:00:00.000Z",
      knownAt: "2026-07-31T12:05:00.000Z",
    });
    expect(millisecondsUntilNextDiscoveryBucket(beforeBoundary)).toBe(1);
    expect(millisecondsUntilNextDiscoveryBucket(onBoundary)).toBe(300_000);
    expect(
      shouldRefreshDiscoveryOnVisible(
        beforeBoundary,
        "2026-07-31T12:00:00.000Z",
      ),
    ).toBe(false);
    expect(
      shouldRefreshDiscoveryOnVisible(
        onBoundary,
        "2026-07-31T12:00:00.000Z",
      ),
    ).toBe(true);
  });

  it("builds Nearby reads from only one canonical coarse cell", () => {
    const request = buildNearbyDiscoveryRequest(
      "wm/10/587/391",
      Date.parse("2026-07-31T18:07:12.000Z"),
    );
    expect(request).toEqual({
      schemaVersion: 3,
      kind: "nearby-incidents",
      cell: "wm/10/587/391",
      time: {
        asOf: "2026-07-31T18:00:00.000Z",
        knownAt: "2026-07-31T18:05:00.000Z",
      },
      page: { limit: 50, after: null },
    });
    expect(JSON.stringify(request)).not.toMatch(
      /lat|lon|latitude|longitude|accuracy|bounds|timezone/iu,
    );
    expect(() =>
      buildNearbyDiscoveryRequest(
        "wm/010/0587/0391",
        Date.parse("2026-07-31T18:07:12.000Z"),
      ),
    ).toThrow(/canonical coarse cell/u);
  });
});

describe("global discovery controller", () => {
  it("aborts and ignores a stale Explore result after Nearby wins", async () => {
    const pendingExplore = deferred<
      GlobalDiscoveryClientResult<ExploreDiscoveryResponse>
    >();
    let exploreSignal: AbortSignal | undefined;
    const client: GlobalDiscoveryClient = {
      exploreCandidates(_request, options) {
        exploreSignal = options?.signal;
        return pendingExplore.promise;
      },
      async nearbyIncidents() {
        return {
          kind: "snapshot",
          transport: "live",
          data: SYNTHETIC_PLOMARI_NEARBY,
        };
      },
    };
    const controller = new GlobalDiscoveryController({
      client,
      now: () => Date.parse("2026-07-31T18:07:12.000Z"),
    });

    const first = controller.activate({ mode: "explore-candidates" });
    await Promise.resolve();
    expect(exploreSignal?.aborted).toBe(false);

    await controller.activate({
      mode: "nearby-incidents",
      cell: "wm/10/587/391",
    });
    expect(exploreSignal?.aborted).toBe(true);

    pendingExplore.resolve({
      kind: "snapshot",
      transport: "live",
      data: SYNTHETIC_MARSEILLE_EXPLORE,
    });
    await first;

    const snapshot = controller.getSnapshot();
    expect(snapshot.status).toBe("ready");
    expect(snapshot.target).toEqual({
      mode: "nearby-incidents",
      cell: "wm/10/587/391",
    });
    if (snapshot.status === "ready") {
      expect(snapshot.response.kind).toBe("nearby-incidents");
    }
  });

  it("coalesces an identical in-flight refresh in the same bucket", async () => {
    const pending = deferred<GlobalDiscoveryClientResult<ExploreDiscoveryResponse>>();
    let calls = 0;
    const client: GlobalDiscoveryClient = {
      exploreCandidates() {
        calls += 1;
        return pending.promise;
      },
      async nearbyIncidents() {
        return unavailable();
      },
    };
    const controller = new GlobalDiscoveryController({
      client,
      now: () => Date.parse("2026-07-31T17:07:00.000Z"),
    });

    const activation = controller.activate({ mode: "explore-candidates" });
    await controller.refresh();
    expect(calls).toBe(1);
    pending.resolve({
      kind: "snapshot",
      transport: "live",
      data: SYNTHETIC_MARSEILLE_EXPLORE,
    });
    await activation;
  });

  it("revalidates manually in the same bucket after a request completes", async () => {
    let calls = 0;
    const client: GlobalDiscoveryClient = {
      async exploreCandidates() {
        calls += 1;
        return {
          kind: "snapshot",
          transport: "live",
          data: SYNTHETIC_MARSEILLE_EXPLORE,
        };
      },
      async nearbyIncidents() {
        return unavailable();
      },
    };
    const controller = new GlobalDiscoveryController({
      client,
      now: () => Date.parse("2026-07-31T17:07:00.000Z"),
    });

    await controller.activate({ mode: "explore-candidates" });
    await controller.refresh();
    expect(calls).toBe(2);
  });

  it("retains only complete last-good data for the exact scope", async () => {
    const partial = structuredClone(SYNTHETIC_MARSEILLE_EXPLORE);
    partial.coverage = {
      state: "partial",
      policyVersion: SYNTHETIC_MARSEILLE_EXPLORE.coverage.policyVersion,
      scope: structuredClone(SYNTHETIC_MARSEILLE_EXPLORE.coverage.scope),
      checkedAt: "2026-07-31T17:04:00.000Z",
      requiredPartitionCount: 3,
      completedPartitionCount: 2,
    };
    partial.result = { state: "indeterminate" };
    partial.candidates = [];
    const notAssessed = structuredClone(SYNTHETIC_MARSEILLE_EXPLORE);
    notAssessed.coverage = {
      state: "not_assessed",
      policyVersion: SYNTHETIC_MARSEILLE_EXPLORE.coverage.policyVersion,
      scope: structuredClone(SYNTHETIC_MARSEILLE_EXPLORE.coverage.scope),
    };
    let explorePass = 0;
    const client: GlobalDiscoveryClient = {
      async exploreCandidates() {
        explorePass += 1;
        if (explorePass === 1) {
          return {
            kind: "snapshot",
            transport: "live",
            data: SYNTHETIC_MARSEILLE_EXPLORE,
          };
        }
        if (explorePass === 2) {
          return { kind: "snapshot", transport: "live", data: partial };
        }
        if (explorePass === 3) {
          return {
            kind: "snapshot",
            transport: "live",
            data: notAssessed,
          };
        }
        return unavailable();
      },
      async nearbyIncidents(request) {
        if (request.cell === SYNTHETIC_PARIS_VALID_EMPTY.scope.cell) {
          return unavailable();
        }
        return {
          kind: "snapshot",
          transport: "live",
          data: SYNTHETIC_PLOMARI_NEARBY,
        };
      },
    };
    let now = Date.parse("2026-07-31T17:07:00.000Z");
    const controller = new GlobalDiscoveryController({ client, now: () => now });

    await controller.activate({ mode: "explore-candidates" });
    now += 300_000;
    await controller.refresh();
    now += 300_000;
    await controller.refresh();
    let snapshot = controller.getSnapshot();
    expect(snapshot.status).toBe("ready");
    if (snapshot.status === "ready") {
      expect(snapshot.response.coverage.state).toBe("not_assessed");
    }
    now += 300_000;
    await controller.refresh();

    snapshot = controller.getSnapshot();
    expect(snapshot.status).toBe("error");
    if (snapshot.status === "error") {
      expect(snapshot.lastGood).toEqual(SYNTHETIC_MARSEILLE_EXPLORE);
    }

    await controller.activate({
      mode: "nearby-incidents",
      cell: SYNTHETIC_PARIS_VALID_EMPTY.scope.cell,
    });
    snapshot = controller.getSnapshot();
    expect(snapshot.status).toBe("error");
    if (snapshot.status === "error") {
      expect(snapshot.lastGood).toBeUndefined();
    }
  });

  it("does not promote an offline cache fallback into controller last-good", async () => {
    let pass = 0;
    const client: GlobalDiscoveryClient = {
      async exploreCandidates() {
        pass += 1;
        if (pass === 1) {
          return {
            kind: "snapshot",
            transport: "cache-fallback",
            data: SYNTHETIC_MARSEILLE_EXPLORE,
          };
        }
        return unavailable();
      },
      async nearbyIncidents() {
        return unavailable();
      },
    };
    let now = Date.parse("2026-07-31T17:07:00.000Z");
    const controller = new GlobalDiscoveryController({ client, now: () => now });

    await controller.activate({ mode: "explore-candidates" });
    now += 300_000;
    await controller.refresh();

    const snapshot = controller.getSnapshot();
    expect(snapshot.status).toBe("error");
    if (snapshot.status === "error") {
      expect(snapshot.lastGood).toBeUndefined();
    }
  });

  it("turns an unexpected client rejection into a scoped unavailable state", async () => {
    const client: GlobalDiscoveryClient = {
      async exploreCandidates() {
        throw new Error("synthetic transport regression");
      },
      async nearbyIncidents() {
        return unavailable();
      },
    };
    const controller = new GlobalDiscoveryController({ client });

    await expect(
      controller.activate({ mode: "explore-candidates" }),
    ).resolves.toBeUndefined();
    const snapshot = controller.getSnapshot();
    expect(snapshot.status).toBe("error");
    if (snapshot.status === "error") {
      expect(snapshot.issue).toBe("unavailable");
      expect(snapshot.lastGood).toBeUndefined();
    }
  });

  it("aborts hidden-tab work and forces one current read on resume", async () => {
    const pending = deferred<GlobalDiscoveryClientResult<ExploreDiscoveryResponse>>();
    let signal: AbortSignal | undefined;
    const client: GlobalDiscoveryClient = {
      exploreCandidates(_request, options) {
        signal = options?.signal;
        return pending.promise;
      },
      async nearbyIncidents() {
        return unavailable();
      },
    };
    const controller = new GlobalDiscoveryController({ client });

    void controller.activate({ mode: "explore-candidates" });
    await Promise.resolve();
    controller.suspend();

    expect(signal?.aborted).toBe(true);
    expect(controller.getLastRequestedCutoff()).toBeNull();
    expect(shouldRefreshDiscoveryOnVisible(Date.now(), null)).toBe(true);
  });
});
