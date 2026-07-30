import { z } from "zod";

const CMR_GRANULES_URL =
  "https://cmr.earthdata.nasa.gov/search/granules.umm_json_v1_6_7";
const CMR_CLIENT_ID = "plomari-wildfire-tracker";
const CMR_PROVIDER = "LANCEMODIS";
const LOOKBACK_HOURS = 36;
const PAGE_SIZE = 200;
const MAX_RESPONSE_BYTES = 16_000_000;

export type CmrProduct = Readonly<{
  shortName: "VNP14IMG_NRT" | "VJ114IMG_NRT" | "VJ214IMG_NRT";
  version: "2";
  satellite: "Suomi-NPP" | "NOAA-20" | "NOAA-21";
}>;

export const CMR_FIREMASK_PRODUCTS: readonly CmrProduct[] = Object.freeze([
  Object.freeze({
    shortName: "VNP14IMG_NRT",
    version: "2",
    satellite: "Suomi-NPP",
  }),
  Object.freeze({
    shortName: "VJ114IMG_NRT",
    version: "2",
    satellite: "NOAA-20",
  }),
  Object.freeze({
    shortName: "VJ214IMG_NRT",
    version: "2",
    satellite: "NOAA-21",
  }),
]);

export type SatellitePass = Readonly<{
  id: string;
  collectionId: string;
  product: CmrProduct["shortName"];
  productVersion: CmrProduct["version"];
  satellite: CmrProduct["satellite"];
  sensor: "VIIRS";
  observedFrom: string;
  observedTo: string;
  producedAt: string | null;
  catalogedAt: string;
  dayNight: "day" | "night" | "both" | "unknown";
  coverage: "catalog-footprint";
  anomalyAssessment: "not-assessed";
}>;

export type CmrProductResult = Readonly<{
  product: CmrProduct["shortName"];
  satellite: CmrProduct["satellite"];
  status: "ok" | "error";
  hits: number;
  passes: readonly SatellitePass[];
  errorCode:
    | "timeout"
    | "rate-limit"
    | "upstream-unavailable"
    | "response-too-large"
    | "invalid-response"
    | null;
}>;

const timestampSchema = z
  .string()
  .trim()
  .min(1)
  .max(64)
  .refine((value) => Number.isFinite(Date.parse(value)));

const cmrItemSchema = z.object({
  meta: z.object({
    "concept-id": z.string().trim().min(1).max(160),
    "collection-concept-id": z.string().trim().min(1).max(160),
    "revision-date": timestampSchema,
  }),
  umm: z.object({
    TemporalExtent: z.object({
      RangeDateTime: z.object({
        BeginningDateTime: timestampSchema,
        EndingDateTime: timestampSchema,
      }),
    }),
    CollectionReference: z.object({
      ShortName: z.string().trim().min(1).max(80),
      Version: z.string().trim().min(1).max(32),
    }),
    DataGranule: z
      .object({
        DayNightFlag: z.string().trim().min(1).max(32).optional(),
        ProductionDateTime: timestampSchema.optional(),
      })
      .optional(),
  }),
});

const cmrResponseSchema = z.object({
  hits: z.number().int().nonnegative(),
  items: z.array(cmrItemSchema).max(PAGE_SIZE),
});

export class CmrPayloadError extends Error {
  constructor(readonly code: NonNullable<CmrProductResult["errorCode"]>) {
    super("NASA CMR pass metadata is unavailable.");
    this.name = "CmrPayloadError";
  }
}

function utcTimestamp(epochMs: number) {
  return new Date(epochMs).toISOString();
}

export function cmrGranulesUrl(
  product: CmrProduct,
  nowMs: number,
) {
  const url = new URL(CMR_GRANULES_URL);
  url.searchParams.set("provider", CMR_PROVIDER);
  url.searchParams.set("short_name", product.shortName);
  url.searchParams.set("version", product.version);
  url.searchParams.set(
    "temporal",
    `${utcTimestamp(nowMs - LOOKBACK_HOURS * 60 * 60_000)},${utcTimestamp(nowMs)}`,
  );
  url.searchParams.set("page_size", String(PAGE_SIZE));
  url.searchParams.append("sort_key[]", "-start_date");
  url.searchParams.append("sort_key[]", "granule_ur");
  return url;
}

function cappedJson(bytes: Uint8Array) {
  if (bytes.byteLength > MAX_RESPONSE_BYTES) {
    throw new CmrPayloadError("response-too-large");
  }

  try {
    return JSON.parse(new TextDecoder().decode(bytes)) as unknown;
  } catch {
    throw new CmrPayloadError("invalid-response");
  }
}

function dayNight(value: string | undefined): SatellitePass["dayNight"] {
  const normalized = value?.trim().toLowerCase();
  if (normalized === "day" || normalized === "night" || normalized === "both") {
    return normalized;
  }
  return "unknown";
}

function passFromItem(
  product: CmrProduct,
  item: z.infer<typeof cmrItemSchema>,
): SatellitePass | null {
  if (
    item.umm.CollectionReference.ShortName !== product.shortName ||
    item.umm.CollectionReference.Version !== product.version
  ) {
    return null;
  }

  const range = item.umm.TemporalExtent.RangeDateTime;
  return Object.freeze({
    id: item.meta["concept-id"],
    collectionId: item.meta["collection-concept-id"],
    product: product.shortName,
    productVersion: product.version,
    satellite: product.satellite,
    sensor: "VIIRS",
    observedFrom: new Date(range.BeginningDateTime).toISOString(),
    observedTo: new Date(range.EndingDateTime).toISOString(),
    producedAt: item.umm.DataGranule?.ProductionDateTime
      ? new Date(item.umm.DataGranule.ProductionDateTime).toISOString()
      : null,
    catalogedAt: new Date(item.meta["revision-date"]).toISOString(),
    dayNight: dayNight(item.umm.DataGranule?.DayNightFlag),
    coverage: "catalog-footprint",
    anomalyAssessment: "not-assessed",
  });
}

/**
 * Parses bytes only after the collector has durably linked them to an HTTP
 * exchange and raw object. This adapter deliberately performs no network I/O.
 */
export function parseCmrProductPasses(
  product: CmrProduct,
  bytes: Uint8Array,
): CmrProductResult {
  try {
    const parsed = cmrResponseSchema.safeParse(cappedJson(bytes));
    if (!parsed.success) throw new CmrPayloadError("invalid-response");

    const passes = parsed.data.items
      .map((item) => passFromItem(product, item))
      .filter((pass): pass is SatellitePass => pass !== null)
      .sort(
        (left, right) =>
          Date.parse(right.observedFrom) - Date.parse(left.observedFrom),
      );

    return Object.freeze({
      product: product.shortName,
      satellite: product.satellite,
      status: "ok",
      hits: parsed.data.hits,
      passes: Object.freeze(passes),
      errorCode: null,
    });
  } catch (error) {
    const errorCode =
      error instanceof CmrPayloadError ? error.code : "invalid-response";
    return Object.freeze({
      product: product.shortName,
      satellite: product.satellite,
      status: "error",
      hits: 0,
      passes: Object.freeze([]),
      errorCode,
    });
  }
}

export function cmrRequestHeaders(
  requestId: string,
  searchAfter: string | null = null,
) {
  const headers: Record<string, string> = {
    Accept: "application/vnd.nasa.cmr.umm_results+json",
    "Client-Id": CMR_CLIENT_ID,
    "X-Request-Id": requestId,
  };
  if (searchAfter) headers["CMR-Search-After"] = searchAfter;
  return Object.freeze(headers);
}

export function combineCmrFireMaskPasses(
  products: readonly CmrProductResult[],
  from: string,
  to: string,
) {
  const passes = products
    .flatMap((product) => product.passes)
    .sort(
      (left, right) =>
        Date.parse(right.observedFrom) - Date.parse(left.observedFrom),
    );

  return Object.freeze({
    from,
    to,
    products: Object.freeze([...products]),
    passes: Object.freeze(passes),
  });
}
