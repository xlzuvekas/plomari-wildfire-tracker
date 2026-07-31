import { Buffer } from "node:buffer";
import { createHmac, timingSafeEqual } from "node:crypto";

import { z } from "zod";

import {
  readSupabaseDiscoveryReaderApiKey,
  type SupabaseServerEnvironmentInput,
} from "../../supabase/server-env";
import { utcInstantSchema, uuidV7Schema } from "../../truth/v1/schemas";
import { parseAreaCellKey } from "../map-context";
import {
  THERMAL_ANOMALY_MAX_CURSOR_LENGTH,
  THERMAL_ANOMALY_MAX_PAGE_SIZE,
  THERMAL_ANOMALY_WINDOW_MS,
} from "./thermal-anomaly-contract";

export const THERMAL_ANOMALY_CURSOR_VERSION = 1 as const;
export { THERMAL_ANOMALY_MAX_CURSOR_LENGTH };

const BASE64URL_PATTERN = /^[A-Za-z0-9_-]+$/u;
const SHA256_BASE64URL_LENGTH = 43;

const canonicalInstantSchema = utcInstantSchema.refine(
  (value) => {
    const instantMs = Date.parse(value);
    return Number.isFinite(instantMs) && new Date(instantMs).toISOString() === value;
  },
  "Expected a canonical millisecond UTC instant",
);

const canonicalCellSchema = z
  .string()
  .min(1)
  .max(64)
  .refine((value) => parseAreaCellKey(value)?.cellKey === value, {
    message: "Expected a canonical Firewatch coarse-area cell key",
  });

const canonicalUuidV7Schema = uuidV7Schema.refine(
  (value) => value === value.toLowerCase(),
  "Expected a canonical lowercase UUIDv7",
);

const cursorBindingSchema = z.strictObject({
  cell: canonicalCellSchema,
  asOf: canonicalInstantSchema,
  knownAt: canonicalInstantSchema,
  limit: z.number().int().min(1).max(THERMAL_ANOMALY_MAX_PAGE_SIZE),
});

const cursorPayloadSchema = cursorBindingSchema
  .extend({
    v: z.literal(THERMAL_ANOMALY_CURSOR_VERSION),
    afterAcquiredAt: canonicalInstantSchema,
    afterDetectionId: canonicalUuidV7Schema,
    gateSnapshot: z.string().regex(/^[0-9a-f]{64}$/u),
  })
  .strict()
  .superRefine((payload, context) => {
    const asOfMs = Date.parse(payload.asOf);
    const knownAtMs = Date.parse(payload.knownAt);
    const afterAcquiredAtMs = Date.parse(payload.afterAcquiredAt);
    if (asOfMs > knownAtMs) {
      context.addIssue({
        code: "custom",
        message: "Event cutoff must not follow the knowledge cutoff",
        path: ["knownAt"],
      });
    }
    if (
      afterAcquiredAtMs > asOfMs ||
      afterAcquiredAtMs <= asOfMs - THERMAL_ANOMALY_WINDOW_MS
    ) {
      context.addIssue({
        code: "custom",
        message: "Cursor position is outside the thermal observation window",
        path: ["afterAcquiredAt"],
      });
    }
  });

const cursorTokenSchema = z
  .string()
  .min(1)
  .max(THERMAL_ANOMALY_MAX_CURSOR_LENGTH)
  .refine((value) => {
    const segments = value.split(".");
    return (
      segments.length === 2 &&
      segments[0] !== undefined &&
      segments[0].length > 0 &&
      BASE64URL_PATTERN.test(segments[0]) &&
      segments[1] !== undefined &&
      segments[1].length === SHA256_BASE64URL_LENGTH &&
      BASE64URL_PATTERN.test(segments[1])
    );
  });

export type ThermalAnomalyCursorBinding = Readonly<
  z.infer<typeof cursorBindingSchema>
>;

export type ThermalAnomalyCursorPayload = Readonly<
  z.infer<typeof cursorPayloadSchema>
>;

export class InvalidThermalAnomalyCursorError extends Error {
  readonly code = "invalid_thermal_anomaly_cursor";

  constructor() {
    super("The thermal anomaly cursor is invalid.");
    this.name = "InvalidThermalAnomalyCursorError";
  }
}

function canonicalPayload(
  payload: z.infer<typeof cursorPayloadSchema>,
): ThermalAnomalyCursorPayload {
  return Object.freeze({
    v: payload.v,
    cell: payload.cell,
    asOf: payload.asOf,
    knownAt: payload.knownAt,
    limit: payload.limit,
    afterAcquiredAt: payload.afterAcquiredAt,
    afterDetectionId: payload.afterDetectionId,
    gateSnapshot: payload.gateSnapshot,
  });
}

function signPayload(encodedPayload: string, secret: string): Buffer {
  return createHmac("sha256", secret).update(encodedPayload, "ascii").digest();
}

function decodeCanonicalBase64Url(value: string): Buffer {
  if (!BASE64URL_PATTERN.test(value)) {
    throw new InvalidThermalAnomalyCursorError();
  }
  const decoded = Buffer.from(value, "base64url");
  if (decoded.toString("base64url") !== value) {
    throw new InvalidThermalAnomalyCursorError();
  }
  return decoded;
}

function invalidCursor(): never {
  throw new InvalidThermalAnomalyCursorError();
}

/**
 * Creates an opaque continuation token. The API key remains server-side and is
 * used only as HMAC key material; neither it nor a derived key is serialized.
 */
export function encodeThermalAnomalyCursor(
  input: ThermalAnomalyCursorPayload,
  environment?: SupabaseServerEnvironmentInput,
): string {
  const secret = readSupabaseDiscoveryReaderApiKey(environment);
  const parsed = cursorPayloadSchema.safeParse(input);
  if (!parsed.success) return invalidCursor();

  const encodedPayload = Buffer.from(
    JSON.stringify(canonicalPayload(parsed.data)),
    "utf8",
  ).toString("base64url");
  const signature = signPayload(encodedPayload, secret).toString("base64url");
  const token = `${encodedPayload}.${signature}`;
  if (!cursorTokenSchema.safeParse(token).success) return invalidCursor();
  return token;
}

/**
 * Authenticates, canonically decodes, and binds a continuation token to the
 * current request. Every token failure intentionally has the same public-safe
 * error shape.
 */
export function decodeThermalAnomalyCursor(
  token: string,
  expectedBinding: ThermalAnomalyCursorBinding,
  environment?: SupabaseServerEnvironmentInput,
): ThermalAnomalyCursorPayload {
  const secret = readSupabaseDiscoveryReaderApiKey(environment);

  try {
    const parsedToken = cursorTokenSchema.safeParse(token);
    if (!parsedToken.success) return invalidCursor();
    const [encodedPayload, encodedSignature] = parsedToken.data.split(".");
    if (encodedPayload === undefined || encodedSignature === undefined) {
      return invalidCursor();
    }

    const suppliedSignature = decodeCanonicalBase64Url(encodedSignature);
    const expectedSignature = signPayload(encodedPayload, secret);
    if (
      suppliedSignature.length !== expectedSignature.length ||
      !timingSafeEqual(suppliedSignature, expectedSignature)
    ) {
      return invalidCursor();
    }

    const payloadBytes = decodeCanonicalBase64Url(encodedPayload);
    const payloadJson = payloadBytes.toString("utf8");
    const rawPayload: unknown = JSON.parse(payloadJson);
    const parsedPayload = cursorPayloadSchema.safeParse(rawPayload);
    if (!parsedPayload.success) return invalidCursor();
    const payload = canonicalPayload(parsedPayload.data);
    if (
      JSON.stringify(payload) !== payloadJson ||
      Buffer.from(payloadJson, "utf8").toString("base64url") !== encodedPayload
    ) {
      return invalidCursor();
    }

    const parsedBinding = cursorBindingSchema.safeParse(expectedBinding);
    if (
      !parsedBinding.success ||
      payload.cell !== parsedBinding.data.cell ||
      payload.asOf !== parsedBinding.data.asOf ||
      payload.knownAt !== parsedBinding.data.knownAt ||
      payload.limit !== parsedBinding.data.limit
    ) {
      return invalidCursor();
    }

    return payload;
  } catch (error) {
    if (error instanceof InvalidThermalAnomalyCursorError) throw error;
    return invalidCursor();
  }
}
