import { describe, expect, it } from "vitest";

import {
  parseViirsFireMaskPixelSummaryInput,
  summarizeViirsFireMaskPixels,
  VIIRS_C2_ALGORITHM_QA_NON_NOMINAL_MASK,
  VIIRS_C2_FIREMASK_CLASSES,
  VIIRS_C2_FIREMASK_PRODUCT_PAIRS,
  VIIRS_C2_FIREMASK_QA_RULE,
  VIIRS_C2_GEOLOCATION_COORDINATE_VALIDITY_RULE,
  VIIRS_C2_GEOLOCATION_INVALID_MASK,
  VIIRS_FIREMASK_INTERNAL_USE_RESTRICTIONS,
  VIIRS_FIREMASK_MAX_PIXEL_COUNT,
  VIIRS_FIREMASK_PERSISTED_COVERAGE_REQUIREMENT,
  type ViirsFirmsProduct,
  type ViirsFireMaskRawPixel,
} from "../lib/satellite/viirs-firemask-assessability";

function pixel(
  overrides: Partial<ViirsFireMaskRawPixel> = {},
): ViirsFireMaskRawPixel {
  return {
    maskClass: 5,
    algorithmQaWord: 0,
    geolocationQualityWord: 0,
    latitude: 39.166,
    longitude: 26.104,
    ...overrides,
  };
}

function evidence(
  pixels: readonly ViirsFireMaskRawPixel[] = [
    pixel({ maskClass: 3 }),
    pixel({ maskClass: 5 }),
  ],
  product: ViirsFirmsProduct = "VIIRS_SNPP_NRT",
): Record<string, unknown> {
  return {
    productPair: { ...VIIRS_C2_FIREMASK_PRODUCT_PAIRS[product] },
    qaRule: {
      ...VIIRS_C2_FIREMASK_QA_RULE,
      coordinateValidityRule: {
        ...VIIRS_C2_FIREMASK_QA_RULE.coordinateValidityRule,
        latitudeRangeInclusive: [-90, 90],
        longitudeRangeInclusive: [-180, 180],
      },
    },
    originalDetectionObservedAt: "2026-07-31T10:00:00.000Z",
    observedWindow: {
      from: "2026-07-31T10:05:00.000Z",
      to: "2026-07-31T10:11:00.000Z",
    },
    geolocationFillValues: {
      coordinateStorageType: "float32",
      latitude: -999,
      latitudeIeee754Hex: "c479c000",
      longitude: -999,
      longitudeIeee754Hex: "c479c000",
    },
    pixels: pixels.map((value) => ({ ...value })),
  };
}

describe("VIIRS C2 375 m raw FireMask pixel summarizer", () => {
  it("pins the exact QA masks and coordinate/fill rule", () => {
    expect(VIIRS_C2_ALGORITHM_QA_NON_NOMINAL_MASK).toBe(0x7f);
    expect(VIIRS_C2_GEOLOCATION_INVALID_MASK).toBe(0x07);
    expect(VIIRS_C2_GEOLOCATION_COORDINATE_VALIDITY_RULE).toEqual({
      ruleId: "finite_wgs84_not_declared_fill_v1",
      requireFiniteLatitudeLongitude: true,
      latitudeRangeInclusive: [-90, 90],
      longitudeRangeInclusive: [-180, 180],
      rejectDatasetDeclaredFillValues: true,
    });
    expect(VIIRS_C2_FIREMASK_QA_RULE).toMatchObject({
      ruleVersion: "0.1.0",
      algorithmQaNonNominalMask: 0x7f,
      geolocationInvalidMask: 0x07,
    });
  });

  it("pins each platform-specific product pair", () => {
    expect(VIIRS_C2_FIREMASK_PRODUCT_PAIRS).toEqual({
      VIIRS_SNPP_NRT: {
        firmsProduct: "VIIRS_SNPP_NRT",
        fireMaskProduct: "VNP14IMG",
        fireMaskCollectionFileVersion: "002",
        geolocationProduct: "VNP03IMG",
        geolocationCollectionFileVersion: "002",
        geolocationInputMetadataAttribute: "VNP03IMG",
        satellite: "Suomi-NPP",
      },
      VIIRS_NOAA20_NRT: {
        firmsProduct: "VIIRS_NOAA20_NRT",
        fireMaskProduct: "VJ114IMG",
        fireMaskCollectionFileVersion: "002",
        geolocationProduct: "VJ103IMG",
        geolocationCollectionFileVersion: "021",
        geolocationInputMetadataAttribute: "VJ103IMG",
        satellite: "NOAA-20",
      },
      VIIRS_NOAA21_NRT: {
        firmsProduct: "VIIRS_NOAA21_NRT",
        fireMaskProduct: "VJ214IMG",
        fireMaskCollectionFileVersion: "002",
        geolocationProduct: "VJ203IMG",
        geolocationCollectionFileVersion: "021",
        geolocationInputMetadataAttribute: "VJ203IMG",
        satellite: "NOAA-21",
      },
    });
    for (const pair of Object.values(VIIRS_C2_FIREMASK_PRODUCT_PAIRS)) {
      expect(Object.isFrozen(pair)).toBe(true);
      expect(pair.geolocationInputMetadataAttribute).not.toBe("InputPointer");
      expect(parseViirsFireMaskPixelSummaryInput(evidence(undefined, pair.firmsProduct)))
        .toMatchObject({ productPair: pair });
    }
  });

  it("encodes all NASA VIIRS Collection 2 FireMask classes", () => {
    expect(VIIRS_C2_FIREMASK_CLASSES.map(({ value }) => value)).toEqual([
      0, 1, 2, 3, 4, 5, 6, 7, 8, 9,
    ]);
  });

  it("derives counts but exposes no negative or no-FireMask-class outcome", () => {
    const result = summarizeViirsFireMaskPixels(evidence());

    expect(result).toMatchObject({
      outcome: "indeterminate",
      pixelCount: 2,
      maskClassPixelCounts: { 3: 1, 5: 1 },
      invalidGeolocationPixelCount: 0,
      nonNominalQaPixelCount: 0,
      geolocationFillValues: {
        coordinateStorageType: "float32",
        latitude: -999,
        latitudeIeee754Hex: "c479c000",
        longitude: -999,
        longitudeIeee754Hex: "c479c000",
      },
      coverageVerification: {
        required: true,
        authority: "persisted_postgis_only",
        method: "geolocated_pixel_union_covers_modeled_support_v1",
        status: "not_performed_by_raw_pixel_summarizer",
      },
      reasons: ["persisted_postgis_coverage_verification_required"],
      restrictions: {
        negativeAssessmentEligible: false,
        allClearEligible: false,
        officialStatusEligible: false,
        protectiveActionEligible: false,
        incidentResolutionEligible: false,
        notificationEligible: false,
      },
    });
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.maskClassPixelCounts)).toBe(true);
    expect(Object.isFrozen(result.coverageVerification)).toBe(true);
    expect(Object.isFrozen(result.restrictions)).toBe(true);
    if (result.outcome !== "indeterminate") {
      throw new Error("Expected indeterminate raw-pixel summary");
    }
    expect(Object.isFrozen(result.reasons)).toBe(true);
    expect(JSON.stringify(result)).not.toContain("candidate");
  });

  it.each([7, 8, 9] as const)(
    "keeps fire_returned precedence for class %i",
    (maskClass) => {
      const result = summarizeViirsFireMaskPixels(
        evidence([
          pixel({
            maskClass,
            algorithmQaWord: 0x7f,
            geolocationQualityWord: 0x07,
            latitude: Number.NaN,
          }),
        ]),
      );

      expect(result).toMatchObject({
        outcome: "fire_returned",
        firePixelCount: 1,
        invalidGeolocationPixelCount: 1,
        nonNominalQaPixelCount: 1,
        coverageVerification: VIIRS_FIREMASK_PERSISTED_COVERAGE_REQUIREMENT,
        restrictions: VIIRS_FIREMASK_INTERNAL_USE_RESTRICTIONS,
      });
      expect(Object.isFrozen(result)).toBe(true);
      expect(Object.isFrozen(result.maskClassPixelCounts)).toBe(true);
      expect(Object.isFrozen(result.coverageVerification)).toBe(true);
    },
  );

  it.each([0, 1, 2, 3, 4, 5, 6] as const)(
    "derives the exact count for non-fire-class value %i",
    (maskClass) => {
      const result = summarizeViirsFireMaskPixels(evidence([pixel({ maskClass })]));
      expect(result.maskClassPixelCounts[maskClass]).toBe(1);
      expect(
        Object.values(result.maskClassPixelCounts).reduce(
          (total, count) => total + count,
          0,
        ),
      ).toBe(1);
      expect(result.outcome).toBe("indeterminate");
    },
  );

  it.each([0, 1, 2, 3, 4, 5, 6])(
    "counts algorithm-QA bit %i as non-nominal",
    (bit) => {
      const result = summarizeViirsFireMaskPixels(
        evidence([pixel({ algorithmQaWord: 1 << bit })]),
      );
      expect(result.nonNominalQaPixelCount).toBe(1);
    },
  );

  it("ignores algorithm-QA bit 7 for input-quality counting", () => {
    const result = summarizeViirsFireMaskPixels(
      evidence([pixel({ algorithmQaWord: 0x80 })]),
    );
    expect(result.nonNominalQaPixelCount).toBe(0);
  });

  it.each([0, 1, 2])(
    "counts geolocation-quality bit %i as invalid",
    (bit) => {
      const result = summarizeViirsFireMaskPixels(
        evidence([pixel({ geolocationQualityWord: 1 << bit })]),
      );
      expect(result.invalidGeolocationPixelCount).toBe(1);
    },
  );

  it("ignores geolocation-quality bit 3", () => {
    const result = summarizeViirsFireMaskPixels(
      evidence([pixel({ geolocationQualityWord: 0x08 })]),
    );
    expect(result.invalidGeolocationPixelCount).toBe(0);
  });

  it.each([
    { name: "NaN latitude", coordinates: { latitude: Number.NaN } },
    {
      name: "+Infinity latitude",
      coordinates: { latitude: Number.POSITIVE_INFINITY },
    },
    {
      name: "-Infinity longitude",
      coordinates: { longitude: Number.NEGATIVE_INFINITY },
    },
    { name: "latitude fill", coordinates: { latitude: -999 } },
    { name: "longitude fill", coordinates: { longitude: -999 } },
    {
      name: "latitude below range",
      coordinates: { latitude: -90.000_001 },
    },
    {
      name: "latitude above range",
      coordinates: { latitude: 90.000_001 },
    },
    {
      name: "longitude below range",
      coordinates: { longitude: -180.000_001 },
    },
    {
      name: "longitude above range",
      coordinates: { longitude: 180.000_001 },
    },
  ])("counts $name as invalid geolocation", ({ coordinates }) => {
    const result = summarizeViirsFireMaskPixels(
      evidence([pixel(coordinates)]),
    );
    expect(result.invalidGeolocationPixelCount).toBe(1);
  });

  it("accepts inclusive WGS84 coordinate bounds", () => {
    const result = summarizeViirsFireMaskPixels(
      evidence([
        pixel({ latitude: -90, longitude: -180 }),
        pixel({ latitude: 90, longitude: 180 }),
      ]),
    );
    expect(result.invalidGeolocationPixelCount).toBe(0);
  });

  it.each([
    ["uppercase bits", { latitudeIeee754Hex: "C479C000" }],
    ["non-string bits", { latitudeIeee754Hex: 0 }],
    ["short float32 bits", { longitudeIeee754Hex: "c479c00" }],
    ["long float32 bits", { latitudeIeee754Hex: "c479c00000" }],
    ["unsupported float64 source storage", { coordinateStorageType: "float64" }],
    ["unsupported storage type", { coordinateStorageType: "float16" }],
  ])("rejects %s in fill-value provenance", (_name, override) => {
    const input = evidence();
    input.geolocationFillValues = {
      ...(input.geolocationFillValues as object),
      ...override,
    };
    expect(() => parseViirsFireMaskPixelSummaryInput(input)).toThrow();
  });

  it("requires IEEE-754 bits to decode exactly to each numeric fill", () => {
    const mismatched = evidence();
    mismatched.geolocationFillValues = {
      ...(mismatched.geolocationFillValues as object),
      latitude: -998,
    };
    expect(() => parseViirsFireMaskPixelSummaryInput(mismatched)).toThrow(
      /latitude IEEE-754 bits must decode exactly/,
    );
  });

  it("preserves signed-zero fill semantics", () => {
    const input = evidence([
      pixel({ latitude: 0 }),
      pixel({ latitude: -0 }),
    ]);
    input.geolocationFillValues = {
      coordinateStorageType: "float32",
      latitude: -0,
      latitudeIeee754Hex: "80000000",
      longitude: -999,
      longitudeIeee754Hex: "c479c000",
    };

    const parsed = parseViirsFireMaskPixelSummaryInput(input);
    expect(Object.is(parsed.geolocationFillValues.latitude, -0)).toBe(true);
    expect(summarizeViirsFireMaskPixels(input).invalidGeolocationPixelCount).toBe(1);

    const wrongSign = evidence();
    wrongSign.geolocationFillValues = {
      coordinateStorageType: "float32",
      latitude: 0,
      latitudeIeee754Hex: "80000000",
      longitude: -999,
      longitudeIeee754Hex: "c479c000",
    };
    expect(() => parseViirsFireMaskPixelSummaryInput(wrongSign)).toThrow(
      /latitude IEEE-754 bits must decode exactly/,
    );
  });

  it("rejects caller-authored aggregate counts and coverage claims", () => {
    const aggregateCounts = evidence();
    aggregateCounts.maskClassPixelCounts = { 5: 2 };
    expect(() => parseViirsFireMaskPixelSummaryInput(aggregateCounts)).toThrow();

    const aggregateQa = evidence();
    aggregateQa.nonNominalQaPixelCount = 0;
    expect(() => parseViirsFireMaskPixelSummaryInput(aggregateQa)).toThrow();

    const aggregateGeo = evidence();
    aggregateGeo.invalidGeolocationPixelCount = 0;
    expect(() => parseViirsFireMaskPixelSummaryInput(aggregateGeo)).toThrow();

    const coverageClaim = evidence();
    coverageClaim.coversModeledSupport = true;
    expect(() => parseViirsFireMaskPixelSummaryInput(coverageClaim)).toThrow();
  });

  it("requires exact product and versioned QA rules", () => {
    const mismatchedProduct = evidence();
    mismatchedProduct.productPair = {
      ...(mismatchedProduct.productPair as object),
      geolocationProduct: "VJ103IMG",
    };
    expect(() => parseViirsFireMaskPixelSummaryInput(mismatchedProduct)).toThrow();

    const mismatchedQaRule = evidence();
    mismatchedQaRule.qaRule = {
      ...(mismatchedQaRule.qaRule as object),
      algorithmQaNonNominalMask: 0x3f,
    };
    expect(() => parseViirsFireMaskPixelSummaryInput(mismatchedQaRule)).toThrow();
  });

  it.each(Object.keys(VIIRS_C2_FIREMASK_PRODUCT_PAIRS) as ViirsFirmsProduct[])(
    "rejects every pinned product-metadata mismatch for %s",
    (product) => {
      for (const field of [
        "fireMaskProduct",
        "fireMaskCollectionFileVersion",
        "geolocationCollectionFileVersion",
        "geolocationInputMetadataAttribute",
        "satellite",
      ] as const) {
        const mismatched = evidence(undefined, product);
        mismatched.productPair = {
          ...(mismatched.productPair as object),
          [field]: "mismatch",
        };
        expect(
          () => parseViirsFireMaskPixelSummaryInput(mismatched),
          `${product}.${field}`,
        ).toThrow();
      }
    },
  );

  it("enforces canonical, minute-aligned original FIRMS timestamps", () => {
    const nonCanonical = evidence();
    nonCanonical.originalDetectionObservedAt = "2026-07-31T10:00:00Z";
    expect(() => parseViirsFireMaskPixelSummaryInput(nonCanonical)).toThrow();

    const notMinuteAligned = evidence();
    notMinuteAligned.originalDetectionObservedAt = "2026-07-31T10:00:00.001Z";
    expect(() => parseViirsFireMaskPixelSummaryInput(notMinuteAligned)).toThrow();
  });

  it("enforces the later-pass minute upper bound inclusively", () => {
    const beforeBoundary = evidence();
    beforeBoundary.observedWindow = {
      from: "2026-07-31T10:00:59.999Z",
      to: "2026-07-31T10:11:00.000Z",
    };
    expect(() => parseViirsFireMaskPixelSummaryInput(beforeBoundary)).toThrow();

    const atBoundary = evidence();
    atBoundary.observedWindow = {
      from: "2026-07-31T10:01:00.000Z",
      to: "2026-07-31T10:07:00.000Z",
    };
    expect(parseViirsFireMaskPixelSummaryInput(atBoundary).observedWindow.from)
      .toBe("2026-07-31T10:01:00.000Z");
  });

  it("rejects reversed windows and out-of-range or fractional words", () => {
    const reversed = evidence();
    reversed.observedWindow = {
      from: "2026-07-31T10:12:00.000Z",
      to: "2026-07-31T10:11:00.000Z",
    };
    expect(() => parseViirsFireMaskPixelSummaryInput(reversed)).toThrow();

    for (const algorithmQaWord of [-1, 0.5, 0x1_0000_0000]) {
      expect(() =>
        parseViirsFireMaskPixelSummaryInput(
          evidence([pixel({ algorithmQaWord })]),
        ),
      ).toThrow();
    }
    for (const geolocationQualityWord of [-1, 0.5, 0x100]) {
      expect(() =>
        parseViirsFireMaskPixelSummaryInput(
          evidence([pixel({ geolocationQualityWord })]),
        ),
      ).toThrow();
    }
  });

  it("deep-freezes parsed raw evidence", () => {
    const parsed = parseViirsFireMaskPixelSummaryInput(
      evidence([pixel({ latitude: Number.NaN })]),
    );
    expect(Object.isFrozen(parsed)).toBe(true);
    expect(Object.isFrozen(parsed.productPair)).toBe(true);
    expect(Object.isFrozen(parsed.qaRule)).toBe(true);
    expect(Object.isFrozen(parsed.qaRule.coordinateValidityRule)).toBe(true);
    expect(
      Object.isFrozen(parsed.qaRule.coordinateValidityRule.latitudeRangeInclusive),
    ).toBe(true);
    expect(Object.isFrozen(parsed.observedWindow)).toBe(true);
    expect(Object.isFrozen(parsed.geolocationFillValues)).toBe(true);
    expect(Object.isFrozen(parsed.pixels)).toBe(true);
    expect(Object.isFrozen(parsed.pixels[0])).toBe(true);
  });

  it("rejects oversized pixel arrays before touching any element", () => {
    let elementReads = 0;
    const oversized = new Array<ViirsFireMaskRawPixel>(
      VIIRS_FIREMASK_MAX_PIXEL_COUNT + 1,
    );
    Object.defineProperty(oversized, 0, {
      configurable: true,
      enumerable: true,
      get() {
        elementReads += 1;
        return pixel();
      },
    });
    const input = evidence([]);
    input.pixels = oversized;

    expect(() => parseViirsFireMaskPixelSummaryInput(input)).toThrow(
      /100000 pixel limit/,
    );
    expect(elementReads).toBe(0);
  });

  it("captures a changing root pixels getter exactly once", () => {
    let rootPixelReads = 0;
    let oversizedElementReads = 0;
    const oversized = new Array<ViirsFireMaskRawPixel>(
      VIIRS_FIREMASK_MAX_PIXEL_COUNT + 1,
    );
    Object.defineProperty(oversized, 0, {
      enumerable: true,
      get() {
        oversizedElementReads += 1;
        return pixel();
      },
    });
    const input = evidence([]);
    Object.defineProperty(input, "pixels", {
      configurable: true,
      enumerable: true,
      get() {
        rootPixelReads += 1;
        return rootPixelReads === 1 ? [pixel()] : oversized;
      },
    });

    const parsed = parseViirsFireMaskPixelSummaryInput(input);
    expect(parsed.pixels).toHaveLength(1);
    expect(rootPixelReads).toBe(1);
    expect(oversizedElementReads).toBe(0);
  });

  it("prevents an earlier root getter from growing the bounded snapshot", () => {
    const input = evidence([pixel()]);
    const productPair = input.productPair;
    let mutationSucceeded = true;
    Object.defineProperty(input, "productPair", {
      configurable: true,
      enumerable: true,
      get: function (this: { pixels: unknown[] }) {
        mutationSucceeded = Reflect.set(
          this.pixels,
          "length",
          VIIRS_FIREMASK_MAX_PIXEL_COUNT + 1,
        );
        return productPair;
      },
    });

    const parsed = parseViirsFireMaskPixelSummaryInput(input);
    expect(mutationSucceeded).toBe(false);
    expect(parsed.pixels).toHaveLength(1);
  });

  it("copies only the captured length when an element grows the source array", () => {
    let firstElementReads = 0;
    let grownElementReads = 0;
    const growing = new Array<ViirsFireMaskRawPixel>(1);
    Object.defineProperty(growing, 0, {
      configurable: true,
      enumerable: true,
      get() {
        firstElementReads += 1;
        growing.length = VIIRS_FIREMASK_MAX_PIXEL_COUNT + 1;
        Object.defineProperty(growing, VIIRS_FIREMASK_MAX_PIXEL_COUNT, {
          configurable: true,
          enumerable: true,
          get() {
            grownElementReads += 1;
            return pixel();
          },
        });
        return pixel();
      },
    });
    const input = evidence([]);
    input.pixels = growing;

    const parsed = parseViirsFireMaskPixelSummaryInput(input);
    expect(parsed.pixels).toHaveLength(1);
    expect(firstElementReads).toBe(1);
    expect(grownElementReads).toBe(0);
  });

  it("summarizes an empty pixel set as indeterminate", () => {
    const result = summarizeViirsFireMaskPixels(evidence([]));
    expect(result).toMatchObject({
      outcome: "indeterminate",
      pixelCount: 0,
      reasons: [
        "no_decoded_pixels",
        "persisted_postgis_coverage_verification_required",
      ],
    });
  });
});
