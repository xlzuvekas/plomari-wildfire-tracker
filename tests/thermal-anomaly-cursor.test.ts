import { Buffer } from "node:buffer";
import { createHmac } from "node:crypto";

import { describe, expect, it } from "vitest";

import {
  InvalidThermalAnomalyCursorError,
  THERMAL_ANOMALY_MAX_CURSOR_LENGTH,
  decodeThermalAnomalyCursor,
  encodeThermalAnomalyCursor,
  type ThermalAnomalyCursorBinding,
  type ThermalAnomalyCursorPayload,
} from "../lib/firewatch/v3/thermal-anomaly-cursor.server";
import { SupabaseServerConfigurationError } from "../lib/supabase/server-env";

const SECRET = `sb_secret_${"a".repeat(48)}`;
const OTHER_SECRET = `sb_secret_${"b".repeat(48)}`;
const ENVIRONMENT = { SUPABASE_DISCOVERY_READER_KEY: SECRET } as const;
const OTHER_ENVIRONMENT = {
  SUPABASE_DISCOVERY_READER_KEY: OTHER_SECRET,
} as const;

const PAYLOAD: ThermalAnomalyCursorPayload = {
  v: 1,
  cell: "wm/10/587/391",
  asOf: "2026-07-31T12:00:00.000Z",
  knownAt: "2026-07-31T12:05:00.000Z",
  limit: 50,
  afterAcquiredAt: "2026-07-31T11:45:00.000Z",
  afterDetectionId: "019a0000-0000-7abc-8abc-abcdefabcdef",
  gateSnapshot: "c".repeat(64),
};

const BINDING: ThermalAnomalyCursorBinding = {
  cell: PAYLOAD.cell,
  asOf: PAYLOAD.asOf,
  knownAt: PAYLOAD.knownAt,
  limit: PAYLOAD.limit,
};

function expectInvalidCursor(action: () => unknown) {
  let caught: unknown;
  try {
    action();
  } catch (error) {
    caught = error;
  }
  expect(caught).toBeInstanceOf(InvalidThermalAnomalyCursorError);
  expect(caught).toMatchObject({
    name: "InvalidThermalAnomalyCursorError",
    code: "invalid_thermal_anomaly_cursor",
    message: "The thermal anomaly cursor is invalid.",
  });
}

function signedToken(json: string) {
  const payload = Buffer.from(json, "utf8").toString("base64url");
  const signature = createHmac("sha256", SECRET)
    .update(payload, "ascii")
    .digest("base64url");
  return `${payload}.${signature}`;
}

describe("server-only thermal anomaly pagination cursor", () => {
  it("round-trips a deterministic canonical base64url payload and signature", () => {
    const first = encodeThermalAnomalyCursor(PAYLOAD, ENVIRONMENT);
    const second = encodeThermalAnomalyCursor(PAYLOAD, ENVIRONMENT);
    const [encodedPayload, signature] = first.split(".");

    expect(first).toBe(second);
    expect(first.length).toBeLessThanOrEqual(THERMAL_ANOMALY_MAX_CURSOR_LENGTH);
    expect(first).toMatch(/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]{43}$/u);
    expect(signature).toHaveLength(43);
    expect(
      Buffer.from(encodedPayload ?? "", "base64url").toString("utf8"),
    ).toBe(JSON.stringify(PAYLOAD));
    expect(
      decodeThermalAnomalyCursor(first, BINDING, ENVIRONMENT),
    ).toEqual(PAYLOAD);
  });

  it("rejects payload and signature tampering without distinguishing failures", () => {
    const token = encodeThermalAnomalyCursor(PAYLOAD, ENVIRONMENT);
    const [payload, signature] = token.split(".");
    if (payload === undefined || signature === undefined) {
      throw new Error("Test cursor was not segmented");
    }
    const tamperedPayload = `${payload.slice(0, -1)}${payload.endsWith("A") ? "B" : "A"}`;
    const tamperedSignature = `${signature.startsWith("A") ? "B" : "A"}${signature.slice(1)}`;

    for (const candidate of [
      `${tamperedPayload}.${signature}`,
      `${payload}.${tamperedSignature}`,
      `${payload}.${signature}=`,
      "not-a-cursor",
      "a".repeat(THERMAL_ANOMALY_MAX_CURSOR_LENGTH + 1),
    ]) {
      expectInvalidCursor(() =>
        decodeThermalAnomalyCursor(candidate, BINDING, ENVIRONMENT),
      );
    }

    expectInvalidCursor(() =>
      decodeThermalAnomalyCursor(token, BINDING, OTHER_ENVIRONMENT),
    );
  });

  it("rejects a correctly signed but non-canonical payload", () => {
    const nonCanonicalJson = JSON.stringify({
      cell: PAYLOAD.cell,
      v: PAYLOAD.v,
      asOf: PAYLOAD.asOf,
      knownAt: PAYLOAD.knownAt,
      limit: PAYLOAD.limit,
      afterAcquiredAt: PAYLOAD.afterAcquiredAt,
      afterDetectionId: PAYLOAD.afterDetectionId,
      gateSnapshot: PAYLOAD.gateSnapshot,
    });

    expectInvalidCursor(() =>
      decodeThermalAnomalyCursor(
        signedToken(nonCanonicalJson),
        BINDING,
        ENVIRONMENT,
      ),
    );
  });

  it("binds the authenticated position to the exact request scope and cutoffs", () => {
    const token = encodeThermalAnomalyCursor(PAYLOAD, ENVIRONMENT);
    const mismatches: readonly ThermalAnomalyCursorBinding[] = [
      { ...BINDING, cell: "wm/10/588/391" },
      { ...BINDING, asOf: "2026-07-31T11:59:00.000Z" },
      { ...BINDING, knownAt: "2026-07-31T12:06:00.000Z" },
      { ...BINDING, limit: 51 },
    ];

    for (const mismatch of mismatches) {
      expectInvalidCursor(() =>
        decodeThermalAnomalyCursor(token, mismatch, ENVIRONMENT),
      );
    }
  });

  it("strictly bounds and canonicalizes every signed field", () => {
    const invalidPayloads: readonly unknown[] = [
      { ...PAYLOAD, v: 2 },
      { ...PAYLOAD, cell: "wm/10/0587/391" },
      { ...PAYLOAD, asOf: "2026-07-31T12:00:00Z" },
      { ...PAYLOAD, knownAt: "2026-07-31T11:59:00.000Z" },
      { ...PAYLOAD, limit: 101 },
      { ...PAYLOAD, afterAcquiredAt: "2026-07-31T12:00:00Z" },
      { ...PAYLOAD, afterAcquiredAt: "2026-07-31T12:00:00.001Z" },
      { ...PAYLOAD, afterAcquiredAt: "2026-07-24T11:59:59.999Z" },
      { ...PAYLOAD, afterAcquiredAt: "2026-07-24T12:00:00.000Z" },
      { ...PAYLOAD, afterDetectionId: PAYLOAD.afterDetectionId.toUpperCase() },
      { ...PAYLOAD, gateSnapshot: "C".repeat(64) },
      { ...PAYLOAD, extra: true },
    ];

    for (const invalid of invalidPayloads) {
      expectInvalidCursor(() =>
        encodeThermalAnomalyCursor(
          invalid as ThermalAnomalyCursorPayload,
          ENVIRONMENT,
        ),
      );
    }
  });

  it("requires the scoped discovery-reader key and never accepts a public key", () => {
    expect(() =>
      encodeThermalAnomalyCursor(PAYLOAD, {
        SUPABASE_PUBLISHABLE_KEY: "sb_publishable_test_value_1234567890",
      }),
    ).toThrow(SupabaseServerConfigurationError);
  });
});
