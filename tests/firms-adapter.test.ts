import { describe, expect, it } from "vitest";

import {
  contentSha256,
  requestEvidenceFingerprintSha256,
  type HttpRequestEvidence,
  type HttpResponseEvidence,
} from "../lib/evidence/recorded-fetch";

import {
  FIRMS_AREA_ENDPOINT,
  FIRMS_MAX_RESPONSE_BYTES,
  firmsAreaRequest,
  firmsAreaRequestEvidence,
  firmsAreaResponseFromTrustedJoinedRecord,
  parseFirmsCsv,
  recordedFirmsAreaFetch,
  type FirmsAreaRequestDescriptor,
  type FirmsAreaResponse,
  type FirmsProduct,
} from "../lib/satellite/firms";
import {
  FIRMS_HEADER_ONLY_CSV,
  FIRMS_MALFORMED_HEADER_CSV,
  FIRMS_MALFORMED_ROWS_CSV,
  FIRMS_MODIS_CSV,
  FIRMS_MODIS_HEADER,
  FIRMS_VIIRS_CSV,
  FIRMS_VIIRS_HEADER,
  oversizedFirmsCsv,
} from "./fixtures/firms";

const MAP_KEY = "sanitized-map-key-000000000001";
const ISSUED_AT = "2026-07-30T12:00:00.000Z";
const AREA = Object.freeze({
  west: 26.2,
  south: 38.85,
  east: 26.6,
  north: 39.15,
});
const RETRIEVED_AT = "2026-07-30T12:00:05.000Z";
const REFERENCE = Object.freeze({ exchangeId: "41", runId: "17" });

function requestFor(product: FirmsProduct): FirmsAreaRequestDescriptor {
  return firmsAreaRequest({
    mapKey: MAP_KEY,
    product,
    area: AREA,
    date: { kind: "rolling", days: 2 },
    issuedAt: ISSUED_AT,
  });
}

async function recordedResponse(
  request: FirmsAreaRequestDescriptor,
  input: string | Uint8Array,
  retrievedAt = RETRIEVED_AT,
): Promise<FirmsAreaResponse> {
  const requestEvidence = firmsAreaRequestEvidence(request);
  const body = typeof input === "string" ? new TextEncoder().encode(input) : input;
  return firmsAreaResponseFromTrustedJoinedRecord({
    reference: REFERENCE,
    requestFingerprintSha256:
      await requestEvidenceFingerprintSha256(requestEvidence),
    request: requestEvidence,
    exchangeResponseRawObjectId: "51",
    response: {
      status: 200,
      body,
      safeHeaders: Object.freeze({}),
      safeMetadata: Object.freeze({}),
    },
    responseOccurrence: {
      rawObjectId: "51",
      httpExchangeId: REFERENCE.exchangeId,
      runId: REFERENCE.runId,
      contentSha256: await contentSha256(body),
      retrievedAt,
    },
  });
}

async function responseFor(
  product: FirmsProduct,
  input: string | Uint8Array,
): Promise<FirmsAreaResponse> {
  return recordedResponse(requestFor(product), input);
}

const VIIRS_REQUEST = requestFor("VIIRS_NOAA20_NRT");

describe("NASA FIRMS Area adapter boundary", () => {
  it("builds a path-secret request with a credential-free logical envelope", () => {
    const request = firmsAreaRequest({
      mapKey: MAP_KEY,
      product: "VIIRS_NOAA20_NRT",
      area: AREA,
      date: { kind: "rolling", days: 2 },
      issuedAt: ISSUED_AT,
    });

    expect(request.url).toBe(
      `${FIRMS_AREA_ENDPOINT}/${MAP_KEY}/VIIRS_NOAA20_NRT/26.200000,38.850000,26.600000,39.150000/2`,
    );
    expect(request.requestUrlSafe).toBe(FIRMS_AREA_ENDPOINT);
    expect(request.requestQuerySafe).toEqual({
      area: "26.200000,38.850000,26.600000,39.150000",
      date: "rolling:2",
      product: "VIIRS_NOAA20_NRT",
    });
    expect(JSON.stringify(request.requestQuerySafe)).not.toContain(MAP_KEY);
    expect("parseContext" in request).toBe(false);
    expect(Object.isFrozen(request)).toBe(true);
    expect(request.requestInit).toEqual({
      method: "GET",
      redirect: "manual",
      headers: { accept: "text/csv" },
    });
    expect(request.credentialPathRedaction).toEqual({ kind: "firms-area-v1" });
    expect(firmsAreaRequestEvidence(request)).toEqual({
      method: "GET",
      requestUrlSafe: FIRMS_AREA_ENDPOINT,
      requestQuerySafe: request.requestQuerySafe,
      requestBodyRedacted: null,
      requestHeadersSafe: { accept: "text/csv" },
      requestMetadataSafe: {
        operation: "firms-area-csv",
        product: "VIIRS_NOAA20_NRT",
        scope: "geographic-area",
        issued_at: ISSUED_AT,
      },
    });
  });

  it("retains a reconstructible historical date and day range without the key", () => {
    const request = firmsAreaRequest({
      mapKey: MAP_KEY,
      product: "MODIS_NRT",
      area: AREA,
      date: { kind: "starting-on", date: "2026-07-29", days: 1 },
      issuedAt: ISSUED_AT,
    });

    expect(request.url).toMatch(/\/1\/2026-07-29$/u);
    expect(request.requestQuerySafe.date).toBe("2026-07-29/1");
    expect(firmsAreaRequestEvidence(request).requestMetadataSafe.issued_at).toBe(
      ISSUED_AT,
    );
    expect(JSON.stringify(request.requestQuerySafe)).not.toContain(MAP_KEY);
  });

  it("returns a credential-free response bound to the exact live request", async () => {
    const request = firmsAreaRequest({
      mapKey: MAP_KEY,
      product: "VIIRS_NOAA20_NRT",
      area: AREA,
      date: { kind: "starting-on", date: "2026-07-29", days: 1 },
      issuedAt: ISSUED_AT,
    });
    const issued: HttpRequestEvidence[] = [];
    const persisted: HttpResponseEvidence[] = [];
    const response = await recordedFirmsAreaFetch(request, {
      fetchImpl: async () =>
        new Response(FIRMS_HEADER_ONLY_CSV, {
          status: 200,
          headers: { "content-type": "text/csv" },
        }),
      ledger: {
        issue: async (evidence) => {
          issued.push(evidence);
          return REFERENCE;
        },
        finishResponse: async (_reference, evidence) => {
          persisted.push(evidence);
          return {
            rawObjectId: "51",
            httpExchangeId: REFERENCE.exchangeId,
            runId: REFERENCE.runId,
            contentSha256: await contentSha256(evidence.body),
            retrievedAt: RETRIEVED_AT,
          };
        },
        finishTransportError: async () => undefined,
      },
    });

    expect(response).toMatchObject({
      kind: "firms-area-response-v1",
      product: "VIIRS_NOAA20_NRT",
      issuedAt: ISSUED_AT,
    });
    expect(JSON.stringify({ response, issued, persisted })).not.toContain(MAP_KEY);
    expect(parseFirmsCsv(response).emptyPayload).toBe(true);
  });

  it.each([
    ["invalid key", { mapKey: "short" }],
    ["reversed longitude", { area: { ...AREA, west: 27, east: 26 } }],
    [
      "invalid calendar date",
      { date: { kind: "starting-on", date: "2026-02-30", days: 1 } },
    ],
  ] as const)("rejects %s before a URL can be issued", (_label, override) => {
    expect(() =>
      firmsAreaRequest({
        mapKey: MAP_KEY,
        product: "VIIRS_NOAA20_NRT",
        area: AREA,
        date: { kind: "rolling", days: 2 },
        issuedAt: ISSUED_AT,
        ...override,
      }),
    ).toThrow(TypeError);
  });

  it("canonicalizes exact coordinate boundaries without losing precision", () => {
    const globalRequest = firmsAreaRequest({
      mapKey: MAP_KEY,
      product: "VIIRS_NOAA20_NRT",
      area: { west: -180, south: -90, east: 180, north: 90 },
      date: { kind: "starting-on", date: "2026-07-29", days: 1 },
      issuedAt: ISSUED_AT,
    });
    expect(globalRequest.requestQuerySafe.area).toBe(
      "-180.000000,-90.000000,180.000000,90.000000",
    );

    const negativeZeroRequest = firmsAreaRequest({
      mapKey: MAP_KEY,
      product: "VIIRS_NOAA20_NRT",
      area: { west: -0, south: 38.123456, east: 26.654321, north: 39.654321 },
      date: { kind: "rolling", days: 1 },
      issuedAt: ISSUED_AT,
    });
    expect(negativeZeroRequest.requestQuerySafe.area).toBe(
      "0.000000,38.123456,26.654321,39.654321",
    );
  });

  it("rejects coordinates that fixed-six serialization would round", () => {
    expect(() =>
      firmsAreaRequest({
        mapKey: MAP_KEY,
        product: "VIIRS_NOAA20_NRT",
        area: { ...AREA, west: 26.1234564 },
        date: { kind: "rolling", days: 1 },
        issuedAt: ISSUED_AT,
      }),
    ).toThrow(
      "FIRMS area coordinates must be exact to at most six decimal places.",
    );
  });

  it("parses strict VIIRS rows while preserving source values and UTC time", async () => {
    const result = parseFirmsCsv(
      await recordedResponse(VIIRS_REQUEST, FIRMS_VIIRS_CSV),
    );

    expect(result).toMatchObject({
      status: "ok",
      returnedRows: 2,
      rejectedRows: [],
      emptyPayload: false,
      errorCode: null,
    });
    expect(result.detections[0]).toMatchObject({
      product: "VIIRS_NOAA20_NRT",
      satellite: "NOAA-20",
      satelliteRaw: "N20",
      instrument: "VIIRS",
      observedAt: "2026-07-29T15:42:00.000Z",
      acquisitionDateRaw: "2026-07-29",
      acquisitionTimeRaw: "1542",
      confidenceRaw: "n",
      confidenceKind: "category",
      confidenceCode: "nominal",
      confidencePercent: null,
      brightTi4Kelvin: 341.2,
      brightTi5Kelvin: 301.45,
      frpMw: 8.1,
      dayNight: "day",
    });
    expect(result.detections[1]?.observedAt).toBe(
      "2026-07-29T00:07:00.000Z",
    );
  });

  it.each([
    ["VIIRS_NOAA21_NRT", "N21", "NOAA-21"],
    ["VIIRS_SNPP_NRT", "N", "Suomi-NPP"],
  ] as const)(
    "enforces the %s platform contract",
    async (product, satelliteRaw, satellite) => {
      const row = `38.97510,26.36620,341.20,0.39,0.36,2026-07-29,1542,${satelliteRaw},VIIRS,n,2.0NRT,301.45,8.10,D`;
      const result = parseFirmsCsv(
        await responseFor(
          product satisfies FirmsProduct,
          `${FIRMS_VIIRS_HEADER}\n${row}\n`,
        ),
      );
      expect(result.status).toBe("ok");
      expect(result.detections[0]).toMatchObject({ product, satellite });
    },
  );

  it("parses MODIS numeric confidence without inventing a category", async () => {
    const result = parseFirmsCsv(
      await responseFor("MODIS_NRT", FIRMS_MODIS_CSV),
    );

    expect(result).toMatchObject({
      status: "ok",
      returnedRows: 1,
      rejectedRows: [],
      emptyPayload: false,
      errorCode: null,
    });
    expect(result.detections[0]).toMatchObject({
      product: "MODIS_NRT",
      satellite: "Terra",
      instrument: "MODIS",
      confidenceRaw: "87",
      confidenceKind: "percent",
      confidenceCode: null,
      confidencePercent: 87,
      brightnessKelvin: 318.7,
      brightT31Kelvin: 293.2,
    });
  });

  it("labels a header-only response as syntactically empty, not anomaly-free", async () => {
    const result = parseFirmsCsv(
      await recordedResponse(VIIRS_REQUEST, FIRMS_HEADER_ONLY_CSV),
    );

    expect(result).toEqual({
      product: "VIIRS_NOAA20_NRT",
      status: "ok",
      returnedRows: 0,
      detections: [],
      rejectedRows: [],
      emptyPayload: true,
      errorCode: null,
    });
  });

  it("fails a malformed product header instead of treating it as empty", async () => {
    const result = parseFirmsCsv(
      await recordedResponse(VIIRS_REQUEST, FIRMS_MALFORMED_HEADER_CSV),
    );

    expect(result).toMatchObject({
      status: "error",
      emptyPayload: false,
      errorCode: "invalid-header",
    });
  });

  it("returns explicit row rejections and never upgrades them to empty", async () => {
    const result = parseFirmsCsv(
      await recordedResponse(VIIRS_REQUEST, FIRMS_MALFORMED_ROWS_CSV),
    );

    expect(result).toMatchObject({
      status: "partial",
      returnedRows: 2,
      detections: [],
      emptyPayload: false,
      errorCode: null,
    });
    expect(result.rejectedRows).toEqual([
      {
        itemIndex: 0,
        rowNumber: 2,
        reasons: ["invalid-coordinate"],
      },
      {
        itemIndex: 1,
        rowNumber: 3,
        reasons: ["column-count-mismatch"],
      },
    ]);
  });

  it("accepts AOI/date boundaries and explicitly rejects out-of-scope rows", async () => {
    const boundary =
      "38.85,26.2,341.20,0.39,0.36,2026-07-29,1542,N20,VIIRS,n,2.0NRT,301.45,8.10,D";
    const outsideArea =
      "38.85,26.60001,341.20,0.39,0.36,2026-07-29,1542,N20,VIIRS,n,2.0NRT,301.45,8.10,D";
    const outsideDate =
      "38.85,26.2,341.20,0.39,0.36,2026-07-28,1542,N20,VIIRS,n,2.0NRT,301.45,8.10,D";
    const result = parseFirmsCsv(
      await recordedResponse(
        VIIRS_REQUEST,
        `${FIRMS_VIIRS_HEADER}\n${boundary}\n${outsideArea}\n${outsideDate}\n`,
      ),
    );

    expect(result).toMatchObject({
      status: "partial",
      returnedRows: 3,
      emptyPayload: false,
    });
    expect(result.detections).toHaveLength(1);
    expect(result.detections[0]).toMatchObject({
      latitude: 38.85,
      longitude: 26.2,
    });
    expect(result.rejectedRows).toEqual([
      {
        itemIndex: 1,
        rowNumber: 3,
        reasons: ["outside-request-area"],
      },
      {
        itemIndex: 2,
        rowNumber: 4,
        reasons: ["outside-request-date-range"],
      },
    ]);
  });

  it.each([
    [
      "scientific-notation coordinate",
      "VIIRS_NOAA20_NRT",
      `${FIRMS_VIIRS_HEADER}\n3.897510e1,26.36620,341.20,0.39,0.36,2026-07-29,1542,N20,VIIRS,n,2.0NRT,301.45,8.10,D\n`,
      "invalid-coordinate",
    ],
    [
      "hexadecimal measurement",
      "VIIRS_NOAA20_NRT",
      `${FIRMS_VIIRS_HEADER}\n38.97510,26.36620,0x155,0.39,0.36,2026-07-29,1542,N20,VIIRS,n,2.0NRT,301.45,8.10,D\n`,
      "invalid-measurement",
    ],
    [
      "non-integer MODIS confidence",
      "MODIS_NRT",
      `${FIRMS_MODIS_HEADER}\n38.96980,26.35510,318.70,1.03,1.01,2026-07-29,1635,Terra,MODIS,8e1,6.1NRT,293.20,12.50,D\n`,
      "invalid-confidence",
    ],
    [
      "overlong numeric measurement",
      "VIIRS_NOAA20_NRT",
      `${FIRMS_VIIRS_HEADER}\n38.97510,26.36620,${"9".repeat(65)},0.39,0.36,2026-07-29,1542,N20,VIIRS,n,2.0NRT,301.45,8.10,D\n`,
      "invalid-measurement",
    ],
    [
      "control-bearing version",
      "VIIRS_NOAA20_NRT",
      `${FIRMS_VIIRS_HEADER}\n38.97510,26.36620,341.20,0.39,0.36,2026-07-29,1542,N20,VIIRS,n,2.0NRT\u0000,301.45,8.10,D\n`,
      "invalid-version",
    ],
  ] as const)("rejects %s source syntax", async (_label, product, csv, reason) => {
    const result = parseFirmsCsv(await responseFor(product, csv));

    expect(result.status).toBe("partial");
    expect(result.rejectedRows[0]?.reasons).toContain(reason);
  });

  it("binds a narrow response against substitution by a valid wide descriptor", async () => {
    const narrowRequest = firmsAreaRequest({
      mapKey: MAP_KEY,
      product: "VIIRS_NOAA20_NRT",
      area: { ...AREA, east: 26.4 },
      date: { kind: "rolling", days: 2 },
      issuedAt: ISSUED_AT,
    });
    const wideRequest = firmsAreaRequest({
      mapKey: MAP_KEY,
      product: "VIIRS_NOAA20_NRT",
      area: AREA,
      date: { kind: "rolling", days: 2 },
      issuedAt: ISSUED_AT,
    });
    const outsideNarrowInsideWide =
      `${FIRMS_VIIRS_HEADER}\n38.97510,26.50000,341.20,0.39,0.36,2026-07-29,1542,N20,VIIRS,n,2.0NRT,301.45,8.10,D\n`;
    const narrowResponse = await recordedResponse(
      narrowRequest,
      outsideNarrowInsideWide,
    );

    expect(parseFirmsCsv(narrowResponse).rejectedRows[0]?.reasons).toContain(
      "outside-request-area",
    );
    expect("parseContext" in wideRequest).toBe(false);
    expect(Reflect.get(wideRequest, "parseContext")).toBeUndefined();
    expect(() =>
      parseFirmsCsv(
        Reflect.get(wideRequest, "parseContext") as FirmsAreaResponse,
      ),
    ).toThrow("response envelope");
  });

  it("rejects cloned envelopes and cloned request descriptors", async () => {
    const response = await recordedResponse(VIIRS_REQUEST, FIRMS_HEADER_ONLY_CSV);
    expect(() =>
      parseFirmsCsv({ ...response } as FirmsAreaResponse),
    ).toThrow("response envelope");
    expect(() =>
      firmsAreaRequestEvidence({ ...VIIRS_REQUEST }),
    ).toThrow("exact firmsAreaRequest descriptor");
  });

  it("rejects substituted response bytes and broken joined-row occurrence links", async () => {
    const request = firmsAreaRequestEvidence(VIIRS_REQUEST);
    const body = new TextEncoder().encode(FIRMS_HEADER_ONLY_CSV);
    const occurrence = {
      rawObjectId: "51",
      httpExchangeId: REFERENCE.exchangeId,
      runId: REFERENCE.runId,
      contentSha256: await contentSha256(body),
      retrievedAt: RETRIEVED_AT,
    };
    const base = {
      reference: REFERENCE,
      requestFingerprintSha256:
        await requestEvidenceFingerprintSha256(request),
      request,
      exchangeResponseRawObjectId: "51",
      response: {
        status: 200,
        body,
        safeHeaders: {},
        safeMetadata: {},
      },
      responseOccurrence: occurrence,
    } as const;

    await expect(
      firmsAreaResponseFromTrustedJoinedRecord({
        ...base,
        response: {
          ...base.response,
          body: new TextEncoder().encode(`${FIRMS_HEADER_ONLY_CSV}\n`),
        },
      }),
    ).rejects.toThrow("bytes do not match");
    await expect(
      firmsAreaResponseFromTrustedJoinedRecord({
        ...base,
        exchangeResponseRawObjectId: "52",
      }),
    ).rejects.toThrow("does not match its joined exchange");
    await expect(
      firmsAreaResponseFromTrustedJoinedRecord({
        ...base,
        responseOccurrence: { ...occurrence, httpExchangeId: "42" },
      }),
    ).rejects.toThrow("does not match its joined exchange");
  });

  it.each([
    ["area", { requestQuerySafe: { ...firmsAreaRequestEvidence(VIIRS_REQUEST).requestQuerySafe, area: "26.200000,38.850000,27.000000,39.150000" } }],
    ["product", { requestQuerySafe: { ...firmsAreaRequestEvidence(VIIRS_REQUEST).requestQuerySafe, product: "VIIRS_NOAA21_NRT" } }],
    ["date", { requestQuerySafe: { ...firmsAreaRequestEvidence(VIIRS_REQUEST).requestQuerySafe, date: "rolling:5" } }],
    ["issuance", { requestMetadataSafe: { ...firmsAreaRequestEvidence(VIIRS_REQUEST).requestMetadataSafe, issued_at: "2026-07-29T12:00:00.000Z" } }],
  ] as const)("rejects a replay with independently changed %s evidence", async (_label, override) => {
    const evidence = firmsAreaRequestEvidence(VIIRS_REQUEST);
    const requestFingerprintSha256 =
      await requestEvidenceFingerprintSha256(evidence);
    const body = new TextEncoder().encode(FIRMS_HEADER_ONLY_CSV);
    await expect(
      firmsAreaResponseFromTrustedJoinedRecord({
        reference: REFERENCE,
        requestFingerprintSha256,
        request: { ...evidence, ...override },
        exchangeResponseRawObjectId: "51",
        response: {
          status: 200,
          body,
          safeHeaders: {},
          safeMetadata: {},
        },
        responseOccurrence: {
          rawObjectId: "51",
          httpExchangeId: REFERENCE.exchangeId,
          runId: REFERENCE.runId,
          contentSha256: await contentSha256(body),
          retrievedAt: RETRIEVED_AT,
        },
      }),
    ).rejects.toBeInstanceOf(TypeError);
  });

  it("fails rolling requests closed across UTC midnight", async () => {
    const rolling = firmsAreaRequest({
      mapKey: MAP_KEY,
      product: "VIIRS_NOAA20_NRT",
      area: AREA,
      date: { kind: "rolling", days: 1 },
      issuedAt: "2026-07-30T23:59:59.000Z",
    });
    const rollingResponse = await recordedResponse(
      rolling,
      FIRMS_HEADER_ONLY_CSV,
      "2026-07-31T00:00:01.000Z",
    );
    expect(() => parseFirmsCsv(rollingResponse)).toThrow(
      "crossing UTC midnight",
    );

    const historical = firmsAreaRequest({
      mapKey: MAP_KEY,
      product: "VIIRS_NOAA20_NRT",
      area: AREA,
      date: { kind: "starting-on", date: "2026-07-30", days: 1 },
      issuedAt: "2026-07-30T23:59:59.000Z",
    });
    expect(
      parseFirmsCsv(
        await recordedResponse(
          historical,
          FIRMS_HEADER_ONLY_CSV,
          "2026-07-31T00:00:01.000Z",
        ),
      ).emptyPayload,
    ).toBe(true);
  });

  it("rejects malformed or reversed retrieval anchors", async () => {
    await expect(
      recordedResponse(
        VIIRS_REQUEST,
        FIRMS_HEADER_ONLY_CSV,
        "2026-07-30T12:00:00+00:00",
      ),
    ).rejects.toThrow("retrieval time must be canonical UTC");
    const reversed = await recordedResponse(
      VIIRS_REQUEST,
      FIRMS_HEADER_ONLY_CSV,
      "2026-07-30T11:59:59.000Z",
    );
    expect(() => parseFirmsCsv(reversed)).toThrow("cannot precede issuance");
  });

  it("rejects an oversized response before decoding or row parsing", async () => {
    const result = parseFirmsCsv(
      await responseFor("MODIS_NRT", oversizedFirmsCsv()),
    );

    expect(result).toEqual({
      product: "MODIS_NRT",
      status: "error",
      returnedRows: 0,
      detections: [],
      rejectedRows: [],
      emptyPayload: false,
      errorCode: "response-too-large",
    });
    expect(oversizedFirmsCsv()).toHaveLength(FIRMS_MAX_RESPONSE_BYTES + 1);
  });
});
