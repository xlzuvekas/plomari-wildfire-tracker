import { z } from "zod";

/**
 * Internal raw-pixel decoding contract only. Nothing in this module is a
 * negative assessment, public-safety assertion, incident-resolution signal,
 * notification decision, or all-clear.
 */
export const VIIRS_FIREMASK_ASSESSABILITY_CONTRACT_VERSION =
  "0.1.0-internal" as const;

export const VIIRS_C2_ALGORITHM_QA_NON_NOMINAL_MASK = 0x7f as const;
export const VIIRS_C2_GEOLOCATION_INVALID_MASK = 0x07 as const;
export const VIIRS_FIREMASK_MAX_PIXEL_COUNT = 100_000 as const;

export const VIIRS_C2_GEOLOCATION_COORDINATE_VALIDITY_RULE = Object.freeze({
  ruleId: "finite_wgs84_not_declared_fill_v1" as const,
  requireFiniteLatitudeLongitude: true as const,
  latitudeRangeInclusive: Object.freeze([-90, 90] as const),
  longitudeRangeInclusive: Object.freeze([-180, 180] as const),
  rejectDatasetDeclaredFillValues: true as const,
});

export const VIIRS_C2_FIREMASK_QA_RULE = Object.freeze({
  ruleId: "viirs-c2-firemask-input-and-geolocation-qa" as const,
  ruleVersion: "0.1.0" as const,
  algorithmQaNonNominalMask: VIIRS_C2_ALGORITHM_QA_NON_NOMINAL_MASK,
  geolocationInvalidMask: VIIRS_C2_GEOLOCATION_INVALID_MASK,
  coordinateValidityRule: VIIRS_C2_GEOLOCATION_COORDINATE_VALIDITY_RULE,
});

export const VIIRS_FIREMASK_SUPPORT_COVERAGE_METHOD =
  "geolocated_pixel_union_covers_modeled_support_v1" as const;

export const VIIRS_FIREMASK_PERSISTED_COVERAGE_REQUIREMENT = Object.freeze({
  required: true as const,
  authority: "persisted_postgis_only" as const,
  method: VIIRS_FIREMASK_SUPPORT_COVERAGE_METHOD,
  status: "not_performed_by_raw_pixel_summarizer" as const,
});

// The dedicated product-named attribute identifies the geolocation input.
// NASA's raw InputPointer is a multi-input metadata value and is intentionally
// not normalized into a single granule by this decoder contract.
export const VIIRS_C2_FIREMASK_PRODUCT_PAIRS = Object.freeze({
  VIIRS_SNPP_NRT: Object.freeze({
    firmsProduct: "VIIRS_SNPP_NRT" as const,
    fireMaskProduct: "VNP14IMG" as const,
    fireMaskCollectionFileVersion: "002" as const,
    geolocationProduct: "VNP03IMG" as const,
    geolocationCollectionFileVersion: "002" as const,
    geolocationInputMetadataAttribute: "VNP03IMG" as const,
    satellite: "Suomi-NPP" as const,
  }),
  VIIRS_NOAA20_NRT: Object.freeze({
    firmsProduct: "VIIRS_NOAA20_NRT" as const,
    fireMaskProduct: "VJ114IMG" as const,
    fireMaskCollectionFileVersion: "002" as const,
    geolocationProduct: "VJ103IMG" as const,
    geolocationCollectionFileVersion: "021" as const,
    geolocationInputMetadataAttribute: "VJ103IMG" as const,
    satellite: "NOAA-20" as const,
  }),
  VIIRS_NOAA21_NRT: Object.freeze({
    firmsProduct: "VIIRS_NOAA21_NRT" as const,
    fireMaskProduct: "VJ214IMG" as const,
    fireMaskCollectionFileVersion: "002" as const,
    geolocationProduct: "VJ203IMG" as const,
    geolocationCollectionFileVersion: "021" as const,
    geolocationInputMetadataAttribute: "VJ203IMG" as const,
    satellite: "NOAA-21" as const,
  }),
});

export type ViirsFirmsProduct = keyof typeof VIIRS_C2_FIREMASK_PRODUCT_PAIRS;
export type ViirsFireMaskProductPair =
  (typeof VIIRS_C2_FIREMASK_PRODUCT_PAIRS)[ViirsFirmsProduct];

export const VIIRS_C2_FIREMASK_CLASSES = Object.freeze([
  Object.freeze({ value: 0 as const, meaning: "not_processed" as const }),
  Object.freeze({ value: 1 as const, meaning: "bowtie_deleted" as const }),
  Object.freeze({ value: 2 as const, meaning: "sun_glint" as const }),
  Object.freeze({ value: 3 as const, meaning: "water" as const }),
  Object.freeze({ value: 4 as const, meaning: "cloud" as const }),
  Object.freeze({ value: 5 as const, meaning: "land" as const }),
  Object.freeze({ value: 6 as const, meaning: "unclassified" as const }),
  Object.freeze({ value: 7 as const, meaning: "fire_low_confidence" as const }),
  Object.freeze({
    value: 8 as const,
    meaning: "fire_nominal_confidence" as const,
  }),
  Object.freeze({
    value: 9 as const,
    meaning: "fire_high_confidence" as const,
  }),
]);

export type ViirsC2FireMaskClass =
  (typeof VIIRS_C2_FIREMASK_CLASSES)[number]["value"];

export type ViirsFireMaskClassPixelCounts = Readonly<{
  0: number;
  1: number;
  2: number;
  3: number;
  4: number;
  5: number;
  6: number;
  7: number;
  8: number;
  9: number;
}>;

export type ViirsFireMaskRawPixel = Readonly<{
  maskClass: ViirsC2FireMaskClass;
  algorithmQaWord: number;
  geolocationQualityWord: number;
  latitude: number;
  longitude: number;
}>;

export type ViirsFireMaskPixelSummaryInput = Readonly<{
  productPair: ViirsFireMaskProductPair;
  qaRule: typeof VIIRS_C2_FIREMASK_QA_RULE;
  originalDetectionObservedAt: string;
  observedWindow: Readonly<{
    from: string;
    to: string;
  }>;
  geolocationFillValues: Readonly<{
    coordinateStorageType: "float32";
    latitude: number;
    latitudeIeee754Hex: string;
    longitude: number;
    longitudeIeee754Hex: string;
  }>;
  pixels: readonly ViirsFireMaskRawPixel[];
}>;

export const VIIRS_FIREMASK_INTERNAL_USE_RESTRICTIONS = Object.freeze({
  visibility: "internal_only" as const,
  negativeAssessmentEligible: false as const,
  allClearEligible: false as const,
  officialStatusEligible: false as const,
  protectiveActionEligible: false as const,
  incidentResolutionEligible: false as const,
  notificationEligible: false as const,
});

export const VIIRS_FIREMASK_INDETERMINATE_REASONS = Object.freeze([
  "no_decoded_pixels",
  "invalid_geolocation",
  "non_nominal_qa",
  "class_0_not_processed",
  "class_1_bowtie_deleted",
  "class_2_sun_glint",
  "class_4_cloud",
  "class_6_unclassified",
  "persisted_postgis_coverage_verification_required",
] as const);

export type ViirsFireMaskIndeterminateReason =
  (typeof VIIRS_FIREMASK_INDETERMINATE_REASONS)[number];

type ViirsFireMaskPixelSummaryBasis = Readonly<{
  contractVersion: typeof VIIRS_FIREMASK_ASSESSABILITY_CONTRACT_VERSION;
  productPair: ViirsFireMaskProductPair;
  qaRule: typeof VIIRS_C2_FIREMASK_QA_RULE;
  originalDetectionObservedAt: string;
  observedWindow: ViirsFireMaskPixelSummaryInput["observedWindow"];
  geolocationFillValues: ViirsFireMaskPixelSummaryInput["geolocationFillValues"];
  pixelCount: number;
  maskClassPixelCounts: ViirsFireMaskClassPixelCounts;
  invalidGeolocationPixelCount: number;
  nonNominalQaPixelCount: number;
  coverageVerification: typeof VIIRS_FIREMASK_PERSISTED_COVERAGE_REQUIREMENT;
  restrictions: typeof VIIRS_FIREMASK_INTERNAL_USE_RESTRICTIONS;
}>;

export type ViirsFireMaskPixelSummary =
  | (ViirsFireMaskPixelSummaryBasis &
      Readonly<{
        outcome: "fire_returned";
        firePixelCount: number;
      }>)
  | (ViirsFireMaskPixelSummaryBasis &
      Readonly<{
        outcome: "indeterminate";
        reasons: readonly ViirsFireMaskIndeterminateReason[];
      }>);

const canonicalUtcInstantSchema = z.string().refine((value) => {
  const epochMilliseconds = Date.parse(value);
  return (
    Number.isFinite(epochMilliseconds) &&
    new Date(epochMilliseconds).toISOString() === value
  );
}, "Timestamp must be a canonical UTC instant");

const productPairSchema = z.discriminatedUnion("firmsProduct", [
  z.strictObject({
    firmsProduct: z.literal("VIIRS_SNPP_NRT"),
    fireMaskProduct: z.literal("VNP14IMG"),
    fireMaskCollectionFileVersion: z.literal("002"),
    geolocationProduct: z.literal("VNP03IMG"),
    geolocationCollectionFileVersion: z.literal("002"),
    geolocationInputMetadataAttribute: z.literal("VNP03IMG"),
    satellite: z.literal("Suomi-NPP"),
  }),
  z.strictObject({
    firmsProduct: z.literal("VIIRS_NOAA20_NRT"),
    fireMaskProduct: z.literal("VJ114IMG"),
    fireMaskCollectionFileVersion: z.literal("002"),
    geolocationProduct: z.literal("VJ103IMG"),
    geolocationCollectionFileVersion: z.literal("021"),
    geolocationInputMetadataAttribute: z.literal("VJ103IMG"),
    satellite: z.literal("NOAA-20"),
  }),
  z.strictObject({
    firmsProduct: z.literal("VIIRS_NOAA21_NRT"),
    fireMaskProduct: z.literal("VJ214IMG"),
    fireMaskCollectionFileVersion: z.literal("002"),
    geolocationProduct: z.literal("VJ203IMG"),
    geolocationCollectionFileVersion: z.literal("021"),
    geolocationInputMetadataAttribute: z.literal("VJ203IMG"),
    satellite: z.literal("NOAA-21"),
  }),
]);

const qaRuleSchema = z.strictObject({
  ruleId: z.literal(VIIRS_C2_FIREMASK_QA_RULE.ruleId),
  ruleVersion: z.literal(VIIRS_C2_FIREMASK_QA_RULE.ruleVersion),
  algorithmQaNonNominalMask: z.literal(
    VIIRS_C2_ALGORITHM_QA_NON_NOMINAL_MASK,
  ),
  geolocationInvalidMask: z.literal(VIIRS_C2_GEOLOCATION_INVALID_MASK),
  coordinateValidityRule: z.strictObject({
    ruleId: z.literal(VIIRS_C2_GEOLOCATION_COORDINATE_VALIDITY_RULE.ruleId),
    requireFiniteLatitudeLongitude: z.literal(true),
    latitudeRangeInclusive: z.tuple([z.literal(-90), z.literal(90)]),
    longitudeRangeInclusive: z.tuple([z.literal(-180), z.literal(180)]),
    rejectDatasetDeclaredFillValues: z.literal(true),
  }),
});

const maskClassSchema = z.union([
  z.literal(0),
  z.literal(1),
  z.literal(2),
  z.literal(3),
  z.literal(4),
  z.literal(5),
  z.literal(6),
  z.literal(7),
  z.literal(8),
  z.literal(9),
]);
const uint32Schema = z.number().int().min(0).max(0xffff_ffff).safe();
const uint8Schema = z.number().int().min(0).max(0xff).safe();
const rawCoordinateSchema = z.custom<number>(
  (value) => typeof value === "number",
  "Coordinate must be a number",
);
const finiteFillValueSchema = z.number().finite();
const float32Ieee754HexSchema = z.string().regex(/^[0-9a-f]{8}$/);

function decodeFloat32Ieee754Hex(ieee754Hex: string): number {
  const bytes = new Uint8Array(4);
  for (let index = 0; index < bytes.length; index += 1) {
    bytes[index] = Number.parseInt(ieee754Hex.slice(index * 2, index * 2 + 2), 16);
  }
  const view = new DataView(bytes.buffer);
  return view.getFloat32(0, false);
}

const geolocationFillValuesSchema = z
  .strictObject({
    coordinateStorageType: z.literal("float32"),
    latitude: finiteFillValueSchema,
    latitudeIeee754Hex: float32Ieee754HexSchema,
    longitude: finiteFillValueSchema,
    longitudeIeee754Hex: float32Ieee754HexSchema,
  })
  .superRefine((fillValues, context) => {
    for (const coordinate of ["latitude", "longitude"] as const) {
      const hexField = `${coordinate}Ieee754Hex` as const;
      const decoded = decodeFloat32Ieee754Hex(fillValues[hexField]);
      if (!Object.is(decoded, fillValues[coordinate])) {
        context.addIssue({
          code: "custom",
          message: `${coordinate} IEEE-754 bits must decode exactly to the supplied fill value`,
          path: [hexField],
        });
      }
    }
  });

const rawPixelSchema = z.strictObject({
  maskClass: maskClassSchema,
  algorithmQaWord: uint32Schema,
  geolocationQualityWord: uint8Schema,
  latitude: rawCoordinateSchema,
  longitude: rawCoordinateSchema,
});

const pixelSummaryInputSchema = z
  .strictObject({
    productPair: productPairSchema,
    qaRule: qaRuleSchema,
    originalDetectionObservedAt: canonicalUtcInstantSchema,
    observedWindow: z.strictObject({
      from: canonicalUtcInstantSchema,
      to: canonicalUtcInstantSchema,
    }),
    geolocationFillValues: geolocationFillValuesSchema,
    pixels: z.array(rawPixelSchema).max(VIIRS_FIREMASK_MAX_PIXEL_COUNT),
  })
  .superRefine((input, context) => {
    const observedFrom = Date.parse(input.observedWindow.from);
    const observedTo = Date.parse(input.observedWindow.to);
    const originalDetection = Date.parse(input.originalDetectionObservedAt);

    if (originalDetection % 60_000 !== 0) {
      context.addIssue({
        code: "custom",
        message: "Original FIRMS timestamp must be aligned to an exact UTC minute",
        path: ["originalDetectionObservedAt"],
      });
    }
    if (observedTo < observedFrom) {
      context.addIssue({
        code: "custom",
        message: "Observed window end must not precede its start",
        path: ["observedWindow", "to"],
      });
    }
    if (observedFrom < originalDetection + 60_000) {
      context.addIssue({
        code: "custom",
        message:
          "Observed window must begin at or after the original FIRMS minute's exclusive upper bound",
        path: ["observedWindow", "from"],
      });
    }
  });

function immutableRawPixel(
  pixel: ViirsFireMaskRawPixel,
): ViirsFireMaskRawPixel {
  return Object.freeze({
    maskClass: pixel.maskClass,
    algorithmQaWord: pixel.algorithmQaWord,
    geolocationQualityWord: pixel.geolocationQualityWord,
    latitude: pixel.latitude,
    longitude: pixel.longitude,
  });
}

function inputWithBoundedPixelSnapshot(value: unknown): unknown {
  if (typeof value !== "object" || value === null) return value;

  // Read the root property and the array length exactly once. Copying against
  // the captured length prevents accessors from swapping or growing the input
  // after the bound has been checked.
  const pixels = (value as { pixels?: unknown }).pixels;
  let pixelSnapshot = pixels;
  if (Array.isArray(pixels)) {
    const initialLength: number = pixels.length;
    if (
      !Number.isSafeInteger(initialLength) ||
      initialLength < 0 ||
      initialLength > VIIRS_FIREMASK_MAX_PIXEL_COUNT
    ) {
      throw new RangeError(
        `Pixel array exceeds the ${VIIRS_FIREMASK_MAX_PIXEL_COUNT} pixel limit`,
      );
    }

    const boundedPixels = new Array<unknown>(initialLength);
    for (let index = 0; index < initialLength; index += 1) {
      boundedPixels[index] = pixels[index];
    }
    // Root accessors run with `this` bound to the detached wrapper below. Freeze
    // the snapshot before installing it so an earlier accessor cannot grow the
    // array again before Zod reaches its bounded-array check.
    pixelSnapshot = Object.freeze(boundedPixels);
  }

  // Delay all other root inspection until after the untrusted collection has
  // passed its hard bound and been detached from the caller-owned array.
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const inputPrototype = Object.getPrototypeOf(value);

  // Preserve every own key and descriptor so Zod's strict-object check still
  // rejects caller-supplied aggregate, coverage, or other unexpected fields.
  // Replace only `pixels`, ensuring the parser cannot re-read the source getter.
  const originalPixelsDescriptor = descriptors.pixels;
  descriptors.pixels = {
    configurable: true,
    enumerable: originalPixelsDescriptor?.enumerable ?? true,
    value: pixelSnapshot,
    writable: false,
  };
  return Object.create(inputPrototype, descriptors);
}

/** Parse and deeply freeze untrusted decoded source pixels. */
export function parseViirsFireMaskPixelSummaryInput(
  value: unknown,
): ViirsFireMaskPixelSummaryInput {
  // Zod array length checks run after element decoding, so parse a bounded
  // snapshot rather than allowing the source array to change during parsing.
  const boundedInput = inputWithBoundedPixelSnapshot(value);
  const parsed = pixelSummaryInputSchema.parse(boundedInput);
  return Object.freeze({
    productPair:
      VIIRS_C2_FIREMASK_PRODUCT_PAIRS[parsed.productPair.firmsProduct],
    qaRule: VIIRS_C2_FIREMASK_QA_RULE,
    originalDetectionObservedAt: parsed.originalDetectionObservedAt,
    observedWindow: Object.freeze({ ...parsed.observedWindow }),
    geolocationFillValues: Object.freeze({ ...parsed.geolocationFillValues }),
    pixels: Object.freeze(parsed.pixels.map(immutableRawPixel)),
  });
}

function coordinateIsInvalid(
  value: number,
  declaredFillValue: number,
  minimum: number,
  maximum: number,
) {
  return (
    !Number.isFinite(value) ||
    Object.is(value, declaredFillValue) ||
    value < minimum ||
    value > maximum
  );
}

function geolocationIsInvalid(
  pixel: ViirsFireMaskRawPixel,
  fillValues: ViirsFireMaskPixelSummaryInput["geolocationFillValues"],
) {
  return (
    (pixel.geolocationQualityWord & VIIRS_C2_GEOLOCATION_INVALID_MASK) !== 0 ||
    coordinateIsInvalid(pixel.latitude, fillValues.latitude, -90, 90) ||
    coordinateIsInvalid(pixel.longitude, fillValues.longitude, -180, 180)
  );
}

function emptyMutableCounts(): Record<ViirsC2FireMaskClass, number> {
  return { 0: 0, 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0, 7: 0, 8: 0, 9: 0 };
}

function immutableCounts(
  counts: Record<ViirsC2FireMaskClass, number>,
): ViirsFireMaskClassPixelCounts {
  return Object.freeze({
    0: counts[0],
    1: counts[1],
    2: counts[2],
    3: counts[3],
    4: counts[4],
    5: counts[5],
    6: counts[6],
    7: counts[7],
    8: counts[8],
    9: counts[9],
  });
}

/**
 * Decode raw QA/geolocation evidence and summarize it for later persistence.
 * This function never proves modeled-support coverage and therefore never
 * returns a no-FireMask-class, negative-assessment, or all-clear outcome.
 */
export function summarizeViirsFireMaskPixels(
  value: unknown,
): ViirsFireMaskPixelSummary {
  const input = parseViirsFireMaskPixelSummaryInput(value);
  const mutableCounts = emptyMutableCounts();
  let invalidGeolocationPixelCount = 0;
  let nonNominalQaPixelCount = 0;

  for (const pixel of input.pixels) {
    mutableCounts[pixel.maskClass] += 1;
    if (
      (pixel.algorithmQaWord & VIIRS_C2_ALGORITHM_QA_NON_NOMINAL_MASK) !==
      0
    ) {
      nonNominalQaPixelCount += 1;
    }
    if (geolocationIsInvalid(pixel, input.geolocationFillValues)) {
      invalidGeolocationPixelCount += 1;
    }
  }

  const maskClassPixelCounts = immutableCounts(mutableCounts);
  const firePixelCount =
    maskClassPixelCounts[7] +
    maskClassPixelCounts[8] +
    maskClassPixelCounts[9];
  const basis: ViirsFireMaskPixelSummaryBasis = {
    contractVersion: VIIRS_FIREMASK_ASSESSABILITY_CONTRACT_VERSION,
    productPair: input.productPair,
    qaRule: input.qaRule,
    originalDetectionObservedAt: input.originalDetectionObservedAt,
    observedWindow: input.observedWindow,
    geolocationFillValues: input.geolocationFillValues,
    pixelCount: input.pixels.length,
    maskClassPixelCounts,
    invalidGeolocationPixelCount,
    nonNominalQaPixelCount,
    coverageVerification: VIIRS_FIREMASK_PERSISTED_COVERAGE_REQUIREMENT,
    restrictions: VIIRS_FIREMASK_INTERNAL_USE_RESTRICTIONS,
  };

  if (firePixelCount > 0) {
    return Object.freeze({
      ...basis,
      outcome: "fire_returned" as const,
      firePixelCount,
    });
  }

  const reasons: ViirsFireMaskIndeterminateReason[] = [];
  if (input.pixels.length === 0) reasons.push("no_decoded_pixels");
  if (invalidGeolocationPixelCount > 0) reasons.push("invalid_geolocation");
  if (nonNominalQaPixelCount > 0) reasons.push("non_nominal_qa");
  if (maskClassPixelCounts[0] > 0) reasons.push("class_0_not_processed");
  if (maskClassPixelCounts[1] > 0) reasons.push("class_1_bowtie_deleted");
  if (maskClassPixelCounts[2] > 0) reasons.push("class_2_sun_glint");
  if (maskClassPixelCounts[4] > 0) reasons.push("class_4_cloud");
  if (maskClassPixelCounts[6] > 0) reasons.push("class_6_unclassified");
  reasons.push("persisted_postgis_coverage_verification_required");

  return Object.freeze({
    ...basis,
    outcome: "indeterminate" as const,
    reasons: Object.freeze(reasons),
  });
}
