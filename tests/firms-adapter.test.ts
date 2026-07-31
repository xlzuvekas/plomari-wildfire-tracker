import { describe, expect, it } from "vitest";

import {
  FIRMS_AREA_ENDPOINT,
  FIRMS_MAX_RESPONSE_BYTES,
  firmsAreaRequest,
  firmsAreaRequestEvidence,
  parseFirmsCsv,
  type FirmsParseRequest,
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
const AREA = Object.freeze({
  west: 26.2,
  south: 38.85,
  east: 26.6,
  north: 39.15,
});
const VIIRS_PARSE_REQUEST = Object.freeze({
  product: "VIIRS_NOAA20_NRT",
  area: AREA,
  date: Object.freeze({ kind: "rolling", days: 2 }),
  requestedAt: "2026-07-30T12:00:00.000Z",
}) satisfies FirmsParseRequest;

function parseRequest(product: FirmsProduct): FirmsParseRequest {
  return Object.freeze({ ...VIIRS_PARSE_REQUEST, product });
}

describe("NASA FIRMS Area adapter boundary", () => {
  it("builds a path-secret request with a credential-free logical envelope", () => {
    const request = firmsAreaRequest({
      mapKey: MAP_KEY,
      product: "VIIRS_NOAA20_NRT",
      area: AREA,
      date: { kind: "rolling", days: 2 },
    });

    expect(request.url).toBe(
      `${FIRMS_AREA_ENDPOINT}/${MAP_KEY}/VIIRS_NOAA20_NRT/26.2,38.85,26.6,39.15/2`,
    );
    expect(request.requestUrlSafe).toBe(FIRMS_AREA_ENDPOINT);
    expect(request.requestQuerySafe).toEqual({
      area: "26.2,38.85,26.6,39.15",
      date: "rolling:2",
      product: "VIIRS_NOAA20_NRT",
    });
    expect(JSON.stringify(request.requestQuerySafe)).not.toContain(MAP_KEY);
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
      },
    });
  });

  it("retains a reconstructible historical date and day range without the key", () => {
    const request = firmsAreaRequest({
      mapKey: MAP_KEY,
      product: "MODIS_NRT",
      area: AREA,
      date: { kind: "starting-on", date: "2026-07-29", days: 1 },
    });

    expect(request.url).toMatch(/\/1\/2026-07-29$/u);
    expect(request.requestQuerySafe.date).toBe("2026-07-29/1");
    expect(JSON.stringify(request.requestQuerySafe)).not.toContain(MAP_KEY);
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
        ...override,
      }),
    ).toThrow(TypeError);
  });

  it("parses strict VIIRS rows while preserving source values and UTC time", () => {
    const result = parseFirmsCsv(VIIRS_PARSE_REQUEST, FIRMS_VIIRS_CSV);

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
    (product, satelliteRaw, satellite) => {
      const row = `38.97510,26.36620,341.20,0.39,0.36,2026-07-29,1542,${satelliteRaw},VIIRS,n,2.0NRT,301.45,8.10,D`;
      const result = parseFirmsCsv(
        parseRequest(product satisfies FirmsProduct),
        `${FIRMS_VIIRS_HEADER}\n${row}\n`,
      );
      expect(result.status).toBe("ok");
      expect(result.detections[0]).toMatchObject({ product, satellite });
    },
  );

  it("parses MODIS numeric confidence without inventing a category", () => {
    const result = parseFirmsCsv(parseRequest("MODIS_NRT"), FIRMS_MODIS_CSV);

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

  it("labels a header-only response as syntactically empty, not anomaly-free", () => {
    const result = parseFirmsCsv(
      VIIRS_PARSE_REQUEST,
      FIRMS_HEADER_ONLY_CSV,
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

  it("fails a malformed product header instead of treating it as empty", () => {
    const result = parseFirmsCsv(
      VIIRS_PARSE_REQUEST,
      FIRMS_MALFORMED_HEADER_CSV,
    );

    expect(result).toMatchObject({
      status: "error",
      emptyPayload: false,
      errorCode: "invalid-header",
    });
  });

  it("returns explicit row rejections and never upgrades them to empty", () => {
    const result = parseFirmsCsv(
      VIIRS_PARSE_REQUEST,
      FIRMS_MALFORMED_ROWS_CSV,
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

  it("accepts AOI/date boundaries and explicitly rejects out-of-scope rows", () => {
    const boundary =
      "38.85,26.2,341.20,0.39,0.36,2026-07-29,1542,N20,VIIRS,n,2.0NRT,301.45,8.10,D";
    const outsideArea =
      "38.85,26.60001,341.20,0.39,0.36,2026-07-29,1542,N20,VIIRS,n,2.0NRT,301.45,8.10,D";
    const outsideDate =
      "38.85,26.2,341.20,0.39,0.36,2026-07-28,1542,N20,VIIRS,n,2.0NRT,301.45,8.10,D";
    const result = parseFirmsCsv(
      VIIRS_PARSE_REQUEST,
      `${FIRMS_VIIRS_HEADER}\n${boundary}\n${outsideArea}\n${outsideDate}\n`,
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
      VIIRS_PARSE_REQUEST,
      `${FIRMS_VIIRS_HEADER}\n3.897510e1,26.36620,341.20,0.39,0.36,2026-07-29,1542,N20,VIIRS,n,2.0NRT,301.45,8.10,D\n`,
      "invalid-coordinate",
    ],
    [
      "hexadecimal measurement",
      VIIRS_PARSE_REQUEST,
      `${FIRMS_VIIRS_HEADER}\n38.97510,26.36620,0x155,0.39,0.36,2026-07-29,1542,N20,VIIRS,n,2.0NRT,301.45,8.10,D\n`,
      "invalid-measurement",
    ],
    [
      "non-integer MODIS confidence",
      parseRequest("MODIS_NRT"),
      `${FIRMS_MODIS_HEADER}\n38.96980,26.35510,318.70,1.03,1.01,2026-07-29,1635,Terra,MODIS,8e1,6.1NRT,293.20,12.50,D\n`,
      "invalid-confidence",
    ],
  ] as const)("rejects %s source syntax", (_label, request, csv, reason) => {
    const result = parseFirmsCsv(request, csv);

    expect(result.status).toBe("partial");
    expect(result.rejectedRows[0]?.reasons).toContain(reason);
  });

  it("rejects malformed parse scope before interpreting response bytes", () => {
    expect(() =>
      parseFirmsCsv(
        {
          ...VIIRS_PARSE_REQUEST,
          requestedAt: "2026-07-30T12:00:00+00:00",
        },
        FIRMS_HEADER_ONLY_CSV,
      ),
    ).toThrow("canonical UTC");
  });

  it("rejects an oversized response before decoding or row parsing", () => {
    const result = parseFirmsCsv(
      parseRequest("MODIS_NRT"),
      oversizedFirmsCsv(),
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
