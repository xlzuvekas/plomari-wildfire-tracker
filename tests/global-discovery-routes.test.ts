import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  exploreDiscoveryResponseSchema,
  nearbyDiscoveryResponseSchema,
} from "../lib/firewatch/v3";
import {
  parseExploreDiscoveryHttpRequest,
  parseNearbyDiscoveryHttpRequest,
} from "../lib/firewatch/v3/discovery-route.server";
import type { NearbyIncidentReadRow } from "../lib/supabase/global-discovery-read-model";

const mocks = vi.hoisted(() => ({
  readNearbyIncidentRows: vi.fn(),
}));

vi.mock("../lib/supabase/global-discovery-read-model", async () => {
  const actual = await vi.importActual<
    typeof import("../lib/supabase/global-discovery-read-model")
  >("../lib/supabase/global-discovery-read-model");
  return { ...actual, readNearbyIncidentRows: mocks.readNearbyIncidentRows };
});

import { GET as getNearby } from "../app/api/v3/areas/nearby/route";
import { GET as getExplore } from "../app/api/v3/explore/cells/route";

const CELL = "wm/10/587/391";

function currentCutoffs() {
  const knownAtMs = Math.floor(Date.now() / 300_000) * 300_000;
  return {
    asOf: new Date(knownAtMs).toISOString(),
    knownAt: new Date(knownAtMs).toISOString(),
  };
}

function requestUrl(
  path: string,
  input: Readonly<{
    cell?: string;
    limit?: number;
    after?: string;
  }> = {},
) {
  const time = currentCutoffs();
  const query = new URLSearchParams({
    ...(input.cell ? { cell: input.cell } : {}),
    schemaVersion: "3",
    asOf: time.asOf,
    knownAt: time.knownAt,
    limit: String(input.limit ?? 50),
    ...(input.after ? { after: input.after } : {}),
  });
  return `https://firewatch.invalid${path}?${query}`;
}

function incidentRow(
  suffix: string,
  knownAt: string,
): NearbyIncidentReadRow {
  return {
    incident_id: `01900000-0000-7000-8000-0000000001${suffix}`,
    contract_version: "1.1.0",
    slug: `plomari-fire-${suffix}`,
    name: `Plomari fire ${suffix}`,
    localized_names: { "el-GR": `Πυρκαγιά ${suffix}` },
    default_timezone: "Europe/Athens",
    incident_kind: "wildfire",
    lifecycle: "monitoring",
    started_at: new Date(Date.parse(knownAt) - 2 * 60 * 60_000).toISOString(),
    started_date: null,
    started_precision: "exact",
    started_timezone: null,
    latest_observed_at: new Date(
      Date.parse(knownAt) - 10 * 60_000,
    ).toISOString(),
    latest_observed_date: null,
    latest_observed_precision: "exact",
    latest_observed_timezone: null,
    item_known_at: new Date(Date.parse(knownAt) - Number(suffix) * 1_000).toISOString(),
    resolved_scope_timezone: "Europe/Athens",
  };
}

beforeEach(() => {
  mocks.readNearbyIncidentRows.mockReset();
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("v3 global discovery HTTP request boundary", () => {
  it("accepts only exact, canonical, recently bounded queries", () => {
    const nearby = parseNearbyDiscoveryHttpRequest(
      new Request(requestUrl("/api/v3/areas/nearby", { cell: CELL })),
    );
    expect(nearby.cell).toBe(CELL);
    expect(nearby.page).toEqual({ limit: 50, after: null });

    expect(() =>
      parseNearbyDiscoveryHttpRequest(
        new Request(
          `${requestUrl("/api/v3/areas/nearby", { cell: CELL })}&lat=38.97`,
        ),
      ),
    ).toThrow("invalid");
    expect(() =>
      parseNearbyDiscoveryHttpRequest(
        new Request(
          requestUrl("/api/v3/areas/nearby", { cell: "wm/7/64/64" }),
        ),
      ),
    ).toThrow("invalid");
    expect(() =>
      parseNearbyDiscoveryHttpRequest(
        new Request(
          `${requestUrl("/api/v3/areas/nearby", { cell: CELL })}&cell=${CELL}`,
        ),
      ),
    ).toThrow("invalid");
    expect(() =>
      parseExploreDiscoveryHttpRequest(
        new Request(
          "https://firewatch.invalid/api/v3/explore/cells?schemaVersion=3" +
            "&asOf=2024-01-01T00%3A00%3A00.000Z" +
            "&knownAt=2024-01-01T00%3A00%3A00.000Z",
        ),
      ),
    ).toThrow("invalid");
  });

  it("fails closed on continuation until an immutable projection exists", () => {
    expect(() =>
      parseNearbyDiscoveryHttpRequest(
        new Request(
          requestUrl("/api/v3/areas/nearby", {
            cell: CELL,
            after: "AAAAAAAAAAAAAAAA",
          }),
        ),
      ),
    ).toThrow("invalid");
  });
});

describe("v3 global discovery routes", () => {
  it("exposes Explore as explicit unconfigured data, never valid-empty", async () => {
    const response = await getExplore(
      new Request(requestUrl("/api/v3/explore/cells")),
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    const payload = await response.json();
    expect(exploreDiscoveryResponseSchema.safeParse(payload).success).toBe(
      true,
    );
    expect(payload).toMatchObject({
      coverage: { state: "unconfigured" },
      result: { state: "indeterminate" },
      candidates: [],
      time: { timeZone: { id: "UTC", basis: "utc-fallback" } },
    });
  });

  it("rejects an unsupported Explore continuation rather than trusting it", async () => {
    const response = await getExplore(
      new Request(
        requestUrl("/api/v3/explore/cells", {
          after: "AAAAAAAAAAAAAAAA",
        }),
      ),
    );
    expect(response.status).toBe(400);
    expect(response.headers.get("cache-control")).toBe("no-store");
  });

  it("uses explicit UTC fallback when no persisted Nearby partition exists", async () => {
    mocks.readNearbyIncidentRows.mockResolvedValue([]);
    const response = await getNearby(
      new Request(requestUrl("/api/v3/areas/nearby", { cell: CELL })),
    );
    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(nearbyDiscoveryResponseSchema.safeParse(payload).success).toBe(
      true,
    );
    expect(payload).toMatchObject({
      coverage: { state: "not_assessed" },
      result: { state: "indeterminate" },
      incidents: [],
      scope: { cell: CELL, timeZone: "UTC" },
      time: { timeZone: { basis: "utc-fallback" } },
    });
  });

  it("publishes persisted items without fabricating a coverage watermark", async () => {
    const { knownAt } = currentCutoffs();
    mocks.readNearbyIncidentRows.mockResolvedValue([
      incidentRow("01", knownAt),
    ]);
    const response = await getNearby(
      new Request(requestUrl("/api/v3/areas/nearby", { cell: CELL })),
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.has("etag")).toBe(false);
    const payload = await response.json();
    expect(nearbyDiscoveryResponseSchema.safeParse(payload).success).toBe(
      true,
    );
    expect(payload).toMatchObject({
      coverage: {
        state: "not_assessed",
      },
      result: { state: "items" },
      scope: { timeZone: "Europe/Athens" },
      time: { timeZone: { basis: "scope" } },
      incidents: [
        {
          displayNames: {
            und: "Plomari fire 01",
            "el-GR": "Πυρκαγιά 01",
          },
        },
      ],
    });
  });

  it("fails closed instead of truncating a cell that exceeds one page", async () => {
    const { knownAt } = currentCutoffs();
    const first = incidentRow("01", knownAt);
    const second = incidentRow("02", knownAt);
    mocks.readNearbyIncidentRows.mockResolvedValueOnce([first, second]);

    const firstResponse = await getNearby(
      new Request(
        requestUrl("/api/v3/areas/nearby", { cell: CELL, limit: 1 }),
      ),
    );
    expect(firstResponse.status).toBe(503);
    await expect(firstResponse.json()).resolves.toMatchObject({
      error: { code: "read_model_unavailable" },
    });
    expect(mocks.readNearbyIncidentRows).toHaveBeenCalledOnce();
  });
});
