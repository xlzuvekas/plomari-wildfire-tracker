import { describe, expect, it } from "vitest";

import {
  AREA_GRID_VERSION,
  AREA_NOTICE_VERSION,
  areaResolveRequestSchema,
  coarseAreaCellForLocation,
  mapContextSchema,
  parseAreaCellKey,
} from "../lib/firewatch";

describe("privacy-reduced map context", () => {
  it.each([
    ["Plomari", 38.976, 26.369],
    ["Marseille", 43.2965, 5.3698],
    ["Paris", 48.8566, 2.3522],
    ["northern wildfire", 64.2, -149.5],
  ])("quantizes %s into a canonical coarse global cell", (_label, lat, lon) => {
    const area = coarseAreaCellForLocation(lat, lon);
    expect(area.gridVersion).toBe(AREA_GRID_VERSION);
    expect(area.cellKey).toMatch(/^wm\/\d+\/\d+\/\d+$/u);
    expect(area.cellKey).not.toContain(String(lat));
    expect(area.cellKey).not.toContain(String(lon));
    expect(area.minimumSpanM).toBeGreaterThanOrEqual(8_000);
    expect(parseAreaCellKey(area.cellKey)).toEqual(area);
    expect(lat).toBeGreaterThanOrEqual(area.bounds.south);
    expect(lat).toBeLessThanOrEqual(area.bounds.north);
    expect(lon).toBeGreaterThanOrEqual(area.bounds.west);
    expect(lon).toBeLessThanOrEqual(area.bounds.east);
  });

  it("accepts only a coarse key and rejects raw coordinates or unknown fields", () => {
    const area = coarseAreaCellForLocation(38.976, 26.369);
    const request = {
      schemaVersion: "1.0.0",
      gridVersion: AREA_GRID_VERSION,
      cellKey: area.cellKey,
      selectionMethod: "gps_coarse",
      noticeVersion: AREA_NOTICE_VERSION,
      requestNonce: "1234567890abcdefghijkl",
    } as const;

    expect(areaResolveRequestSchema.safeParse(request).success).toBe(true);
    expect(
      areaResolveRequestSchema.safeParse({
        ...request,
        latitude: 38.976,
        longitude: 26.369,
      }).success,
    ).toBe(false);
    expect(
      areaResolveRequestSchema.safeParse({ ...request, cellKey: "wm/11/9999/1" })
        .success,
    ).toBe(false);
  });

  it("requires the correct area and incident shapes for each map mode", () => {
    const explore = {
      schemaVersion: "1.0.0",
      mode: "explore",
      area: null,
      incident: null,
      selectionMethod: null,
    } as const;
    expect(mapContextSchema.safeParse(explore).success).toBe(true);
    expect(
      mapContextSchema.safeParse({ ...explore, mode: "nearby" }).success,
    ).toBe(false);
    expect(
      mapContextSchema.safeParse({ ...explore, mode: "incident" }).success,
    ).toBe(false);

    const area = coarseAreaCellForLocation(38.976, 26.369);
    const nearby = {
      ...explore,
      mode: "nearby",
      selectionMethod: "gps_coarse",
      area: {
        gridVersion: AREA_GRID_VERSION,
        cellKey: area.cellKey,
        center: area.center,
        bounds: area.bounds,
        minimumSpanM: area.minimumSpanM,
        placeLabel: "Plomari area",
        countryCode: "GR",
        adminRegion: "Lesvos",
        timeZone: "Europe/Athens",
        locales: ["el-GR", "en-GB"],
        unitSystem: "metric",
      },
    } as const;
    expect(mapContextSchema.safeParse(nearby).success).toBe(true);
    expect(
      mapContextSchema.safeParse({
        ...nearby,
        area: {
          ...nearby.area,
          center: { ...nearby.area.center, latitude: 38.976 },
        },
      }).success,
    ).toBe(false);
  });
});
