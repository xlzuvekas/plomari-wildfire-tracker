import { describe, expect, it, vi } from "vitest";

import {
  recordedFetch,
  type HttpEvidenceLedger,
  type HttpExchangeReference,
  type HttpRequestEvidence,
  type HttpResponseEvidence,
  type HttpTransportErrorEvidence,
} from "../lib/evidence/recorded-fetch";

const REFERENCE = Object.freeze({
  exchangeId: "41",
  runId: "17",
}) satisfies HttpExchangeReference;

const MANUAL_REDIRECT = Object.freeze({
  redirect: "manual" as const,
});

const REQUEST_EVIDENCE = Object.freeze({
  method: "GET",
  requestUrlSafe: "https://example.test/data",
  requestQuerySafe: Object.freeze({ format: "json" }),
  requestBodyRedacted: null,
  requestHeadersSafe: Object.freeze({ accept: "application/json" }),
  requestMetadataSafe: Object.freeze({ operation: "test" }),
}) satisfies HttpRequestEvidence;

function ledger(overrides: Partial<HttpEvidenceLedger> = {}) {
  return {
    issue: vi.fn(async () => REFERENCE),
    finishResponse: vi.fn(async () => undefined),
    finishTransportError: vi.fn(async () => undefined),
    ...overrides,
  } satisfies HttpEvidenceLedger;
}

describe("recordedFetch", () => {
  it.each([
    ["omitted", undefined],
    ["follow", { redirect: "follow" }],
  ] as const)(
    "rejects %s redirect handling before issuance or I/O",
    async (_label, init) => {
      const evidenceLedger = ledger();
      const fetchImpl = vi.fn<typeof fetch>();

      await expect(
        recordedFetch("https://example.test/data?format=json", init, {
          fetchImpl,
          ledger: evidenceLedger,
          requestEvidence: REQUEST_EVIDENCE,
          maximumResponseBytes: 1_024,
        }),
      ).rejects.toBeInstanceOf(TypeError);
      expect(evidenceLedger.issue).not.toHaveBeenCalled();
      expect(fetchImpl).not.toHaveBeenCalled();
    },
  );

  it("commits issuance before I/O and raw response bytes before exposure", async () => {
    const events: string[] = [];
    const capturedResponses: HttpResponseEvidence[] = [];
    const evidenceLedger = ledger({
      issue: vi.fn(async () => {
        events.push("issued");
        return REFERENCE;
      }),
      finishResponse: vi.fn(async (_reference, evidence) => {
        events.push("response-durable");
        capturedResponses.push(evidence);
      }),
    });
    const fetchImpl = vi.fn(async () => {
      events.push("network");
      return new Response('{"ok":true}', {
        status: 503,
        headers: {
          "cmr-search-after": '["next",123]',
          "content-type": "application/json",
          "set-cookie": "must-not-be-captured=1",
          "x-request-id": "safe-id",
        },
      });
    });

    const response = await recordedFetch("https://example.test/data?format=json&token=secret", MANUAL_REDIRECT, {
      fetchImpl,
      ledger: evidenceLedger,
      requestEvidence: REQUEST_EVIDENCE,
      maximumResponseBytes: 1_024,
      safeResponseHeaderNames: [
        "cmr-search-after",
        "content-type",
        "x-request-id",
      ],
    });
    events.push("exposed");

    expect(events).toEqual([
      "issued",
      "network",
      "response-durable",
      "exposed",
    ]);
    expect(response.status).toBe(503);
    expect(await response.text()).toBe('{"ok":true}');
    const responseEvidence = capturedResponses[0];
    expect(responseEvidence).toBeDefined();
    expect(new TextDecoder().decode(responseEvidence?.body)).toBe('{"ok":true}');
    expect(responseEvidence?.safeHeaders).toEqual({
      "cmr-search-after": '["next",123]',
      "content-type": "application/json",
      "x-request-id": "safe-id",
    });
    expect(JSON.stringify(responseEvidence)).not.toContain("set-cookie");
  });

  it("never starts I/O when request issuance is not durable", async () => {
    const fetchImpl = vi.fn<typeof fetch>();
    const evidenceLedger = ledger({
      issue: vi.fn(async () => {
        throw new Error("database unavailable");
      }),
    });

    await expect(
      recordedFetch("https://example.test/data?format=json", MANUAL_REDIRECT, {
        fetchImpl,
        ledger: evidenceLedger,
        requestEvidence: REQUEST_EVIDENCE,
        maximumResponseBytes: 1_024,
      }),
    ).rejects.toMatchObject({ stage: "issue" });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("records a bounded transport outcome without leaking the thrown URL", async () => {
    const capturedErrors: HttpTransportErrorEvidence[] = [];
    const evidenceLedger = ledger({
      finishTransportError: vi.fn(async (_reference, evidence) => {
        capturedErrors.push(evidence);
      }),
    });
    const upstreamError = new TypeError(
      "request to https://example.test/data?token=secret failed",
    );

    await expect(
      recordedFetch("https://example.test/data?format=json&token=secret", MANUAL_REDIRECT, {
        fetchImpl: vi.fn(async () => {
          throw upstreamError;
        }),
        ledger: evidenceLedger,
        requestEvidence: REQUEST_EVIDENCE,
        maximumResponseBytes: 1_024,
      }),
    ).rejects.toBe(upstreamError);
    const terminalEvidence = capturedErrors[0];
    expect(terminalEvidence).toEqual({
      errorClass: "network",
      errorDetailSafe:
        "Upstream request failed before an HTTP response was available.",
      safeMetadata: {},
    });
    expect(JSON.stringify(terminalEvidence)).not.toContain("secret");
  });

  it("withholds a response when exact raw evidence cannot be persisted", async () => {
    const evidenceLedger = ledger({
      finishResponse: vi.fn(async () => {
        throw new Error("storage unavailable");
      }),
    });

    await expect(
      recordedFetch("https://example.test/data?format=json", MANUAL_REDIRECT, {
        fetchImpl: vi.fn(async () => new Response("payload")),
        ledger: evidenceLedger,
        requestEvidence: REQUEST_EVIDENCE,
        maximumResponseBytes: 1_024,
      }),
    ).rejects.toMatchObject({
      stage: "finish_response",
    });
  });

  it("rejects mismatched or credential-bearing request evidence before issuance", async () => {
    const evidenceLedger = ledger();
    const unsafe = {
      ...REQUEST_EVIDENCE,
      method: "POST",
      requestHeadersSafe: { authorization: "Bearer secret" },
    } satisfies HttpRequestEvidence;

    await expect(
      recordedFetch("https://example.test/data?format=json", MANUAL_REDIRECT, {
        fetchImpl: vi.fn(),
        ledger: evidenceLedger,
        requestEvidence: unsafe,
        maximumResponseBytes: 1_024,
      }),
    ).rejects.toBeInstanceOf(TypeError);
    expect(evidenceLedger.issue).not.toHaveBeenCalled();
  });

  it("rejects unsafe capture configuration before issuance or I/O", async () => {
    const evidenceLedger = ledger();
    const fetchImpl = vi.fn<typeof fetch>();

    await expect(
      recordedFetch("https://example.test/data?format=json", MANUAL_REDIRECT, {
        fetchImpl,
        ledger: evidenceLedger,
        requestEvidence: REQUEST_EVIDENCE,
        maximumResponseBytes: 1_024,
        safeResponseHeaderNames: ["set-cookie"],
      }),
    ).rejects.toBeInstanceOf(TypeError);
    expect(evidenceLedger.issue).not.toHaveBeenCalled();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("stores origin/path separately from an allowlisted safe query", async () => {
    const evidenceLedger = ledger();
    const fetchImpl = vi.fn<typeof fetch>();

    await expect(
      recordedFetch("https://example.test/data?format=json&token=secret", MANUAL_REDIRECT, {
        fetchImpl,
        ledger: evidenceLedger,
        requestEvidence: {
          ...REQUEST_EVIDENCE,
          requestUrlSafe:
            "https://example.test/data?token=%5BREDACTED%5D",
        },
        maximumResponseBytes: 1_024,
      }),
    ).rejects.toBeInstanceOf(TypeError);

    await expect(
      recordedFetch("https://example.test/data?format=json&token=secret", MANUAL_REDIRECT, {
        fetchImpl,
        ledger: evidenceLedger,
        requestEvidence: {
          ...REQUEST_EVIDENCE,
          requestQuerySafe: { token: "[REDACTED]" },
        },
        maximumResponseBytes: 1_024,
      }),
    ).rejects.toBeInstanceOf(TypeError);
    expect(evidenceLedger.issue).not.toHaveBeenCalled();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("does not let a caller record a different origin or path", async () => {
    const evidenceLedger = ledger();
    const fetchImpl = vi.fn<typeof fetch>();

    for (const url of [
      "https://other.test/data?token=secret",
      "https://example.test/other?format=json&token=secret",
      "https://example.test/credential/value?format=json",
    ]) {
      await expect(
        recordedFetch(url, MANUAL_REDIRECT, {
          fetchImpl,
          ledger: evidenceLedger,
          requestEvidence: REQUEST_EVIDENCE,
          maximumResponseBytes: 1_024,
        }),
      ).rejects.toBeInstanceOf(TypeError);
    }
    expect(evidenceLedger.issue).not.toHaveBeenCalled();
    expect(fetchImpl).not.toHaveBeenCalled();

    await expect(
      recordedFetch(
        "https://example.test/credential/value?format=json",
        MANUAL_REDIRECT,
        {
          fetchImpl,
          ledger: evidenceLedger,
          requestEvidence: {
            ...REQUEST_EVIDENCE,
            requestUrlSafe: "https://example.test/credential/value",
          },
          maximumResponseBytes: 1_024,
        },
      ),
    ).rejects.toBeInstanceOf(TypeError);

    const firmsPath =
      "https://firms.modaps.eosdis.nasa.gov/api/area/csv/opaque-map-key/VIIRS_SNPP_NRT/world/1";
    await expect(
      recordedFetch(firmsPath, MANUAL_REDIRECT, {
        fetchImpl,
        ledger: evidenceLedger,
        requestEvidence: {
          ...REQUEST_EVIDENCE,
          requestUrlSafe: firmsPath,
          requestQuerySafe: {},
        },
        maximumResponseBytes: 1_024,
      }),
    ).rejects.toBeInstanceOf(TypeError);
  });

  it("preserves repeated allowlisted provider query fields", async () => {
    const evidenceLedger = ledger();
    const fetchImpl = vi.fn(async () => new Response(null, { status: 204 }));
    const query = new URLSearchParams();
    query.append("short_name[]", "VNP14IMG_NRT");
    query.append("sort_key[]", "-start_date");
    query.append("sort_key[]", "granule_ur");

    const response = await recordedFetch(
      `https://example.test/data?${query.toString()}`,
      MANUAL_REDIRECT,
      {
        fetchImpl,
        ledger: evidenceLedger,
        requestEvidence: {
          ...REQUEST_EVIDENCE,
          requestQuerySafe: {
            "short_name[]": "VNP14IMG_NRT",
            "sort_key[]": ["-start_date", "granule_ur"],
          },
          requestHeadersSafe: {
            accept: "application/json",
            "client-id": "firewatch-test",
            "cmr-search-after": "next-page-cursor",
            "x-request-id": "request-42",
          },
        },
        maximumResponseBytes: 0,
      },
    );

    expect(response.status).toBe(204);
    expect(evidenceLedger.issue).toHaveBeenCalledOnce();
    expect(evidenceLedger.finishResponse).toHaveBeenCalledOnce();
  });
});
