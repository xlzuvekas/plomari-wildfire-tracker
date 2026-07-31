import type { HttpRequestEvidence } from "../evidence/recorded-fetch";

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

export type FirmsParseRequest = Readonly<{
  product: FirmsProduct;
  area: FirmsArea;
  date: FirmsDateSelection;
  requestedAt: string;
}>;

const MAP_KEY = /^[A-Za-z0-9._~-]{8,512}$/u;
const CALENDAR_DATE = /^(\d{4})-(\d{2})-(\d{2})$/u;
const DECIMAL_COORDINATE = /^-?(?:0|[1-9]\d*)(?:\.\d+)?$/u;
const SOURCE_DECIMAL = /^-?(?:\d+(?:\.\d+)?|\.\d+)$/u;
const SOURCE_UNSIGNED_INTEGER = /^(?:0|[1-9]\d*)$/u;

function canonicalCalendarDate(value: string) {
  const match = CALENDAR_DATE.exec(value);
  if (!match) return null;
  const instant = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(instant.getTime()) &&
      instant.toISOString().slice(0, 10) === value
    ? value
    : null;
}

function canonicalCoordinate(value: number, minimum: number, maximum: number) {
  if (!Number.isFinite(value) || value < minimum || value > maximum) {
    throw new TypeError("FIRMS area coordinates are invalid.");
  }
  const normalized = Object.is(value, -0) ? 0 : value;
  const result = String(normalized);
  if (!DECIMAL_COORDINATE.test(result)) {
    throw new TypeError("FIRMS area coordinates must use decimal notation.");
  }
  return result;
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

  const west = canonicalCoordinate(input.area.west, -180, 180);
  const south = canonicalCoordinate(input.area.south, -90, 90);
  const east = canonicalCoordinate(input.area.east, -180, 180);
  const north = canonicalCoordinate(input.area.north, -90, 90);
  if (input.area.west >= input.area.east || input.area.south >= input.area.north) {
    throw new TypeError("The FIRMS area bounds must be ordered.");
  }
  const area = `${west},${south},${east},${north}`;

  let dateSafe: string;
  let datePath: string;
  if (input.date.kind === "rolling") {
    dateSafe = `rolling:${input.date.days}`;
    datePath = String(input.date.days);
  } else {
    const date = canonicalCalendarDate(input.date.date);
    if (date === null) throw new TypeError("The FIRMS request date is invalid.");
    dateSafe = `${date}/${input.date.days}`;
    datePath = `${input.date.days}/${date}`;
  }

  const requestQuerySafe = Object.freeze({
    area,
    date: dateSafe,
    product: input.product,
  });
  return Object.freeze({
    url: `${FIRMS_AREA_ENDPOINT}/${input.mapKey}/${input.product}/${area}/${datePath}`,
    requestInit: FIRMS_AREA_REQUEST_INIT,
    credentialPathRedaction: FIRMS_AREA_PATH_REDACTION,
    requestUrlSafe: FIRMS_AREA_ENDPOINT,
    requestQuerySafe,
  });
}

/** Complete credential-free evidence envelope accepted by recordedFetch. */
export function firmsAreaRequestEvidence(
  request: FirmsAreaRequestDescriptor,
): HttpRequestEvidence {
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
    }),
  });
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
  if (!SOURCE_DECIMAL.test(source)) return null;
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
  request: FirmsParseRequest,
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
  if (version === "" || version.length > 64) reasons.add("invalid-version");
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

function validateParseRequest(request: FirmsParseRequest) {
  if (request === null || typeof request !== "object") {
    throw new TypeError("The FIRMS parse request is invalid.");
  }
  if (!FIRMS_PRODUCTS.includes(request.product)) {
    throw new TypeError("The FIRMS product is invalid.");
  }
  canonicalCoordinate(request.area.west, -180, 180);
  canonicalCoordinate(request.area.south, -90, 90);
  canonicalCoordinate(request.area.east, -180, 180);
  canonicalCoordinate(request.area.north, -90, 90);
  if (request.area.west >= request.area.east || request.area.south >= request.area.north) {
    throw new TypeError("The FIRMS area bounds must be ordered.");
  }
  if (!validDayRange(request.date.days)) {
    throw new TypeError("The FIRMS day range is invalid.");
  }
  const requestedAt = new Date(request.requestedAt);
  if (
    typeof request.requestedAt !== "string" ||
    !Number.isFinite(requestedAt.getTime()) ||
    requestedAt.toISOString() !== request.requestedAt
  ) {
    throw new TypeError("The FIRMS request time must be canonical UTC.");
  }

  if (request.date.kind === "rolling") {
    const end = request.requestedAt.slice(0, 10);
    return Object.freeze({
      start: utcDatePlusDays(end, 1 - request.date.days),
      end,
    });
  }
  const start = canonicalCalendarDate(request.date.date);
  if (start === null) throw new TypeError("The FIRMS request date is invalid.");
  return Object.freeze({
    start,
    end: utcDatePlusDays(start, request.date.days - 1),
  });
}

/**
 * Parses one exact FIRMS Area CSV product contract within the requested AOI
 * and UTC date window. `emptyPayload` means only that the CSV is syntactically
 * valid and contains a header but no rows; it is not evidence of complete
 * satellite coverage or proof that the requested area has no anomaly.
 */
export function parseFirmsCsv(
  request: FirmsParseRequest,
  input: string | Uint8Array,
  maximumBytes = FIRMS_MAX_RESPONSE_BYTES,
): FirmsParseResult {
  const dateRange = validateParseRequest(request);
  const { product } = request;
  if (!Number.isSafeInteger(maximumBytes) || maximumBytes < 0) {
    throw new TypeError("The FIRMS response limit is invalid.");
  }
  const bytes = typeof input === "string" ? new TextEncoder().encode(input) : input;
  if (bytes.byteLength > maximumBytes) {
    return errorResult(product, "response-too-large");
  }

  let text: string;
  try {
    text = typeof input === "string"
      ? input
      : new TextDecoder("utf-8", { fatal: true }).decode(input);
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
    const parsedRow = parseRow(request, dateRange, row, header, itemIndex);
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
