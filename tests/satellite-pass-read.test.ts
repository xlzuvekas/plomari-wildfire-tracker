import { afterEach, describe, expect, it, vi } from "vitest";

import { GET } from "../app/api/v3/satellite-passes/route";
import type { SupabaseServerEnvironment } from "../lib/supabase/server-env";

const TEST_ENVIRONMENT: SupabaseServerEnvironment = Object.freeze({
  url: "https://project.supabase.co",
  publishableKey: "test-publishable-key-1234",
});

const SCAN_ROW = {
  source_id: "018f0000-0000-7000-8000-000000000115",
  source_slug: "nasa-cmr-firemask",
  collection_target_id: "018f0000-0000-7000-8000-000000000415",
  collection_target_revision_id: "018f0000-0000-7000-8000-000000000515",
  health_id: "018f0000-0000-7000-8000-000000000615",
  scan_health_id: "018f0000-0000-7000-8000-000000000614",
  health_status: "healthy",
  scan_kind: "incremental",
  requested_from: "2026-07-29T06:00:00+00:00",
  requested_to: "2026-07-30T18:00:00+00:00",
  watermark_from: "2026-07-30T17:45:00+00:00",
  updated_since: "2026-07-30T17:45:00+00:00",
  watermark_to: "2026-07-30T17:50:00+00:00",
  predecessor_health_id: "018f0000-0000-7000-8000-000000000613",
  baseline_health_id: "018f0000-0000-7000-8000-000000000601",
  continuous_coverage_from: "2026-07-29T06:00:00+00:00",
  continuous_coverage_to: "2026-07-30T18:00:00+00:00",
  lineage_depth: 12,
  completed_products: [
    "VNP14IMG_NRT",
    "VJ114IMG_NRT",
    "VJ214IMG_NRT",
  ],
  page_count: 6,
  upstream_hit_count: 421,
  accepted_granule_count: 421,
  geographic_completeness: 1,
  schema_failure_count: 0,
  checked_at: "2026-07-30T18:05:00+00:00",
  last_success_at: "2026-07-30T18:05:00+00:00",
  latest_source_observed_at: "2026-07-30T17:58:00+00:00",
  scan_checked_at: "2026-07-30T18:05:00+00:00",
  freshness_deadline: "2026-07-30T21:05:00+00:00",
  coverage_status: "complete_current",
  is_current: true,
  covers_requested_window: true,
  valid_empty_eligible: true,
  anomaly_assessment: "not_assessed",
} as const;

const PASS_ROW = {
  observation_id: "018f0000-0000-7000-8000-000000000715",
  contract_version: "1.1.0",
  identity_version: "2.0.0",
  source_id: SCAN_ROW.source_id,
  source_slug: SCAN_ROW.source_slug,
  catalog_granule_id: "G123-LANCEMODIS",
  catalog_collection_id: "C123-LANCEMODIS",
  cmr_revision_id: 4,
  umm_g_version: "1.6.7",
  product: "VJ114IMG_NRT",
  product_version: "2",
  satellite: "NOAA-20",
  sensor: "VIIRS",
  observed_from: "2026-07-30T17:54:00+00:00",
  observed_to: "2026-07-30T18:00:00+00:00",
  produced_at: "2026-07-30T18:02:00+00:00",
  cataloged_at: "2026-07-30T18:03:00+00:00",
  retrieved_at: "2026-07-30T18:04:00+00:00",
  day_night: "day",
  footprint_geojson: {
    type: "Polygon",
    coordinates: [
      [
        [26.3, 38.9],
        [26.4, 38.9],
        [26.4, 39],
        [26.3, 38.9],
      ],
    ],
  },
  geometry_precision_m: null,
  geometry_precision_source: "not_applicable",
  footprint_basis: "cmr_catalog_metadata",
  anomaly_assessment: "not_assessed",
  spatial_relationship: "catalog_footprint_intersection",
} as const;

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function configureRouteEnvironment() {
  vi.spyOn(Date, "now").mockReturnValue(
    Date.parse("2026-07-30T18:03:00.000Z"),
  );
  vi.stubEnv("SUPABASE_URL", TEST_ENVIRONMENT.url);
  vi.stubEnv(
    "SUPABASE_PUBLISHABLE_KEY",
    TEST_ENVIRONMENT.publishableKey,
  );
}

function installRouteFetch(
  scan: object = SCAN_ROW,
  passes: readonly object[] = [PASS_ROW],
) {
  const fetchMock = vi.fn(
    async (
      input: Parameters<typeof fetch>[0],
      _init?: Parameters<typeof fetch>[1],
    ) => {
      void _init;
      const url = new URL(String(input));
      if (url.pathname.endsWith("/rpc/satellite_scan_status_for_window")) {
        return Response.json([scan]);
      }
      if (url.pathname.endsWith("/rpc/satellite_passes_for_cell")) {
        return Response.json(passes);
      }
      return Response.json({ error: "unexpected test route" }, { status: 404 });
    },
  );
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

describe("GET /api/v3/satellite-passes", () => {
  it("returns bounded persisted intersections with explicit source times", async () => {
    configureRouteEnvironment();
    const fetchMock = installRouteFetch();

    const response = await GET(
      new Request(
        "http://localhost/api/v3/satellite-passes?cell=wm%2F11%2F1174%2F807&limit=20",
      ),
    );
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toContain("s-maxage=300");
    expect(response.headers.get("x-firewatch-cacheable")).toBe("1");
    expect(response.headers.get("etag")).toMatch(/^"[A-Za-z0-9_-]+"$/u);
    expect(payload).toMatchObject({
      schemaVersion: 3,
      mode: "persisted",
      scope: {
        kind: "coarse-area",
        gridVersion: "web-mercator-adaptive-v1",
        cell: "wm/11/1174/807",
      },
      timeSemantics: {
        format: "RFC3339",
        normalizedTimeZone: "UTC",
      },
      requestedWindow: {
        from: "2026-07-29T06:00:00.000Z",
        to: "2026-07-30T18:00:00.000Z",
        timeZone: "UTC",
      },
      scan: {
        healthState: "healthy",
        coverageState: "complete_current",
        scanKind: "incremental",
        collectionTarget: {
          id: SCAN_ROW.collection_target_id,
          revisionId: SCAN_ROW.collection_target_revision_id,
        },
        sourceRequestWindow: {
          from: "2026-07-29T06:00:00.000Z",
          to: "2026-07-30T18:00:00.000Z",
          timeZone: "UTC",
        },
        watermark: {
          from: "2026-07-30T17:45:00.000Z",
          updatedSince: "2026-07-30T17:45:00.000Z",
          to: "2026-07-30T17:50:00.000Z",
          timeZone: "UTC",
        },
        continuousCoverage: {
          from: "2026-07-29T06:00:00.000Z",
          to: "2026-07-30T18:00:00.000Z",
          timeZone: "UTC",
        },
        lineage: {
          baselineHealthId: SCAN_ROW.baseline_health_id,
          depth: 12,
          coversRequestedWindow: true,
        },
        freshness: {
          checkedAt: "2026-07-30T18:05:00.000Z",
          latestSourceObservedAt: "2026-07-30T17:58:00.000Z",
          scanCheckedAt: "2026-07-30T18:05:00.000Z",
          deadline: "2026-07-30T21:05:00.000Z",
          isCurrent: true,
        },
        completeness: {
          completedProducts: SCAN_ROW.completed_products,
          geographic: 1,
          schemaFailureCount: 0,
        },
      },
      result: {
        state: "catalog-footprints",
        validEmpty: false,
        coverage: "catalog-footprint-intersection",
        anomalyAssessment: "not_assessed",
      },
      passes: [
        {
          observationId: PASS_ROW.observation_id,
          product: "VJ114IMG_NRT",
          satellite: "NOAA-20",
          times: {
            observedFrom: "2026-07-30T17:54:00.000Z",
            observedTo: "2026-07-30T18:00:00.000Z",
            producedAt: "2026-07-30T18:02:00.000Z",
            catalogedAt: "2026-07-30T18:03:00.000Z",
            retrievedAt: "2026-07-30T18:04:00.000Z",
            timeZone: "UTC",
          },
          coverage: {
            basis: "cmr_catalog_metadata",
            relationship: "catalog_footprint_intersection",
            geometryPrecisionM: null,
            geometryPrecisionSource: "not_applicable",
          },
          anomalyAssessment: "not_assessed",
        },
      ],
      page: { limit: 20, truncated: false },
    });
    expect(JSON.stringify(payload)).not.toContain("observationCursor");

    expect(fetchMock).toHaveBeenCalledTimes(2);
    const statusCall = fetchMock.mock.calls[0];
    const passCall = fetchMock.mock.calls[1];
    expect(statusCall).toBeDefined();
    expect(passCall).toBeDefined();
    const statusUrl = new URL(String(statusCall?.[0]));
    const passUrl = new URL(String(passCall?.[0]));
    expect(statusUrl.pathname).toBe(
      "/rest/v1/rpc/satellite_scan_status_for_window",
    );
    expect(statusUrl.searchParams.get("p_observed_from")).toBe(
      "2026-07-29T06:00:00.000Z",
    );
    expect(statusUrl.searchParams.get("p_observed_to")).toBe(
      "2026-07-30T18:00:00.000Z",
    );
    expect(passUrl.pathname).toBe("/rest/v1/rpc/satellite_passes_for_cell");
    expect(passUrl.searchParams.get("p_z")).toBe("11");
    expect(passUrl.searchParams.get("p_x")).toBe("1174");
    expect(passUrl.searchParams.get("p_y")).toBe("807");
    expect(passUrl.searchParams.get("p_observed_from")).toBe(
      "2026-07-29T06:00:00.000Z",
    );
    expect(passUrl.searchParams.get("p_observed_to")).toBe(
      "2026-07-30T18:00:00.000Z",
    );
    expect(passUrl.searchParams.get("p_limit")).toBe("21");

    for (const call of fetchMock.mock.calls) {
      const [input, init] = call;
      const url = new URL(String(input));
      const headers = new Headers(init?.headers);
      expect(url.origin).toBe(TEST_ENVIRONMENT.url);
      expect(url.hostname).not.toContain("earthdata.nasa.gov");
      expect(headers.get("accept-profile")).toBe("api");
      expect(headers.get("apikey")).toBe(TEST_ENVIRONMENT.publishableKey);
      expect(headers.has("authorization")).toBe(false);
      expect(init?.cache).toBe("no-store");
    }
  });

  it("uses valid-empty only for an eligible complete current scan", async () => {
    configureRouteEnvironment();
    installRouteFetch(
      {
        ...SCAN_ROW,
        scan_kind: "bootstrap",
        watermark_from: null,
        updated_since: null,
        predecessor_health_id: null,
        baseline_health_id: SCAN_ROW.scan_health_id,
        lineage_depth: 0,
      },
      [],
    );

    const response = await GET(
      new Request(
        "http://localhost/api/v3/satellite-passes?cell=wm%2F11%2F1174%2F807",
      ),
    );
    const payload = await response.json();

    expect(payload.result).toEqual({
      state: "valid-empty",
      validEmpty: true,
      coverage: "catalog-footprint-intersection",
      anomalyAssessment: "not_assessed",
      message:
        "No CMR FireMask granule footprints intersect this area in the completed catalog window.",
    });
    expect(JSON.stringify(payload).toLowerCase()).not.toContain("no anomaly");
    expect(JSON.stringify(payload).toLowerCase()).not.toContain("fire out");
  });

  it("keeps partial empty coverage uncached and explicitly non-valid", async () => {
    configureRouteEnvironment();
    installRouteFetch(
      {
        ...SCAN_ROW,
        health_id: "018f0000-0000-7000-8000-000000000616",
        health_status: "healthy",
        coverage_status: "partial",
        is_current: false,
        valid_empty_eligible: false,
      },
      [],
    );

    const response = await GET(
      new Request(
        "http://localhost/api/v3/satellite-passes?cell=wm%2F11%2F1174%2F807",
      ),
    );
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("x-firewatch-cacheable")).toBeNull();
    expect(payload.result).toMatchObject({ state: "partial", validEmpty: false });
    expect(payload.result.message).toContain("cannot be interpreted as empty");
  });

  it("does not treat a current incremental delta as complete window coverage", async () => {
    configureRouteEnvironment();
    installRouteFetch(
      {
        ...SCAN_ROW,
        continuous_coverage_from: "2026-07-30T17:55:00+00:00",
        covers_requested_window: false,
        valid_empty_eligible: false,
      },
      [],
    );

    const response = await GET(
      new Request(
        "http://localhost/api/v3/satellite-passes?cell=wm%2F11%2F1174%2F807",
      ),
    );
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(payload.scan).toMatchObject({
      scanKind: "incremental",
      lineage: { coversRequestedWindow: false },
    });
    expect(payload.result).toMatchObject({
      state: "complete-not-eligible",
      validEmpty: false,
      anomalyAssessment: "not_assessed",
    });
  });

  it("does not query pass rows when the persisted target is unconfigured", async () => {
    configureRouteEnvironment();
    const fetchMock = installRouteFetch({
      ...SCAN_ROW,
      health_id: null,
      scan_health_id: null,
      health_status: "unconfigured",
      scan_kind: null,
      coverage_status: "unconfigured",
      checked_at: null,
      last_success_at: null,
      latest_source_observed_at: null,
      scan_checked_at: null,
      requested_from: null,
      requested_to: null,
      watermark_from: null,
      updated_since: null,
      watermark_to: null,
      predecessor_health_id: null,
      baseline_health_id: null,
      continuous_coverage_from: null,
      continuous_coverage_to: null,
      lineage_depth: null,
      completed_products: null,
      page_count: null,
      upstream_hit_count: null,
      accepted_granule_count: null,
      geographic_completeness: null,
      schema_failure_count: null,
      freshness_deadline: null,
      is_current: false,
      covers_requested_window: false,
      valid_empty_eligible: false,
    });

    const response = await GET(
      new Request(
        "http://localhost/api/v3/satellite-passes?cell=wm%2F11%2F1174%2F807",
      ),
    );
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(payload.result).toMatchObject({
      state: "unconfigured",
      validEmpty: false,
    });
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("fails closed when the database gives an inconsistent empty proof", async () => {
    configureRouteEnvironment();
    const fetchMock = installRouteFetch({
      ...SCAN_ROW,
      geographic_completeness: 0.5,
    });

    const response = await GET(
      new Request(
        "http://localhost/api/v3/satellite-passes?cell=wm%2F11%2F1174%2F807",
      ),
    );

    expect(response.status).toBe(503);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.text()).toContain("read_model_unavailable");
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it.each([
    {
      name: "incremental updated_since drift",
      row: { ...SCAN_ROW, updated_since: "2026-07-30T17:40:00+00:00" },
    },
    {
      name: "publication watermark without the replay lag",
      row: { ...SCAN_ROW, watermark_to: SCAN_ROW.requested_to },
    },
    {
      name: "lossy accepted granule accounting",
      row: { ...SCAN_ROW, accepted_granule_count: 420 },
    },
  ])("fails closed on $name", async ({ row }) => {
    configureRouteEnvironment();
    const fetchMock = installRouteFetch(row, []);

    const response = await GET(
      new Request(
        "http://localhost/api/v3/satellite-passes?cell=wm%2F11%2F1174%2F807",
      ),
    );

    expect(response.status).toBe(503);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.text()).toContain("read_model_unavailable");
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("rejects exact coordinates, invalid cells, repeats, and unknown queries", async () => {
    configureRouteEnvironment();
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const paths = [
      "/api/v3/satellite-passes?lat=39&lon=26",
      "/api/v3/satellite-passes?cell=wm%2F6%2F1%2F1",
      "/api/v3/satellite-passes?cell=wm%2F11%2F1174%2F807&cell=wm%2F11%2F1175%2F807",
      "/api/v3/satellite-passes?cell=wm%2F11%2F1174%2F807&limit=101",
      "/api/v3/satellite-passes?cell=wm%2F11%2F1174%2F807&unknown=true",
    ];

    for (const path of paths) {
      const response = await GET(new Request(`http://localhost${path}`));
      expect(response.status).toBe(400);
      expect(response.headers.get("cache-control")).toBe("no-store");
      expect(await response.text()).toContain("invalid_request");
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("fails closed without server publishable Supabase configuration", async () => {
    vi.stubEnv("SUPABASE_URL", "");
    vi.stubEnv("SUPABASE_PUBLISHABLE_KEY", "");
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const response = await GET(
      new Request(
        "http://localhost/api/v3/satellite-passes?cell=wm%2F11%2F1174%2F807",
      ),
    );
    const body = await response.text();

    expect(response.status).toBe(503);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(body).toContain("read_model_unavailable");
    expect(body).not.toContain("SUPABASE_PUBLISHABLE_KEY");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("supports conditional reads only for current complete snapshots", async () => {
    configureRouteEnvironment();
    installRouteFetch();
    const url =
      "http://localhost/api/v3/satellite-passes?cell=wm%2F11%2F1174%2F807";
    const first = await GET(new Request(url));
    const etag = first.headers.get("etag");
    expect(etag).not.toBeNull();

    const conditional = await GET(
      new Request(url, { headers: { "If-None-Match": etag ?? "" } }),
    );
    expect(conditional.status).toBe(304);
    expect(await conditional.text()).toBe("");
  });
});
