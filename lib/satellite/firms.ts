import {
  contentSha256,
  recordedFetch,
  requestEvidenceFingerprintSha256,
  type HttpExchangeReference,
  type HttpEvidenceLedger,
  type HttpRequestEvidence,
  type HttpResponseEvidence,
  type HttpResponseOccurrence,
  type RecordedFetchOptions,
} from "../evidence/recorded-fetch.ts";

export const FIRMS_AREA_ENDPOINT =
  "https://firms.modaps.eosdis.nasa.gov/api/area/csv";
export const FIRMS_MAX_RESPONSE_BYTES = 2_000_000;

export const FIRMS_PRODUCTS = [
  "VIIRS_NOAA20_NRT",
  "VIIRS_NOAA21_NRT",
  "VIIRS_SNPP_NRT",
  "MODIS_NRT",
] as const;

export type FirmsProduct = (typeof FIRMS_PRODUCTS)[number];
export type FirmsDayRange = 1 | 2 | 3 | 4 | 5;

export type FirmsArea = Readonly<{
  west: number;
  south: number;
  east: number;
  north: number;
}>;

export type FirmsDateSelection =
  | Readonly<{ kind: "rolling"; days: FirmsDayRange }>
  | Readonly<{
      kind: "starting-on";
      date: string;
      days: FirmsDayRange;
    }>;

export const FIRMS_AREA_PATH_REDACTION = Object.freeze({
  kind: "firms-area-v1" as const,
});

export type FirmsAreaRequestInit = Readonly<{
  method: "GET";
  redirect: "manual";
  headers: Readonly<{ accept: "text/csv" }>;
}>;

const FIRMS_AREA_REQUEST_INIT = Object.freeze({
  method: "GET" as const,
  redirect: "manual" as const,
  headers: Object.freeze({ accept: "text/csv" as const }),
}) satisfies FirmsAreaRequestInit;

export type FirmsAreaRequestDescriptor = Readonly<{
  url: string;
  requestInit: FirmsAreaRequestInit;
  credentialPathRedaction: typeof FIRMS_AREA_PATH_REDACTION;
  requestUrlSafe: typeof FIRMS_AREA_ENDPOINT;
  requestQuerySafe: Readonly<{
    area: string;
    date: string;
    product: FirmsProduct;
  }>;
}>;

const FIRMS_AREA_PARSE_CONTEXT_BRAND = Symbol("firms-area-parse-context-v1");
const FIRMS_AREA_PARSE_CONTEXTS = new WeakSet<object>();
const FIRMS_AREA_REQUEST_CONTEXTS = new WeakMap<
  FirmsAreaRequestDescriptor,
  FirmsAreaParseContext
>();
const FIRMS_AREA_RESPONSE_BRAND = Symbol("firms-area-response-v1");

type FirmsAreaParseContextBrand = Readonly<{
  [FIRMS_AREA_PARSE_CONTEXT_BRAND]: true;
}>;

type FirmsAreaParseContext = Readonly<{
  kind: "firms-area-parse-context-v1";
  product: FirmsProduct;
  area: FirmsArea;
  issuedAt: string;
  date:
    | Readonly<{ kind: "rolling"; dayCount: FirmsDayRange }>
    | Readonly<{
        kind: "starting-on";
        dateFrom: string;
        dayCount: FirmsDayRange;
      }>;
}> & FirmsAreaParseContextBrand;

type FirmsAreaResponseState = Readonly<{
  context: FirmsAreaParseContext;
  retrievedAt: string;
  body: Uint8Array;
}>;

type FirmsAreaResponseBrand = Readonly<{
  [FIRMS_AREA_RESPONSE_BRAND]: true;
}>;

/**
 * Credential-free response capability produced only by the live recorded
 * fetch boundary or by validation of one joined durable exchange record.
 * Request scope and response bytes are held together in private module state.
 */
export type FirmsAreaResponse = Readonly<{
  kind: "firms-area-response-v1";
  product: FirmsProduct;
  issuedAt: string;
  retrievedAt: string;
}> & FirmsAreaResponseBrand;

const FIRMS_AREA_RESPONSES = new WeakMap<
  FirmsAreaResponse,
  FirmsAreaResponseState
>();

export type FirmsAreaFetchOptions = Readonly<
  Omit<
    RecordedFetchOptions,
    | "credentialPathRedaction"
    | "ledger"
    | "maximumResponseBytes"
    | "requestEvidence"
  > & {
    ledger: FirmsAreaEvidenceLedger;
    maximumResponseBytes?: number;
  }
>;

export interface FirmsAreaEvidenceLedger extends HttpEvidenceLedger {
  finishResponse(
    reference: HttpExchangeReference,
    response: HttpResponseEvidence,
  ): Promise<HttpResponseOccurrence>;
}

/**
 * One database-joined immutable exchange/raw-object/blob record. The loader
 * must obtain these fields from one trusted query; this type is not proof of
 * database provenance by itself.
 */
export type FirmsAreaTrustedJoinedRecord = Readonly<{
  reference: HttpExchangeReference;
  requestFingerprintSha256: string;
  request: HttpRequestEvidence;
  response: HttpResponseEvidence;
  exchangeResponseRawObjectId: string;
  responseOccurrence: HttpResponseOccurrence;
}>;

const MAP_KEY = /^[A-Za-z0-9._~-]{8,512}$/u;
const CALENDAR_DATE = /^(\d{4})-(\d{2})-(\d{2})$/u;
const DECIMAL_COORDINATE = /^-?(?:0|[1-9]\d*)(?:\.\d+)?$/u;
const CANONICAL_AREA =
  /^-?(?:0|[1-9]\d*)\.\d{6},-?(?:0|[1-9]\d*)\.\d{6},-?(?:0|[1-9]\d*)\.\d{6},-?(?:0|[1-9]\d*)\.\d{6}$/u;
const SOURCE_DECIMAL = /^-?(?:\d+(?:\.\d+)?|\.\d+)$/u;
const SOURCE_UNSIGNED_INTEGER = /^(?:0|[1-9]\d*)$/u;
const SOURCE_VERSION = /^[A-Za-z0-9][A-Za-z0-9._+-]{0,63}$/u;
const MAX_SOURCE_NUMBER_LENGTH = 64;

function canonicalCalendarDate(value: string) {
  const match = CALENDAR_DATE.exec(value);
  if (!match) return null;
  const instant = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(instant.getTime()) &&
      instant.toISOString().slice(0, 10) === value
    ? value
    : null;
}

function canonicalUtcInstant(value: string, label: "issuance" | "retrieval") {
  if (typeof value !== "string") {
    throw new TypeError(`The FIRMS ${label} time must be canonical UTC.`);
  }
  const instant = new Date(value);
  if (
    !Number.isFinite(instant.getTime()) ||
    instant.toISOString() !== value
  ) {
    throw new TypeError(`The FIRMS ${label} time must be canonical UTC.`);
  }
  return instant;
}

function canonicalCoordinate(value: number, minimum: number, maximum: number) {
  if (!Number.isFinite(value) || value < minimum || value > maximum) {
    throw new TypeError("FIRMS area coordinates are invalid.");
  }
  const normalized = Object.is(value, -0) ? 0 : value;
  const result = normalized.toFixed(6);
  if (
    !DECIMAL_COORDINATE.test(result) ||
    Number(result) !== normalized
  ) {
    throw new TypeError(
      "FIRMS area coordinates must be exact to at most six decimal places.",
    );
  }
  return result;
}

function brandedParseContext(
  product: FirmsProduct,
  area: FirmsArea,
  issuedAt: string,
  date: FirmsAreaParseContext["date"],
): FirmsAreaParseContext {
  const context = {
    kind: "firms-area-parse-context-v1" as const,
    product,
    area: Object.freeze({ ...area }),
    issuedAt,
    date: Object.freeze({ ...date }),
  } as FirmsAreaParseContext;
  Object.defineProperty(context, FIRMS_AREA_PARSE_CONTEXT_BRAND, {
    configurable: false,
    enumerable: false,
    value: true,
    writable: false,
  });
  FIRMS_AREA_PARSE_CONTEXTS.add(context);
  return Object.freeze(context);
}

function validDayRange(value: FirmsDayRange) {
  return Number.isInteger(value) && value >= 1 && value <= 5;
}

/**
 * Builds one Area API request while keeping the path credential outside the
 * durable request envelope. The returned logical fields are sufficient to
 * reconstruct the product, AOI, and date selection without retaining a key.
 */
export function firmsAreaRequest(input: Readonly<{
  mapKey: string;
  product: FirmsProduct;
  area: FirmsArea;
  date: FirmsDateSelection;
  issuedAt: string;
}>): FirmsAreaRequestDescriptor {
  if (!MAP_KEY.test(input.mapKey)) {
    throw new TypeError("The FIRMS MAP key is invalid.");
  }
  if (!FIRMS_PRODUCTS.includes(input.product)) {
    throw new TypeError("The FIRMS product is invalid.");
  }
  if (!validDayRange(input.date.days)) {
    throw new TypeError("The FIRMS day range is invalid.");
  }
  const issuedAt = canonicalUtcInstant(input.issuedAt, "issuance").toISOString();

  const west = canonicalCoordinate(input.area.west, -180, 180);
  const south = canonicalCoordinate(input.area.south, -90, 90);
  const east = canonicalCoordinate(input.area.east, -180, 180);
  const north = canonicalCoordinate(input.area.north, -90, 90);
  const canonicalArea = Object.freeze({
    west: Number(west),
    south: Number(south),
    east: Number(east),
    north: Number(north),
  });
  if (
    canonicalArea.west >= canonicalArea.east ||
    canonicalArea.south >= canonicalArea.north
  ) {
    throw new TypeError("The FIRMS area bounds must be ordered.");
  }
  const area = `${west},${south},${east},${north}`;

  let dateSafe: string;
  let datePath: string;
  let parseDate: FirmsAreaParseContext["date"];
  if (input.date.kind === "rolling") {
    dateSafe = `rolling:${input.date.days}`;
    datePath = String(input.date.days);
    parseDate = Object.freeze({
      kind: "rolling",
      dayCount: input.date.days,
    });
  } else {
    const date = canonicalCalendarDate(input.date.date);
    if (date === null) throw new TypeError("The FIRMS request date is invalid.");
    dateSafe = `${date}/${input.date.days}`;
    datePath = `${input.date.days}/${date}`;
    parseDate = Object.freeze({
      kind: "starting-on",
      dateFrom: date,
      dayCount: input.date.days,
    });
  }

  const requestQuerySafe = Object.freeze({
    area,
    date: dateSafe,
    product: input.product,
  });
  const descriptor = Object.freeze({
    url: `${FIRMS_AREA_ENDPOINT}/${input.mapKey}/${input.product}/${area}/${datePath}`,
    requestInit: FIRMS_AREA_REQUEST_INIT,
    credentialPathRedaction: FIRMS_AREA_PATH_REDACTION,
    requestUrlSafe: FIRMS_AREA_ENDPOINT,
    requestQuerySafe,
  });
  FIRMS_AREA_REQUEST_CONTEXTS.set(
    descriptor,
    brandedParseContext(input.product, canonicalArea, issuedAt, parseDate),
  );
  return descriptor;
}

/** Complete credential-free evidence envelope accepted by recordedFetch. */
export function firmsAreaRequestEvidence(
  request: FirmsAreaRequestDescriptor,
): HttpRequestEvidence {
  const context = FIRMS_AREA_REQUEST_CONTEXTS.get(request);
  if (context === undefined) {
    throw new TypeError(
      "FIRMS request evidence requires an exact firmsAreaRequest descriptor.",
    );
  }
  return Object.freeze({
    method: "GET",
    requestUrlSafe: request.requestUrlSafe,
    requestQuerySafe: request.requestQuerySafe,
    requestBodyRedacted: null,
    requestHeadersSafe: request.requestInit.headers,
    requestMetadataSafe: Object.freeze({
      operation: "firms-area-csv",
      product: request.requestQuerySafe.product,
      scope: "geographic-area",
      issued_at: context.issuedAt,
    }),
  });
}

function canonicalAreaFromEvidence(value: unknown): FirmsArea {
  if (typeof value !== "string" || !CANONICAL_AREA.test(value)) {
    throw new TypeError("The recorded FIRMS area is not canonical.");
  }
  const parts = value.split(",");
  if (
    parts.length !== 4 ||
    parts.some(
      (part) => part === "-0.000000" || Number(part).toFixed(6) !== part,
    )
  ) {
    throw new TypeError("The recorded FIRMS area is not canonical.");
  }
  const [west, south, east, north] = parts.map(Number);
  if (
    west === undefined ||
    south === undefined ||
    east === undefined ||
    north === undefined ||
    west < -180 ||
    west > 180 ||
    east < -180 ||
    east > 180 ||
    south < -90 ||
    south > 90 ||
    north < -90 ||
    north > 90 ||
    west >= east ||
    south >= north
  ) {
    throw new TypeError("The recorded FIRMS area is invalid.");
  }
  return Object.freeze({ west, south, east, north });
}

function contextFromRecordedEvidence(
  evidence: HttpRequestEvidence,
): FirmsAreaParseContext {
  const queryKeys = Object.keys(evidence.requestQuerySafe).sort().join(",");
  const headerKeys = Object.keys(evidence.requestHeadersSafe).sort().join(",");
  const metadataKeys = Object.keys(evidence.requestMetadataSafe).sort().join(",");
  const product = evidence.requestQuerySafe.product;
  const issuedAt = evidence.requestMetadataSafe.issued_at;
  if (
    evidence.method !== "GET" ||
    evidence.requestUrlSafe !== FIRMS_AREA_ENDPOINT ||
    evidence.requestBodyRedacted !== null ||
    queryKeys !== "area,date,product" ||
    headerKeys !== "accept" ||
    evidence.requestHeadersSafe.accept !== "text/csv" ||
    metadataKeys !== "issued_at,operation,product,scope" ||
    evidence.requestMetadataSafe.operation !== "firms-area-csv" ||
    evidence.requestMetadataSafe.product !== product ||
    evidence.requestMetadataSafe.scope !== "geographic-area" ||
    typeof product !== "string" ||
    !FIRMS_PRODUCTS.includes(product as FirmsProduct) ||
    typeof issuedAt !== "string"
  ) {
    throw new TypeError("The recorded FIRMS request evidence is invalid.");
  }

  const area = canonicalAreaFromEvidence(evidence.requestQuerySafe.area);
  const canonicalIssuedAt = canonicalUtcInstant(issuedAt, "issuance").toISOString();
  const date = evidence.requestQuerySafe.date;
  if (typeof date !== "string") {
    throw new TypeError("The recorded FIRMS date selection is invalid.");
  }
  const rolling = /^rolling:([1-5])$/u.exec(date);
  if (rolling !== null) {
    return brandedParseContext(
      product as FirmsProduct,
      area,
      canonicalIssuedAt,
      Object.freeze({
        kind: "rolling" as const,
        dayCount: Number(rolling[1]) as FirmsDayRange,
      }),
    );
  }
  const historical = /^(\d{4}-\d{2}-\d{2})\/([1-5])$/u.exec(date);
  const dateFrom = historical?.[1];
  if (dateFrom === undefined || canonicalCalendarDate(dateFrom) === null) {
    throw new TypeError("The recorded FIRMS date selection is invalid.");
  }
  return brandedParseContext(
    product as FirmsProduct,
    area,
    canonicalIssuedAt,
    Object.freeze({
      kind: "starting-on" as const,
      dateFrom,
      dayCount: Number(historical?.[2]) as FirmsDayRange,
    }),
  );
}

function boundFirmsAreaResponse(
  context: FirmsAreaParseContext,
  retrievedAtInput: string,
  bodyInput: Uint8Array,
): FirmsAreaResponse {
  const retrievedAt = canonicalUtcInstant(
    retrievedAtInput,
    "retrieval",
  ).toISOString();
  const envelope = {
    kind: "firms-area-response-v1" as const,
    product: context.product,
    issuedAt: context.issuedAt,
    retrievedAt,
  } as FirmsAreaResponse;
  Object.defineProperty(envelope, FIRMS_AREA_RESPONSE_BRAND, {
    configurable: false,
    enumerable: false,
    value: true,
    writable: false,
  });
  FIRMS_AREA_RESPONSES.set(envelope, Object.freeze({
    context,
    retrievedAt,
    body: new Uint8Array(bodyInput),
  }));
  return Object.freeze(envelope);
}

async function validateResponseOccurrence(
  reference: HttpExchangeReference,
  occurrence: HttpResponseOccurrence,
  body: Uint8Array,
  exchangeResponseRawObjectId?: string,
) {
  if (
    !/^[1-9]\d*$/u.test(reference.exchangeId) ||
    !/^[1-9]\d*$/u.test(reference.runId) ||
    !/^[1-9]\d*$/u.test(occurrence.rawObjectId) ||
    occurrence.httpExchangeId !== reference.exchangeId ||
    occurrence.runId !== reference.runId ||
    !/^[0-9a-f]{64}$/u.test(occurrence.contentSha256) ||
    (exchangeResponseRawObjectId !== undefined &&
      exchangeResponseRawObjectId !== occurrence.rawObjectId)
  ) {
    throw new TypeError(
      "The FIRMS response occurrence does not match its joined exchange.",
    );
  }
  canonicalUtcInstant(occurrence.retrievedAt, "retrieval");
  if (await contentSha256(body) !== occurrence.contentSha256) {
    throw new TypeError(
      "The FIRMS response bytes do not match their durable occurrence.",
    );
  }
}

/**
 * Performs the credential-path request and returns only a response capability
 * bound to the exact descriptor that was durably issued.
 */
export async function recordedFirmsAreaFetch(
  request: FirmsAreaRequestDescriptor,
  options: FirmsAreaFetchOptions,
): Promise<FirmsAreaResponse> {
  const context = FIRMS_AREA_REQUEST_CONTEXTS.get(request);
  if (context === undefined) {
    throw new TypeError(
      "FIRMS fetch requires an exact firmsAreaRequest descriptor.",
    );
  }
  const maximumResponseBytes =
    options.maximumResponseBytes ?? FIRMS_MAX_RESPONSE_BYTES;
  if (
    !Number.isSafeInteger(maximumResponseBytes) ||
    maximumResponseBytes < 0 ||
    maximumResponseBytes > FIRMS_MAX_RESPONSE_BYTES
  ) {
    throw new TypeError("The FIRMS response limit is invalid.");
  }
  let issuedReference: HttpExchangeReference | undefined;
  let responseOccurrence: HttpResponseOccurrence | undefined;
  const ledger: HttpEvidenceLedger = {
    issue: async (evidence) => {
      const reference = await options.ledger.issue(evidence);
      issuedReference = reference;
      return reference;
    },
    finishResponse: async (reference, evidence) => {
      const occurrence = await options.ledger.finishResponse(reference, evidence);
      responseOccurrence = occurrence;
      return occurrence;
    },
    finishTransportError: (reference, error) =>
      options.ledger.finishTransportError(reference, error),
  };
  const response = await recordedFetch(request.url, request.requestInit, {
    ...options,
    ledger,
    requestEvidence: firmsAreaRequestEvidence(request),
    credentialPathRedaction: request.credentialPathRedaction,
    maximumResponseBytes,
  });
  if (response.status !== 200) {
    throw new Error("The FIRMS Area API returned a non-success response.");
  }
  const body = new Uint8Array(await response.arrayBuffer());
  if (issuedReference === undefined || responseOccurrence === undefined) {
    throw new TypeError(
      "The FIRMS evidence ledger did not return a durable response occurrence.",
    );
  }
  await validateResponseOccurrence(issuedReference, responseOccurrence, body);
  return boundFirmsAreaResponse(
    context,
    responseOccurrence.retrievedAt,
    body,
  );
}

/**
 * Rehydrates a response capability from one trusted database join. This checks
 * the schema's exact exchange/raw-object/content invariants, but the caller is
 * responsible for obtaining the record from the immutable persistence layer.
 */
export async function firmsAreaResponseFromTrustedJoinedRecord(
  exchange: FirmsAreaTrustedJoinedRecord,
): Promise<FirmsAreaResponse> {
  if (
    exchange === null ||
    typeof exchange !== "object" ||
    exchange.reference === null ||
    typeof exchange.reference !== "object" ||
    typeof exchange.reference.exchangeId !== "string" ||
    exchange.reference.exchangeId.length === 0 ||
    typeof exchange.reference.runId !== "string" ||
    exchange.reference.runId.length === 0 ||
    !/^[0-9a-f]{64}$/u.test(exchange.requestFingerprintSha256) ||
    typeof exchange.exchangeResponseRawObjectId !== "string" ||
    exchange.responseOccurrence === null ||
    typeof exchange.responseOccurrence !== "object" ||
    exchange.response === null ||
    typeof exchange.response !== "object" ||
    exchange.response.status !== 200 ||
    !(exchange.response.body instanceof Uint8Array)
  ) {
    throw new TypeError("The recorded FIRMS exchange is invalid.");
  }
  const context = contextFromRecordedEvidence(exchange.request);
  const fingerprint = await requestEvidenceFingerprintSha256(exchange.request);
  if (fingerprint !== exchange.requestFingerprintSha256) {
    throw new TypeError(
      "The recorded FIRMS request fingerprint does not match its safe evidence.",
    );
  }
  await validateResponseOccurrence(
    exchange.reference,
    exchange.responseOccurrence,
    exchange.response.body,
    exchange.exchangeResponseRawObjectId,
  );
  return boundFirmsAreaResponse(
    context,
    exchange.responseOccurrence.retrievedAt,
    exchange.response.body,
  );
}

const VIIRS_HEADERS = Object.freeze([
  "latitude",
  "longitude",
  "bright_ti4",
  "scan",
  "track",
  "acq_date",
  "acq_time",
  "satellite",
  "instrument",
  "confidence",
  "version",
  "bright_ti5",
  "frp",
  "daynight",
]);

const MODIS_HEADERS = Object.freeze([
  "latitude",
  "longitude",
  "brightness",
  "scan",
  "track",
  "acq_date",
  "acq_time",
  "satellite",
  "instrument",
  "confidence",
  "version",
  "bright_t31",
  "frp",
  "daynight",
]);

type ViirsProduct = Exclude<FirmsProduct, "MODIS_NRT">;
type ViirsSatellite = "Suomi-NPP" | "NOAA-20" | "NOAA-21";
type ModisSatellite = "Aqua" | "Terra";

type FirmsDetectionBase = Readonly<{
  itemIndex: number;
  rowNumber: number;
  product: FirmsProduct;
  latitude: number;
  longitude: number;
  observedAt: string;
  acquisitionDateRaw: string;
  acquisitionTimeRaw: string;
  satelliteRaw: string;
  version: string;
  scanKm: number;
  trackKm: number;
  frpMw: number;
  dayNight: "day" | "night";
  confidenceRaw: string;
}>;

export type FirmsViirsDetection = FirmsDetectionBase &
  Readonly<{
    product: ViirsProduct;
    satellite: ViirsSatellite;
    instrument: "VIIRS";
    confidenceKind: "category";
    confidenceCode: "low" | "nominal" | "high";
    confidencePercent: null;
    brightTi4Kelvin: number;
    brightTi5Kelvin: number;
  }>;

export type FirmsModisDetection = FirmsDetectionBase &
  Readonly<{
    product: "MODIS_NRT";
    satellite: ModisSatellite;
    instrument: "MODIS";
    confidenceKind: "percent";
    confidenceCode: null;
    confidencePercent: number;
    brightnessKelvin: number;
    brightT31Kelvin: number;
  }>;

export type FirmsDetection = FirmsViirsDetection | FirmsModisDetection;

export type FirmsRowRejectionCode =
  | "column-count-mismatch"
  | "invalid-coordinate"
  | "outside-request-area"
  | "invalid-acquisition-time"
  | "outside-request-date-range"
  | "satellite-mismatch"
  | "instrument-mismatch"
  | "invalid-confidence"
  | "invalid-version"
  | "invalid-measurement"
  | "invalid-day-night";

export type FirmsRejectedRow = Readonly<{
  itemIndex: number;
  rowNumber: number;
  reasons: readonly FirmsRowRejectionCode[];
}>;

export type FirmsParseErrorCode =
  | "response-too-large"
  | "invalid-encoding"
  | "invalid-csv"
  | "invalid-header";

export type FirmsParseResult = Readonly<{
  product: FirmsProduct;
  status: "ok" | "partial" | "error";
  returnedRows: number;
  detections: readonly FirmsDetection[];
  rejectedRows: readonly FirmsRejectedRow[];
  emptyPayload: boolean;
  errorCode: FirmsParseErrorCode | null;
}>;

type CsvParseResult =
  | Readonly<{ ok: true; rows: readonly (readonly string[])[] }>
  | Readonly<{ ok: false }>;

function parseCsv(text: string): CsvParseResult {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  let quoteClosed = false;

  const commitRow = () => {
    row.push(field);
    if (!(row.length === 1 && row[0]?.trim() === "")) rows.push(row);
    row = [];
    field = "";
    quoteClosed = false;
  };

  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (quoted) {
      if (character === '"') {
        if (text[index + 1] === '"') {
          field += '"';
          index += 1;
        } else {
          quoted = false;
          quoteClosed = true;
        }
      } else {
        field += character;
      }
      continue;
    }

    if (quoteClosed && character !== "," && character !== "\r" && character !== "\n") {
      return Object.freeze({ ok: false });
    }
    if (character === '"') {
      if (field !== "") return Object.freeze({ ok: false });
      quoted = true;
    } else if (character === ",") {
      row.push(field);
      field = "";
      quoteClosed = false;
    } else if (character === "\n" || character === "\r") {
      if (character === "\r" && text[index + 1] === "\n") index += 1;
      commitRow();
    } else {
      field += character;
    }
  }
  if (quoted) return Object.freeze({ ok: false });
  if (field !== "" || row.length > 0 || quoteClosed) commitRow();
  return Object.freeze({ ok: true, rows });
}

function errorResult(product: FirmsProduct, errorCode: FirmsParseErrorCode) {
  return Object.freeze({
    product,
    status: "error" as const,
    returnedRows: 0,
    detections: Object.freeze([]),
    rejectedRows: Object.freeze([]),
    emptyPayload: false,
    errorCode,
  });
}

function exactHeaderIndex(product: FirmsProduct, row: readonly string[]) {
  const expected = product === "MODIS_NRT" ? MODIS_HEADERS : VIIRS_HEADERS;
  const headers = row.map((value) => value.trim().toLowerCase());
  if (
    headers.length !== expected.length ||
    new Set(headers).size !== headers.length ||
    expected.some((header) => !headers.includes(header))
  ) {
    return null;
  }
  return new Map(headers.map((header, index) => [header, index]));
}

function finiteNumber(value: string) {
  const source = value.trim();
  if (
    source.length === 0 ||
    source.length > MAX_SOURCE_NUMBER_LENGTH ||
    !SOURCE_DECIMAL.test(source)
  ) {
    return null;
  }
  const result = Number(source);
  return Number.isFinite(result) ? result : null;
}

function positiveNumber(value: string) {
  const result = finiteNumber(value);
  return result !== null && result > 0 ? result : null;
}

function nonnegativeNumber(value: string) {
  const result = finiteNumber(value);
  return result !== null && result >= 0 ? result : null;
}

function acquisitionInstant(dateRaw: string, timeRaw: string) {
  const date = canonicalCalendarDate(dateRaw);
  const time = timeRaw.trim();
  if (date === null || !/^\d{1,4}$/u.test(time)) return null;
  const digits = time.padStart(4, "0");
  const hour = Number(digits.slice(0, 2));
  const minute = Number(digits.slice(2));
  if (hour > 23 || minute > 59) return null;
  return new Date(
    `${date}T${digits.slice(0, 2)}:${digits.slice(2)}:00.000Z`,
  ).toISOString();
}

function field(
  row: readonly string[],
  header: ReadonlyMap<string, number>,
  name: string,
) {
  const index = header.get(name);
  return index === undefined ? "" : (row[index]?.trim() ?? "");
}

function viirsSatellite(product: ViirsProduct, rawValue: string) {
  const raw = rawValue.trim().toUpperCase();
  if (product === "VIIRS_NOAA20_NRT") {
    return raw === "N20" || raw === "NOAA-20" ? "NOAA-20" : null;
  }
  if (product === "VIIRS_NOAA21_NRT") {
    return raw === "N21" || raw === "NOAA-21" ? "NOAA-21" : null;
  }
  return raw === "N" || raw === "SNPP" || raw === "S-NPP" || raw === "SUOMI-NPP"
    ? "Suomi-NPP"
    : null;
}

function modisSatellite(rawValue: string) {
  const raw = rawValue.trim().toUpperCase();
  if (raw === "A" || raw === "AQUA") return "Aqua" as const;
  if (raw === "T" || raw === "TERRA") return "Terra" as const;
  return null;
}

function viirsConfidence(rawValue: string) {
  const raw = rawValue.trim().toLowerCase();
  if (raw === "l" || raw === "low") return "low" as const;
  if (raw === "n" || raw === "nominal") return "nominal" as const;
  if (raw === "h" || raw === "high") return "high" as const;
  return null;
}

function parseRow(
  request: FirmsAreaParseContext,
  dateRange: Readonly<{ start: string; end: string }>,
  row: readonly string[],
  header: ReadonlyMap<string, number>,
  itemIndex: number,
): FirmsDetection | FirmsRejectedRow {
  const { product } = request;
  const rowNumber = itemIndex + 2;
  if (row.length !== header.size) {
    return Object.freeze({
      itemIndex,
      rowNumber,
      reasons: Object.freeze(["column-count-mismatch" as const]),
    });
  }

  const reasons = new Set<FirmsRowRejectionCode>();
  const latitude = finiteNumber(field(row, header, "latitude"));
  const longitude = finiteNumber(field(row, header, "longitude"));
  if (
    latitude === null ||
    longitude === null ||
    latitude < -90 ||
    latitude > 90 ||
    longitude < -180 ||
    longitude > 180
  ) {
    reasons.add("invalid-coordinate");
  } else if (
    longitude < request.area.west ||
    longitude > request.area.east ||
    latitude < request.area.south ||
    latitude > request.area.north
  ) {
    reasons.add("outside-request-area");
  }
  const acquisitionDateRaw = field(row, header, "acq_date");
  const acquisitionTimeRaw = field(row, header, "acq_time");
  const observedAt = acquisitionInstant(acquisitionDateRaw, acquisitionTimeRaw);
  if (observedAt === null) reasons.add("invalid-acquisition-time");
  else {
    const observedDate = observedAt.slice(0, 10);
    if (observedDate < dateRange.start || observedDate > dateRange.end) {
      reasons.add("outside-request-date-range");
    }
  }

  const satelliteRaw = field(row, header, "satellite");
  const instrumentRaw = field(row, header, "instrument").toUpperCase();
  const version = field(row, header, "version");
  if (!SOURCE_VERSION.test(version)) reasons.add("invalid-version");
  const scanKm = positiveNumber(field(row, header, "scan"));
  const trackKm = positiveNumber(field(row, header, "track"));
  const frpMw = nonnegativeNumber(field(row, header, "frp"));
  const dayNightRaw = field(row, header, "daynight").toUpperCase();
  const dayNight = dayNightRaw === "D" ? "day" : dayNightRaw === "N" ? "night" : null;
  if (scanKm === null || trackKm === null || frpMw === null) {
    reasons.add("invalid-measurement");
  }
  if (dayNight === null) reasons.add("invalid-day-night");
  const confidenceRaw = field(row, header, "confidence");

  if (product === "MODIS_NRT") {
    const satellite = modisSatellite(satelliteRaw);
    if (satellite === null) reasons.add("satellite-mismatch");
    if (instrumentRaw !== "MODIS") reasons.add("instrument-mismatch");
    const confidencePercent = SOURCE_UNSIGNED_INTEGER.test(confidenceRaw)
      ? Number(confidenceRaw)
      : null;
    if (
      confidencePercent === null ||
      confidencePercent < 0 ||
      confidencePercent > 100
    ) {
      reasons.add("invalid-confidence");
    }
    const brightnessKelvin = positiveNumber(field(row, header, "brightness"));
    const brightT31Kelvin = positiveNumber(field(row, header, "bright_t31"));
    if (brightnessKelvin === null || brightT31Kelvin === null) {
      reasons.add("invalid-measurement");
    }
    if (reasons.size === 0) {
      return Object.freeze({
        itemIndex,
        rowNumber,
        product,
        latitude: latitude as number,
        longitude: longitude as number,
        observedAt: observedAt as string,
        acquisitionDateRaw,
        acquisitionTimeRaw,
        satelliteRaw,
        satellite: satellite as ModisSatellite,
        instrument: "MODIS",
        version,
        scanKm: scanKm as number,
        trackKm: trackKm as number,
        frpMw: frpMw as number,
        dayNight: dayNight as "day" | "night",
        confidenceRaw,
        confidenceKind: "percent",
        confidenceCode: null,
        confidencePercent: confidencePercent as number,
        brightnessKelvin: brightnessKelvin as number,
        brightT31Kelvin: brightT31Kelvin as number,
      });
    }
  } else {
    const satellite = viirsSatellite(product, satelliteRaw);
    if (satellite === null) reasons.add("satellite-mismatch");
    if (instrumentRaw !== "VIIRS") reasons.add("instrument-mismatch");
    const confidenceCode = viirsConfidence(confidenceRaw);
    if (confidenceCode === null) reasons.add("invalid-confidence");
    const brightTi4Kelvin = positiveNumber(field(row, header, "bright_ti4"));
    const brightTi5Kelvin = positiveNumber(field(row, header, "bright_ti5"));
    if (brightTi4Kelvin === null || brightTi5Kelvin === null) {
      reasons.add("invalid-measurement");
    }
    if (reasons.size === 0) {
      return Object.freeze({
        itemIndex,
        rowNumber,
        product,
        latitude: latitude as number,
        longitude: longitude as number,
        observedAt: observedAt as string,
        acquisitionDateRaw,
        acquisitionTimeRaw,
        satelliteRaw,
        satellite: satellite as ViirsSatellite,
        instrument: "VIIRS",
        version,
        scanKm: scanKm as number,
        trackKm: trackKm as number,
        frpMw: frpMw as number,
        dayNight: dayNight as "day" | "night",
        confidenceRaw,
        confidenceKind: "category",
        confidenceCode: confidenceCode as "low" | "nominal" | "high",
        confidencePercent: null,
        brightTi4Kelvin: brightTi4Kelvin as number,
        brightTi5Kelvin: brightTi5Kelvin as number,
      });
    }
  }

  return Object.freeze({
    itemIndex,
    rowNumber,
    reasons: Object.freeze([...reasons]),
  });
}

function utcDatePlusDays(date: string, days: number) {
  const instant = new Date(`${date}T00:00:00.000Z`);
  instant.setUTCDate(instant.getUTCDate() + days);
  return instant.toISOString().slice(0, 10);
}

function validateParseContext(
  context: FirmsAreaParseContext,
  retrievedAtInput: string,
) {
  if (
    context === null ||
    typeof context !== "object" ||
    context.kind !== "firms-area-parse-context-v1" ||
    Reflect.get(context, FIRMS_AREA_PARSE_CONTEXT_BRAND) !== true ||
    !FIRMS_AREA_PARSE_CONTEXTS.has(context) ||
    !Object.isFrozen(context) ||
    !Object.isFrozen(context.area) ||
    !Object.isFrozen(context.date)
  ) {
    throw new TypeError(
      "The FIRMS parse context must come from firmsAreaRequest.",
    );
  }
  if (!FIRMS_PRODUCTS.includes(context.product)) {
    throw new TypeError("The FIRMS product is invalid.");
  }
  canonicalCoordinate(context.area.west, -180, 180);
  canonicalCoordinate(context.area.south, -90, 90);
  canonicalCoordinate(context.area.east, -180, 180);
  canonicalCoordinate(context.area.north, -90, 90);
  if (
    context.area.west >= context.area.east ||
    context.area.south >= context.area.north
  ) {
    throw new TypeError("The FIRMS area bounds must be ordered.");
  }
  if (!validDayRange(context.date.dayCount)) {
    throw new TypeError("The FIRMS day range is invalid.");
  }
  const issuedAt = canonicalUtcInstant(context.issuedAt, "issuance");
  const retrievedAt = canonicalUtcInstant(retrievedAtInput, "retrieval");
  if (issuedAt.getTime() > retrievedAt.getTime()) {
    throw new TypeError("The FIRMS retrieval time cannot precede issuance.");
  }

  if (context.date.kind === "rolling") {
    const end = context.issuedAt.slice(0, 10);
    if (retrievedAtInput.slice(0, 10) !== end) {
      throw new TypeError(
        "A rolling FIRMS request crossing UTC midnight has an ambiguous date window.",
      );
    }
    return Object.freeze({
      start: utcDatePlusDays(end, 1 - context.date.dayCount),
      end,
    });
  }
  const start = canonicalCalendarDate(context.date.dateFrom);
  if (start === null) throw new TypeError("The FIRMS request date is invalid.");
  return Object.freeze({
    start,
    end: utcDatePlusDays(start, context.date.dayCount - 1),
  });
}

/**
 * Parses one exact FIRMS Area CSV product contract within the requested AOI
 * and UTC date window. `emptyPayload` means only that the CSV is syntactically
 * valid and contains a header but no rows; it is not evidence of complete
 * satellite coverage or proof that the requested area has no anomaly.
 */
export function parseFirmsCsv(
  response: FirmsAreaResponse,
  maximumBytes = FIRMS_MAX_RESPONSE_BYTES,
): FirmsParseResult {
  const state = FIRMS_AREA_RESPONSES.get(response);
  if (
    state === undefined ||
    Reflect.get(response, FIRMS_AREA_RESPONSE_BRAND) !== true ||
    !Object.isFrozen(response)
  ) {
    throw new TypeError(
      "FIRMS parsing requires an issued or durably replayed response envelope.",
    );
  }
  const { context, retrievedAt, body: input } = state;
  const dateRange = validateParseContext(context, retrievedAt);
  const { product } = context;
  if (!Number.isSafeInteger(maximumBytes) || maximumBytes < 0) {
    throw new TypeError("The FIRMS response limit is invalid.");
  }
  const bytes = input;
  if (bytes.byteLength > maximumBytes) {
    return errorResult(product, "response-too-large");
  }

  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(input);
  } catch {
    return errorResult(product, "invalid-encoding");
  }
  const parsed = parseCsv(text.replace(/^\uFEFF/u, ""));
  if (!parsed.ok) return errorResult(product, "invalid-csv");
  const headerRow = parsed.rows[0];
  if (headerRow === undefined) return errorResult(product, "invalid-header");
  const header = exactHeaderIndex(product, headerRow);
  if (header === null) return errorResult(product, "invalid-header");

  const dataRows = parsed.rows.slice(1);
  const detections: FirmsDetection[] = [];
  const rejectedRows: FirmsRejectedRow[] = [];
  dataRows.forEach((row, itemIndex) => {
    const parsedRow = parseRow(context, dateRange, row, header, itemIndex);
    if ("reasons" in parsedRow) rejectedRows.push(parsedRow);
    else detections.push(parsedRow);
  });
  const status = rejectedRows.length > 0 ? "partial" : "ok";
  return Object.freeze({
    product,
    status,
    returnedRows: dataRows.length,
    detections: Object.freeze(detections),
    rejectedRows: Object.freeze(rejectedRows),
    emptyPayload: status === "ok" && dataRows.length === 0,
    errorCode: null,
  });
}
