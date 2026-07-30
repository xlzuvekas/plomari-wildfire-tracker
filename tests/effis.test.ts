import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { buildBurntAreaUrl, normalizeBurntAreas } from "../app/api/effis/effis";

const fixture = JSON.parse(
  readFileSync(join(__dirname, "fixtures", "effis-ba-week.json"), "utf8"),
) as unknown;

describe("normalizeBurntAreas", () => {
  it("extracts dated, attributed polygons from a live EFFIS response", () => {
    const areas = normalizeBurntAreas(fixture);
    expect(areas).toHaveLength(3);
    for (const area of areas) {
      expect(area.country).toBe("FR");
      expect(area.fireDate).toMatch(/^2026-07-2\d/);
      expect(area.areaHa).toBeGreaterThan(0);
      expect(area.rings.length).toBeGreaterThan(0);
      const [lat, lon] = area.rings[0]![0]!;
      expect(lat).toBeGreaterThan(41);
      expect(lat).toBeLessThan(45.5);
      expect(lon).toBeGreaterThan(-2);
      expect(lon).toBeLessThan(8);
    }
  });

  it("sorts newest fire first", () => {
    const dates = normalizeBurntAreas(fixture).map((area) => area.fireDate);
    expect(dates).toEqual([...dates].sort().reverse());
  });

  it("returns empty for malformed payloads", () => {
    expect(normalizeBurntAreas(null)).toEqual([]);
    expect(normalizeBurntAreas({ features: "no" })).toEqual([]);
    expect(
      normalizeBurntAreas({ features: [{ geometry: { type: "Point" } }] }),
    ).toEqual([]);
  });
});

describe("buildBurntAreaUrl", () => {
  it("targets the weekly burnt-area layer with the region bbox", () => {
    const url = buildBurntAreaUrl([41.2, -1.5, 45.5, 9.7]);
    expect(url.searchParams.get("typename")).toBe("ms:modis.ba.poly.week");
    expect(url.searchParams.get("bbox")).toBe("41.2,-1.5,45.5,9.7,EPSG:4326");
  });
});
