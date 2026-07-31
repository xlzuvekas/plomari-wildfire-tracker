import { createHash } from "node:crypto";

import { describe, expect, it, vi } from "vitest";

import {
  CredentialPathResponseError,
  CredentialPathTransportError,
  recordedFetch,
  type HttpEvidenceLedger,
  type HttpExchangeReference,
  type HttpRequestEvidence,
  type HttpResponseEvidence,
  type HttpTransportErrorEvidence,
} from "../lib/evidence/recorded-fetch";
import {
  firmsAreaRequest,
  firmsAreaRequestEvidence,
} from "../lib/satellite/firms";

const REFERENCE = Object.freeze({
  exchangeId: "41",
  runId: "17",
}) satisfies HttpExchangeReference;
const FIRMS_ISSUED_AT = "2026-07-30T12:00:00.000Z";

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

function requestFingerprint(request: HttpRequestEvidence) {
  return createHash("sha256")
    .update(
      JSON.stringify({
        method: request.method,
        url: request.requestUrlSafe,
        query: request.requestQuerySafe,
        headers: request.requestHeadersSafe,
        metadata: request.requestMetadataSafe,
        body: null,
      }),
    )
    .digest("hex");
}

type CredentialEchoSurface =
  | "body"
  | "status-text"
  | "location"
  | "header-name"
  | "header-value"
  | "percent-encoded"
  | "malformed-binary";

function credentialEchoResponse(
  surface: CredentialEchoSurface,
  mapKey: string,
  requestUrl: string,
) {
  if (surface === "status-text") {
    return new Response(null, { status: 502, statusText: mapKey });
  }
  if (surface === "location") {
    return new Response(null, {
      status: 302,
      headers: { location: requestUrl },
    });
  }
  if (surface === "header-name") {
    return new Response(null, { status: 502, headers: { [mapKey]: "echo" } });
  }
  if (surface === "header-value") {
    return new Response(null, {
      status: 502,
      headers: { "x-request-id": mapKey },
    });
  }
  if (surface === "percent-encoded") {
    const encoded = [...new TextEncoder().encode(mapKey)]
      .map((byte) => `%${byte.toString(16).padStart(2, "0")}`)
      .join("");
    return new Response(encoded, { status: 502 });
  }
  if (surface === "malformed-binary") {
    const keyBytes = new TextEncoder().encode(mapKey);
    const bytes = new Uint8Array(keyBytes.byteLength + 3);
    bytes.set([0xff, 0xfe, 0x80]);
    bytes.set(keyBytes, 3);
    return new Response(bytes, { status: 502 });
  }
  return new Response(`Upstream echoed ${mapKey}`, { status: 502 });
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

  it("records a FIRMS path-secret request without leaking the MAP key", async () => {
    const firstKey = "firms-test-key-0000000000000001";
    const secondKey = "firms-test-key-0000000000000002";
    const area = Object.freeze({
      west: 26.2,
      south: 38.85,
      east: 26.6,
      north: 39.15,
    });
    const first = firmsAreaRequest({
      mapKey: firstKey,
      product: "VIIRS_NOAA20_NRT",
      area,
      date: { kind: "rolling", days: 2 },
      issuedAt: FIRMS_ISSUED_AT,
    });
    const second = firmsAreaRequest({
      mapKey: secondKey,
      product: "VIIRS_NOAA20_NRT",
      area,
      date: { kind: "rolling", days: 2 },
      issuedAt: FIRMS_ISSUED_AT,
    });
    const issued: HttpRequestEvidence[] = [];
    const evidenceLedger = ledger({
      issue: vi.fn(async (request) => {
        issued.push(request);
        return REFERENCE;
      }),
    });
    const fetchImpl = vi.fn(async () =>
      new Response("latitude,longitude\n", {
        status: 200,
        headers: { "content-type": "text/csv" },
      }),
    );

    for (const request of [first, second]) {
      await recordedFetch(request.url, request.requestInit, {
        fetchImpl,
        ledger: evidenceLedger,
        requestEvidence: firmsAreaRequestEvidence(request),
        credentialPathRedaction: request.credentialPathRedaction,
        maximumResponseBytes: 1_024,
      });
    }

    expect(issued).toHaveLength(2);
    const serialized = JSON.stringify(issued);
    expect(serialized).not.toContain(firstKey);
    expect(serialized).not.toContain(secondKey);
    expect(issued[0]?.requestUrlSafe).toBe(
      "https://firms.modaps.eosdis.nasa.gov/api/area/csv",
    );
    expect(issued[0]?.requestQuerySafe).toEqual({
      area: "26.200000,38.850000,26.600000,39.150000",
      date: "rolling:2",
      product: "VIIRS_NOAA20_NRT",
    });
    expect(requestFingerprint(issued[0] as HttpRequestEvidence)).toBe(
      requestFingerprint(issued[1] as HttpRequestEvidence),
    );
  });

  it.each([
    "body",
    "status-text",
    "location",
    "header-name",
    "header-value",
    "percent-encoded",
    "malformed-binary",
  ] as const)(
    "withholds a credential echoed through the response %s",
    async (surface) => {
      const mapKey = "firms-test-key-0000000000000001";
      const request = firmsAreaRequest({
        mapKey,
        product: "VIIRS_NOAA20_NRT",
        area: { west: 26.2, south: 38.85, east: 26.6, north: 39.15 },
        date: { kind: "rolling", days: 1 },
        issuedAt: FIRMS_ISSUED_AT,
      });
      const issued: HttpRequestEvidence[] = [];
      const terminalErrors: HttpTransportErrorEvidence[] = [];
      const capturedResponses: HttpResponseEvidence[] = [];
      const evidenceLedger = ledger({
        issue: vi.fn(async (evidence) => {
          issued.push(evidence);
          return REFERENCE;
        }),
        finishResponse: vi.fn(async (_reference, evidence) => {
          capturedResponses.push(evidence);
        }),
        finishTransportError: vi.fn(async (_reference, evidence) => {
          terminalErrors.push(evidence);
        }),
      });

      let thrown: unknown;
      try {
        await recordedFetch(request.url, request.requestInit, {
          fetchImpl: vi.fn(async () =>
            credentialEchoResponse(surface, mapKey, request.url)
          ),
          ledger: evidenceLedger,
          requestEvidence: firmsAreaRequestEvidence(request),
          credentialPathRedaction: request.credentialPathRedaction,
          maximumResponseBytes: 4_096,
          safeResponseHeaderNames: ["x-request-id"],
        });
      } catch (error) {
        thrown = error;
      }

      expect(thrown).toBeInstanceOf(CredentialPathResponseError);
      expect(String(thrown)).not.toContain(mapKey);
      expect((thrown as Error & { cause?: unknown }).cause).toBeUndefined();
      expect(capturedResponses).toEqual([]);
      expect(terminalErrors).toEqual([
        {
          errorClass: "upstream",
          errorDetailSafe: "Credential-bearing upstream response was withheld.",
          safeMetadata: {
            reason: "credential_exposure",
            terminal: true,
          },
        },
      ]);
      expect(
        JSON.stringify({ issued, terminalErrors, capturedResponses }),
      ).not.toContain(mapKey);
    },
  );

  it("withholds even a clean credential-path redirect", async () => {
    const mapKey = "firms-test-key-0000000000000001";
    const request = firmsAreaRequest({
      mapKey,
      product: "VIIRS_NOAA20_NRT",
      area: { west: 26.2, south: 38.85, east: 26.6, north: 39.15 },
      date: { kind: "rolling", days: 1 },
      issuedAt: FIRMS_ISSUED_AT,
    });
    const terminalErrors: HttpTransportErrorEvidence[] = [];
    const evidenceLedger = ledger({
      finishTransportError: vi.fn(async (_reference, evidence) => {
        terminalErrors.push(evidence);
      }),
    });

    await expect(
      recordedFetch(request.url, request.requestInit, {
        fetchImpl: vi.fn(async () =>
          new Response(null, {
            status: 307,
            headers: {
              location: "https://firms.modaps.eosdis.nasa.gov/maintenance",
            },
          })
        ),
        ledger: evidenceLedger,
        requestEvidence: firmsAreaRequestEvidence(request),
        credentialPathRedaction: request.credentialPathRedaction,
        maximumResponseBytes: 1_024,
      }),
    ).rejects.toBeInstanceOf(CredentialPathResponseError);
    expect(evidenceLedger.finishResponse).not.toHaveBeenCalled();
    expect(terminalErrors).toEqual([
      {
        errorClass: "upstream",
        errorDetailSafe: "Credential-bearing upstream response was withheld.",
        safeMetadata: { reason: "credential_redirect", terminal: true },
      },
    ]);
  });

  it("persists and returns a clean credential-path response", async () => {
    const mapKey = "firms-test-key-0000000000000001";
    const request = firmsAreaRequest({
      mapKey,
      product: "VIIRS_NOAA20_NRT",
      area: { west: 26.2, south: 38.85, east: 26.6, north: 39.15 },
      date: { kind: "rolling", days: 1 },
      issuedAt: FIRMS_ISSUED_AT,
    });
    const capturedResponses: HttpResponseEvidence[] = [];
    const evidenceLedger = ledger({
      finishResponse: vi.fn(async (_reference, evidence) => {
        capturedResponses.push(evidence);
      }),
    });
    const body = "latitude,longitude\n";

    const response = await recordedFetch(request.url, request.requestInit, {
      fetchImpl: vi.fn(async () =>
        new Response(body, {
          status: 200,
          headers: {
            "content-type": "text/csv",
            "x-request-id": "safe-firms-request-id",
          },
        })
      ),
      ledger: evidenceLedger,
      requestEvidence: firmsAreaRequestEvidence(request),
      credentialPathRedaction: request.credentialPathRedaction,
      maximumResponseBytes: 1_024,
      safeResponseHeaderNames: ["content-type", "x-request-id"],
    });

    expect(await response.text()).toBe(body);
    expect(capturedResponses).toHaveLength(1);
    expect(capturedResponses[0]?.safeHeaders).toEqual({
      "content-type": "text/csv",
      "x-request-id": "safe-firms-request-id",
    });
    expect(evidenceLedger.finishTransportError).not.toHaveBeenCalled();
    expect(JSON.stringify(capturedResponses)).not.toContain(mapKey);
  });

  it("includes safe FIRMS product, AOI, and date fields in request identity", () => {
    const area = Object.freeze({
      west: 26.2,
      south: 38.85,
      east: 26.6,
      north: 39.15,
    });
    const baseline = firmsAreaRequest({
      mapKey: "firms-test-key-0000000000000001",
      product: "VIIRS_NOAA20_NRT",
      area,
      date: { kind: "rolling", days: 2 },
      issuedAt: FIRMS_ISSUED_AT,
    });
    const differentProduct = firmsAreaRequest({
      mapKey: "firms-test-key-0000000000000001",
      product: "MODIS_NRT",
      area,
      date: { kind: "rolling", days: 2 },
      issuedAt: FIRMS_ISSUED_AT,
    });
    const differentArea = firmsAreaRequest({
      mapKey: "firms-test-key-0000000000000001",
      product: "VIIRS_NOAA20_NRT",
      area: { ...area, east: 26.7 },
      date: { kind: "rolling", days: 2 },
      issuedAt: FIRMS_ISSUED_AT,
    });
    const differentDate = firmsAreaRequest({
      mapKey: "firms-test-key-0000000000000001",
      product: "VIIRS_NOAA20_NRT",
      area,
      date: { kind: "starting-on", date: "2026-07-29", days: 1 },
      issuedAt: FIRMS_ISSUED_AT,
    });
    const baselineFingerprint = requestFingerprint(firmsAreaRequestEvidence(baseline));

    expect(requestFingerprint(firmsAreaRequestEvidence(differentProduct))).not.toBe(
      baselineFingerprint,
    );
    expect(requestFingerprint(firmsAreaRequestEvidence(differentArea))).not.toBe(
      baselineFingerprint,
    );
    expect(requestFingerprint(firmsAreaRequestEvidence(differentDate))).not.toBe(
      baselineFingerprint,
    );
  });

  it("rejects tampered or credential-bearing FIRMS evidence before issuance", async () => {
    const mapKey = "firms-test-key-0000000000000001";
    const request = firmsAreaRequest({
      mapKey,
      product: "VIIRS_NOAA20_NRT",
      area: { west: 26.2, south: 38.85, east: 26.6, north: 39.15 },
      date: { kind: "rolling", days: 2 },
      issuedAt: FIRMS_ISSUED_AT,
    });
    const evidenceLedger = ledger();
    const fetchImpl = vi.fn<typeof fetch>();
    const evidence = firmsAreaRequestEvidence(request);

    for (const requestEvidence of [
      {
        ...evidence,
        requestQuerySafe: {
          ...evidence.requestQuerySafe,
          area: "26.2,38.85,26.7,39.15",
        },
      },
      {
        ...evidence,
        requestMetadataSafe: { operation: mapKey },
      },
    ]) {
      await expect(
        recordedFetch(request.url, request.requestInit, {
          fetchImpl,
          ledger: evidenceLedger,
          requestEvidence,
          credentialPathRedaction: request.credentialPathRedaction,
          maximumResponseBytes: 1_024,
        }),
      ).rejects.toBeInstanceOf(TypeError);
    }
    expect(evidenceLedger.issue).not.toHaveBeenCalled();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it.each([
    "25.9,38.850000,26.600000,39.150000",
    "-0.000000,38.850000,26.600000,39.150000",
    "26.2000000,38.850000,26.600000,39.150000",
  ])("rejects noncanonical FIRMS area %s before issuance", async (area) => {
    const request = firmsAreaRequest({
      mapKey: "firms-test-key-0000000000000001",
      product: "VIIRS_NOAA20_NRT",
      area: { west: 26.2, south: 38.85, east: 26.6, north: 39.15 },
      date: { kind: "rolling", days: 2 },
      issuedAt: FIRMS_ISSUED_AT,
    });
    const evidence = firmsAreaRequestEvidence(request);
    const evidenceLedger = ledger();
    const fetchImpl = vi.fn<typeof fetch>();
    const tamperedUrl = request.url.replace(
      request.requestQuerySafe.area,
      area,
    );

    await expect(
      recordedFetch(tamperedUrl, request.requestInit, {
        fetchImpl,
        ledger: evidenceLedger,
        requestEvidence: {
          ...evidence,
          requestQuerySafe: { ...evidence.requestQuerySafe, area },
        },
        credentialPathRedaction: request.credentialPathRedaction,
        maximumResponseBytes: 1_024,
      }),
    ).rejects.toBeInstanceOf(TypeError);
    expect(evidenceLedger.issue).not.toHaveBeenCalled();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("rejects FIRMS method, body, and split-field credential smuggling", async () => {
    const mapKey = "firms-test-key-0000000000000001";
    const request = firmsAreaRequest({
      mapKey,
      product: "VIIRS_NOAA20_NRT",
      area: { west: 26.2, south: 38.85, east: 26.6, north: 39.15 },
      date: { kind: "rolling", days: 2 },
      issuedAt: FIRMS_ISSUED_AT,
    });
    const evidence = firmsAreaRequestEvidence(request);
    const evidenceLedger = ledger();
    const fetchImpl = vi.fn<typeof fetch>();

    await expect(
      recordedFetch(
        request.url,
        { redirect: "manual", method: "POST", body: mapKey },
        {
          fetchImpl,
          ledger: evidenceLedger,
          requestEvidence: {
            ...evidence,
            method: "POST",
            requestBodyRedacted: new TextEncoder().encode(mapKey),
          },
          credentialPathRedaction: request.credentialPathRedaction,
          maximumResponseBytes: 1_024,
        },
      ),
    ).rejects.toBeInstanceOf(TypeError);

    await expect(
      recordedFetch(
        request.url,
        { ...request.requestInit, body: mapKey },
        {
          fetchImpl,
          ledger: evidenceLedger,
          requestEvidence: evidence,
          credentialPathRedaction: request.credentialPathRedaction,
          maximumResponseBytes: 1_024,
        },
      ),
    ).rejects.toBeInstanceOf(TypeError);

    await expect(
      recordedFetch(
        request.url,
        {
          ...request.requestInit,
          headers: {
            ...request.requestInit.headers,
            "accept-language": mapKey,
          },
        },
        {
          fetchImpl,
          ledger: evidenceLedger,
          requestEvidence: evidence,
          credentialPathRedaction: request.credentialPathRedaction,
          maximumResponseBytes: 1_024,
        },
      ),
    ).rejects.toBeInstanceOf(TypeError);

    const midpoint = Math.floor(mapKey.length / 2);
    await expect(
      recordedFetch(request.url, request.requestInit, {
        fetchImpl,
        ledger: evidenceLedger,
        requestEvidence: {
          ...evidence,
          requestHeadersSafe: {
            ...evidence.requestHeadersSafe,
            "accept-language": mapKey.slice(0, midpoint),
          },
          requestMetadataSafe: {
            ...evidence.requestMetadataSafe,
            collection: mapKey.slice(midpoint),
          },
        },
        credentialPathRedaction: request.credentialPathRedaction,
        maximumResponseBytes: 1_024,
      }),
    ).rejects.toBeInstanceOf(TypeError);

    expect(evidenceLedger.issue).not.toHaveBeenCalled();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("sanitizes credential-path transport failures before rethrowing", async () => {
    const mapKey = "firms-test-key-0000000000000001";
    const request = firmsAreaRequest({
      mapKey,
      product: "MODIS_NRT",
      area: { west: 26.2, south: 38.85, east: 26.6, north: 39.15 },
      date: { kind: "starting-on", date: "2026-07-29", days: 1 },
      issuedAt: FIRMS_ISSUED_AT,
    });
    const issued: HttpRequestEvidence[] = [];
    const terminalErrors: HttpTransportErrorEvidence[] = [];
    const evidenceLedger = ledger({
      issue: vi.fn(async (evidence) => {
        issued.push(evidence);
        return REFERENCE;
      }),
      finishTransportError: vi.fn(async (_reference, evidence) => {
        terminalErrors.push(evidence);
      }),
    });

    let thrown: unknown;
    try {
      await recordedFetch(request.url, request.requestInit, {
        fetchImpl: vi.fn(async () => {
          throw new Error(`GET ${request.url} failed`);
        }),
        ledger: evidenceLedger,
        requestEvidence: firmsAreaRequestEvidence(request),
        credentialPathRedaction: request.credentialPathRedaction,
        maximumResponseBytes: 1_024,
      });
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(CredentialPathTransportError);
    expect(String(thrown)).not.toContain(mapKey);
    expect((thrown as Error & { cause?: unknown }).cause).toBeUndefined();
    expect(terminalErrors).toEqual([
      {
        errorClass: "network",
        errorDetailSafe:
          "Upstream request failed before an HTTP response was available.",
        safeMetadata: {},
      },
    ]);
    expect(JSON.stringify({ issued, terminalErrors })).not.toContain(mapKey);
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

  it("cancels an oversized response without exposing or terminalizing partial bytes", async () => {
    const evidenceLedger = ledger();
    const fetchImpl = vi.fn(async () => new Response("response-over-limit"));

    await expect(
      recordedFetch("https://example.test/data?format=json", MANUAL_REDIRECT, {
        fetchImpl,
        ledger: evidenceLedger,
        requestEvidence: REQUEST_EVIDENCE,
        maximumResponseBytes: 4,
      }),
    ).rejects.toMatchObject({ stage: "capture_response" });
    expect(evidenceLedger.issue).toHaveBeenCalledOnce();
    expect(evidenceLedger.finishResponse).not.toHaveBeenCalled();
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
