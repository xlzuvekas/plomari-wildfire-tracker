import { Buffer } from "node:buffer";
import { env as processEnvironment } from "node:process";

import { z } from "zod";

const LOCAL_SUPABASE_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

function isServerSupabaseUrl(value: string) {
  try {
    const url = new URL(value);
    const secure = url.protocol === "https:";
    const local =
      url.protocol === "http:" && LOCAL_SUPABASE_HOSTS.has(url.hostname);

    return (
      (secure || local) &&
      url.username === "" &&
      url.password === "" &&
      url.pathname === "/" &&
      url.search === "" &&
      url.hash === ""
    );
  } catch {
    return false;
  }
}

const supabaseServerEnvironmentSchema = z.strictObject({
  SUPABASE_URL: z
    .string()
    .trim()
    .min(1)
    .max(2_048)
    .refine(isServerSupabaseUrl),
  SUPABASE_PUBLISHABLE_KEY: z.string().trim().min(16).max(8_192),
});

const discoveryReaderSecretApiKeySchema = z
  .string()
  .trim()
  .min(32)
  .max(8_192)
  .regex(/^sb_secret_[A-Za-z0-9_-]+$/u);

const BASE64URL_PATTERN = /^[A-Za-z0-9_-]+$/u;
const HOSTED_PROJECT_HOST_PATTERN = /^([a-z]{20})\.supabase\.co$/u;
const PROJECT_REF_PATTERN = /^[a-z]{20}$/u;
const DISCOVERY_READER_ROLE = "firewatch_discovery_reader";
const LEGACY_JWT_MAX_LIFETIME_SECONDS = 31 * 24 * 60 * 60;
const LEGACY_JWT_IAT_FUTURE_SKEW_SECONDS = 30;
const unixTimestampSchema = z.number().int().safe().nonnegative();
const legacyJwtHeaderSchema = z
  .object({
    alg: z.literal("HS256"),
    typ: z.literal("JWT").optional(),
  })
  .passthrough();
const legacyJwtPayloadSchema = z
  .object({
    iss: z.literal("supabase"),
    ref: z.string().regex(PROJECT_REF_PATTERN),
    role: z.literal(DISCOVERY_READER_ROLE),
    exp: unixTimestampSchema,
    nbf: unixTimestampSchema.optional(),
    iat: unixTimestampSchema,
  })
  .passthrough();

function hostedProjectRef(supabaseUrl: string | undefined) {
  if (supabaseUrl === undefined) return undefined;
  try {
    return HOSTED_PROJECT_HOST_PATTERN.exec(
      new URL(supabaseUrl.trim()).hostname,
    )?.[1];
  } catch {
    return undefined;
  }
}

function decodeCanonicalBase64UrlJson(value: string): unknown {
  if (!BASE64URL_PATTERN.test(value)) return undefined;
  const decoded = Buffer.from(value, "base64url");
  if (decoded.toString("base64url") !== value) return undefined;
  try {
    return JSON.parse(decoded.toString("utf8")) as unknown;
  } catch {
    return undefined;
  }
}

function isLegacyDiscoveryReaderJwt(
  value: string,
  supabaseUrl?: string,
  now = Date.now(),
) {
  const segments = value.split(".");
  if (segments.length !== 3) return false;
  const [encodedHeader, encodedPayload, encodedSignature] = segments;
  if (
    encodedHeader === undefined ||
    encodedPayload === undefined ||
    encodedSignature === undefined ||
    !BASE64URL_PATTERN.test(encodedSignature)
  ) {
    return false;
  }
  const signature = Buffer.from(encodedSignature, "base64url");
  if (
    signature.length !== 32 ||
    signature.toString("base64url") !== encodedSignature
  ) {
    return false;
  }
  const header = legacyJwtHeaderSchema.safeParse(
    decodeCanonicalBase64UrlJson(encodedHeader),
  );
  const payload = legacyJwtPayloadSchema.safeParse(
    decodeCanonicalBase64UrlJson(encodedPayload),
  );
  if (!header.success || !payload.success) return false;

  const nowSeconds = Math.floor(now / 1_000);
  const lifetimeSeconds = payload.data.exp - payload.data.iat;
  const expectedProjectRef = hostedProjectRef(supabaseUrl);
  return (
    payload.data.exp > nowSeconds &&
    payload.data.iat <=
      nowSeconds + LEGACY_JWT_IAT_FUTURE_SKEW_SECONDS &&
    lifetimeSeconds > 0 &&
    lifetimeSeconds <= LEGACY_JWT_MAX_LIFETIME_SECONDS &&
    (payload.data.nbf === undefined || payload.data.nbf <= nowSeconds) &&
    (payload.data.nbf === undefined || payload.data.nbf < payload.data.exp) &&
    (expectedProjectRef === undefined ||
      payload.data.ref === expectedProjectRef)
  );
}

const discoveryReaderCredentialSchema = z.string().trim().min(32).max(8_192);

export type SupabaseServerEnvironment = Readonly<{
  url: string;
  publishableKey: string;
}>;

export type SupabaseServerEnvironmentInput = Readonly<{
  [name: string]: string | undefined;
  SUPABASE_URL?: string;
  SUPABASE_PUBLISHABLE_KEY?: string;
  SUPABASE_DISCOVERY_READER_KEY?: string;
}>;

export class SupabaseServerConfigurationError extends Error {
  readonly code = "supabase_server_unconfigured";

  constructor() {
    super("Supabase server reads are not configured.");
    this.name = "SupabaseServerConfigurationError";
  }
}

/**
 * Prefer a named Supabase secret API key whose release-verified JWT template
 * contains only role=firewatch_discovery_reader. A legacy HS256 JWT is a
 * transitional Free-plan fallback: this parser only checks its unverified
 * structure, exact role, and validity window. Supabase still authenticates its
 * signature. The JWT signing secret must never enter this application.
 */
export function readSupabaseDiscoveryReaderApiKey(
  environment: SupabaseServerEnvironmentInput = processEnvironment,
) {
  const parsed = discoveryReaderCredentialSchema.safeParse(
    environment.SUPABASE_DISCOVERY_READER_KEY,
  );
  if (
    !parsed.success ||
    (!discoveryReaderSecretApiKeySchema.safeParse(parsed.data).success &&
      !isLegacyDiscoveryReaderJwt(
        parsed.data,
        environment.SUPABASE_URL,
      ))
  ) {
    throw new SupabaseServerConfigurationError();
  }
  return parsed.data;
}

/**
 * Selects the legacy transport after the credential has passed the server-only
 * boundary above. This does not authenticate the JWT; Supabase does that.
 */
export function isSupabaseDiscoveryReaderLegacyJwt(
  value: string,
  supabaseUrl?: string,
) {
  return isLegacyDiscoveryReaderJwt(value, supabaseUrl);
}

/**
 * Reads only server-scoped names. Neither value may use a NEXT_PUBLIC_ alias,
 * and the service-role key is intentionally not part of this contract.
 */
export function readSupabaseServerEnvironment(
  environment: SupabaseServerEnvironmentInput = processEnvironment,
): SupabaseServerEnvironment {
  const parsed = supabaseServerEnvironmentSchema.safeParse({
    SUPABASE_URL: environment.SUPABASE_URL,
    SUPABASE_PUBLISHABLE_KEY: environment.SUPABASE_PUBLISHABLE_KEY,
  });

  if (!parsed.success) {
    throw new SupabaseServerConfigurationError();
  }

  return Object.freeze({
    url: new URL(parsed.data.SUPABASE_URL).origin,
    publishableKey: parsed.data.SUPABASE_PUBLISHABLE_KEY,
  });
}
