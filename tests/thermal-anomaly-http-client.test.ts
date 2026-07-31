import { describe, expect, it, vi } from "vitest";

import {
  buildThermalAnomalyFirstPagePath,
  createHttpThermalAnomalyClient,
  type ThermalAnomalyFetch,
  type ThermalAnomalyFirstPageRequest,
} from "../lib/firewatch/v3/thermal-anomaly-http-client";
import {
  THERMAL_CLIENT_AS_OF,
  THERMAL_CLIENT_CELL,
  THERMAL_CLIENT_KNOWN_AT,
  thermalAnomalyClientFixture,
} from "./fixtures/thermal-anomaly-v3-client";

const REQUEST = Object.freeze({
  cell: THERMAL_CLIENT_CELL,
  asOf: THERMAL_CLIENT_AS_OF,
  knownAt: THERMAL_CLIENT_KNOWN_AT,
  limit: 50,
}) satisfies ThermalAnomalyFirstPageRequest;

function jsonResponse(body: unknown, init: ResponseInit = {}) {
  const headers = new Headers(init.headers);
  if (!headers.has("content-type")) {
    headers.set("content-type", "application/json; charset=utf-8");
  }
  return new Response(JSON.stringify(body), { ...init, headers });
}

describe("thermal anomaly first-page path", () => {
  it("builds only the fixed relative route with exact coarse scope and cutoffs", () => {
    const path = buildThermalAnomalyFirstPagePath(REQUEST);
    const url = new URL(path, "https://firewatch.invalid");

    expect(path.startsWith("/api/v3/thermal-anomalies?")).toBe(true);
    expect(url.origin).toBe("https://firewatch.invalid");
    expect(url.pathname).toBe("/api/v3/thermal-anomalies");
    expect(Object.fromEntries(url.searchParams)).toEqual({
      cell: THERMAL_CLIENT_CELL,
      schemaVersion: "3",
      asOf: THERMAL_CLIENT_AS_OF,
      knownAt: THERMAL_CLIENT_KNOWN_AT,
      limit: "50",
    });
    expect(path).not.toMatch(/after|lat|lon|latitude|longitude|bounds/iu);
  });

  it("rejects noncanonical scope, clocks, extra fields, and oversized pages", () => {
    const invalid = [
      { ...REQUEST, cell: "wm/010/0587/0391" },
      { ...REQUEST, asOf: "2026-07-31T12:00:00Z" },
      {
        ...REQUEST,
        asOf: "2026-07-31T12:06:00.000Z",
        knownAt: "2026-07-31T12:05:00.000Z",
      },
      { ...REQUEST, limit: 51 },
      { ...REQUEST, after: "forbidden-cursor" },
    ];
    invalid.forEach((request) => {
      expect(() => buildThermalAnomalyFirstPagePath(request)).toThrow(
        TypeError,
      );
    });
  });
});

describe("same-origin thermal anomaly client", () => {
  it("uses a credential-free no-store GET and preserves indeterminate emptiness", async () => {
    const calls: Array<Readonly<{ path: string; init: RequestInit }>> = [];
    const fetch: ThermalAnomalyFetch = async (path, init) => {
      calls.push({ path, init });
      return jsonResponse(thermalAnomalyClientFixture());
    };
    const result = await createHttpThermalAnomalyClient({ fetch }).readFirstPage(
      REQUEST,
    );

    expect(result.kind).toBe("snapshot");
    if (result.kind !== "snapshot") throw new Error("Expected a snapshot");
    expect(result.data.anomalies).toEqual([]);
    expect(result.data.result).toMatchObject({
      state: "indeterminate",
      allClearAssessment: "not_assessed",
      count: { scope: "page", value: 0, relation: "exact" },
    });
    expect(result.data.safety.allClear).toBe(false);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.path).toBe(buildThermalAnomalyFirstPagePath(REQUEST));
    expect(calls[0]?.init).toMatchObject({
      method: "GET",
      cache: "no-store",
      credentials: "omit",
      mode: "same-origin",
      redirect: "error",
      referrerPolicy: "same-origin",
    });
    const headers = new Headers(calls[0]?.init.headers);
    expect(headers.get("accept")).toBe("application/json");
    expect(headers.has("authorization")).toBe(false);
    expect(headers.has("apikey")).toBe(false);
  });

  it("rejects invalid requests before invoking fetch", async () => {
    const fetch = vi.fn<ThermalAnomalyFetch>();
    const client = createHttpThermalAnomalyClient({ fetch });
    const result = await client.readFirstPage({
      ...REQUEST,
      cell: "wm/010/0587/0391",
    });
    expect(result).toEqual({ kind: "invalid-request", retryable: false });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("binds every accepted snapshot to the requested first page", async () => {
    const wrongCell = thermalAnomalyClientFixture({ cell: "wm/10/588/391" });
    const wrongAsOf = thermalAnomalyClientFixture({
      asOf: "2026-07-31T11:55:00.000Z",
    });
    const wrongKnownAt = thermalAnomalyClientFixture({
      knownAt: "2026-07-31T12:06:00.000Z",
    });
    const wrongLimit = thermalAnomalyClientFixture({ limit: 49 });
    const continuation = thermalAnomalyClientFixture({ isFirstPage: false });

    for (const payload of [
      wrongCell,
      wrongAsOf,
      wrongKnownAt,
      wrongLimit,
      continuation,
    ]) {
      const client = createHttpThermalAnomalyClient({
        fetch: async () => jsonResponse(payload),
      });
      await expect(client.readFirstPage(REQUEST)).resolves.toEqual({
        kind: "invalid-response",
        retryable: true,
      });
    }
  });

  it("accepts a bounded first page with more rows without following its cursor", async () => {
    const fetch = vi.fn<ThermalAnomalyFetch>(async () =>
      jsonResponse(
        thermalAnomalyClientFixture({
          limit: 1,
          withItem: true,
          hasMore: true,
        }),
      ),
    );
    const client = createHttpThermalAnomalyClient({ fetch });
    const result = await client.readFirstPage({ ...REQUEST, limit: 1 });

    expect(result.kind).toBe("snapshot");
    if (result.kind !== "snapshot") throw new Error("Expected a snapshot");
    expect(result.data.anomalies).toHaveLength(1);
    expect(result.data.result.count).toEqual({
      scope: "page",
      value: 1,
      relation: "exact",
    });
    expect(result.data.page).toMatchObject({
      isFirstPage: true,
      hasMore: true,
    });
    expect(fetch).toHaveBeenCalledOnce();
    expect(String(fetch.mock.calls[0]?.[0])).not.toContain("after=");
  });

  it("requires JSON and rejects malformed, declared-oversize, and streamed-oversize bodies", async () => {
    const responses = [
      new Response(JSON.stringify(thermalAnomalyClientFixture()), {
        status: 200,
        headers: { "content-type": "text/plain" },
      }),
      new Response("{", {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
      new Response("{}", {
        status: 200,
        headers: {
          "content-type": "application/json",
          "content-length": "1000001",
        },
      }),
      new Response("x".repeat(1_000_001), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    ];

    for (const response of responses) {
      const client = createHttpThermalAnomalyClient({
        fetch: async () => response,
      });
      await expect(client.readFirstPage(REQUEST)).resolves.toEqual({
        kind: "invalid-response",
        retryable: true,
      });
    }
  });

  it("classifies 4xx, exact snapshot restarts, malformed 409, and 5xx distinctly", async () => {
    const snapshotChanged = {
      schemaVersion: 3,
      error: {
        code: "snapshot_changed",
        message: "Restart pagination from the first page.",
      },
    };
    const cases = [
      {
        response: jsonResponse(
          {
            schemaVersion: 3,
            error: { code: "invalid_request", message: "Invalid request." },
          },
          { status: 400 },
        ),
        result: { kind: "invalid-request", retryable: false },
      },
      {
        response: jsonResponse(
          {
            schemaVersion: 3,
            error: { code: "read_model_unavailable", message: "Timeout." },
          },
          { status: 408 },
        ),
        result: { kind: "unavailable", retryable: true },
      },
      {
        response: jsonResponse(
          {
            schemaVersion: 3,
            error: { code: "read_model_unavailable", message: "Too early." },
          },
          { status: 425 },
        ),
        result: { kind: "unavailable", retryable: true },
      },
      {
        response: jsonResponse(
          {
            schemaVersion: 3,
            error: { code: "read_model_unavailable", message: "Throttled." },
          },
          { status: 429 },
        ),
        result: { kind: "unavailable", retryable: true },
      },
      {
        response: jsonResponse(snapshotChanged, { status: 409 }),
        result: {
          kind: "snapshot-changed",
          retryable: true,
          restartFromFirstPage: true,
        },
      },
      {
        response: jsonResponse(
          { ...snapshotChanged, error: { code: "invalid_request", message: "No" } },
          { status: 409 },
        ),
        result: { kind: "invalid-response", retryable: true },
      },
      {
        response: jsonResponse(
          {
            schemaVersion: 3,
            error: {
              code: "read_model_unavailable",
              message: "Unavailable.",
            },
          },
          { status: 503 },
        ),
        result: { kind: "unavailable", retryable: true },
      },
    ];

    for (const testCase of cases) {
      const client = createHttpThermalAnomalyClient({
        fetch: async () => testCase.response,
      });
      await expect(client.readFirstPage(REQUEST)).resolves.toEqual(
        testCase.result,
      );
    }
  });

  it("cancels before fetch and when abort wins the response race", async () => {
    const beforeFetch = vi.fn<ThermalAnomalyFetch>();
    const beforeController = new AbortController();
    beforeController.abort();
    await expect(
      createHttpThermalAnomalyClient({ fetch: beforeFetch }).readFirstPage(
        REQUEST,
        { signal: beforeController.signal },
      ),
    ).resolves.toEqual({ kind: "cancelled", retryable: false });
    expect(beforeFetch).not.toHaveBeenCalled();

    const raceController = new AbortController();
    const racingClient = createHttpThermalAnomalyClient({
      fetch: async () => {
        raceController.abort();
        return jsonResponse(thermalAnomalyClientFixture());
      },
    });
    await expect(
      racingClient.readFirstPage(REQUEST, { signal: raceController.signal }),
    ).resolves.toEqual({ kind: "cancelled", retryable: false });
  });
});
