import {
  CredentialPathResponseError,
  CredentialPathTransportError,
  EvidencePersistenceError,
} from "../evidence/recorded-fetch.ts";
import {
  FIRMS_MAX_RESPONSE_BYTES,
  firmsAreaRequest,
  parseFirmsCsv,
  recordedFirmsAreaFetch,
  type FirmsArea,
  type FirmsAreaEvidenceLedger,
  type FirmsDetection,
  type FirmsParseResult,
  type FirmsProduct,
  type FirmsRejectedRow,
} from "./firms.ts";

export const FIRMS_SHADOW_PRODUCTS = Object.freeze([
  "MODIS_NRT",
  "VIIRS_NOAA20_NRT",
  "VIIRS_NOAA21_NRT",
  "VIIRS_SNPP_NRT",
] as const satisfies readonly FirmsProduct[]);

export type FirmsShadowLimits = Readonly<{
  maximumLatitudeSpanDegrees: number;
  maximumLongitudeSpanDegrees: number;
  maximumAreaSquareDegrees: number;
  maximumResponseBytesPerProduct: number;
  maximumTotalResponseBytes: number;
  requestTimeoutMs: number;
  maximumElapsedMs: number;
}>;

export const DEFAULT_FIRMS_SHADOW_LIMITS = Object.freeze({
  maximumLatitudeSpanDegrees: 10,
  maximumLongitudeSpanDegrees: 10,
  maximumAreaSquareDegrees: 100,
  maximumResponseBytesPerProduct: FIRMS_MAX_RESPONSE_BYTES,
  maximumTotalResponseBytes: FIRMS_MAX_RESPONSE_BYTES * 4,
  requestTimeoutMs: 15_000,
  maximumElapsedMs: 90_000,
}) satisfies FirmsShadowLimits;

export type FirmsShadowPlan = Readonly<{
  kind: "firms-shadow-plan-v1";
  planKey: string;
  scheduledFor: string;
  area: FirmsArea;
  areaToken: string;
  dateFrom: string;
  dateTo: string;
  dayCount: 1 | 2 | 3 | 4 | 5;
  dateRequestMode: "explicit-starting-on";
  products: typeof FIRMS_SHADOW_PRODUCTS;
  coverage: "requested-bbox-only";
  sensorAssessability: "unknown";
  negativeAssessmentEligible: false;
}>;

export type FirmsShadowProductSummary = Readonly<{
  product: FirmsProduct;
  outcome: "complete" | "partial" | "failed";
  returnedCount: number;
  acceptedCount: number;
  rejectedCount: number;
  newDetailCount: number;
  duplicateCount: number;
  latestObservedAt: string | null;
}>;

export type FirmsShadowSummary = Readonly<{
  status: "complete";
  collectionId: string;
  plan: FirmsShadowPlan;
  products: readonly FirmsShadowProductSummary[];
  requestCount: 4;
  returnedCount: number;
  acceptedCount: number;
  rejectedCount: 0;
  newDetailCount: number;
  duplicateCount: number;
  latestObservedAt: string | null;
  coverage: "requested-bbox-only";
  sensorAssessability: "unknown";
  negativeAssessmentEligible: false;
}>;

export type FirmsShadowReservation =
  | Readonly<{ state: "execute"; collectionId: string }>
  | Readonly<{ state: "already-complete"; summary: FirmsShadowSummary }>
  | Readonly<{ state: "busy" }>;

export type FirmsShadowFailureCode =
  | "deadline"
  | "timeout"
  | "network"
  | "upstream"
  | "response_too_large"
  | "parser"
  | "validation"
  | "database";

export interface FirmsShadowPersistence extends FirmsAreaEvidenceLedger {
  reserveCollection(plan: FirmsShadowPlan): Promise<FirmsShadowReservation>;
  heartbeatCollection(input: Readonly<{
    collectionId: string;
    plan: FirmsShadowPlan;
  }>): Promise<void>;
  persistProduct(input: Readonly<{
    collectionId: string;
    plan: FirmsShadowPlan;
    product: FirmsProduct;
    parsed: FirmsParseResult;
  }>): Promise<FirmsShadowProductSummary>;
  persistProductFailure(input: Readonly<{
    collectionId: string;
    plan: FirmsShadowPlan;
    product: FirmsProduct;
    code: FirmsShadowFailureCode;
  }>): Promise<FirmsShadowProductSummary>;
  completeCollection(summary: FirmsShadowSummary): Promise<void>;
  failCollection(input: Readonly<{
    collectionId: string;
    plan: FirmsShadowPlan;
    code: FirmsShadowFailureCode;
  }>): Promise<void>;
}

export type FirmsShadowCollectionInput = Readonly<{
  mapKey: string;
  plan: FirmsShadowPlan;
  persistence: FirmsShadowPersistence;
  fetchImpl?: typeof fetch;
  signal?: AbortSignal;
  limits?: FirmsShadowLimits;
  clockMs?: () => number;
}>;

export class FirmsShadowCollectionError extends Error {
  constructor(
    readonly code: FirmsShadowFailureCode | "busy",
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "FirmsShadowCollectionError";
  }
}

export class FirmsShadowPersistenceError extends Error {
  constructor(
    readonly stage:
      | "reserve_collection"
      | "heartbeat_collection"
      | "persist_product"
      | "persist_product_failure"
      | "complete_collection"
      | "fail_collection",
    options?: ErrorOptions,
  ) {
    super("FIRMS data was withheld because its collection state was not durable.", options);
    this.name = "FirmsShadowPersistenceError";
  }
}

const CALENDAR_DATE = /^(\d{4})-(\d{2})-(\d{2})$/u;
const MAP_KEY = /^[A-Za-z0-9._~-]{8,512}$/u;

function canonicalDate(value: string) {
  if (!CALENDAR_DATE.test(value)) return null;
  const instant = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(instant.getTime()) &&
      instant.toISOString().slice(0, 10) === value
    ? value
    : null;
}

function datePlusDays(value: string, days: number) {
  const instant = new Date(`${value}T00:00:00.000Z`);
  instant.setUTCDate(instant.getUTCDate() + days);
  return instant.toISOString().slice(0, 10);
}

function canonicalInstant(value: string, label: string) {
  const instant = new Date(value);
  if (!Number.isFinite(instant.getTime()) || instant.toISOString() !== value) {
    throw new TypeError(`The FIRMS ${label} must be canonical UTC.`);
  }
  return value;
}

function coordinate(value: number, minimum: number, maximum: number) {
  if (!Number.isFinite(value) || value < minimum || value > maximum) {
    throw new TypeError("The FIRMS shadow AOI is invalid.");
  }
  const normalized = Object.is(value, -0) ? 0 : value;
  const token = normalized.toFixed(6);
  if (Number(token) !== normalized || token === "-0.000000") {
    throw new TypeError("The FIRMS shadow AOI must be exact to six decimals.");
  }
  return Object.freeze({ token, value: normalized });
}

function validateLimits(limits: FirmsShadowLimits) {
  const values = [
    limits.maximumLatitudeSpanDegrees,
    limits.maximumLongitudeSpanDegrees,
    limits.maximumAreaSquareDegrees,
    limits.maximumResponseBytesPerProduct,
    limits.maximumTotalResponseBytes,
    limits.requestTimeoutMs,
    limits.maximumElapsedMs,
  ];
  if (
    values.some((value) => !Number.isSafeInteger(value) || value <= 0) ||
    limits.maximumResponseBytesPerProduct > FIRMS_MAX_RESPONSE_BYTES ||
    limits.maximumTotalResponseBytes <
      limits.maximumResponseBytesPerProduct * FIRMS_SHADOW_PRODUCTS.length ||
    limits.requestTimeoutMs * FIRMS_SHADOW_PRODUCTS.length >
      limits.maximumElapsedMs
  ) {
    throw new TypeError("The FIRMS shadow limits are invalid.");
  }
  return limits;
}

export function firmsShadowPlan(input: Readonly<{
  scheduledFor: string;
  area: FirmsArea;
  dateFrom: string;
  dayCount: 1 | 2 | 3 | 4 | 5;
  limits?: FirmsShadowLimits;
}>): FirmsShadowPlan {
  const limits = validateLimits(
    input.limits ?? DEFAULT_FIRMS_SHADOW_LIMITS,
  );
  const scheduledFor = canonicalInstant(input.scheduledFor, "schedule time");
  const dateFrom = canonicalDate(input.dateFrom);
  if (dateFrom === null) {
    throw new TypeError("The FIRMS shadow start date is invalid.");
  }
  if (!Number.isInteger(input.dayCount) || input.dayCount < 1 || input.dayCount > 5) {
    throw new TypeError("The FIRMS shadow day count is invalid.");
  }
  const dateTo = datePlusDays(dateFrom, input.dayCount - 1);
  if (dateTo > scheduledFor.slice(0, 10)) {
    throw new TypeError("The FIRMS shadow date range cannot extend into the future.");
  }

  const west = coordinate(input.area.west, -180, 180);
  const south = coordinate(input.area.south, -90, 90);
  const east = coordinate(input.area.east, -180, 180);
  const north = coordinate(input.area.north, -90, 90);
  const longitudeSpan = east.value - west.value;
  const latitudeSpan = north.value - south.value;
  if (
    longitudeSpan <= 0 ||
    latitudeSpan <= 0 ||
    longitudeSpan > limits.maximumLongitudeSpanDegrees ||
    latitudeSpan > limits.maximumLatitudeSpanDegrees ||
    longitudeSpan * latitudeSpan > limits.maximumAreaSquareDegrees
  ) {
    throw new TypeError("The FIRMS shadow AOI exceeds its bounded envelope.");
  }
  const areaToken = [west.token, south.token, east.token, north.token].join(",");
  const planKey = [
    "firms-shadow-v1",
    areaToken,
    dateFrom,
    String(input.dayCount),
  ].join(":");
  return Object.freeze({
    kind: "firms-shadow-plan-v1",
    planKey,
    scheduledFor,
    area: Object.freeze({
      west: west.value,
      south: south.value,
      east: east.value,
      north: north.value,
    }),
    areaToken,
    dateFrom,
    dateTo,
    dayCount: input.dayCount,
    dateRequestMode: "explicit-starting-on",
    products: FIRMS_SHADOW_PRODUCTS,
    coverage: "requested-bbox-only",
    sensorAssessability: "unknown",
    negativeAssessmentEligible: false,
  });
}

function validatePlan(plan: FirmsShadowPlan, limits: FirmsShadowLimits) {
  const rebuilt = firmsShadowPlan({
    scheduledFor: plan.scheduledFor,
    area: plan.area,
    dateFrom: plan.dateFrom,
    dayCount: plan.dayCount,
    limits,
  });
  if (
    plan.kind !== rebuilt.kind ||
    plan.planKey !== rebuilt.planKey ||
    plan.areaToken !== rebuilt.areaToken ||
    plan.dateTo !== rebuilt.dateTo ||
    plan.dateRequestMode !== rebuilt.dateRequestMode ||
    plan.coverage !== rebuilt.coverage ||
    plan.sensorAssessability !== rebuilt.sensorAssessability ||
    plan.negativeAssessmentEligible !== false ||
    plan.products !== FIRMS_SHADOW_PRODUCTS
  ) {
    throw new TypeError("The FIRMS shadow plan contract changed.");
  }
}

function withTimeout(
  fetchImpl: typeof fetch,
  outerSignal: AbortSignal | undefined,
  timeoutMs: number,
  deadlineMs: number,
  clockMs: () => number,
): typeof fetch {
  return async (input, init) => {
    const remaining = Math.floor(deadlineMs - clockMs());
    if (remaining <= 0) {
      throw new DOMException("FIRMS deadline exceeded.", "TimeoutError");
    }
    const controller = new AbortController();
    const abort = () => controller.abort(outerSignal?.reason);
    if (outerSignal?.aborted) abort();
    else outerSignal?.addEventListener("abort", abort, { once: true });
    const timer = setTimeout(
      () => controller.abort(new DOMException("FIRMS request timed out.", "TimeoutError")),
      Math.min(timeoutMs, remaining),
    );
    try {
      return await fetchImpl(input, { ...init, signal: controller.signal });
    } finally {
      clearTimeout(timer);
      outerSignal?.removeEventListener("abort", abort);
    }
  };
}

function failureCode(error: unknown): FirmsShadowFailureCode {
  if (error instanceof EvidencePersistenceError) return "database";
  if (error instanceof CredentialPathTransportError) return "network";
  if (error instanceof CredentialPathResponseError) return "upstream";
  if (error instanceof DOMException &&
    (error.name === "AbortError" || error.name === "TimeoutError")) {
    return "timeout";
  }
  return "upstream";
}

function latestInstant(
  current: string | null,
  candidate: string | null,
) {
  if (candidate === null) return current;
  if (current === null || Date.parse(candidate) > Date.parse(current)) {
    return candidate;
  }
  return current;
}

async function persistenceCall<Result>(
  stage: FirmsShadowPersistenceError["stage"],
  operation: () => Promise<Result>,
) {
  try {
    return await operation();
  } catch (error) {
    throw new FirmsShadowPersistenceError(stage, { cause: error });
  }
}

function completeSummary(
  collectionId: string,
  plan: FirmsShadowPlan,
  products: readonly FirmsShadowProductSummary[],
): FirmsShadowSummary {
  if (
    products.length !== 4 ||
    products.some((product) =>
      product.outcome !== "complete" || product.rejectedCount !== 0
    ) ||
    products.map((product) => product.product).join(",") !==
      FIRMS_SHADOW_PRODUCTS.join(",")
  ) {
    throw new TypeError("A FIRMS completion requires four schema-clean products.");
  }
  return Object.freeze({
    status: "complete",
    collectionId,
    plan,
    products: Object.freeze([...products]),
    requestCount: 4,
    returnedCount: products.reduce((sum, value) => sum + value.returnedCount, 0),
    acceptedCount: products.reduce((sum, value) => sum + value.acceptedCount, 0),
    rejectedCount: 0,
    newDetailCount: products.reduce((sum, value) => sum + value.newDetailCount, 0),
    duplicateCount: products.reduce((sum, value) => sum + value.duplicateCount, 0),
    latestObservedAt: products.reduce<string | null>(
      (latest, value) => latestInstant(latest, value.latestObservedAt),
      null,
    ),
    coverage: "requested-bbox-only",
    sensorAssessability: "unknown",
    negativeAssessmentEligible: false,
  });
}

const SAFE_RESPONSE_HEADERS = Object.freeze([
  "content-length",
  "content-type",
  "date",
  "etag",
  "last-modified",
  "retry-after",
  "x-ratelimit-limit",
  "x-ratelimit-remaining",
  "x-ratelimit-reset",
  "x-request-id",
]);

/**
 * Collects one exact four-product, explicit-date FIRMS Area request set.
 * A successful result proves only that the four bounded API responses were
 * durably captured and parsed. It does not assess sensor coverage or absence.
 */
export async function collectFirmsShadow(
  input: FirmsShadowCollectionInput,
): Promise<FirmsShadowSummary> {
  const limits = validateLimits(
    input.limits ?? DEFAULT_FIRMS_SHADOW_LIMITS,
  );
  validatePlan(input.plan, limits);
  // Validate the path credential before reserving a job. It is never copied
  // into a durable value, diagnostic, thrown message, or returned summary.
  if (!MAP_KEY.test(input.mapKey)) {
    throw new TypeError("The FIRMS collector credential is invalid.");
  }
  const clockMs = input.clockMs ?? Date.now;
  const startedAt = clockMs();
  if (!Number.isFinite(startedAt)) {
    throw new TypeError("The FIRMS collector clock is invalid.");
  }
  const reservation = await persistenceCall(
    "reserve_collection",
    () => input.persistence.reserveCollection(input.plan),
  );
  if (reservation.state === "busy") {
    throw new FirmsShadowCollectionError("busy", "The FIRMS shadow slot is busy.");
  }
  if (reservation.state === "already-complete") return reservation.summary;

  const { collectionId } = reservation;
  const deadlineMs = startedAt + limits.maximumElapsedMs;
  const products: FirmsShadowProductSummary[] = [];
  let firstFailure: FirmsShadowFailureCode | null = null;

  try {
    for (const product of FIRMS_SHADOW_PRODUCTS) {
      if (clockMs() >= deadlineMs) {
        firstFailure ??= "deadline";
        break;
      }
      await persistenceCall(
        "heartbeat_collection",
        () => input.persistence.heartbeatCollection({
          collectionId,
          plan: input.plan,
        }),
      );

      try {
        const issuedAt = new Date(clockMs()).toISOString();
        const request = firmsAreaRequest({
          mapKey: input.mapKey,
          product,
          area: input.plan.area,
          date: {
            kind: "starting-on",
            date: input.plan.dateFrom,
            days: input.plan.dayCount,
          },
          issuedAt,
        });
        const response = await recordedFirmsAreaFetch(request, {
          fetchImpl: withTimeout(
            input.fetchImpl ?? fetch,
            input.signal,
            limits.requestTimeoutMs,
            deadlineMs,
            clockMs,
          ),
          ledger: input.persistence,
          maximumResponseBytes: limits.maximumResponseBytesPerProduct,
          safeResponseHeaderNames: SAFE_RESPONSE_HEADERS,
          responseMetadataSafe: Object.freeze({
            partial: false,
            terminal: true,
            truncated: false,
          }),
        });
        const parsed = parseFirmsCsv(
          response,
          limits.maximumResponseBytesPerProduct,
        );
        const persisted = await persistenceCall(
          "persist_product",
          () => input.persistence.persistProduct({
            collectionId,
            plan: input.plan,
            product,
            parsed,
          }),
        );
        products.push(persisted);
        if (persisted.outcome !== "complete") firstFailure ??= "parser";
      } catch (error) {
        if (error instanceof FirmsShadowPersistenceError) throw error;
        const code = failureCode(error);
        firstFailure ??= code;
        const persisted = await persistenceCall(
          "persist_product_failure",
          () => input.persistence.persistProductFailure({
            collectionId,
            plan: input.plan,
            product,
            code,
          }),
        );
        products.push(persisted);
      }
    }

    if (products.length === 4 && firstFailure === null) {
      const summary = completeSummary(collectionId, input.plan, products);
      await persistenceCall(
        "complete_collection",
        () => input.persistence.completeCollection(summary),
      );
      return summary;
    }

    const code = firstFailure ?? "deadline";
    await persistenceCall(
      "fail_collection",
      () => input.persistence.failCollection({
        collectionId,
        plan: input.plan,
        code,
      }),
    );
    throw new FirmsShadowCollectionError(
      code,
      "The FIRMS shadow request set did not complete.",
    );
  } catch (error) {
    if (
      error instanceof FirmsShadowCollectionError &&
      error.code !== "busy"
    ) {
      throw error;
    }
    try {
      await input.persistence.failCollection({
        collectionId,
        plan: input.plan,
        code: error instanceof FirmsShadowPersistenceError
          ? "database"
          : failureCode(error),
      });
    } catch (failureError) {
      throw new FirmsShadowPersistenceError("fail_collection", {
        cause: failureError,
      });
    }
    throw error;
  }
}

export type FirmsShadowSerializedDetection = Readonly<{
  item_index: number;
  row_number: number;
  product_key: FirmsProduct;
  latitude: number;
  longitude: number;
  acquired_at: string;
  acquisition_date_raw: string;
  acquisition_time_raw: string;
  satellite: string;
  source_satellite_raw: string;
  instrument: "VIIRS" | "MODIS";
  source_dataset_version: string;
  scan_km: number;
  track_km: number;
  frp_mw: number;
  day_night: "day" | "night";
  confidence_class: "low" | "nominal" | "high" | null;
  confidence_percent: number | null;
  brightness_primary_k: number;
  brightness_secondary_k: number;
  brightness_contract: "viirs_bright_ti4_ti5" | "modis_brightness_t31";
  source_row_contract: "firms-area-csv-viirs-v1" | "firms-area-csv-modis-v1";
  source_revision_public_id: string;
  observation_public_id: string;
  detail_public_id: string;
}>;

export function serializeFirmsDetection(
  detection: FirmsDetection,
  identifiers: Readonly<{
    sourceRevisionPublicId: string;
    observationPublicId: string;
    detailPublicId: string;
  }>,
): FirmsShadowSerializedDetection {
  const common = {
    item_index: detection.itemIndex,
    row_number: detection.rowNumber,
    product_key: detection.product,
    latitude: detection.latitude,
    longitude: detection.longitude,
    acquired_at: detection.observedAt,
    acquisition_date_raw: detection.acquisitionDateRaw,
    acquisition_time_raw: detection.acquisitionTimeRaw,
    satellite: detection.satellite,
    source_satellite_raw: detection.satelliteRaw,
    instrument: detection.instrument,
    source_dataset_version: detection.version,
    scan_km: detection.scanKm,
    track_km: detection.trackKm,
    frp_mw: detection.frpMw,
    day_night: detection.dayNight,
    source_revision_public_id: identifiers.sourceRevisionPublicId,
    observation_public_id: identifiers.observationPublicId,
    detail_public_id: identifiers.detailPublicId,
  } as const;
  if (detection.product === "MODIS_NRT") {
    return Object.freeze({
      ...common,
      confidence_class: null,
      confidence_percent: detection.confidencePercent,
      brightness_primary_k: detection.brightnessKelvin,
      brightness_secondary_k: detection.brightT31Kelvin,
      brightness_contract: "modis_brightness_t31",
      source_row_contract: "firms-area-csv-modis-v1",
    });
  }
  return Object.freeze({
    ...common,
    confidence_class: detection.confidenceCode,
    confidence_percent: null,
    brightness_primary_k: detection.brightTi4Kelvin,
    brightness_secondary_k: detection.brightTi5Kelvin,
    brightness_contract: "viirs_bright_ti4_ti5",
    source_row_contract: "firms-area-csv-viirs-v1",
  });
}

export type FirmsShadowSerializedRejection = Readonly<{
  item_index: number;
  row_number: number;
  reasons: readonly string[];
}>;

export function serializeFirmsRejection(
  rejection: FirmsRejectedRow,
): FirmsShadowSerializedRejection {
  return Object.freeze({
    item_index: rejection.itemIndex,
    row_number: rejection.rowNumber,
    reasons: Object.freeze([...rejection.reasons]),
  });
}
