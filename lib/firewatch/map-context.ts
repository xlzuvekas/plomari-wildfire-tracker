import { z } from "zod";

const MAX_WEB_MERCATOR_LATITUDE = 85.051_128_78;
const EARTH_CIRCUMFERENCE_M = 40_075_016.686;
const TARGET_CELL_SPAN_M = 18_000;
const MIN_GRID_ZOOM = 7;
const MAX_GRID_ZOOM = 11;

export const AREA_GRID_VERSION = "web-mercator-adaptive-v1" as const;
export const AREA_NOTICE_VERSION = "coarse-area-v1" as const;

export const mapModeSchema = z.enum(["explore", "nearby", "incident"]);
export const areaSelectionMethodSchema = z.enum([
  "gps_coarse",
  "map_confirm",
  "place_select",
  "incident_select",
]);

const areaCellKeySchema = z
  .string()
  .regex(/^wm\/(?:[7-9]|10|11)\/\d{1,4}\/\d{1,4}$/u);
const oneUseNonceSchema = z
  .string()
  .regex(/^[A-Za-z0-9_-]{22,43}$/u)
  .describe("128–256 bits of base64url randomness, used only for retry dedupe");

export const areaResolveRequestSchema = z
  .strictObject({
    schemaVersion: z.literal("1.0.0"),
    gridVersion: z.literal(AREA_GRID_VERSION),
    cellKey: areaCellKeySchema,
    selectionMethod: areaSelectionMethodSchema,
    noticeVersion: z.literal(AREA_NOTICE_VERSION),
    requestNonce: oneUseNonceSchema,
  })
  .refine((request) => parseAreaCellKey(request.cellKey) !== null, {
    message: "The coarse area key is outside the supported grid",
    path: ["cellKey"],
  });

const longitudeSchema = z.number().finite().min(-180).max(180);
const latitudeSchema = z
  .number()
  .finite()
  .min(-MAX_WEB_MERCATOR_LATITUDE)
  .max(MAX_WEB_MERCATOR_LATITUDE);

const ianaTimeZoneSchema = z.string().min(1).max(100).refine((value) => {
  try {
    new Intl.DateTimeFormat("en", { timeZone: value }).format(0);
    return true;
  } catch {
    return false;
  }
});

export const mapContextSchema = z
  .strictObject({
    schemaVersion: z.literal("1.0.0"),
    mode: mapModeSchema,
    area: z
      .strictObject({
        gridVersion: z.literal(AREA_GRID_VERSION),
        cellKey: areaCellKeySchema,
        center: z.strictObject({
          latitude: latitudeSchema,
          longitude: longitudeSchema,
        }),
        bounds: z.strictObject({
          west: longitudeSchema,
          south: latitudeSchema,
          east: longitudeSchema,
          north: latitudeSchema,
        }),
        minimumSpanM: z.number().int().min(8_000).max(80_000),
        placeLabel: z.string().trim().min(1).max(200).nullable(),
        countryCode: z.string().regex(/^[A-Z]{2}$/u).nullable(),
        adminRegion: z.string().trim().min(1).max(160).nullable(),
        timeZone: ianaTimeZoneSchema,
        locales: z.array(z.string().regex(/^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/u)).min(1).max(6),
        unitSystem: z.enum(["metric", "imperial"]),
      })
      .nullable(),
    incident: z
      .strictObject({
        incidentId: z
          .string()
          .regex(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu),
        slug: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/u),
        label: z.string().trim().min(1).max(200),
      })
      .nullable(),
    selectionMethod: areaSelectionMethodSchema.nullable(),
  })
  .superRefine((context, refinement) => {
    if (context.mode === "explore" && context.incident !== null) {
      refinement.addIssue({
        code: "custom",
        message: "Explore mode cannot carry an incident selection",
        path: ["incident"],
      });
    }
    if (context.mode === "nearby" && context.area === null) {
      refinement.addIssue({
        code: "custom",
        message: "Nearby mode requires a coarse area",
        path: ["area"],
      });
    }
    if (context.mode === "incident" && context.incident === null) {
      refinement.addIssue({
        code: "custom",
        message: "Incident mode requires an incident",
        path: ["incident"],
      });
    }

    if (context.area) {
      const canonical = parseAreaCellKey(context.area.cellKey);
      const matchesCanonicalCell =
        canonical !== null &&
        context.area.center.latitude === canonical.center.latitude &&
        context.area.center.longitude === canonical.center.longitude &&
        context.area.bounds.west === canonical.bounds.west &&
        context.area.bounds.south === canonical.bounds.south &&
        context.area.bounds.east === canonical.bounds.east &&
        context.area.bounds.north === canonical.bounds.north &&
        context.area.minimumSpanM === canonical.minimumSpanM;
      if (!matchesCanonicalCell) {
        refinement.addIssue({
          code: "custom",
          message: "Area geometry must be derived canonically from its coarse cell key",
          path: ["area"],
        });
      }
    }
  });

export type AreaResolveRequest = z.infer<typeof areaResolveRequestSchema>;
export type MapContext = z.infer<typeof mapContextSchema>;

export type CoarseAreaCell = Readonly<{
  gridVersion: typeof AREA_GRID_VERSION;
  cellKey: string;
  zoom: number;
  x: number;
  y: number;
  center: Readonly<{ latitude: number; longitude: number }>;
  bounds: Readonly<{
    west: number;
    south: number;
    east: number;
    north: number;
  }>;
  minimumSpanM: number;
}>;

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(maximum, Math.max(minimum, value));
}

function longitudeForTileX(x: number, zoom: number) {
  return (x / 2 ** zoom) * 360 - 180;
}

function latitudeForTileY(y: number, zoom: number) {
  const mercator = Math.PI * (1 - (2 * y) / 2 ** zoom);
  return (Math.atan(Math.sinh(mercator)) * 180) / Math.PI;
}

function adaptiveZoom(latitude: number) {
  const latitudeRadians = (Math.abs(latitude) * Math.PI) / 180;
  const localCircumference =
    EARTH_CIRCUMFERENCE_M * Math.max(0.000_001, Math.cos(latitudeRadians));
  return clamp(
    Math.floor(Math.log2(localCircumference / TARGET_CELL_SPAN_M)),
    MIN_GRID_ZOOM,
    MAX_GRID_ZOOM,
  );
}

function cellFromCoordinates(zoom: number, x: number, y: number): CoarseAreaCell {
  const west = longitudeForTileX(x, zoom);
  const east = longitudeForTileX(x + 1, zoom);
  const north = latitudeForTileY(y, zoom);
  const south = latitudeForTileY(y + 1, zoom);
  const latitude = latitudeForTileY(y + 0.5, zoom);
  const longitude = (west + east) / 2;
  const eastWestSpan =
    (EARTH_CIRCUMFERENCE_M * Math.cos((latitude * Math.PI) / 180)) /
    2 ** zoom;
  const northSouthSpan = (EARTH_CIRCUMFERENCE_M / 2 ** zoom) *
    ((north - south) / (360 / 2 ** zoom));

  return Object.freeze({
    gridVersion: AREA_GRID_VERSION,
    cellKey: `wm/${zoom}/${x}/${y}`,
    zoom,
    x,
    y,
    center: Object.freeze({ latitude, longitude }),
    bounds: Object.freeze({ west, south, east, north }),
    minimumSpanM: Math.round(Math.min(eastWestSpan, northSouthSpan)),
  });
}

/**
 * Converts an exact device fix into a versioned coarse area entirely on the
 * client. Callers send only `cellKey`, never the input coordinates.
 */
export function coarseAreaCellForLocation(
  latitude: number,
  longitude: number,
): CoarseAreaCell {
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
    throw new TypeError("Location must contain finite coordinates.");
  }
  if (latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) {
    throw new RangeError("Location is outside WGS84 coordinate bounds.");
  }

  const clampedLatitude = clamp(
    latitude,
    -MAX_WEB_MERCATOR_LATITUDE,
    MAX_WEB_MERCATOR_LATITUDE,
  );
  const zoom = adaptiveZoom(clampedLatitude);
  const scale = 2 ** zoom;
  const x = clamp(Math.floor(((longitude + 180) / 360) * scale), 0, scale - 1);
  const latitudeRadians = (clampedLatitude * Math.PI) / 180;
  const y = clamp(
    Math.floor(
      ((1 - Math.asinh(Math.tan(latitudeRadians)) / Math.PI) / 2) * scale,
    ),
    0,
    scale - 1,
  );
  return cellFromCoordinates(zoom, x, y);
}

export function parseAreaCellKey(value: string): CoarseAreaCell | null {
  const match = /^wm\/(\d{1,2})\/(\d{1,4})\/(\d{1,4})$/u.exec(value);
  if (!match) return null;
  const zoom = Number(match[1]);
  const x = Number(match[2]);
  const y = Number(match[3]);
  if (
    !Number.isInteger(zoom) ||
    zoom < MIN_GRID_ZOOM ||
    zoom > MAX_GRID_ZOOM ||
    !Number.isInteger(x) ||
    !Number.isInteger(y) ||
    x < 0 ||
    y < 0 ||
    x >= 2 ** zoom ||
    y >= 2 ** zoom
  ) {
    return null;
  }
  return cellFromCoordinates(zoom, x, y);
}
