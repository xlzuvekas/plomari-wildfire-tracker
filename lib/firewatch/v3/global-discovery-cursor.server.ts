import { Buffer } from "node:buffer";
import { createHmac, timingSafeEqual } from "node:crypto";

import { z } from "zod";

import {
  readSupabaseDiscoveryReaderApiKey,
  type SupabaseServerEnvironmentInput,
} from "../../supabase/server-env";
import { utcInstantSchema, uuidV7Schema } from "../../truth/v1/schemas";
import { AREA_GRID_VERSION } from "../map-context";
import {
  GLOBAL_DISCOVERY_MAX_CURSOR_LENGTH,
  GLOBAL_DISCOVERY_MAX_PAGE_SIZE,
  GLOBAL_DISCOVERY_ORDERING,
  GLOBAL_DISCOVERY_SCHEMA_VERSION,
} from "./discovery-contracts";

export const GLOBAL_CANDIDATE_CURSOR_VERSION = 1 as const;

const CURSOR_SIGNATURE_BYTES = 32;
// Domain separation binds the signature to this endpoint, public schema,
// scope/grid, ordering contract, and cursor format without exposing them as
// mutable client-controlled fields.
const CURSOR_DOMAIN =
  `firewatch:v${GLOBAL_DISCOVERY_SCHEMA_VERSION}:explore-candidates:global:` +
  `${AREA_GRID_VERSION}:${GLOBAL_DISCOVERY_ORDERING}:cursor-v1\0`;
const BASE64URL_PATTERN = /^[A-Za-z0-9_-]+$/u;
const digestSchema = z.string().regex(/^[a-f0-9]{64}$/u);
const canonicalUuidV7Schema = uuidV7Schema.refine(
  (value) => value === value.toLowerCase(),
  "Expected a canonical lowercase UUIDv7",
);
const canonicalInstantSchema = utcInstantSchema.refine(
  (value) => new Date(value).toISOString() === value,
  "Expected a canonical millisecond UTC instant",
);

const cursorBindingSchema = z.strictObject({
  asOf: canonicalInstantSchema,
  knownAt: canonicalInstantSchema,
  limit: z.number().int().min(1).max(GLOBAL_DISCOVERY_MAX_PAGE_SIZE),
});

const cursorPayloadSchema = cursorBindingSchema
  .extend({
    version: z.literal(GLOBAL_CANDIDATE_CURSOR_VERSION),
    snapshotId: canonicalUuidV7Schema,
    snapshotDigest: digestSchema,
    publicationGateDigest: digestSchema,
    afterItemKnownAt: canonicalInstantSchema,
    afterCandidateId: canonicalUuidV7Schema,
  })
  .superRefine((payload, context) => {
    if (
      Date.parse(payload.asOf) > Date.parse(payload.knownAt) ||
      Date.parse(payload.afterItemKnownAt) > Date.parse(payload.knownAt)
    ) {
      context.addIssue({
        code: "custom",
        message: "Global candidate cursor clocks are invalid",
        path: ["knownAt"],
      });
    }
  });

const cursorWireSchema = z
  .strictObject({
    v: z.literal(GLOBAL_CANDIDATE_CURSOR_VERSION),
    a: z.number().int().nonnegative().safe(),
    k: z.number().int().nonnegative().safe(),
    l: z.number().int().min(1).max(GLOBAL_DISCOVERY_MAX_PAGE_SIZE),
    s: canonicalUuidV7Schema,
    d: digestSchema,
    g: digestSchema,
    t: z.number().int().nonnegative().safe(),
    i: canonicalUuidV7Schema,
  })
  .superRefine((payload, context) => {
    if (payload.a > payload.k || payload.t > payload.k) {
      context.addIssue({
        code: "custom",
        message: "Global candidate cursor clocks are invalid",
        path: ["k"],
      });
    }
  });

export type GlobalCandidateCursorBinding = Readonly<
  z.input<typeof cursorBindingSchema>
>;
export type GlobalCandidateCursorPayload = Readonly<
  z.input<typeof cursorPayloadSchema>
>;

export class InvalidGlobalCandidateCursorError extends Error {
  readonly code = "invalid_global_candidate_cursor";

  constructor() {
    super("The global candidate cursor is invalid.");
    this.name = "InvalidGlobalCandidateCursorError";
  }
}

function invalidCursor(): never {
  throw new InvalidGlobalCandidateCursorError();
}

function wirePayload(
  payload: z.output<typeof cursorPayloadSchema>,
): z.output<typeof cursorWireSchema> {
  return Object.freeze({
    v: payload.version,
    a: Date.parse(payload.asOf),
    k: Date.parse(payload.knownAt),
    l: payload.limit,
    s: payload.snapshotId,
    d: payload.snapshotDigest,
    g: payload.publicationGateDigest,
    t: Date.parse(payload.afterItemKnownAt),
    i: payload.afterCandidateId,
  });
}

function sign(payloadBytes: Buffer, secret: string) {
  return createHmac("sha256", secret)
    .update(CURSOR_DOMAIN, "utf8")
    .update(payloadBytes)
    .digest();
}

/**
 * Signs one compact, opaque continuation token. The scoped reader key is
 * server-only HMAC material and is never serialized into the token.
 */
export function encodeGlobalCandidateCursor(
  input: GlobalCandidateCursorPayload,
  environment?: SupabaseServerEnvironmentInput,
) {
  const secret = readSupabaseDiscoveryReaderApiKey(environment);
  const parsed = cursorPayloadSchema.safeParse(input);
  if (!parsed.success) return invalidCursor();
  const wire = wirePayload(parsed.data);
  if (!cursorWireSchema.safeParse(wire).success) return invalidCursor();
  const payloadBytes = Buffer.from(JSON.stringify(wire), "utf8");
  const signature = sign(payloadBytes, secret);
  const token = Buffer.concat([payloadBytes, signature]).toString("base64url");
  if (
    token.length > GLOBAL_DISCOVERY_MAX_CURSOR_LENGTH ||
    !BASE64URL_PATTERN.test(token)
  ) {
    return invalidCursor();
  }
  return token;
}

/**
 * Authenticates and canonically decodes a cursor, then binds it to the exact
 * request cutoffs and page size. All failures intentionally collapse to one
 * public-safe error.
 */
export function decodeGlobalCandidateCursor(
  token: string,
  expectedBinding: GlobalCandidateCursorBinding,
  environment?: SupabaseServerEnvironmentInput,
): GlobalCandidateCursorPayload {
  const secret = readSupabaseDiscoveryReaderApiKey(environment);
  try {
    if (
      token.length < 16 ||
      token.length > GLOBAL_DISCOVERY_MAX_CURSOR_LENGTH ||
      !BASE64URL_PATTERN.test(token)
    ) {
      return invalidCursor();
    }
    const decoded = Buffer.from(token, "base64url");
    if (
      decoded.toString("base64url") !== token ||
      decoded.length <= CURSOR_SIGNATURE_BYTES
    ) {
      return invalidCursor();
    }
    const payloadBytes = decoded.subarray(0, -CURSOR_SIGNATURE_BYTES);
    const suppliedSignature = decoded.subarray(-CURSOR_SIGNATURE_BYTES);
    const expectedSignature = sign(payloadBytes, secret);
    if (
      suppliedSignature.length !== expectedSignature.length ||
      !timingSafeEqual(suppliedSignature, expectedSignature)
    ) {
      return invalidCursor();
    }
    const payloadJson = payloadBytes.toString("utf8");
    const rawWire: unknown = JSON.parse(payloadJson);
    const parsedWire = cursorWireSchema.safeParse(rawWire);
    if (!parsedWire.success || JSON.stringify(parsedWire.data) !== payloadJson) {
      return invalidCursor();
    }
    const wire = parsedWire.data;
    const parsedPayload = cursorPayloadSchema.safeParse({
      version: wire.v,
      asOf: new Date(wire.a).toISOString(),
      knownAt: new Date(wire.k).toISOString(),
      limit: wire.l,
      snapshotId: wire.s,
      snapshotDigest: wire.d,
      publicationGateDigest: wire.g,
      afterItemKnownAt: new Date(wire.t).toISOString(),
      afterCandidateId: wire.i,
    });
    const parsedBinding = cursorBindingSchema.safeParse(expectedBinding);
    if (
      !parsedPayload.success ||
      !parsedBinding.success ||
      parsedPayload.data.asOf !== parsedBinding.data.asOf ||
      parsedPayload.data.knownAt !== parsedBinding.data.knownAt ||
      parsedPayload.data.limit !== parsedBinding.data.limit
    ) {
      return invalidCursor();
    }
    return Object.freeze(parsedPayload.data);
  } catch (error) {
    if (error instanceof InvalidGlobalCandidateCursorError) throw error;
    return invalidCursor();
  }
}
