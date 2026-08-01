import { z } from "zod";

/**
 * Open-Meteo Air Quality protocol module.
 *
 * Pure by contract: this module builds URLs and parses bytes only after the
 * collector has durably linked them to an HTTP exchange and raw object. It
 * deliberately performs no network I/O.
 *
 * Semantics (docs/data-truth-layer-spec.md, docs/production-architecture.md):
 * Open-Meteo air quality is a MODEL product, never an on-site measurement.
 * Pollutant fields are preserved individually; provider AQ indexes are kept
 * as provider indexes and are never relabeled as a pollutant concentration.
 *
 * Harvested with review from tyler-grimes/plomari-wildfire-tracker commits
 * e002589 and 0e31aa7 (PR #19), per issue #43 work package A.
 */

export const OPEN_METEO_AIR_QUALITY_URL =
  "https://air-quality-api.open-meteo.com/v1/air-quality";
export const OPEN_METEO_AIR_QUALITY_DOCS =
  "https://open-meteo.com/en/docs/air-quality-api";

// A current-conditions block is a few hundred bytes; 256 KiB leaves room for
// provider error pages without letting a misbehaving response grow unbounded.
export const OPEN_METEO_AQ_MAX_RESPONSE_BYTES = 262_144;

export const OPEN_METEO_AQ_CURRENT_FIELDS = Object.freeze([
  "pm2_5",
  "pm10",
  "nitrogen_dioxide",
  "ozone",
  "aerosol_optical_depth",
  "european_aqi",
  "us_aqi",
] as const);

export type AirQualityPoint = Readonly<{
  latitude: number;
  longitude: number;
}>;

function coordinateToken(value: number, minimum: number, maximum: number) {
  if (!Number.isFinite(value) || value < minimum || value > maximum) {
    throw new TypeError("The air-quality point is out of range.");
  }
  const normalized = Object.is(value, -0) ? 0 : value;
  const token = normalized.toFixed(4);
  if (Number(token) !== normalized || token === "-0.0000") {
    throw new TypeError(
      "The air-quality point must be exact to four decimals.",
    );
  }
  return token;
}

/**
 * Builds the current-conditions request URL for one point. All query keys are
 * within the recorded-fetch and SQL http_safe_map allowlists (latitude,
 * longitude, current, timezone). UTC is requested explicitly so the model
 * timestamp arrives with a zero offset and no local wall-time ambiguity.
 */
export function openMeteoAirQualityUrl(point: AirQualityPoint): URL {
  const url = new URL(OPEN_METEO_AIR_QUALITY_URL);
  url.searchParams.set("latitude", coordinateToken(point.latitude, -90, 90));
  url.searchParams.set(
    "longitude",
    coordinateToken(point.longitude, -180, 180),
  );
  url.searchParams.set("current", OPEN_METEO_AQ_CURRENT_FIELDS.join(","));
  url.searchParams.set("timezone", "UTC");
  return url;
}

export function openMeteoAirQualityRequestHeaders(requestId: string) {
  return Object.freeze({
    Accept: "application/json",
    "X-Request-Id": requestId,
  });
}

export type AirQualityReading = Readonly<{
  basis: "modeled";
  observedAtUtc: string;
  latitude: number;
  longitude: number;
  pm25: number | null;
  pm10: number | null;
  nitrogenDioxide: number | null;
  ozone: number | null;
  aerosolOpticalDepth: number | null;
  europeanAqi: number | null;
  usAqi: number | null;
}>;

export type AirQualityParseResult =
  | Readonly<{ status: "ok"; reading: AirQualityReading }>
  | Readonly<{
      status: "malformed";
      reason:
        | "not_json"
        | "response_too_large"
        | "schema_mismatch"
        | "non_utc_offset"
        | "invalid_model_time";
    }>;

const finiteOrNull = z
  .number()
  .finite()
  .nullable()
  .optional()
  .transform((value) => (value === undefined ? null : value));

const payloadSchema = z.object({
  latitude: z.number().finite(),
  longitude: z.number().finite(),
  utc_offset_seconds: z.number().int(),
  current: z.object({
    time: z.string(),
    pm2_5: finiteOrNull,
    pm10: finiteOrNull,
    nitrogen_dioxide: finiteOrNull,
    ozone: finiteOrNull,
    aerosol_optical_depth: finiteOrNull,
    european_aqi: finiteOrNull,
    us_aqi: finiteOrNull,
  }),
});

const MODEL_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/u;

/**
 * Parses one current-conditions response. Never throws: every deviation from
 * the contract returns a coded "malformed" result so the collector can record
 * a parser failure without losing the already-persisted raw evidence.
 */
export function parseOpenMeteoAirQuality(
  bytes: Uint8Array,
  maximumResponseBytes = OPEN_METEO_AQ_MAX_RESPONSE_BYTES,
): AirQualityParseResult {
  if (bytes.byteLength > maximumResponseBytes) {
    return Object.freeze({
      status: "malformed" as const,
      reason: "response_too_large" as const,
    });
  }
  let decoded: unknown;
  try {
    decoded = JSON.parse(new TextDecoder("utf-8").decode(bytes));
  } catch {
    return Object.freeze({
      status: "malformed" as const,
      reason: "not_json" as const,
    });
  }
  const parsed = payloadSchema.safeParse(decoded);
  if (!parsed.success) {
    return Object.freeze({
      status: "malformed" as const,
      reason: "schema_mismatch" as const,
    });
  }
  if (parsed.data.utc_offset_seconds !== 0) {
    // The URL builder requests timezone=UTC; any other offset means the
    // response does not match the recorded request and cannot be trusted.
    return Object.freeze({
      status: "malformed" as const,
      reason: "non_utc_offset" as const,
    });
  }
  const modelTime = parsed.data.current.time;
  if (!MODEL_TIME.test(modelTime)) {
    return Object.freeze({
      status: "malformed" as const,
      reason: "invalid_model_time" as const,
    });
  }
  const observedAtUtc = `${modelTime}:00.000Z`;
  if (new Date(observedAtUtc).toISOString() !== observedAtUtc) {
    return Object.freeze({
      status: "malformed" as const,
      reason: "invalid_model_time" as const,
    });
  }
  return Object.freeze({
    status: "ok" as const,
    reading: Object.freeze({
      basis: "modeled" as const,
      observedAtUtc,
      latitude: parsed.data.latitude,
      longitude: parsed.data.longitude,
      pm25: parsed.data.current.pm2_5,
      pm10: parsed.data.current.pm10,
      nitrogenDioxide: parsed.data.current.nitrogen_dioxide,
      ozone: parsed.data.current.ozone,
      aerosolOpticalDepth: parsed.data.current.aerosol_optical_depth,
      europeanAqi: parsed.data.current.european_aqi,
      usAqi: parsed.data.current.us_aqi,
    }),
  });
}
