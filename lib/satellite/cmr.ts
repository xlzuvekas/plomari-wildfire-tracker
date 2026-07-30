import polygonClipping, {
  type MultiPolygon as ClippingMultiPolygon,
  type Pair as ClippingPosition,
  type Polygon as ClippingPolygon,
  type Ring as ClippingRing,
} from "polygon-clipping";
import { z } from "zod";

export const CMR_GRANULES_URL =
  "https://cmr.earthdata.nasa.gov/search/granules.umm_json_v1_6_7";
export const CMR_CLIENT_ID = "plomari-wildfire-tracker";
export const CMR_PROVIDER = "LANCEMODIS";
export const CMR_PAGE_SIZE = 200;
export const CMR_UMM_G_VERSION = "1.6.7";
export const CMR_MAX_RESPONSE_BYTES = 16_000_000;

const MAX_POLYGONS_PER_GRANULE = 64;
const MAX_RECTANGLES_PER_GRANULE = 64;
const MAX_HOLES_PER_POLYGON = 64;
const MAX_POINTS_PER_RING = 20_000;
const MAX_SOURCE_POINTS_PER_GRANULE = 50_000;
const MAX_PROJECTED_POLYGONS_PER_GRANULE = 256;
const MAX_PROJECTED_POINTS_PER_GRANULE = 100_000;
const MAX_LONGITUDE_WINDOWS_PER_POLYGON = 4;
const GEOMETRY_EPSILON = 1e-9;
const GENERATED_COORDINATE_DECIMALS = 12;
const CMR_GRANULE_CONCEPT_ID = /^G[0-9]+-[A-Za-z0-9_-]+$/u;
const CMR_COLLECTION_CONCEPT_ID = /^C[0-9]+-[A-Za-z0-9_-]+$/u;

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

export type CmrScanKind = "bootstrap" | "incremental" | "reconciliation";

export type CmrCatalogQuery = Readonly<{
  scanKind: CmrScanKind;
  requestedFrom: string;
  requestedTo: string;
  updatedSince: string | null;
}>;

export type GeoJsonPosition = readonly [longitude: number, latitude: number];
export type GeoJsonLinearRing = readonly GeoJsonPosition[];
export type GeoJsonPolygon = Readonly<{
  type: "Polygon";
  coordinates: readonly GeoJsonLinearRing[];
}>;
export type GeoJsonMultiPolygon = Readonly<{
  type: "MultiPolygon";
  coordinates: readonly (readonly GeoJsonLinearRing[])[];
}>;
export type CmrCatalogFootprint = GeoJsonPolygon | GeoJsonMultiPolygon;

export type SatellitePass = Readonly<{
  itemIndex: number;
  id: string;
  revisionId: number;
  granuleUr: string;
  collectionId: string;
  product: CmrProduct["shortName"];
  productVersion: CmrProduct["version"];
  satellite: CmrProduct["satellite"];
  sensor: "VIIRS";
  ummGVersion: typeof CMR_UMM_G_VERSION;
  observedFrom: string;
  observedTo: string;
  producedAt: string | null;
  catalogedAt: string;
  dayNight: "day" | "night" | "both" | "unknown";
  footprint: CmrCatalogFootprint;
  footprintSource: "umm-g-gpolygon" | "umm-g-bounding-rectangle";
  /** CMR declares the footprint vertices, but no metric accuracy. */
  footprintPrecision: "not_applicable";
  coverage: "catalog-footprint";
  anomalyAssessment: "not-assessed";
}>;

export type CmrRejectedItem = Readonly<{
  itemIndex: number;
  conceptId: string | null;
  revisionId: number | null;
  reason:
    | "invalid-item"
    | "product-mismatch"
    | "missing-footprint"
    | "invalid-footprint";
}>;

export type CmrProductResult = Readonly<{
  product: CmrProduct["shortName"];
  satellite: CmrProduct["satellite"];
  status: "ok" | "error";
  hits: number;
  returnedItems: number;
  passes: readonly SatellitePass[];
  rejectedItems: readonly CmrRejectedItem[];
  errorCode: "response-too-large" | "invalid-response" | null;
}>;

const timestampSchema = z
  .string()
  .trim()
  .min(1)
  .max(64)
  .refine((value) => Number.isFinite(Date.parse(value)));

const pointSchema = z
  .object({
    Longitude: z.number().finite().min(-180).max(180),
    Latitude: z.number().finite().min(-90).max(90),
  })
  .strict();

const boundarySchema = z
  .object({
    Points: z.array(pointSchema).min(3).max(MAX_POINTS_PER_RING),
  })
  .strict();

const gPolygonSchema = z
  .object({
    Boundary: boundarySchema,
    ExclusiveZone: z
      .object({
        Boundaries: z
          .array(boundarySchema)
          .min(1)
          .max(MAX_HOLES_PER_POLYGON),
      })
      .strict()
      .optional(),
  })
  .strict();

const boundingRectangleSchema = z
  .object({
    WestBoundingCoordinate: z.number().finite().min(-180).max(180),
    NorthBoundingCoordinate: z.number().finite().min(-90).max(90),
    EastBoundingCoordinate: z.number().finite().min(-180).max(180),
    SouthBoundingCoordinate: z.number().finite().min(-90).max(90),
  })
  .strict();

const horizontalGeometrySchema = z.object({
  GPolygons: z
    .array(gPolygonSchema)
    .min(1)
    .max(MAX_POLYGONS_PER_GRANULE)
    .optional(),
  BoundingRectangles: z
    .array(boundingRectangleSchema)
    .min(1)
    .max(MAX_RECTANGLES_PER_GRANULE)
    .optional(),
});

const spatialExtentSchema = z.object({
  HorizontalSpatialDomain: z.object({
    Geometry: horizontalGeometrySchema,
  }),
});

const temporalExtentSchema = z.union([
  z.object({
    RangeDateTime: z.object({
      BeginningDateTime: timestampSchema,
      EndingDateTime: timestampSchema,
    }),
  }),
  z.object({ SingleDateTime: timestampSchema }),
]);

const cmrItemSchema = z.object({
  meta: z.object({
    "concept-id": z.string().trim().min(1).max(160).regex(CMR_GRANULE_CONCEPT_ID),
    "collection-concept-id": z
      .string()
      .trim()
      .min(1)
      .max(160)
      .regex(CMR_COLLECTION_CONCEPT_ID),
    "revision-id": z.number().int().positive().safe(),
    "revision-date": timestampSchema,
  }),
  umm: z.object({
    GranuleUR: z.string().trim().min(1).max(250),
    TemporalExtent: temporalExtentSchema,
    SpatialExtent: z.unknown().optional(),
    CollectionReference: z.object({
      ShortName: z.string().trim().min(1).max(85),
      Version: z.string().trim().min(1).max(80),
    }),
    DataGranule: z
      .object({
        DayNightFlag: z.string().trim().min(1).max(32).optional(),
        ProductionDateTime: timestampSchema.optional(),
      })
      .optional(),
    MetadataSpecification: z.object({
      Name: z.literal("UMM-G"),
      Version: z.literal(CMR_UMM_G_VERSION),
    }),
  }),
});

const cmrResponseSchema = z.object({
  hits: z.number().int().nonnegative().safe(),
  items: z.array(z.unknown()).max(CMR_PAGE_SIZE),
});

export class CmrPayloadError extends Error {
  constructor(readonly code: NonNullable<CmrProductResult["errorCode"]>) {
    super("NASA CMR pass metadata is unavailable.");
    this.name = "CmrPayloadError";
  }
}

function normalizedTimestamp(value: string) {
  return new Date(value).toISOString();
}

function validQueryTimestamp(value: string) {
  const epochMs = Date.parse(value);
  if (!Number.isFinite(epochMs)) {
    throw new TypeError("CMR query timestamps must be valid ISO timestamps.");
  }
  return new Date(epochMs).toISOString();
}

/**
 * Builds one global catalog query. Incremental scheduled scans use CMR's
 * revision watermark (`updated_since`); bounded bootstrap/reconciliation scans
 * use an observation-time range. Neither mode substitutes a viewer AOI.
 */
export function cmrGranulesUrl(product: CmrProduct, query: CmrCatalogQuery) {
  const requestedFrom = validQueryTimestamp(query.requestedFrom);
  const requestedTo = validQueryTimestamp(query.requestedTo);
  if (Date.parse(requestedFrom) > Date.parse(requestedTo)) {
    throw new TypeError("CMR query start must not be after its end.");
  }

  const url = new URL(CMR_GRANULES_URL);
  url.searchParams.set("provider", CMR_PROVIDER);
  url.searchParams.set("short_name", product.shortName);
  url.searchParams.set("version", product.version);
  url.searchParams.set("temporal", `${requestedFrom},${requestedTo}`);
  if (query.scanKind === "incremental") {
    if (query.updatedSince === null) {
      throw new TypeError("Incremental CMR queries require an update watermark.");
    }
    url.searchParams.set("updated_since", validQueryTimestamp(query.updatedSince));
    url.searchParams.append("sort_key[]", "-start_date");
  } else {
    if (query.updatedSince !== null) {
      throw new TypeError("Full CMR queries cannot include an update watermark.");
    }
    url.searchParams.append("sort_key[]", "-start_date");
  }
  url.searchParams.set("page_size", String(CMR_PAGE_SIZE));
  url.searchParams.append("sort_key[]", "granule_ur");
  return url;
}

function cappedJson(bytes: Uint8Array) {
  if (bytes.byteLength > CMR_MAX_RESPONSE_BYTES) {
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

function position(point: z.infer<typeof pointSchema>): GeoJsonPosition {
  return Object.freeze([point.Longitude, point.Latitude]);
}

function positionsEqual(left: GeoJsonPosition, right: GeoJsonPosition) {
  return left[0] === right[0] && left[1] === right[1];
}

function signedRingArea(ring: GeoJsonLinearRing) {
  let twiceArea = 0;
  for (let index = 0; index < ring.length - 1; index += 1) {
    const current = ring[index];
    const next = ring[index + 1];
    if (!current || !next) continue;
    twiceArea += current[0] * next[1] - next[0] * current[1];
  }
  return twiceArea / 2;
}

type PolygonCoordinates = readonly GeoJsonLinearRing[];

type UnwrappedBoundary = Readonly<{
  ring: ClippingRing;
  netTurns: -1 | 0 | 1;
  pole: -90 | 90 | null;
  source: readonly GeoJsonPosition[];
}>;

function crossProduct(
  left: readonly [number, number, number],
  right: readonly [number, number, number],
): [number, number, number] {
  return [
    left[1] * right[2] - left[2] * right[1],
    left[2] * right[0] - left[0] * right[2],
    left[0] * right[1] - left[1] * right[0],
  ];
}

/**
 * Finds the antimeridian intersection on the minor great-circle arc. CMR's
 * UMM-G vertices are geodetic; inserting this point before planar clipping
 * prevents a longitude/latitude chord from moving the catalog boundary.
 */
function greatCircleAntimeridianLatitude(
  start: GeoJsonPosition,
  end: GeoJsonPosition,
) {
  const radians = Math.PI / 180;
  const cartesian = ([longitude, latitude]: GeoJsonPosition) => {
    const longitudeRadians = longitude * radians;
    const latitudeRadians = latitude * radians;
    return [
      Math.cos(longitudeRadians) * Math.cos(latitudeRadians),
      Math.sin(longitudeRadians) * Math.cos(latitudeRadians),
      Math.sin(latitudeRadians),
    ] as const;
  };
  const greatCircleNormal = crossProduct(cartesian(start), cartesian(end));
  let intersection = crossProduct(greatCircleNormal, [0, -1, 0]);
  const norm = Math.hypot(...intersection);
  if (!Number.isFinite(norm) || norm <= GEOMETRY_EPSILON) return null;
  intersection = intersection.map((value) => value / norm) as [
    number,
    number,
    number,
  ];
  // y=0 intersects the great circle at both Greenwich and its antipode. The
  // antimeridian is the solution with a negative Cartesian x coordinate.
  if ((intersection[0] ?? 0) > 0) {
    intersection = intersection.map((value) => -value) as [
      number,
      number,
      number,
    ];
  }
  const latitude = Math.asin(Math.max(-1, Math.min(1, intersection[2]))) /
    radians;
  return Number.isFinite(latitude) && latitude >= -90 && latitude <= 90
    ? Number(latitude.toFixed(GENERATED_COORDINATE_DECIMALS))
    : null;
}

function unwrappedBoundary(
  boundary: z.infer<typeof boundarySchema>,
): UnwrappedBoundary | null {
  const source = boundary.Points.map(position);
  const first = source[0];
  const last = source[source.length - 1];
  if (!first || !last || source.length < 4 || !positionsEqual(first, last)) {
    return null;
  }
  const distinct = new Set(
    source
      .slice(0, -1)
      .map(([longitude, latitude]) => `${longitude},${latitude}`),
  );
  if (distinct.size < 3) return null;

  const ring: ClippingRing = [[first[0], first[1]]];
  let previousSource = first;
  let previousLongitude = first[0];
  for (const currentSource of source.slice(1)) {
    const rawDelta = currentSource[0] - previousSource[0];
    if (Math.abs(rawDelta) === 180) {
      // The minor arc is ambiguous for antipodal longitudes. Quarantine it
      // rather than choose a hemisphere on NASA's behalf.
      return null;
    }
    const delta = rawDelta > 180
      ? rawDelta - 360
      : rawDelta < -180
        ? rawDelta + 360
        : rawDelta;
    const currentLongitude = previousLongitude + delta;
    if (Math.abs(rawDelta) > 180) {
      const lowerLongitude = Math.min(previousLongitude, currentLongitude);
      const upperLongitude = Math.max(previousLongitude, currentLongitude);
      const seam = 180 +
        360 * Math.ceil((lowerLongitude - 180) / 360);
      if (
        seam > lowerLongitude + GEOMETRY_EPSILON &&
        seam < upperLongitude - GEOMETRY_EPSILON
      ) {
        const latitude = greatCircleAntimeridianLatitude(
          previousSource,
          currentSource,
        );
        if (latitude === null) return null;
        ring.push([seam, latitude]);
      }
    }
    ring.push([currentLongitude, currentSource[1]]);
    previousSource = currentSource;
    previousLongitude = currentLongitude;
  }

  const netTurns = Math.round((previousLongitude - first[0]) / 360);
  if (
    Math.abs(previousLongitude - first[0] - netTurns * 360) >
      GEOMETRY_EPSILON ||
    Math.abs(netTurns) > 1
  ) {
    return null;
  }
  let pole: UnwrappedBoundary["pole"] = null;
  if (netTurns === 0) {
    ring[ring.length - 1] = [first[0], first[1]];
  } else {
    const latitudes = source.slice(0, -1).map((point) => point[1]);
    if (latitudes.every((latitude) => latitude > 0)) pole = 90;
    else if (latitudes.every((latitude) => latitude < 0)) pole = -90;
    else return null;
    // Cutting a pole-enclosing spherical ring opens it by one world turn.
    // Close that cut over the declared hemisphere's pole before clipping it
    // into RFC 7946 longitude windows.
    ring.push(
      [previousLongitude, pole],
      [first[0], pole],
      [first[0], first[1]],
    );
  }
  if (Math.abs(signedRingArea(ring)) <= GEOMETRY_EPSILON) return null;
  return Object.freeze({
    ring,
    netTurns: netTurns as -1 | 0 | 1,
    pole,
    source: Object.freeze(source),
  });
}

function longitudeRange(rings: readonly ClippingRing[]) {
  let minimum = Number.POSITIVE_INFINITY;
  let maximum = Number.NEGATIVE_INFINITY;
  for (const ring of rings) {
    for (const [longitude] of ring) {
      minimum = Math.min(minimum, longitude);
      maximum = Math.max(maximum, longitude);
    }
  }
  return { minimum, maximum };
}

function shiftedRing(ring: ClippingRing, longitudeShift: number): ClippingRing {
  return ring.map(([longitude, latitude]) => [
    longitude + longitudeShift,
    latitude,
  ]);
}

function canonicalCoordinate(value: number, minimum: number, maximum: number) {
  if (!Number.isFinite(value)) return null;
  if (Math.abs(value - minimum) <= GEOMETRY_EPSILON) return minimum;
  if (Math.abs(value - maximum) <= GEOMETRY_EPSILON) return maximum;
  if (value < minimum || value > maximum) return null;
  return Object.is(value, -0) ? 0 : value;
}

type SourcePositionLookup = ReadonlyMap<string, GeoJsonPosition>;

function generatedCoordinate(value: number) {
  const stable = Number(value.toFixed(GENERATED_COORDINATE_DECIMALS));
  return Object.is(stable, -0) ? 0 : stable;
}

function positionLookupKey(longitude: number, latitude: number) {
  return `${generatedCoordinate(longitude)},${generatedCoordinate(latitude)}`;
}

function sourcePositionLookup(
  sources: readonly (readonly GeoJsonPosition[])[],
): SourcePositionLookup | null {
  const lookup = new Map<string, GeoJsonPosition>();
  for (const source of sources) {
    for (const point of source.slice(0, -1)) {
      const aliases = Math.abs(point[0]) === 180
        ? [point, Object.freeze([-point[0], point[1]] as const)]
        : [point];
      for (const alias of aliases) {
        const key = positionLookupKey(alias[0], alias[1]);
        const existing = lookup.get(key);
        if (
          existing &&
          !positionsEqual(existing, alias) &&
          !(Math.abs(existing[0]) === 180 && Math.abs(alias[0]) === 180 &&
            existing[1] === alias[1])
        ) {
          // Two distinct declared vertices must never be collapsed merely
          // because the generated-coordinate precision cannot distinguish them.
          return null;
        }
        lookup.set(key, alias);
      }
    }
  }
  return lookup;
}

function canonicalProjectedPosition(
  longitudeInput: number,
  latitudeInput: number,
  sourceLookup: SourcePositionLookup,
): ClippingPosition | null {
  const longitude = canonicalCoordinate(longitudeInput, -180, 180);
  const latitude = canonicalCoordinate(latitudeInput, -90, 90);
  if (longitude === null || latitude === null) return null;
  const source = sourceLookup.get(positionLookupKey(longitude, latitude));
  if (
    source &&
    Math.abs(Math.abs(longitude) - Math.abs(source[0])) <= GEOMETRY_EPSILON &&
    Math.abs(latitude - source[1]) <= GEOMETRY_EPSILON
  ) {
    return [
      Math.abs(longitude) === 180 && Math.abs(source[0]) === 180
        ? longitude
        : source[0],
      source[1],
    ];
  }
  return [generatedCoordinate(longitude), generatedCoordinate(latitude)];
}

function positionsNearlyEqual(
  left: GeoJsonPosition,
  right: GeoJsonPosition,
) {
  return Math.abs(left[0] - right[0]) <= GEOMETRY_EPSILON &&
    Math.abs(left[1] - right[1]) <= GEOMETRY_EPSILON;
}

function normalizedProjectedRing(
  input: ClippingRing,
  clockwise: boolean,
  sourceLookup: SourcePositionLookup,
): GeoJsonLinearRing | null {
  const ring: GeoJsonPosition[] = [];
  for (const pair of input) {
    const projected = canonicalProjectedPosition(pair[0], pair[1], sourceLookup);
    if (!projected) return null;
    const next = Object.freeze([projected[0], projected[1]] as const);
    const previous = ring[ring.length - 1];
    if (!previous || !positionsNearlyEqual(previous, next)) ring.push(next);
  }
  const first = ring[0];
  const last = ring[ring.length - 1];
  if (!first || !last) return null;
  if (!positionsNearlyEqual(first, last)) ring.push(first);
  else ring[ring.length - 1] = first;
  const distinct = new Set(
    ring.slice(0, -1).map(([longitude, latitude]) => `${longitude},${latitude}`),
  );
  const area = signedRingArea(ring);
  if (distinct.size < 3 || Math.abs(area) <= GEOMETRY_EPSILON) return null;
  const result = area < 0 === clockwise ? ring : [...ring].reverse();
  return Object.freeze(result);
}

function normalizedProjectedPolygons(
  input: ClippingMultiPolygon,
  sourceLookup: SourcePositionLookup,
): readonly PolygonCoordinates[] | null {
  if (
    input.length < 1 ||
    input.length > MAX_PROJECTED_POLYGONS_PER_GRANULE
  ) {
    return null;
  }
  let pointCount = 0;
  const polygons: PolygonCoordinates[] = [];
  for (const polygon of input) {
    const exteriorInput = polygon[0];
    if (!exteriorInput) return null;
    const exterior = normalizedProjectedRing(exteriorInput, false, sourceLookup);
    if (!exterior) return null;
    const rings: GeoJsonLinearRing[] = [exterior];
    pointCount += exterior.length;
    for (const holeInput of polygon.slice(1)) {
      const hole = normalizedProjectedRing(holeInput, true, sourceLookup);
      if (!hole) return null;
      rings.push(hole);
      pointCount += hole.length;
    }
    if (pointCount > MAX_PROJECTED_POINTS_PER_GRANULE) return null;
    polygons.push(Object.freeze(rings));
  }
  return Object.freeze(polygons);
}

function pointOnSegment(
  point: GeoJsonPosition,
  start: GeoJsonPosition,
  end: GeoJsonPosition,
) {
  const cross =
    (point[0] - start[0]) * (end[1] - start[1]) -
    (point[1] - start[1]) * (end[0] - start[0]);
  const scale = Math.max(
    1,
    Math.abs(end[0] - start[0]),
    Math.abs(end[1] - start[1]),
  );
  if (Math.abs(cross) > GEOMETRY_EPSILON * scale) return false;
  return (
    point[0] >= Math.min(start[0], end[0]) - GEOMETRY_EPSILON &&
    point[0] <= Math.max(start[0], end[0]) + GEOMETRY_EPSILON &&
    point[1] >= Math.min(start[1], end[1]) - GEOMETRY_EPSILON &&
    point[1] <= Math.max(start[1], end[1]) + GEOMETRY_EPSILON
  );
}

function sourceVerticesRemainOnBoundary(
  sourceBoundaries: readonly (readonly GeoJsonPosition[])[],
  polygons: readonly PolygonCoordinates[],
) {
  const outputRings = polygons.flatMap((polygon) => polygon);
  return sourceBoundaries.every((source) =>
    source.slice(0, -1).every((point) => {
      const candidates: GeoJsonPosition[] = [point];
      if (point[0] === -180) candidates.push([180, point[1]]);
      if (point[0] === 180) candidates.push([-180, point[1]]);
      return candidates.some((candidate) =>
        outputRings.some((ring) =>
          ring.slice(0, -1).some((start, index) => {
            const end = ring[index + 1];
            return end !== undefined && pointOnSegment(candidate, start, end);
          }),
        ),
      );
    }),
  );
}

function polygonCoordinates(
  polygon: z.infer<typeof gPolygonSchema>,
): readonly PolygonCoordinates[] | null {
  const exterior = unwrappedBoundary(polygon.Boundary);
  if (
    !exterior ||
    (exterior.netTurns === 1 && exterior.pole !== 90) ||
    (exterior.netTurns === -1 && exterior.pole !== -90)
  ) {
    // CMR exterior rings are counter-clockwise: a positive world turn
    // encloses the north pole and a negative turn encloses the south pole.
    return null;
  }
  const unwrapped: ClippingRing[] = [exterior.ring];
  const sources: Array<readonly GeoJsonPosition[]> = [exterior.source];
  const exteriorRange = longitudeRange([exterior.ring]);
  const exteriorCenter = (exteriorRange.minimum + exteriorRange.maximum) / 2;
  for (const boundary of polygon.ExclusiveZone?.Boundaries ?? []) {
    const hole = unwrappedBoundary(boundary);
    if (
      !hole ||
      (hole.pole !== null && hole.pole !== exterior.pole)
    ) {
      return null;
    }
    const holeRange = longitudeRange([hole.ring]);
    const holeCenter = (holeRange.minimum + holeRange.maximum) / 2;
    const shift = 360 * Math.round((exteriorCenter - holeCenter) / 360);
    unwrapped.push(shiftedRing(hole.ring, shift));
    sources.push(hole.source);
  }

  const range = longitudeRange(unwrapped);
  const sourceLookup = sourcePositionLookup(sources);
  if (!sourceLookup) return null;
  const firstWindow = Math.ceil((range.minimum - 180) / 360);
  const lastWindow = Math.floor((range.maximum + 180) / 360);
  if (
    !Number.isSafeInteger(firstWindow) ||
    !Number.isSafeInteger(lastWindow) ||
    lastWindow < firstWindow ||
    lastWindow - firstWindow + 1 > MAX_LONGITUDE_WINDOWS_PER_POLYGON
  ) {
    return null;
  }

  const clippedPolygons: ClippingPolygon[] = [];
  let clippedPointCount = 0;
  try {
    for (let window = firstWindow; window <= lastWindow; window += 1) {
      const left = -180 + 360 * window;
      const right = 180 + 360 * window;
      const windowPolygon: ClippingPolygon = [[
        [left, -90],
        [right, -90],
        [right, 90],
        [left, 90],
        [left, -90],
      ]];
      const intersection = polygonClipping.intersection(
        unwrapped,
        windowPolygon,
      );
      for (const clipped of intersection) {
        const shifted: ClippingPolygon = [];
        for (const ring of clipped) {
          const shiftedRing: ClippingRing = [];
          for (const [longitude, latitude] of ring) {
            const position = canonicalProjectedPosition(
              longitude - 360 * window,
              latitude,
              sourceLookup,
            );
            if (!position) return null;
            shiftedRing.push(position);
          }
          shifted.push(shiftedRing);
        }
        clippedPointCount += shifted.reduce(
          (count, ring) => count + ring.length,
          0,
        );
        if (
          clippedPolygons.length >= MAX_PROJECTED_POLYGONS_PER_GRANULE ||
          clippedPointCount > MAX_PROJECTED_POINTS_PER_GRANULE
        ) {
          return null;
        }
        clippedPolygons.push(shifted);
      }
    }
    if (clippedPolygons.length === 0) return null;
    const merged = clippedPolygons.length === 1
      ? [clippedPolygons[0] as ClippingPolygon]
      : polygonClipping.union(
          clippedPolygons[0] as ClippingPolygon,
          ...clippedPolygons.slice(1),
        );
    const normalized = normalizedProjectedPolygons(merged, sourceLookup);
    if (
      !normalized ||
      !sourceVerticesRemainOnBoundary(sources, normalized)
    ) {
      return null;
    }
    return normalized;
  } catch {
    // Upstream self-intersections or clipping safety limits are quarantined;
    // they never become a guessed rectangle or whole-world footprint.
    return null;
  }
}

function rectanglePolygons(
  rectangle: z.infer<typeof boundingRectangleSchema>,
): readonly PolygonCoordinates[] | null {
  const west = rectangle.WestBoundingCoordinate;
  const east = rectangle.EastBoundingCoordinate;
  const north = rectangle.NorthBoundingCoordinate;
  const south = rectangle.SouthBoundingCoordinate;
  if (north <= south || west === east) return null;

  const rectangleRing = (left: number, right: number): PolygonCoordinates =>
    Object.freeze([
      Object.freeze([
        Object.freeze([left, south] as const),
        Object.freeze([right, south] as const),
        Object.freeze([right, north] as const),
        Object.freeze([left, north] as const),
        Object.freeze([left, south] as const),
      ]),
    ]);

  // UMM-G explicitly permits a west value greater than east for a rectangle
  // crossing the antimeridian. Split it instead of drawing the complement.
  if (west > east) {
    return Object.freeze([
      rectangleRing(west, 180),
      rectangleRing(-180, east),
    ]);
  }
  return Object.freeze([rectangleRing(west, east)]);
}

function footprintFromSpatialExtent(spatialExtent: unknown): Readonly<{
  footprint: CmrCatalogFootprint;
  source: SatellitePass["footprintSource"];
}> | null {
  const parsed = spatialExtentSchema.safeParse(spatialExtent);
  if (!parsed.success) return null;
  const geometry = parsed.data.HorizontalSpatialDomain.Geometry;

  // Mixed geometry encodings are ambiguous alternate representations rather
  // than independent coverage. Fail closed instead of inventing their union.
  if (geometry.GPolygons && geometry.BoundingRectangles) return null;

  const polygons: PolygonCoordinates[] = [];
  let source: SatellitePass["footprintSource"];
  if (geometry.GPolygons) {
    source = "umm-g-gpolygon";
    let sourcePointCount = 0;
    for (const polygon of geometry.GPolygons) {
      sourcePointCount += polygon.Boundary.Points.length;
      sourcePointCount += (polygon.ExclusiveZone?.Boundaries ?? []).reduce(
        (count, boundary) => count + boundary.Points.length,
        0,
      );
      if (sourcePointCount > MAX_SOURCE_POINTS_PER_GRANULE) return null;
      const coordinates = polygonCoordinates(polygon);
      if (!coordinates) return null;
      polygons.push(...coordinates);
    }
  } else if (geometry.BoundingRectangles) {
    source = "umm-g-bounding-rectangle";
    for (const rectangle of geometry.BoundingRectangles) {
      const coordinates = rectanglePolygons(rectangle);
      if (!coordinates) return null;
      polygons.push(...coordinates);
    }
  } else {
    return null;
  }

  if (polygons.length === 0) return null;
  const footprint: CmrCatalogFootprint =
    polygons.length === 1
      ? Object.freeze({ type: "Polygon", coordinates: polygons[0] ?? [] })
      : Object.freeze({
          type: "MultiPolygon",
          coordinates: Object.freeze(polygons),
        });
  return Object.freeze({ footprint, source });
}

function temporalRange(temporalExtent: z.infer<typeof temporalExtentSchema>) {
  if ("SingleDateTime" in temporalExtent) {
    const observedAt = normalizedTimestamp(temporalExtent.SingleDateTime);
    return Object.freeze({ observedFrom: observedAt, observedTo: observedAt });
  }
  const observedFrom = normalizedTimestamp(
    temporalExtent.RangeDateTime.BeginningDateTime,
  );
  const observedTo = normalizedTimestamp(
    temporalExtent.RangeDateTime.EndingDateTime,
  );
  if (Date.parse(observedTo) < Date.parse(observedFrom)) return null;
  return Object.freeze({ observedFrom, observedTo });
}

function passFromItem(
  product: CmrProduct,
  item: z.infer<typeof cmrItemSchema>,
  itemIndex: number,
): SatellitePass | "product-mismatch" | "missing-footprint" | "invalid-footprint" {
  if (
    item.umm.CollectionReference.ShortName !== product.shortName ||
    item.umm.CollectionReference.Version !== product.version
  ) {
    return "product-mismatch";
  }
  if (item.umm.SpatialExtent === undefined) return "missing-footprint";
  const spatial = footprintFromSpatialExtent(item.umm.SpatialExtent);
  const temporal = temporalRange(item.umm.TemporalExtent);
  if (!spatial || !temporal) return "invalid-footprint";

  return Object.freeze({
    itemIndex,
    id: item.meta["concept-id"],
    revisionId: item.meta["revision-id"],
    granuleUr: item.umm.GranuleUR,
    collectionId: item.meta["collection-concept-id"],
    product: product.shortName,
    productVersion: product.version,
    satellite: product.satellite,
    sensor: "VIIRS",
    ummGVersion: CMR_UMM_G_VERSION,
    observedFrom: temporal.observedFrom,
    observedTo: temporal.observedTo,
    producedAt: item.umm.DataGranule?.ProductionDateTime
      ? normalizedTimestamp(item.umm.DataGranule.ProductionDateTime)
      : null,
    catalogedAt: normalizedTimestamp(item.meta["revision-date"]),
    dayNight: dayNight(item.umm.DataGranule?.DayNightFlag),
    footprint: spatial.footprint,
    footprintSource: spatial.source,
    footprintPrecision: "not_applicable",
    coverage: "catalog-footprint",
    anomalyAssessment: "not-assessed",
  });
}

function safeItemIdentity(item: unknown) {
  if (item === null || typeof item !== "object" || Array.isArray(item)) {
    return { conceptId: null, revisionId: null };
  }
  const meta = Reflect.get(item, "meta");
  if (meta === null || typeof meta !== "object" || Array.isArray(meta)) {
    return { conceptId: null, revisionId: null };
  }
  const conceptId = Reflect.get(meta, "concept-id");
  const revisionId = Reflect.get(meta, "revision-id");
  return {
    conceptId:
      typeof conceptId === "string" && CMR_GRANULE_CONCEPT_ID.test(conceptId)
        ? conceptId
        : null,
    revisionId:
      typeof revisionId === "number" &&
      Number.isSafeInteger(revisionId) &&
      revisionId > 0
        ? revisionId
        : null,
  };
}

/**
 * Parses bytes only after the collector has durably linked them to an HTTP
 * exchange and raw object. This adapter deliberately performs no network I/O.
 * Items without a valid, source-declared UMM-G footprint are quarantined; the
 * query window/global bounds are never substituted as geometry.
 */
export function parseCmrProductPasses(
  product: CmrProduct,
  bytes: Uint8Array,
): CmrProductResult {
  try {
    const parsed = cmrResponseSchema.safeParse(cappedJson(bytes));
    if (!parsed.success) throw new CmrPayloadError("invalid-response");

    const passes: SatellitePass[] = [];
    const rejectedItems: CmrRejectedItem[] = [];
    parsed.data.items.forEach((rawItem, itemIndex) => {
      const identity = safeItemIdentity(rawItem);
      const item = cmrItemSchema.safeParse(rawItem);
      if (!item.success) {
        rejectedItems.push(
          Object.freeze({ itemIndex, ...identity, reason: "invalid-item" }),
        );
        return;
      }
      const pass = passFromItem(product, item.data, itemIndex);
      if (typeof pass === "string") {
        rejectedItems.push(
          Object.freeze({ itemIndex, ...identity, reason: pass }),
        );
        return;
      }
      passes.push(pass);
    });
    passes.sort(
      (left, right) =>
        Date.parse(right.observedFrom) - Date.parse(left.observedFrom),
    );

    return Object.freeze({
      product: product.shortName,
      satellite: product.satellite,
      status: "ok",
      hits: parsed.data.hits,
      returnedItems: parsed.data.items.length,
      passes: Object.freeze(passes),
      rejectedItems: Object.freeze(rejectedItems),
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
      returnedItems: 0,
      passes: Object.freeze([]),
      rejectedItems: Object.freeze([]),
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
