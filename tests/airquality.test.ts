import { readFileSync } from "node:fs";
import { expect, test } from "vitest";

import { normalizeAirQuality } from "../app/api/wind/airquality";

const LOCATIONS = [
  { id: "fire", label: "Plomari fire area" },
  { id: "perama", label: "Perama" },
] as const;

const fixture = JSON.parse(
  readFileSync(
    new URL("./fixtures/open-meteo-air-quality.json", import.meta.url),
    "utf8",
  ),
) as unknown;

test("normalizes a real multi-location response in request order", () => {
  const result = normalizeAirQuality(fixture, LOCATIONS);
  expect(result).toHaveLength(2);
  expect(result[0]).toMatchObject({
    id: "fire",
    provider: "open-meteo",
    pm25: 4.2,
    pm10: 8.1,
    europeanAqi: 35,
  });
  expect(result[1]?.id).toBe("perama");
  expect(result[0]?.time).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/);
});

test("drops locations whose entry is missing instead of fabricating values", () => {
  const single = (fixture as unknown[])[0];
  expect(normalizeAirQuality([single], LOCATIONS)).toHaveLength(1);
});

test("handles a bare single-location object", () => {
  const single = (fixture as unknown[])[0];
  const result = normalizeAirQuality(single, [LOCATIONS[0]]);
  expect(result).toHaveLength(1);
  expect(result[0]?.id).toBe("fire");
});

test("returns empty for malformed payloads instead of throwing", () => {
  expect(normalizeAirQuality(null, LOCATIONS)).toEqual([]);
  expect(normalizeAirQuality({ current: "not-an-object" }, LOCATIONS)).toEqual(
    [],
  );
});
