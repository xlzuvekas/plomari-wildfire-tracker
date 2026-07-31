import { parseAreaCellKey } from "../map-context";
import {
  GLOBAL_DISCOVERY_SCHEMA_VERSION,
  exploreDiscoveryRequestSchema,
  nearbyDiscoveryRequestSchema,
  type ExploreDiscoveryRequest,
  type ExploreDiscoveryResponse,
  type NearbyDiscoveryRequest,
  type NearbyDiscoveryResponse,
} from "./discovery-contracts";
import type {
  GlobalDiscoveryClient,
  GlobalDiscoveryClientResult,
  GlobalDiscoveryTransport,
} from "./global-discovery-client";

export const GLOBAL_DISCOVERY_REFRESH_MS = 5 * 60_000;

export type GlobalDiscoveryTarget =
  | Readonly<{ mode: "explore-candidates" }>
  | Readonly<{ mode: "nearby-incidents"; cell: string }>;

type DiscoveryClientIssue = Exclude<
  GlobalDiscoveryClientResult<never>,
  { kind: "snapshot" }
>["kind"];

type ModeControllerSnapshot<
  Target extends GlobalDiscoveryTarget,
  Response,
> =
  | Readonly<{
      status: "loading";
      target: Target;
      lastGood?: Response;
    }>
  | Readonly<{
      status: "ready";
      target: Target;
      response: Response;
      transport: GlobalDiscoveryTransport;
    }>
  | Readonly<{
      status: "error";
      target: Target;
      issue: DiscoveryClientIssue;
      lastGood?: Response;
    }>;

export type GlobalDiscoveryControllerSnapshot =
  | Readonly<{ status: "idle"; target: null }>
  | ModeControllerSnapshot<
      Readonly<{ mode: "explore-candidates" }>,
      ExploreDiscoveryResponse
    >
  | ModeControllerSnapshot<
      Readonly<{ mode: "nearby-incidents"; cell: string }>,
      NearbyDiscoveryResponse
    >;

type ControllerOptions = Readonly<{
  client: GlobalDiscoveryClient;
  now?: () => number;
}>;

function timeCutoff(nowMs: number) {
  if (!Number.isFinite(nowMs)) {
    throw new TypeError("Discovery clock must return a finite timestamp.");
  }
  const bucketMs =
    Math.floor(nowMs / GLOBAL_DISCOVERY_REFRESH_MS) *
    GLOBAL_DISCOVERY_REFRESH_MS;
  return new Date(bucketMs).toISOString();
}

export function canonicalDiscoveryCutoff(nowMs: number): string {
  return timeCutoff(nowMs);
}

export function millisecondsUntilNextDiscoveryBucket(nowMs: number): number {
  if (!Number.isFinite(nowMs)) {
    throw new TypeError("Discovery clock must return a finite timestamp.");
  }
  const elapsed =
    ((nowMs % GLOBAL_DISCOVERY_REFRESH_MS) + GLOBAL_DISCOVERY_REFRESH_MS) %
    GLOBAL_DISCOVERY_REFRESH_MS;
  return elapsed === 0
    ? GLOBAL_DISCOVERY_REFRESH_MS
    : GLOBAL_DISCOVERY_REFRESH_MS - elapsed;
}

export function shouldRefreshDiscoveryOnVisible(
  nowMs: number,
  lastRequestedCutoff: string | null,
): boolean {
  if (lastRequestedCutoff === null) return true;
  return (
    Date.parse(canonicalDiscoveryCutoff(nowMs)) >
    Date.parse(lastRequestedCutoff)
  );
}

export function buildExploreDiscoveryRequest(
  nowMs: number,
): ExploreDiscoveryRequest {
  const knownAt = canonicalDiscoveryCutoff(nowMs);
  const asOf = new Date(
    Date.parse(knownAt) - GLOBAL_DISCOVERY_REFRESH_MS,
  ).toISOString();
  return exploreDiscoveryRequestSchema.parse({
    schemaVersion: GLOBAL_DISCOVERY_SCHEMA_VERSION,
    kind: "explore-candidates",
    time: { asOf, knownAt },
    page: {},
  });
}

export function buildNearbyDiscoveryRequest(
  cell: string,
  nowMs: number,
): NearbyDiscoveryRequest {
  const canonical = parseAreaCellKey(cell);
  if (canonical?.cellKey !== cell) {
    throw new TypeError("Nearby discovery requires a canonical coarse cell.");
  }
  const knownAt = canonicalDiscoveryCutoff(nowMs);
  const asOf = new Date(
    Date.parse(knownAt) - GLOBAL_DISCOVERY_REFRESH_MS,
  ).toISOString();
  return nearbyDiscoveryRequestSchema.parse({
    schemaVersion: GLOBAL_DISCOVERY_SCHEMA_VERSION,
    kind: "nearby-incidents",
    cell,
    time: { asOf, knownAt },
    page: {},
  });
}

function targetKey(target: GlobalDiscoveryTarget): string {
  return target.mode === "explore-candidates"
    ? target.mode
    : `${target.mode}:${target.cell}`;
}

function canonicalTarget(target: GlobalDiscoveryTarget): GlobalDiscoveryTarget {
  if (target.mode === "explore-candidates") {
    return Object.freeze({ mode: target.mode });
  }
  const canonical = parseAreaCellKey(target.cell);
  if (canonical?.cellKey !== target.cell) {
    throw new TypeError("Nearby discovery requires a canonical coarse cell.");
  }
  return Object.freeze({ mode: target.mode, cell: target.cell });
}

export class GlobalDiscoveryController {
  readonly #client: GlobalDiscoveryClient;
  readonly #now: () => number;
  readonly #listeners = new Set<() => void>();
  readonly #lastGood = new Map<
    string,
    ExploreDiscoveryResponse | NearbyDiscoveryResponse
  >();
  #snapshot: GlobalDiscoveryControllerSnapshot = Object.freeze({
    status: "idle",
    target: null,
  });
  #target: GlobalDiscoveryTarget | null = null;
  #activeController: AbortController | null = null;
  #activeRequestKey: string | null = null;
  #sequence = 0;
  #lastRequestedCutoff: string | null = null;

  constructor(options: ControllerOptions) {
    this.#client = options.client;
    this.#now = options.now ?? Date.now;
  }

  readonly getSnapshot = (): GlobalDiscoveryControllerSnapshot =>
    this.#snapshot;

  readonly subscribe = (listener: () => void): (() => void) => {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  };

  getLastRequestedCutoff(): string | null {
    return this.#lastRequestedCutoff;
  }

  async activate(target: GlobalDiscoveryTarget): Promise<void> {
    this.#target = canonicalTarget(target);
    await this.refresh();
  }

  pause(): void {
    this.#sequence += 1;
    this.#activeController?.abort();
    this.#activeController = null;
    this.#activeRequestKey = null;
    this.#target = null;
    this.#setSnapshot(Object.freeze({ status: "idle", target: null }));
  }

  /** Abort hidden-tab work without changing the user's selected scope. */
  suspend(): void {
    this.#sequence += 1;
    if (this.#activeController !== null) {
      this.#lastRequestedCutoff = null;
      this.#activeController.abort();
    }
    this.#activeController = null;
    this.#activeRequestKey = null;
  }

  async refresh(): Promise<void> {
    const target = this.#target;
    if (target === null) return;

    const nowMs = this.#now();
    const cutoff = canonicalDiscoveryCutoff(nowMs);
    const requestKey = `${targetKey(target)}:${cutoff}`;
    if (
      this.#activeController !== null &&
      this.#activeRequestKey === requestKey
    ) {
      return;
    }

    const sequence = this.#sequence + 1;
    this.#sequence = sequence;
    this.#activeController?.abort();
    const activeController = new AbortController();
    this.#activeController = activeController;
    this.#activeRequestKey = requestKey;
    this.#lastRequestedCutoff = cutoff;
    const key = targetKey(target);
    const lastGood = this.#lastGood.get(key);

    if (target.mode === "explore-candidates") {
      this.#setSnapshot(
        Object.freeze({
          status: "loading",
          target,
          ...(lastGood?.kind === "explore-candidates" ? { lastGood } : {}),
        }),
      );
      let result: GlobalDiscoveryClientResult<ExploreDiscoveryResponse>;
      try {
        result = await this.#client.exploreCandidates(
          buildExploreDiscoveryRequest(nowMs),
          { signal: activeController.signal },
        );
      } catch {
        result = { kind: "unavailable", retryable: true };
      }
      if (!this.#isCurrent(sequence, activeController)) return;
      this.#activeController = null;
      this.#activeRequestKey = null;
      this.#finishExplore(target, key, result, lastGood);
      return;
    }

    this.#setSnapshot(
      Object.freeze({
        status: "loading",
        target,
        ...(lastGood?.kind === "nearby-incidents" ? { lastGood } : {}),
      }),
    );
    let result: GlobalDiscoveryClientResult<NearbyDiscoveryResponse>;
    try {
      result = await this.#client.nearbyIncidents(
        buildNearbyDiscoveryRequest(target.cell, nowMs),
        { signal: activeController.signal },
      );
    } catch {
      result = { kind: "unavailable", retryable: true };
    }
    if (!this.#isCurrent(sequence, activeController)) return;
    this.#activeController = null;
    this.#activeRequestKey = null;
    this.#finishNearby(target, key, result, lastGood);
  }

  dispose(): void {
    this.#sequence += 1;
    this.#activeController?.abort();
    this.#activeController = null;
    this.#activeRequestKey = null;
    this.#target = null;
  }

  #isCurrent(sequence: number, controller: AbortController): boolean {
    return (
      !controller.signal.aborted &&
      this.#sequence === sequence &&
      this.#activeController === controller
    );
  }

  #finishExplore(
    target: Readonly<{ mode: "explore-candidates" }>,
    key: string,
    result: GlobalDiscoveryClientResult<ExploreDiscoveryResponse>,
    previous: ExploreDiscoveryResponse | NearbyDiscoveryResponse | undefined,
  ) {
    if (result.kind === "snapshot") {
      if (
        result.data.coverage.state === "complete" &&
        result.transport !== "cache-fallback"
      ) {
        this.#lastGood.set(key, structuredClone(result.data));
      }
      this.#setSnapshot(
        Object.freeze({
          status: "ready",
          target,
          response: result.data,
          transport: result.transport,
        }),
      );
      return;
    }
    this.#setSnapshot(
      Object.freeze({
        status: "error",
        target,
        issue: result.kind,
        ...(previous?.kind === "explore-candidates"
          ? { lastGood: previous }
          : {}),
      }),
    );
  }

  #finishNearby(
    target: Readonly<{ mode: "nearby-incidents"; cell: string }>,
    key: string,
    result: GlobalDiscoveryClientResult<NearbyDiscoveryResponse>,
    previous: ExploreDiscoveryResponse | NearbyDiscoveryResponse | undefined,
  ) {
    if (result.kind === "snapshot") {
      if (
        result.data.coverage.state === "complete" &&
        result.transport !== "cache-fallback"
      ) {
        this.#lastGood.set(key, structuredClone(result.data));
      }
      this.#setSnapshot(
        Object.freeze({
          status: "ready",
          target,
          response: result.data,
          transport: result.transport,
        }),
      );
      return;
    }
    this.#setSnapshot(
      Object.freeze({
        status: "error",
        target,
        issue: result.kind,
        ...(previous?.kind === "nearby-incidents"
          ? { lastGood: previous }
          : {}),
      }),
    );
  }

  #setSnapshot(snapshot: GlobalDiscoveryControllerSnapshot) {
    this.#snapshot = snapshot;
    this.#listeners.forEach((listener) => listener());
  }
}
