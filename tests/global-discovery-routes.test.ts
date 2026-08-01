import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  exploreDiscoveryResponseSchema,
  nearbyDiscoveryResponseSchema,
} from "../lib/firewatch/v3";
import {
  parseExploreDiscoveryHttpRequest,
  parseNearbyDiscoveryHttpRequest,
} from "../lib/firewatch/v3/discovery-route.server";
import type {
  GlobalCandidateProjectionItem,
  GlobalCandidateProjectionSnapshot,
  NearbyIncidentReadRow,
} from "../lib/supabase/global-discovery-read-model";

const mocks = vi.hoisted(() => ({
  readGlobalCandidateProjectionPage: vi.fn(),
  readNearbyIncidentRows: vi.fn(),
}));

vi.mock("../lib/supabase/global-discovery-read-model", async () => {
  const actual = await vi.importActual<
    typeof import("../lib/supabase/global-discovery-read-model")
  >("../lib/supabase/global-discovery-read-model");
  return {
    ...actual,
    readGlobalCandidateProjectionPage:
      mocks.readGlobalCandidateProjectionPage,
    readNearbyIncidentRows: mocks.readNearbyIncidentRows,
  };
});

import { GET as getNearby } from "../app/api/v3/areas/nearby/route";
import { GET as getExplore } from "../app/api/v3/explore/cells/route";

const CELL = "wm/10/587/391";
const DISCOVERY_KEY = `sb_secret_${"a".repeat(48)}`;
const SNAPSHOT_ID = "01900000-0000-7000-8000-000000000200";
const SNAPSHOT_DIGEST = "b".repeat(64);
const GATE_DIGEST = "c".repeat(64);

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
    asOf?: string;
    knownAt?: string;
  }> = {},
) {
  const time = input.asOf !== undefined && input.knownAt !== undefined
    ? { asOf: input.asOf, knownAt: input.knownAt }
    : currentCutoffs();
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

function globalSnapshot(): GlobalCandidateProjectionSnapshot {
  const cutoffs = currentCutoffs();
  return {
    snapshot_id: SNAPSHOT_ID,
    snapshot_as_of: cutoffs.asOf,
    snapshot_known_at: cutoffs.knownAt,
    snapshot_observed_from: new Date(
      Date.parse(cutoffs.asOf) - 7 * 24 * 60 * 60_000,
    ).toISOString(),
    snapshot_digest: SNAPSHOT_DIGEST,
    publication_gate_digest: GATE_DIGEST,
  };
}

function candidateRow(
  suffix: string,
  knownAt: string,
): GlobalCandidateProjectionItem {
  const snapshot = globalSnapshot();
  return {
    row_kind: "candidate",
    ...snapshot,
    candidate_id: `01900000-0000-7000-8000-0000000002${suffix}`,
    cell_key: CELL,
    display_timezone: "Europe/Athens",
    signal_kinds: ["thermal_detection"],
    observation_count: 2,
    source_count: 1,
    first_observed_at: new Date(
      Date.parse(knownAt) - 60 * 60_000,
    ).toISOString(),
    latest_observed_at: new Date(
      Date.parse(knownAt) - 10 * 60_000,
    ).toISOString(),
    item_known_at: new Date(
      Date.parse(knownAt) - Number(suffix) * 1_000,
    ).toISOString(),
  };
}

beforeEach(() => {
  vi.stubEnv("SUPABASE_DISCOVERY_READER_KEY", DISCOVERY_KEY);
  mocks.readGlobalCandidateProjectionPage.mockReset();
  mocks.readGlobalCandidateProjectionPage.mockResolvedValue({
    snapshot: null,
    candidates: [],
  });
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

  it("rejects an unauthenticated Explore continuation", async () => {
    const response = await getExplore(
      new Request(
        requestUrl("/api/v3/explore/cells", {
          after: "AAAAAAAAAAAAAAAA",
        }),
      ),
    );
    expect(response.status).toBe(400);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(mocks.readGlobalCandidateProjectionPage).not.toHaveBeenCalled();
  });

  it("keeps a published empty projection indeterminate without claiming coverage", async () => {
    mocks.readGlobalCandidateProjectionPage.mockResolvedValue({
      snapshot: globalSnapshot(),
      candidates: [],
    });
    const response = await getExplore(
      new Request(requestUrl("/api/v3/explore/cells")),
    );
    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(exploreDiscoveryResponseSchema.safeParse(payload).success).toBe(
      true,
    );
    expect(payload).toMatchObject({
      coverage: { state: "not_assessed" },
      result: { state: "indeterminate" },
      candidates: [],
      page: { hasMore: false, nextCursor: null },
    });
  });

  it("publishes positive candidates and signs a snapshot-bound continuation", async () => {
    const url = requestUrl("/api/v3/explore/cells", { limit: 1 });
    const parameters = new URL(url).searchParams;
    const asOf = parameters.get("asOf");
    const knownAt = parameters.get("knownAt");
    if (asOf === null || knownAt === null) throw new Error("Missing cutoffs");
    const snapshot = {
      ...globalSnapshot(),
      snapshot_as_of: asOf,
      snapshot_known_at: knownAt,
      snapshot_observed_from: new Date(
        Date.parse(asOf) - 7 * 24 * 60 * 60_000,
      ).toISOString(),
    };
    const first = { ...candidateRow("01", knownAt), ...snapshot };
    const second = { ...candidateRow("02", knownAt), ...snapshot };
    mocks.readGlobalCandidateProjectionPage.mockResolvedValueOnce({
      snapshot,
      candidates: [first, second],
    });

    const firstResponse = await getExplore(new Request(url));
    expect(firstResponse.status).toBe(200);
    const firstPayload = await firstResponse.json();
    expect(exploreDiscoveryResponseSchema.safeParse(firstPayload).success).toBe(
      true,
    );
    expect(firstPayload).toMatchObject({
      coverage: { state: "not_assessed" },
      result: { state: "items" },
      candidates: [{ candidateId: first.candidate_id }],
      page: { isFirstPage: true, hasMore: true },
    });
    expect(firstPayload.page.nextCursor).toMatch(/^[A-Za-z0-9_-]+$/u);
    expect(firstPayload.page.nextCursor).not.toContain(".");
    expect(firstPayload.page.nextCursor.length).toBeLessThanOrEqual(512);

    mocks.readGlobalCandidateProjectionPage.mockResolvedValueOnce({
      snapshot,
      candidates: [second],
    });
    const continuationResponse = await getExplore(
      new Request(
        requestUrl("/api/v3/explore/cells", {
          limit: 1,
          after: firstPayload.page.nextCursor,
          asOf,
          knownAt,
        }),
      ),
    );
    expect(continuationResponse.status).toBe(200);
    const continuationPayload = await continuationResponse.json();
    expect(
      exploreDiscoveryResponseSchema.safeParse(continuationPayload).success,
    ).toBe(true);
    expect(continuationPayload).toMatchObject({
      coverage: { state: "not_assessed" },
      result: { state: "items" },
      candidates: [{ candidateId: second.candidate_id }],
      page: {
        isFirstPage: false,
        hasMore: false,
        nextCursor: null,
      },
    });
    expect(mocks.readGlobalCandidateProjectionPage).toHaveBeenLastCalledWith({
      observedFrom: snapshot.snapshot_observed_from,
      asOf,
      knownAt,
      limit: 2,
      continuation: {
        snapshotId: SNAPSHOT_ID,
        snapshotDigest: SNAPSHOT_DIGEST,
        publicationGateDigest: GATE_DIGEST,
        afterItemKnownAt: first.item_known_at,
        afterCandidateId: first.candidate_id,
      },
    });
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
