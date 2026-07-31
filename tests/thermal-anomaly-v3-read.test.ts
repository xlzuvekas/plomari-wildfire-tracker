import { afterEach, describe, expect, it, vi } from "vitest";

import { parseAreaCellKey } from "../lib/firewatch/map-context";
import {
  handleThermalAnomalyRequest,
  type ThermalAnomalyRouteDependencies,
} from "../lib/firewatch/v3/thermal-anomaly-route.server";
import { ThermalAdmissionUnavailableError } from "../lib/firewatch/v3/thermal-anomaly-admission.server";
import type { ThermalTelemetryEvent } from "../lib/firewatch/v3/thermal-anomaly-telemetry.server";
import {
  parseThermalAnomalyPayload,
  thermalAnomalyErrorSchema,
  thermalAnomalyPayloadSchema,
} from "../lib/firewatch/v3/thermal-anomaly-contract";
import {
  readThermalAnomalyRows,
  thermalAnomalyReadLimits,
  type ThermalAnomalyReadRow,
} from "../lib/supabase/thermal-anomaly-read-model";
import { SupabasePostgrestReadError } from "../lib/supabase/postgrest";

const CELL = parseAreaCellKey("wm/10/587/391");
if (CELL === null) throw new Error("Fixture cell is invalid");

const ENVIRONMENT = {
  url: "https://project.supabase.co",
  publishableKey: "sb_publishable_test_value_1234567890",
} as const;
const DISCOVERY_KEY = `sb_secret_${"a".repeat(48)}`;
const AS_OF = "2026-07-31T12:00:00.000Z";
const KNOWN_AT = "2026-07-31T12:05:00.000Z";
const GATE_SNAPSHOT = "b".repeat(64);

const DETECTION_LIMITATIONS = [
  "thermal_pixel_not_flame_location",
  "not_incident_confirmation",
  "pixel_orientation_not_source_supplied",
  "modeled_support_is_not_pixel_footprint",
  "source_time_precision_minute",
  "not_official_status",
  "not_protective_guidance",
  "not_all_clear",
] as const;
const ASSESSMENT_LIMITATIONS = [
  "thermal_detection_not_incident_confirmation",
  "cmr_catalog_metadata_does_not_assess_anomalies",
  "sensor_assessability_unknown",
  "not_official_status",
  "not_protective_guidance",
  "not_containment_statement",
  "not_incident_resolution",
  "not_all_clear",
] as const;

function row(
  detectionId = "019a0000-0000-7000-8000-000000000101",
  acquiredAt = "2026-07-31T11:45:00.000Z",
): ThermalAnomalyReadRow {
  return {
    detection_id: detectionId,
    basis_detection_id: detectionId,
    basis_version_no: 1,
    assessment_id: "019a0000-0000-7000-8000-000000000201",
    source_id: "018f0000-0000-7000-8000-000000000101",
    source_key: "nasa-firms",
    contract_version: "1.1.0",
    identity_version: "firms-detection-v1",
    product_key: "VIIRS_NOAA20_NRT",
    platform: "NOAA-20",
    instrument: "VIIRS",
    acquired_at: acquiredAt,
    source_time_precision: "minute",
    published_at: "2026-07-31T11:46:00.000Z",
    retrieved_at: "2026-07-31T11:47:00.000Z",
    detection_recorded_at: "2026-07-31T11:48:00.000Z",
    latitude: 39.001,
    longitude: 26.402,
    scan_km: 0.375,
    track_km: 0.375,
    spatial_support_method: "centroid_with_circumscribed_radius_v1",
    confidence_class: "high",
    confidence_percent: null,
    brightness_primary_k: 370.25,
    brightness_secondary_k: 302.5,
    brightness_contract: "viirs_bright_ti4_ti5",
    frp_mw: 12.25,
    day_night: "day",
    source_dataset_version: "2.0NRT",
    detection_limitations: [...DETECTION_LIMITATIONS],
    assessment_state: "detected",
    assessment_reason: "firms_detection_observed",
    assessment_rule_id: "firms.initial-detection",
    assessment_rule_version: "1.0.0",
    assessment_as_of: "2026-07-31T11:45:00.000Z",
    assessment_known_at: "2026-07-31T11:49:00.000Z",
    assessment_recorded_at: "2026-07-31T11:50:00.000Z",
    assessment_limitations: [...ASSESSMENT_LIMITATIONS],
    claim_kind: "thermal_anomaly_observation_only",
    operational_effect: "none",
    notification_eligible: false,
    official_status_eligible: false,
    protective_action_eligible: false,
    incident_resolution_eligible: false,
    item_known_at: "2026-07-31T11:50:00.000Z",
    gate_snapshot: GATE_SNAPSHOT,
  };
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function routeGet(
  request: Request,
  overrides: Partial<ThermalAnomalyRouteDependencies> = {},
) {
  return handleThermalAnomalyRequest(request, {
    admit: async () => ({
      kind: "admitted",
      lease: { release: async () => undefined },
    }),
    readRows: readThermalAnomalyRows,
    reportTelemetry: () => undefined,
    monotonicNow: () => 0,
    ...overrides,
  });
}

describe("Supabase v3 thermal anomaly read model", () => {
  it("calls only the allowlisted RPC with coarse cell and cutoff parameters", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async (input, init) => {
      const endpoint = new URL(String(input));
      expect(endpoint.pathname).toBe("/rest/v1/rpc/thermal_anomalies_v3");
      expect(Object.fromEntries(endpoint.searchParams)).toEqual({
        p_z: "10",
        p_x: "587",
        p_y: "391",
        p_as_of: AS_OF,
        p_known_at: KNOWN_AT,
        p_limit: "51",
      });
      const headers = new Headers(init?.headers);
      expect(headers.get("apikey")).toBe(DISCOVERY_KEY);
      expect(headers.has("authorization")).toBe(false);
      expect(init).toMatchObject({ method: "GET", cache: "no-store" });
      expect(init?.signal).toBeInstanceOf(AbortSignal);
      return Response.json([row()]);
    });

    await expect(
      readThermalAnomalyRows(
        { cell: CELL, asOf: AS_OF, knownAt: KNOWN_AT, limit: 51 },
        { environment: ENVIRONMENT, fetchImpl, apiKey: DISCOVERY_KEY },
      ),
    ).resolves.toHaveLength(1);
    expect(fetchImpl).toHaveBeenCalledOnce();
    expect(thermalAnomalyReadLimits.timeoutMs).toBe(5_000);
  });

  it("rejects unsafe, future-known, duplicate, and unordered rows", async () => {
    const unsafe = { ...row(), incident_resolution_eligible: true };
    const future = {
      ...row(),
      item_known_at: "2026-07-31T12:06:00.000Z",
    };
    const older = row(
      "019a0000-0000-7000-8000-000000000102",
      "2026-07-31T11:44:00.000Z",
    );
    const cases = [[unsafe], [future], [row(), row()], [older, row()]];
    for (const rows of cases) {
      await expect(
        readThermalAnomalyRows(
          { cell: CELL, asOf: AS_OF, knownAt: KNOWN_AT, limit: 51 },
          {
            environment: ENVIRONMENT,
            apiKey: DISCOVERY_KEY,
            fetchImpl: async () => Response.json(rows),
          },
        ),
      ).rejects.toMatchObject({ code: "invalid_response" });
    }
  });

  it("validates continuation boundaries and a uniform gate snapshot", async () => {
    const after = {
      acquiredAt: "2026-07-31T11:45:00.000Z",
      detectionId: "019a0000-0000-7000-8000-000000000102",
      gateSnapshot: GATE_SNAPSHOT,
    } as const;
    const atBoundary = row(after.detectionId, after.acquiredAt);
    const staleGate = {
      ...row(
        "019a0000-0000-7000-8000-000000000101",
        "2026-07-31T11:44:00.000Z",
      ),
      gate_snapshot: "c".repeat(64),
    };

    for (const rows of [[atBoundary], [staleGate]]) {
      await expect(
        readThermalAnomalyRows(
          {
            cell: CELL,
            asOf: AS_OF,
            knownAt: KNOWN_AT,
            limit: 51,
            after,
          },
          {
            environment: ENVIRONMENT,
            apiKey: DISCOVERY_KEY,
            fetchImpl: async () => Response.json(rows),
          },
        ),
      ).rejects.toMatchObject({ code: "invalid_response" });
    }
  });

  it("maps only the controlled projection-snapshot sentinel", async () => {
    const after = {
      acquiredAt: "2026-07-31T11:45:00.000Z",
      detectionId: "019a0000-0000-7000-8000-000000000102",
      gateSnapshot: GATE_SNAPSHOT,
    } as const;
    const exactSnapshotChange = async () =>
      Response.json(
        {
          code: "22023",
          details: "firewatch_snapshot_changed_v1",
          hint: null,
          message: "Thermal anomaly publication gate snapshot changed",
        },
        { status: 400 },
      );
    await expect(
      readThermalAnomalyRows(
        { cell: CELL, asOf: AS_OF, knownAt: KNOWN_AT, limit: 51, after },
        {
          environment: ENVIRONMENT,
          apiKey: DISCOVERY_KEY,
          fetchImpl: exactSnapshotChange,
        },
      ),
    ).rejects.toEqual(new SupabasePostgrestReadError("snapshot_changed"));

    const unrelatedDatabaseError = async () =>
      Response.json(
        {
          code: "22023",
          details: "different_internal_failure",
          message: "Do not expose this message",
        },
        { status: 400 },
      );
    await expect(
      readThermalAnomalyRows(
        { cell: CELL, asOf: AS_OF, knownAt: KNOWN_AT, limit: 51, after },
        {
          environment: ENVIRONMENT,
          apiKey: DISCOVERY_KEY,
          fetchImpl: unrelatedDatabaseError,
        },
      ),
    ).rejects.toEqual(new SupabasePostgrestReadError("unavailable"));
  });

  it.each([
    ["54000", "scan_cap"],
    ["57014", "database_timeout"],
  ] as const)(
    "retains SQLSTATE %s only as a bounded internal error class",
    async (postgresCode, expectedCode) => {
      await expect(
        readThermalAnomalyRows(
          { cell: CELL, asOf: AS_OF, knownAt: KNOWN_AT, limit: 51 },
          {
            environment: ENVIRONMENT,
            apiKey: DISCOVERY_KEY,
            fetchImpl: async () =>
              Response.json(
                {
                  code: postgresCode,
                  details: null,
                  message: "Internal database detail must not be public.",
                },
                { status: 500 },
              ),
          },
        ),
      ).rejects.toEqual(new SupabasePostgrestReadError(expectedCode));
    },
  );
});

describe("GET /api/v3/thermal-anomalies", () => {
  function configure(rows: readonly object[]) {
    vi.spyOn(Date, "now").mockReturnValue(Date.parse(KNOWN_AT));
    vi.stubEnv("SUPABASE_URL", ENVIRONMENT.url);
    vi.stubEnv("SUPABASE_PUBLISHABLE_KEY", ENVIRONMENT.publishableKey);
    vi.stubEnv("SUPABASE_DISCOVERY_READER_KEY", DISCOVERY_KEY);
    const fetchMock = vi.fn<typeof fetch>(async (input) => {
      expect(new URL(String(input)).pathname).toBe(
        "/rest/v1/rpc/thermal_anomalies_v3",
      );
      return Response.json(rows);
    });
    vi.stubGlobal("fetch", fetchMock);
    return fetchMock;
  }

  function request(extra = "") {
    return new Request(
      `http://localhost/api/v3/thermal-anomalies?cell=wm%2F10%2F587%2F391&schemaVersion=3&asOf=${encodeURIComponent(AS_OF)}&knownAt=${encodeURIComponent(KNOWN_AT)}&limit=50${extra}`,
    );
  }

  it("returns explicit clocks, assessment evidence, and non-authoritative safety", async () => {
    configure([row()]);
    const response = await routeGet(request());
    const payload = parseThermalAnomalyPayload(await response.json());
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("x-firewatch-coverage")).toBe("not-assessed");
    expect(payload).toMatchObject({
      schemaVersion: 3,
      mode: "persisted",
      scope: { cell: "wm/10/587/391" },
      time: {
        asOf: AS_OF,
        knownAt: KNOWN_AT,
        observedWindow: {
          from: "2026-07-24T12:00:00.000Z",
          to: AS_OF,
        },
      },
      coverage: { state: "not_assessed" },
      result: {
        state: "items",
        count: { scope: "page", value: 1, relation: "exact" },
        allClearAssessment: "not_assessed",
      },
      page: {
        ordering: "acquired-at-desc-detection-id-desc",
        isFirstPage: true,
        hasMore: false,
        nextCursor: null,
      },
      safety: {
        flameLocation: false,
        incidentConfirmation: false,
        firePerimeter: false,
        officialStatus: false,
        protectiveAction: false,
        incidentResolution: false,
        allClear: false,
      },
      anomalies: [
        {
          product: {
            key: "VIIRS_NOAA20_NRT",
            platform: "NOAA-20",
            instrument: "VIIRS",
          },
          times: {
            acquiredAt: "2026-07-31T11:45:00.000Z",
            sourcePrecision: "minute",
            retrievedAt: "2026-07-31T11:47:00.000Z",
            itemKnownAt: "2026-07-31T11:50:00.000Z",
          },
          assessment: {
            basisDetailRevisionId:
              "019a0000-0000-7000-8000-000000000101",
            state: "detected",
            reason: "firms_detection_observed",
            operationalEffect: "none",
            incidentResolutionEligible: false,
          },
          detailRevision: {
            id: "019a0000-0000-7000-8000-000000000101",
            version: 1,
            role: "assessment-basis",
          },
        },
      ],
    });
  });

  it("attests the server-derived Vercel environment on every response", async () => {
    configure([]);
    vi.stubEnv("VERCEL", "1");
    vi.stubEnv("VERCEL_ENV", "preview");
    vi.stubEnv("VERCEL_URL", "firewatch-review-123.vercel.app");
    vi.stubEnv("VERCEL_DEPLOYMENT_ID", `dpl_${"a".repeat(24)}`);

    const response = await routeGet(request());

    expect(response.status).toBe(200);
    expect(response.headers.get("x-firewatch-deployment-environment")).toBe(
      "preview",
    );
    expect(response.headers.get("x-firewatch-deployment-host")).toBe(
      "firewatch-review-123.vercel.app",
    );
    expect(response.headers.get("x-firewatch-deployment-id")).toBe(
      `dpl_${"a".repeat(24)}`,
    );
  });

  it("issues and consumes an authenticated keyset cursor without skipping a tied acquisition minute", async () => {
    vi.spyOn(Date, "now").mockReturnValue(Date.parse(KNOWN_AT));
    vi.stubEnv("SUPABASE_URL", ENVIRONMENT.url);
    vi.stubEnv("SUPABASE_PUBLISHABLE_KEY", ENVIRONMENT.publishableKey);
    vi.stubEnv("SUPABASE_DISCOVERY_READER_KEY", DISCOVERY_KEY);
    const ids = Array.from({ length: 51 }, (_, index) =>
      `019a0000-0000-7000-8000-${(51 - index).toString(16).padStart(12, "0")}`,
    );
    let call = 0;
    const fetchMock = vi.fn<typeof fetch>(async (input) => {
      const endpoint = new URL(String(input));
      call += 1;
      if (call === 1) {
        expect(endpoint.searchParams.has("p_after_detection_id")).toBe(false);
        return Response.json(ids.map((id) => row(id)));
      }
      expect(Object.fromEntries(endpoint.searchParams)).toMatchObject({
        p_after_acquired_at: "2026-07-31T11:45:00.000Z",
        p_after_detection_id: ids[49],
        p_gate_snapshot: GATE_SNAPSHOT,
      });
      return Response.json([row(ids[50])]);
    });
    vi.stubGlobal("fetch", fetchMock);

    const firstResponse = await routeGet(request());
    const first = parseThermalAnomalyPayload(await firstResponse.json());
    expect(first.anomalies).toHaveLength(50);
    expect(first.page).toMatchObject({
      isFirstPage: true,
      hasMore: true,
    });
    expect(first.page.nextCursor).toBeTypeOf("string");

    const secondResponse = await routeGet(
      request(`&after=${encodeURIComponent(first.page.nextCursor ?? "")}`),
    );
    const second = parseThermalAnomalyPayload(await secondResponse.json());
    expect(second.anomalies.map((item) => item.detectionId)).toEqual([
      ids[50],
    ]);
    expect(second.result.count).toEqual({
      scope: "page",
      value: 1,
      relation: "exact",
    });
    expect(second.result.message).toMatch(/^This page contains 1 /u);
    expect(second.page).toEqual({
      limit: 50,
      ordering: "acquired-at-desc-detection-id-desc",
      isFirstPage: false,
      hasMore: false,
      nextCursor: null,
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("rejects a tampered cursor before querying Supabase", async () => {
    const fetchMock = configure([]);
    const response = await routeGet(request("&after=not-a-signed-cursor"));
    expect(response.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("tells a continuation client to restart after a snapshot change", async () => {
    const fetchMock = configure([]);
    const ids = Array.from({ length: 51 }, (_, index) =>
      `019a0000-0000-7000-8000-${(51 - index).toString(16).padStart(12, "0")}`,
    );
    fetchMock
      .mockResolvedValueOnce(Response.json(ids.map((id) => row(id))))
      .mockResolvedValueOnce(Response.json(
        {
          code: "22023",
          details: "firewatch_snapshot_changed_v1",
          message: "Thermal anomaly publication gate snapshot changed",
        },
        { status: 400 },
      ));
    const firstResponse = await routeGet(request());
    const first = parseThermalAnomalyPayload(await firstResponse.json());
    const response = await routeGet(
      request(`&after=${encodeURIComponent(first.page.nextCursor ?? "")}`),
    );
    expect(response.status).toBe(409);
    expect(response.headers.get("cache-control")).toBe("no-store");
    await expect(response.json()).resolves.toEqual({
      schemaVersion: 3,
      error: {
        code: "snapshot_changed",
        message:
          "The thermal anomaly snapshot changed. Restart pagination from the first page.",
      },
    });
  });

  it("rejects incoherent public clocks and assessment-basis provenance", async () => {
    configure([row()]);
    const response = await routeGet(request());
    const original = await response.json();
    const cases = [
      {
        path: ["publishedAt"],
        mutate: (value: typeof original) => {
          value.anomalies[0].times.publishedAt =
            "2026-07-31T11:47:00.001Z";
        },
      },
      {
        path: ["assessment", "asOf"],
        mutate: (value: typeof original) => {
          value.anomalies[0].assessment.asOf =
            "2026-07-31T11:44:59.999Z";
        },
      },
      {
        path: ["assessment", "knownAt"],
        mutate: (value: typeof original) => {
          value.anomalies[0].assessment.asOf =
            "2026-07-31T11:49:00.001Z";
        },
      },
      {
        path: ["basisDetailRevisionId"],
        mutate: (value: typeof original) => {
          value.anomalies[0].assessment.basisDetailRevisionId =
            "019a0000-0000-7000-8000-000000000112";
        },
      },
    ];

    for (const testCase of cases) {
      const candidate = structuredClone(original);
      testCase.mutate(candidate);
      expect(
        thermalAnomalyPayloadSchema.safeParse(candidate).success,
        testCase.path.join("."),
      ).toBe(false);
    }
  });

  it("keeps absence indeterminate and never converts disabled data to empty coverage", async () => {
    const fetchMock = configure([]);
    const response = await routeGet(request());
    const payload = thermalAnomalyPayloadSchema.parse(await response.json());
    expect(payload.anomalies).toEqual([]);
    expect(payload.coverage.state).toBe("not_assessed");
    expect(payload.result.state).toBe("indeterminate");
    expect(payload.result.allClearAssessment).toBe("not_assessed");
    expect(payload.result.message).toMatch(/not an all-clear/u);
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("rejects duplicate, exact-location, malformed, and out-of-range queries", async () => {
    configure([]);
    const invalid = [
      request("&cell=wm%2F10%2F587%2F391"),
      new Request(
        `http://localhost/api/v3/thermal-anomalies?latitude=39&longitude=26&schemaVersion=3&asOf=${AS_OF}&knownAt=${KNOWN_AT}`,
      ),
      new Request(
        `http://localhost/api/v3/thermal-anomalies?cell=wm%2F6%2F1%2F1&schemaVersion=3&asOf=${AS_OF}&knownAt=${KNOWN_AT}`,
      ),
      new Request(
        `http://localhost/api/v3/thermal-anomalies?cell=wm%2F10%2F587%2F391&schemaVersion=3&asOf=2026-07-31T12%3A00%3A00Z&knownAt=${KNOWN_AT}`,
      ),
      request("&limit=101"),
    ];
    for (const candidate of invalid) {
      const response = await routeGet(candidate);
      expect(response.status).toBe(400);
      await expect(response.json()).resolves.toMatchObject({
        error: { code: "invalid_request" },
      });
    }
  });

  it("admits and accounts for malformed traffic before full query parsing", async () => {
    const release = vi.fn(async () => undefined);
    const admit = vi.fn(async () => ({
      kind: "admitted" as const,
      lease: { release },
    }));
    const readRows = vi.fn<typeof readThermalAnomalyRows>();
    const response = await routeGet(
      new Request("http://localhost/api/v3/thermal-anomalies?nonce=1"),
      { admit, readRows },
    );

    expect(response.status).toBe(400);
    expect(admit).toHaveBeenCalledOnce();
    expect(release).toHaveBeenCalledOnce();
    expect(readRows).not.toHaveBeenCalled();
  });

  it("fails closed with a generic 503 when the scoped key or read model fails", async () => {
    vi.spyOn(Date, "now").mockReturnValue(Date.parse(KNOWN_AT));
    vi.stubEnv("SUPABASE_URL", ENVIRONMENT.url);
    vi.stubEnv("SUPABASE_PUBLISHABLE_KEY", ENVIRONMENT.publishableKey);
    vi.stubEnv("SUPABASE_DISCOVERY_READER_KEY", "");
    const response = await routeGet(request());
    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({
      schemaVersion: 3,
      error: {
        code: "read_model_unavailable",
        message: "Persisted thermal anomaly data is temporarily unavailable.",
      },
    });
  });

  it.each([
    ["burst", "rate_limited_burst"],
    ["sustained", "rate_limited_sustained"],
    ["capacity", "capacity_limited"],
  ] as const)(
    "returns 429 with Retry-After and never calls Supabase for %s rejection",
    async (reason, expectedOutcome) => {
      vi.spyOn(Date, "now").mockReturnValue(Date.parse(KNOWN_AT));
      const readRows = vi.fn<typeof readThermalAnomalyRows>();
      const telemetry: ThermalTelemetryEvent[] = [];
      const monotonicNow = vi
        .fn<() => number>()
        .mockReturnValueOnce(100)
        .mockReturnValueOnce(125);
      const response = await routeGet(request(), {
        admit: async () => ({
          kind: "rejected",
          reason,
          retryAfterSeconds: 7,
        }),
        readRows,
        reportTelemetry: (event) => telemetry.push(event),
        monotonicNow,
      });

      expect(response.status).toBe(429);
      expect(response.headers.get("retry-after")).toBe("7");
      expect(response.headers.get("cache-control")).toBe("no-store");
      const errorPayload = thermalAnomalyErrorSchema.parse(await response.json());
      expect(errorPayload).toEqual({
        schemaVersion: 3,
        error: {
          code: "rate_limited",
          message: "Thermal anomaly request capacity is temporarily limited.",
        },
      });
      expect(readRows).not.toHaveBeenCalled();
      expect(telemetry).toEqual([
        expect.objectContaining({
          status: 429,
          outcome: expectedOutcome,
          pageType: "unknown",
          zoom: null,
          rows: null,
          hasMore: null,
          databaseSqlstate: null,
          leaseRelease: "not_acquired",
        }),
      ]);
    },
  );

  it("fails closed before Supabase when admission is unavailable", async () => {
    vi.spyOn(Date, "now").mockReturnValue(Date.parse(KNOWN_AT));
    const readRows = vi.fn<typeof readThermalAnomalyRows>();
    const telemetry: ThermalTelemetryEvent[] = [];
    const response = await routeGet(request(), {
      admit: async () => {
        throw new ThermalAdmissionUnavailableError();
      },
      readRows,
      reportTelemetry: (event) => telemetry.push(event),
    });

    expect(response.status).toBe(503);
    expect(readRows).not.toHaveBeenCalled();
    expect(telemetry).toEqual([
      expect.objectContaining({
        outcome: "admission_unavailable",
        leaseRelease: "not_acquired",
      }),
    ]);
  });

  it.each([
    ["database_timeout", "database_timeout", "57014"],
    ["scan_cap", "database_scan_cap", "54000"],
  ] as const)(
    "releases the lease and sanitizes the %s database failure",
    async (errorCode, expectedOutcome, expectedSqlstate) => {
      vi.spyOn(Date, "now").mockReturnValue(Date.parse(KNOWN_AT));
      const release = vi.fn(async () => undefined);
      const telemetry: ThermalTelemetryEvent[] = [];
      const response = await routeGet(request(), {
        admit: async () => ({ kind: "admitted", lease: { release } }),
        readRows: async () => {
          throw new SupabasePostgrestReadError(errorCode);
        },
        reportTelemetry: (event) => telemetry.push(event),
      });

      expect(response.status).toBe(503);
      await expect(response.json()).resolves.toEqual({
        schemaVersion: 3,
        error: {
          code: "read_model_unavailable",
          message:
            "Persisted thermal anomaly data is temporarily unavailable.",
        },
      });
      expect(release).toHaveBeenCalledOnce();
      expect(telemetry).toEqual([
        expect.objectContaining({
          status: 503,
          outcome: expectedOutcome,
          databaseSqlstate: expectedSqlstate,
          leaseRelease: "released",
        }),
      ]);
      expect(JSON.stringify(telemetry)).not.toContain("wm/10/587/391");
    },
  );

  it("keeps a successful response when lease release falls back to expiry", async () => {
    vi.spyOn(Date, "now").mockReturnValue(Date.parse(KNOWN_AT));
    const telemetry: ThermalTelemetryEvent[] = [];
    const response = await routeGet(request(), {
      admit: async () => ({
        kind: "admitted",
        lease: {
          release: async () => {
            throw new ThermalAdmissionUnavailableError();
          },
        },
      }),
      readRows: async () => [row()],
      reportTelemetry: (event) => telemetry.push(event),
    });

    expect(response.status).toBe(200);
    expect(telemetry).toEqual([
      expect.objectContaining({
        outcome: "success",
        rows: 1,
        hasMore: false,
        leaseRelease: "expired_fallback",
      }),
    ]);
  });
});
