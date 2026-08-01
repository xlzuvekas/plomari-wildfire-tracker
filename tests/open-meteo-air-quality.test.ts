import { describe, expect, it } from "vitest";
import {
  OPEN_METEO_AQ_MAX_RESPONSE_BYTES,
  openMeteoAirQualityUrl,
  parseOpenMeteoAirQuality,
} from "../lib/air-quality/open-meteo";

const encode = (value: unknown) =>
  new TextEncoder().encode(JSON.stringify(value));

// Response shape captured live from the Open-Meteo air-quality API on
// 2026-07-30 (PR #19 lineage, commits e002589 / 0e31aa7).
const validPayload = {
  latitude: 43.5,
  longitude: 4.8,
  utc_offset_seconds: 0,
  timezone: "UTC",
  current: {
    time: "2026-07-30T06:00",
    pm2_5: 22.1,
    pm10: 35.2,
    nitrogen_dioxide: 8.4,
    ozone: 91,
    aerosol_optical_depth: 0.25,
    european_aqi: 32,
    us_aqi: 71,
  },
};

describe("openMeteoAirQualityUrl", () => {
  it("builds an allowlisted UTC query for a point", () => {
    const url = openMeteoAirQualityUrl({ latitude: 43.5, longitude: 4.8 });
    expect(url.origin + url.pathname).toBe(
      "https://air-quality-api.open-meteo.com/v1/air-quality",
    );
    expect([...url.searchParams.keys()].sort()).toEqual([
      "current",
      "latitude",
      "longitude",
      "timezone",
    ]);
    expect(url.searchParams.get("timezone")).toBe("UTC");
    expect(url.searchParams.get("latitude")).toBe("43.5000");
  });

  it("rejects out-of-range and over-precise coordinates", () => {
    expect(() =>
      openMeteoAirQualityUrl({ latitude: 91, longitude: 0 }),
    ).toThrow(TypeError);
    expect(() =>
      openMeteoAirQualityUrl({ latitude: 43.123456789, longitude: 0 }),
    ).toThrow(TypeError);
  });
});

describe("parseOpenMeteoAirQuality", () => {
  it("parses a valid payload into a modeled UTC reading", () => {
    const result = parseOpenMeteoAirQuality(encode(validPayload));
    expect(result.status).toBe("ok");
    if (result.status !== "ok") return;
    expect(result.reading.basis).toBe("modeled");
    expect(result.reading.observedAtUtc).toBe("2026-07-30T06:00:00.000Z");
    expect(result.reading.pm25).toBe(22.1);
    expect(result.reading.europeanAqi).toBe(32);
    expect(result.reading.usAqi).toBe(71);
  });

  it("preserves missing pollutant fields as null instead of inventing values", () => {
    const payload = {
      ...validPayload,
      current: { time: "2026-07-30T06:00", pm2_5: 3.2 },
    };
    const result = parseOpenMeteoAirQuality(encode(payload));
    expect(result.status).toBe("ok");
    if (result.status !== "ok") return;
    expect(result.reading.pm25).toBe(3.2);
    expect(result.reading.pm10).toBeNull();
    expect(result.reading.europeanAqi).toBeNull();
  });

  it("rejects a non-UTC offset because the request demanded UTC", () => {
    const result = parseOpenMeteoAirQuality(
      encode({ ...validPayload, utc_offset_seconds: 7200 }),
    );
    expect(result).toEqual({ status: "malformed", reason: "non_utc_offset" });
  });

  it("rejects malformed bodies with coded reasons, never throwing", () => {
    expect(parseOpenMeteoAirQuality(new TextEncoder().encode("<html>"))).toEqual(
      { status: "malformed", reason: "not_json" },
    );
    expect(parseOpenMeteoAirQuality(encode({ latitude: 1 }))).toEqual({
      status: "malformed",
      reason: "schema_mismatch",
    });
    expect(
      parseOpenMeteoAirQuality(
        encode({
          ...validPayload,
          current: { ...validPayload.current, time: "yesterday" },
        }),
      ),
    ).toEqual({ status: "malformed", reason: "invalid_model_time" });
  });

  it("rejects oversized bodies", () => {
    const result = parseOpenMeteoAirQuality(
      new Uint8Array(OPEN_METEO_AQ_MAX_RESPONSE_BYTES + 1),
    );
    expect(result).toEqual({
      status: "malformed",
      reason: "response_too_large",
    });
  });
});
