import {
  EvidencePersistenceError,
  recordedFetch,
  type HttpEvidenceLedger,
  type HttpRequestEvidence,
} from "../evidence/recorded-fetch.ts";
import {
  OPEN_METEO_AQ_MAX_RESPONSE_BYTES,
  openMeteoAirQualityRequestHeaders,
  openMeteoAirQualityUrl,
  parseOpenMeteoAirQuality,
  type AirQualityParseResult,
  type AirQualityPoint,
} from "./open-meteo.ts";

/**
 * Open-Meteo air-quality collector (issue #43 work package A, superseding
 * PR #19's request-time route). One recorded request per configured target
 * point; raw bytes are durable in the evidence ledger before any parsing,
 * and collection state is durable before any summary is returned.
 *
 * Target points arrive from configuration (collection-target revisions or a
 * jurisdiction profile); nothing here hard-codes an incident, a place, or a
 * regional AQ index.
 */

export type AirQualityTarget = Readonly<{
  targetKey: string;
  point: AirQualityPoint;
}>;

export type AirQualityCollectionLimits = Readonly<{
  maximumTargets: number;
  maximumResponseBytesPerTarget: number;
  requestTimeoutMs: number;
  maximumElapsedMs: number;
}>;

export const DEFAULT_AIR_QUALITY_LIMITS = Object.freeze({
  maximumTargets: 24,
  maximumResponseBytesPerTarget: OPEN_METEO_AQ_MAX_RESPONSE_BYTES,
  requestTimeoutMs: 9_000,
  maximumElapsedMs: 120_000,
}) satisfies AirQualityCollectionLimits;

export type AirQualityPlan = Readonly<{
  kind: "open-meteo-air-quality-plan-v1";
  planKey: string;
  scheduledFor: string;
  targets: readonly AirQualityTarget[];
}>;

export type AirQualityTargetSummary = Readonly<{
  targetKey: string;
  outcome: "complete" | "failed";
  observedAtUtc: string | null;
}>;

export type AirQualityCollectionSummary = Readonly<{
  status: "complete";
  collectionId: string;
  plan: AirQualityPlan;
  targets: readonly AirQualityTargetSummary[];
  requestCount: number;
  completeCount: number;
  failedCount: number;
  latestObservedAtUtc: string | null;
}>;

export type AirQualityReservation =
  | Readonly<{ state: "execute"; collectionId: string }>
  | Readonly<{ state: "already-complete"; summary: AirQualityCollectionSummary }>
  | Readonly<{ state: "busy" }>;

export type AirQualityFailureCode =
  | "deadline"
  | "timeout"
  | "network"
  | "upstream"
  | "response_too_large"
  | "parser"
  | "validation"
  | "database";

export interface AirQualityPersistence extends HttpEvidenceLedger {
  reserveCollection(plan: AirQualityPlan): Promise<AirQualityReservation>;
  heartbeatCollection(
    input: Readonly<{ collectionId: string; plan: AirQualityPlan }>,
  ): Promise<void>;
  persistReading(
    input: Readonly<{
      collectionId: string;
      plan: AirQualityPlan;
      target: AirQualityTarget;
      parsed: AirQualityParseResult;
    }>,
  ): Promise<AirQualityTargetSummary>;
  persistReadingFailure(
    input: Readonly<{
      collectionId: string;
      plan: AirQualityPlan;
      target: AirQualityTarget;
      code: AirQualityFailureCode;
    }>,
  ): Promise<AirQualityTargetSummary>;
  completeCollection(summary: AirQualityCollectionSummary): Promise<void>;
  failCollection(
    input: Readonly<{
      collectionId: string;
      plan: AirQualityPlan;
      code: AirQualityFailureCode;
    }>,
  ): Promise<void>;
}

export type AirQualityCollectionInput = Readonly<{
  plan: AirQualityPlan;
  persistence: AirQualityPersistence;
  fetchImpl: typeof fetch;
  signal?: AbortSignal;
  limits?: AirQualityCollectionLimits;
  clockMs?: () => number;
}>;

export class AirQualityCollectionError extends Error {
  constructor(
    readonly code: AirQualityFailureCode | "busy",
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "AirQualityCollectionError";
  }
}

export class AirQualityPersistenceError extends Error {
  constructor(
    readonly stage:
      | "reserve_collection"
      | "heartbeat_collection"
      | "persist_reading"
      | "persist_reading_failure"
      | "complete_collection"
      | "fail_collection",
    options?: ErrorOptions,
  ) {
    super(
      "Air-quality data was withheld because its collection state was not durable.",
      options,
    );
    this.name = "AirQualityPersistenceError";
  }
}

function assertServerRuntime() {
  if (typeof document !== "undefined") {
    throw new Error(
      "The air-quality collector must not run in a browser context.",
    );
  }
}

const TARGET_KEY = /^[a-z0-9]+(-[a-z0-9]+)*$/u;

function canonicalInstant(value: string, label: string) {
  const instant = new Date(value);
  if (!Number.isFinite(instant.getTime()) || instant.toISOString() !== value) {
    throw new TypeError(`The air-quality ${label} must be canonical UTC.`);
  }
  return value;
}

function validateLimits(limits: AirQualityCollectionLimits) {
  const values = [
    limits.maximumTargets,
    limits.maximumResponseBytesPerTarget,
    limits.requestTimeoutMs,
    limits.maximumElapsedMs,
  ];
  if (
    values.some((value) => !Number.isSafeInteger(value) || value <= 0) ||
    limits.maximumResponseBytesPerTarget > OPEN_METEO_AQ_MAX_RESPONSE_BYTES ||
    limits.requestTimeoutMs > limits.maximumElapsedMs
  ) {
    throw new TypeError("The air-quality limits are invalid.");
  }
  return limits;
}

function fiveMinuteSlot(scheduledFor: string) {
  const instant = new Date(scheduledFor);
  instant.setUTCSeconds(0, 0);
  instant.setUTCMinutes(instant.getUTCMinutes() - (instant.getUTCMinutes() % 5));
  return instant
    .toISOString()
    .slice(0, 16)
    .replace(/[-:T]/gu, "");
}

/**
 * Deterministic plan for a scheduled instant: a duplicate schedule fire
 * produces the same plan key, so the persistence layer can return the stored
 * summary instead of re-fetching.
 */
export function openMeteoAirQualityPlan(
  input: Readonly<{
    scheduledFor: string;
    targets: readonly AirQualityTarget[];
    limits?: AirQualityCollectionLimits;
  }>,
): AirQualityPlan {
  const limits = validateLimits(input.limits ?? DEFAULT_AIR_QUALITY_LIMITS);
  const scheduledFor = canonicalInstant(input.scheduledFor, "schedule time");
  if (
    input.targets.length === 0 ||
    input.targets.length > limits.maximumTargets
  ) {
    throw new TypeError("The air-quality target list size is invalid.");
  }
  const seen = new Set<string>();
  const targets = input.targets.map((target) => {
    if (!TARGET_KEY.test(target.targetKey) || target.targetKey.length > 128) {
      throw new TypeError("An air-quality target key is invalid.");
    }
    if (seen.has(target.targetKey)) {
      throw new TypeError("Air-quality target keys must be unique.");
    }
    seen.add(target.targetKey);
    // Validates range and canonical precision; throws on bad coordinates.
    openMeteoAirQualityUrl(target.point);
    return Object.freeze({
      targetKey: target.targetKey,
      point: Object.freeze({ ...target.point }),
    });
  });
  return Object.freeze({
    kind: "open-meteo-air-quality-plan-v1" as const,
    planKey: `open-meteo-aq:${fiveMinuteSlot(scheduledFor)}:${targets
      .map((target) => target.targetKey)
      .join(",")}`,
    scheduledFor,
    targets: Object.freeze(targets),
  });
}

const SAFE_RESPONSE_HEADERS = Object.freeze([
  "cache-control",
  "content-length",
  "content-type",
  "date",
] as const);

function requestEvidence(
  url: URL,
  requestId: string,
  issuedAt: string,
): HttpRequestEvidence {
  const headers = openMeteoAirQualityRequestHeaders(requestId);
  const values: Record<string, string> = {};
  for (const name of new Set(url.searchParams.keys())) {
    values[name] = url.searchParams.get(name) ?? "";
  }
  return Object.freeze({
    method: "GET",
    requestUrlSafe: `${url.origin}${url.pathname}`,
    requestQuerySafe: Object.freeze(values),
    requestBodyRedacted: null,
    requestHeadersSafe: Object.freeze({
      accept: headers.Accept,
      "x-request-id": headers["X-Request-Id"],
    }),
    requestMetadataSafe: Object.freeze({
      operation: "open_meteo_air_quality_current",
      scope: "configured-targets",
      issued_at: issuedAt,
    }),
  });
}

function failureCode(error: unknown): AirQualityFailureCode {
  if (error instanceof RangeError) return "response_too_large";
  if (error instanceof Error && error.name === "AbortError") return "timeout";
  if (error instanceof TypeError) return "network";
  return "upstream";
}

async function persistenceCall<T>(
  stage: ConstructorParameters<typeof AirQualityPersistenceError>[0],
  call: () => Promise<T>,
): Promise<T> {
  try {
    return await call();
  } catch (error) {
    throw new AirQualityPersistenceError(stage, { cause: error });
  }
}

function requestSignal(
  external: AbortSignal | undefined,
  timeoutMs: number,
): AbortSignal {
  const timeout = AbortSignal.timeout(timeoutMs);
  return external ? AbortSignal.any([external, timeout]) : timeout;
}

export async function collectOpenMeteoAirQuality(
  input: AirQualityCollectionInput,
): Promise<AirQualityCollectionSummary> {
  assertServerRuntime();
  const limits = validateLimits(input.limits ?? DEFAULT_AIR_QUALITY_LIMITS);
  const clockMs = input.clockMs ?? Date.now;
  const startedAt = clockMs();
  if (!Number.isFinite(startedAt)) {
    throw new TypeError("The air-quality collector clock is invalid.");
  }
  const reservation = await persistenceCall("reserve_collection", () =>
    input.persistence.reserveCollection(input.plan),
  );
  if (reservation.state === "busy") {
    throw new AirQualityCollectionError(
      "busy",
      "The air-quality collection slot is busy.",
    );
  }
  if (reservation.state === "already-complete") return reservation.summary;

  const { collectionId } = reservation;
  const deadlineMs = startedAt + limits.maximumElapsedMs;
  const targets: AirQualityTargetSummary[] = [];
  let firstFailure: AirQualityFailureCode | null = null;
  let requestNumber = 0;

  try {
    for (const target of input.plan.targets) {
      if (clockMs() >= deadlineMs) {
        firstFailure ??= "deadline";
        break;
      }
      await persistenceCall("heartbeat_collection", () =>
        input.persistence.heartbeatCollection({
          collectionId,
          plan: input.plan,
        }),
      );
      requestNumber += 1;
      try {
        const issuedAt = new Date(clockMs()).toISOString();
        const url = openMeteoAirQualityUrl(target.point);
        const requestId = `${input.plan.planKey}:${target.targetKey}`;
        const response = await recordedFetch(
          url,
          {
            method: "GET",
            headers: openMeteoAirQualityRequestHeaders(requestId),
            redirect: "manual",
            cache: "no-store",
            signal: requestSignal(
              input.signal,
              Math.min(limits.requestTimeoutMs, deadlineMs - clockMs()),
            ),
          },
          {
            fetchImpl: input.fetchImpl,
            ledger: input.persistence,
            requestEvidence: requestEvidence(url, requestId, issuedAt),
            maximumResponseBytes: limits.maximumResponseBytesPerTarget,
            safeResponseHeaderNames: SAFE_RESPONSE_HEADERS,
            responseMetadataSafe: Object.freeze({
              terminal: true,
              partial: false,
              truncated: false,
            }),
          },
        );
        if (response.status !== 200) {
          throw new AirQualityCollectionError(
            response.status === 429 ? "upstream" : "upstream",
            `Open-Meteo air quality answered HTTP ${response.status}.`,
          );
        }
        const bytes = new Uint8Array(await response.arrayBuffer());
        const parsed = parseOpenMeteoAirQuality(
          bytes,
          limits.maximumResponseBytesPerTarget,
        );
        const persisted = await persistenceCall("persist_reading", () =>
          input.persistence.persistReading({
            collectionId,
            plan: input.plan,
            target,
            parsed,
          }),
        );
        targets.push(persisted);
        if (persisted.outcome !== "complete") firstFailure ??= "parser";
      } catch (error) {
        if (error instanceof AirQualityPersistenceError) throw error;
        if (error instanceof EvidencePersistenceError) {
          throw new AirQualityPersistenceError("persist_reading", {
            cause: error,
          });
        }
        const code =
          error instanceof AirQualityCollectionError &&
          error.code !== "busy"
            ? error.code
            : failureCode(error);
        firstFailure ??= code;
        const persisted = await persistenceCall(
          "persist_reading_failure",
          () =>
            input.persistence.persistReadingFailure({
              collectionId,
              plan: input.plan,
              target,
              code,
            }),
        );
        targets.push(persisted);
      }
    }

    if (targets.length === input.plan.targets.length && firstFailure === null) {
      const observed = targets
        .map((target) => target.observedAtUtc)
        .filter((value): value is string => value !== null)
        .sort();
      const summary: AirQualityCollectionSummary = Object.freeze({
        status: "complete" as const,
        collectionId,
        plan: input.plan,
        targets: Object.freeze([...targets]),
        requestCount: requestNumber,
        completeCount: targets.length,
        failedCount: 0,
        latestObservedAtUtc: observed.at(-1) ?? null,
      });
      await persistenceCall("complete_collection", () =>
        input.persistence.completeCollection(summary),
      );
      return summary;
    }

    const code = firstFailure ?? "validation";
    await persistenceCall("fail_collection", () =>
      input.persistence.failCollection({ collectionId, plan: input.plan, code }),
    );
    throw new AirQualityCollectionError(
      code,
      "The air-quality collection did not complete for every target.",
    );
  } catch (error) {
    if (
      error instanceof AirQualityPersistenceError ||
      (error instanceof AirQualityCollectionError && error.code !== "busy")
    ) {
      throw error;
    }
    await persistenceCall("fail_collection", () =>
      input.persistence.failCollection({
        collectionId,
        plan: input.plan,
        code: "database",
      }),
    );
    throw error;
  }
}
