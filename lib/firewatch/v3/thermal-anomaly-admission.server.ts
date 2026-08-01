import { Buffer } from "node:buffer";
import {
  createHash,
  createHmac,
  randomUUID,
  timingSafeEqual,
} from "node:crypto";
import { isIP } from "node:net";
import { env as processEnvironment } from "node:process";

import { z } from "zod";

const MAX_REDIS_RESPONSE_BYTES = 8_192;
const MAX_RETRY_AFTER_SECONDS = 3_600;
const REDIS_KEY_PREFIX = "firewatch:thermal:v3";
const VERCEL_DEPLOYMENT_HOST_PATTERN =
  /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+vercel\.app$/u;

const positiveIntegerEnvironmentSchema = z
  .string()
  .trim()
  .regex(/^[1-9]\d*$/u)
  .transform(Number)
  .pipe(z.number().int().positive().safe());

function isRedisRestUrl(value: string) {
  try {
    const url = new URL(value);
    return (
      url.protocol === "https:" &&
      url.username === "" &&
      url.password === "" &&
      (url.pathname === "/" || url.pathname === "") &&
      url.search === "" &&
      url.hash === ""
    );
  } catch {
    return false;
  }
}

const admissionEnvironmentSchema = z
  .strictObject({
    VERCEL: z.literal("1"),
    VERCEL_ENV: z.enum(["production", "preview", "development"]),
    VERCEL_URL: z
      .string()
      .trim()
      .max(253)
      .regex(VERCEL_DEPLOYMENT_HOST_PATTERN),
    VERCEL_DEPLOYMENT_ID: z
      .string()
      .trim()
      .regex(/^dpl_[A-Za-z0-9]{16,128}$/u),
    FIREWATCH_THERMAL_V3_ADMISSION_ENABLED: z.literal("true"),
    FIREWATCH_THERMAL_V3_ACCESS_MODE: z.enum(["canary", "public"]),
    FIREWATCH_THERMAL_V3_CANARY_TOKEN_SHA256: z
      .string()
      .trim()
      .regex(/^[a-f0-9]{64}$/u)
      .optional(),
    FIREWATCH_THERMAL_ADMISSION_REDIS_URL: z
      .string()
      .trim()
      .min(1)
      .max(2_048)
      .refine(isRedisRestUrl),
    FIREWATCH_THERMAL_ADMISSION_REDIS_TOKEN: z.string().trim().min(16).max(8_192),
    FIREWATCH_THERMAL_ADMISSION_IDENTITY_SECRET: z.string().min(32).max(8_192),
    FIREWATCH_THERMAL_ADMISSION_BURST_LIMIT:
      positiveIntegerEnvironmentSchema.pipe(z.number().max(10_000)),
    FIREWATCH_THERMAL_ADMISSION_BURST_WINDOW_SECONDS:
      positiveIntegerEnvironmentSchema.pipe(z.number().max(600)),
    FIREWATCH_THERMAL_ADMISSION_SUSTAINED_LIMIT:
      positiveIntegerEnvironmentSchema.pipe(z.number().max(100_000)),
    FIREWATCH_THERMAL_ADMISSION_SUSTAINED_WINDOW_SECONDS:
      positiveIntegerEnvironmentSchema.pipe(z.number().max(3_600)),
    FIREWATCH_THERMAL_ADMISSION_GLOBAL_CONCURRENCY:
      positiveIntegerEnvironmentSchema.pipe(z.number().max(1_000)),
    FIREWATCH_THERMAL_ADMISSION_LEASE_SECONDS:
      positiveIntegerEnvironmentSchema.pipe(z.number().min(12).max(30)),
    FIREWATCH_THERMAL_ADMISSION_TIMEOUT_MS:
      positiveIntegerEnvironmentSchema.pipe(z.number().min(100).max(1_000)),
  })
  .superRefine((configuration, context) => {
    if (
      configuration.FIREWATCH_THERMAL_V3_ACCESS_MODE === "canary" &&
      configuration.FIREWATCH_THERMAL_V3_CANARY_TOKEN_SHA256 === undefined
    ) {
      context.addIssue({
        code: "custom",
        message: "Canary mode requires a token digest",
        path: ["FIREWATCH_THERMAL_V3_CANARY_TOKEN_SHA256"],
      });
    }
    if (
      configuration.FIREWATCH_THERMAL_V3_ACCESS_MODE === "public" &&
      configuration.FIREWATCH_THERMAL_V3_CANARY_TOKEN_SHA256 !== undefined
    ) {
      context.addIssue({
        code: "custom",
        message: "Public mode cannot retain a canary token digest",
        path: ["FIREWATCH_THERMAL_V3_CANARY_TOKEN_SHA256"],
      });
    }
    if (
      configuration.FIREWATCH_THERMAL_ADMISSION_SUSTAINED_WINDOW_SECONDS <=
      configuration.FIREWATCH_THERMAL_ADMISSION_BURST_WINDOW_SECONDS
    ) {
      context.addIssue({
        code: "custom",
        message: "The sustained admission window must exceed the burst window",
        path: ["FIREWATCH_THERMAL_ADMISSION_SUSTAINED_WINDOW_SECONDS"],
      });
    }
    if (
      configuration.FIREWATCH_THERMAL_ADMISSION_SUSTAINED_LIMIT <
      configuration.FIREWATCH_THERMAL_ADMISSION_BURST_LIMIT
    ) {
      context.addIssue({
        code: "custom",
        message: "The sustained admission limit must cover at least one burst",
        path: ["FIREWATCH_THERMAL_ADMISSION_SUSTAINED_LIMIT"],
      });
    }
  });

const admissionReplySchema = z.tuple([
  z.union([z.literal(0), z.literal(1)]),
  z.enum(["admitted", "burst", "sustained", "capacity"]),
  z.number().int().positive().safe(),
]);
const releaseReplySchema = z.number().int().min(0).max(1);
const redisEnvelopeSchema = z.strictObject({ result: z.unknown() });

const ACQUIRE_SCRIPT = `
local now_parts = redis.call('TIME')
local now_ms = (tonumber(now_parts[1]) * 1000) + math.floor(tonumber(now_parts[2]) / 1000)

redis.call('ZREMRANGEBYSCORE', KEYS[3], '-inf', now_ms)

local burst_count = redis.call('INCR', KEYS[1])
if burst_count == 1 then
  redis.call('PEXPIRE', KEYS[1], ARGV[2])
end

local sustained_count = redis.call('INCR', KEYS[2])
if sustained_count == 1 then
  redis.call('PEXPIRE', KEYS[2], ARGV[4])
end

if burst_count > tonumber(ARGV[1]) then
  return {0, 'burst', math.max(redis.call('PTTL', KEYS[1]), 1000)}
end

if sustained_count > tonumber(ARGV[3]) then
  return {0, 'sustained', math.max(redis.call('PTTL', KEYS[2]), 1000)}
end

if redis.call('ZCARD', KEYS[3]) >= tonumber(ARGV[5]) then
  local earliest = redis.call('ZRANGE', KEYS[3], 0, 0, 'WITHSCORES')
  local retry_ms = 1000
  if earliest[2] ~= nil then
    retry_ms = math.max(tonumber(earliest[2]) - now_ms, 1000)
  end
  return {0, 'capacity', retry_ms}
end

redis.call('ZADD', KEYS[3], now_ms + tonumber(ARGV[6]), ARGV[7])
redis.call('PEXPIRE', KEYS[3], tonumber(ARGV[6]) * 2)
return {1, 'admitted', tonumber(ARGV[6])}
`;

const RELEASE_SCRIPT = `
return redis.call('ZREM', KEYS[1], ARGV[1])
`;

export type ThermalAdmissionEnvironmentInput = Readonly<{
  [name: string]: string | undefined;
  VERCEL?: string;
  VERCEL_ENV?: string;
  VERCEL_URL?: string;
  VERCEL_DEPLOYMENT_ID?: string;
  FIREWATCH_THERMAL_V3_ADMISSION_ENABLED?: string;
  FIREWATCH_THERMAL_V3_ACCESS_MODE?: string;
  FIREWATCH_THERMAL_V3_CANARY_TOKEN_SHA256?: string;
  FIREWATCH_THERMAL_ADMISSION_REDIS_URL?: string;
  FIREWATCH_THERMAL_ADMISSION_REDIS_TOKEN?: string;
  FIREWATCH_THERMAL_ADMISSION_REDIS_KV_REST_API_URL?: string;
  FIREWATCH_THERMAL_ADMISSION_REDIS_KV_REST_API_TOKEN?: string;
  FIREWATCH_THERMAL_ADMISSION_REDIS_KV_REST_API_READ_ONLY_TOKEN?: string;
  FIREWATCH_THERMAL_ADMISSION_REDIS_KV_URL?: string;
  FIREWATCH_THERMAL_ADMISSION_REDIS_REDIS_URL?: string;
  FIREWATCH_THERMAL_ADMISSION_IDENTITY_SECRET?: string;
  FIREWATCH_THERMAL_ADMISSION_BURST_LIMIT?: string;
  FIREWATCH_THERMAL_ADMISSION_BURST_WINDOW_SECONDS?: string;
  FIREWATCH_THERMAL_ADMISSION_SUSTAINED_LIMIT?: string;
  FIREWATCH_THERMAL_ADMISSION_SUSTAINED_WINDOW_SECONDS?: string;
  FIREWATCH_THERMAL_ADMISSION_GLOBAL_CONCURRENCY?: string;
  FIREWATCH_THERMAL_ADMISSION_LEASE_SECONDS?: string;
  FIREWATCH_THERMAL_ADMISSION_TIMEOUT_MS?: string;
}>;

export type ThermalAdmissionRejectionReason =
  | "burst"
  | "sustained"
  | "capacity";

export type ThermalAdmissionLease = Readonly<{
  release: () => Promise<void>;
}>;

export type ThermalAdmissionDecision =
  | Readonly<{ kind: "admitted"; lease: ThermalAdmissionLease }>
  | Readonly<{
      kind: "rejected";
      reason: ThermalAdmissionRejectionReason;
      retryAfterSeconds: number;
    }>;

export type ThermalAdmissionOptions = Readonly<{
  environment?: ThermalAdmissionEnvironmentInput;
  fetchImpl?: typeof fetch;
  createLeaseToken?: () => string;
}>;

export class ThermalAdmissionUnavailableError extends Error {
  readonly code = "thermal_admission_unavailable";

  constructor() {
    super("Thermal anomaly admission is unavailable.");
    this.name = "ThermalAdmissionUnavailableError";
  }
}

function unavailable(): never {
  throw new ThermalAdmissionUnavailableError();
}

function configuredValue(value: string | undefined) {
  const normalized = value?.trim();
  return normalized === undefined || normalized.length === 0
    ? undefined
    : normalized;
}

function resolveRedisRestUrl(environment: ThermalAdmissionEnvironmentInput) {
  const canonical = configuredValue(
    environment.FIREWATCH_THERMAL_ADMISSION_REDIS_URL,
  );
  const upstash = configuredValue(
    environment.FIREWATCH_THERMAL_ADMISSION_REDIS_KV_REST_API_URL,
  );
  if (canonical !== undefined && upstash !== undefined) {
    if (!isRedisRestUrl(canonical) || !isRedisRestUrl(upstash)) {
      return unavailable();
    }
    if (new URL(canonical).origin !== new URL(upstash).origin) {
      return unavailable();
    }
  }
  return canonical ?? upstash;
}

function resolveRedisWriteToken(
  environment: ThermalAdmissionEnvironmentInput,
) {
  const canonical = configuredValue(
    environment.FIREWATCH_THERMAL_ADMISSION_REDIS_TOKEN,
  );
  const upstash = configuredValue(
    environment.FIREWATCH_THERMAL_ADMISSION_REDIS_KV_REST_API_TOKEN,
  );
  if (
    canonical !== undefined &&
    upstash !== undefined &&
    canonical !== upstash
  ) {
    return unavailable();
  }
  return canonical ?? upstash;
}

function readConfiguration(
  environment: ThermalAdmissionEnvironmentInput = processEnvironment,
) {
  const parsed = admissionEnvironmentSchema.safeParse({
    VERCEL: environment.VERCEL,
    VERCEL_ENV: environment.VERCEL_ENV,
    VERCEL_URL: environment.VERCEL_URL,
    VERCEL_DEPLOYMENT_ID: environment.VERCEL_DEPLOYMENT_ID,
    FIREWATCH_THERMAL_V3_ADMISSION_ENABLED:
      environment.FIREWATCH_THERMAL_V3_ADMISSION_ENABLED,
    FIREWATCH_THERMAL_V3_ACCESS_MODE:
      environment.FIREWATCH_THERMAL_V3_ACCESS_MODE,
    FIREWATCH_THERMAL_V3_CANARY_TOKEN_SHA256:
      environment.FIREWATCH_THERMAL_V3_CANARY_TOKEN_SHA256,
    FIREWATCH_THERMAL_ADMISSION_REDIS_URL:
      resolveRedisRestUrl(environment),
    FIREWATCH_THERMAL_ADMISSION_REDIS_TOKEN:
      resolveRedisWriteToken(environment),
    FIREWATCH_THERMAL_ADMISSION_IDENTITY_SECRET:
      environment.FIREWATCH_THERMAL_ADMISSION_IDENTITY_SECRET,
    FIREWATCH_THERMAL_ADMISSION_BURST_LIMIT:
      environment.FIREWATCH_THERMAL_ADMISSION_BURST_LIMIT,
    FIREWATCH_THERMAL_ADMISSION_BURST_WINDOW_SECONDS:
      environment.FIREWATCH_THERMAL_ADMISSION_BURST_WINDOW_SECONDS,
    FIREWATCH_THERMAL_ADMISSION_SUSTAINED_LIMIT:
      environment.FIREWATCH_THERMAL_ADMISSION_SUSTAINED_LIMIT,
    FIREWATCH_THERMAL_ADMISSION_SUSTAINED_WINDOW_SECONDS:
      environment.FIREWATCH_THERMAL_ADMISSION_SUSTAINED_WINDOW_SECONDS,
    FIREWATCH_THERMAL_ADMISSION_GLOBAL_CONCURRENCY:
      environment.FIREWATCH_THERMAL_ADMISSION_GLOBAL_CONCURRENCY,
    FIREWATCH_THERMAL_ADMISSION_LEASE_SECONDS:
      environment.FIREWATCH_THERMAL_ADMISSION_LEASE_SECONDS,
    FIREWATCH_THERMAL_ADMISSION_TIMEOUT_MS:
      environment.FIREWATCH_THERMAL_ADMISSION_TIMEOUT_MS,
  });
  if (!parsed.success) return unavailable();

  return Object.freeze({
    deploymentEnvironment: parsed.data.VERCEL_ENV,
    accessMode: parsed.data.FIREWATCH_THERMAL_V3_ACCESS_MODE,
    canaryTokenSha256:
      parsed.data.FIREWATCH_THERMAL_V3_CANARY_TOKEN_SHA256 ?? null,
    redisUrl: new URL(parsed.data.FIREWATCH_THERMAL_ADMISSION_REDIS_URL).origin,
    redisToken: parsed.data.FIREWATCH_THERMAL_ADMISSION_REDIS_TOKEN,
    identitySecret: parsed.data.FIREWATCH_THERMAL_ADMISSION_IDENTITY_SECRET,
    burstLimit: parsed.data.FIREWATCH_THERMAL_ADMISSION_BURST_LIMIT,
    burstWindowMs:
      parsed.data.FIREWATCH_THERMAL_ADMISSION_BURST_WINDOW_SECONDS * 1_000,
    sustainedLimit: parsed.data.FIREWATCH_THERMAL_ADMISSION_SUSTAINED_LIMIT,
    sustainedWindowMs:
      parsed.data.FIREWATCH_THERMAL_ADMISSION_SUSTAINED_WINDOW_SECONDS * 1_000,
    globalConcurrency:
      parsed.data.FIREWATCH_THERMAL_ADMISSION_GLOBAL_CONCURRENCY,
    leaseMs: parsed.data.FIREWATCH_THERMAL_ADMISSION_LEASE_SECONDS * 1_000,
    timeoutMs: parsed.data.FIREWATCH_THERMAL_ADMISSION_TIMEOUT_MS,
  });
}

function trustedVercelClientIp(request: Request) {
  const forwardedFor = request.headers.get("x-forwarded-for")?.trim();
  const vercelForwardedFor = request.headers
    .get("x-vercel-forwarded-for")
    ?.trim();
  const realIp = request.headers.get("x-real-ip")?.trim();
  if (
    forwardedFor === undefined ||
    vercelForwardedFor === undefined ||
    realIp === undefined ||
    forwardedFor.length === 0 ||
    forwardedFor.length > 64 ||
    forwardedFor.includes(",") ||
    forwardedFor !== vercelForwardedFor ||
    forwardedFor !== realIp ||
    isIP(forwardedFor) === 0
  ) {
    return unavailable();
  }
  return forwardedFor;
}

function ipv6Words(address: string) {
  let canonical: string;
  try {
    const hostname = new URL(`http://[${address}]/`).hostname;
    canonical = hostname.slice(1, -1);
  } catch {
    return unavailable();
  }
  const halves = canonical.split("::");
  if (halves.length > 2) return unavailable();
  const left = halves[0] === "" ? [] : halves[0]?.split(":") ?? [];
  const right = halves.length === 1 || halves[1] === ""
    ? []
    : halves[1]?.split(":") ?? [];
  const missing = 8 - left.length - right.length;
  if (
    missing < 0 ||
    (halves.length === 1 && missing !== 0) ||
    (halves.length === 2 && missing < 1)
  ) {
    return unavailable();
  }
  const words = [
    ...left,
    ...Array.from({ length: missing }, () => "0"),
    ...right,
  ].map((part) => Number.parseInt(part, 16));
  if (
    words.length !== 8 ||
    words.some((word) => !Number.isInteger(word) || word < 0 || word > 0xffff)
  ) {
    return unavailable();
  }
  return words;
}

function clientRateIdentity(address: string) {
  const version = isIP(address);
  if (version === 4) {
    return `ipv4:${address.split(".").map(Number).join(".")}`;
  }
  if (version !== 6) return unavailable();
  const words = ipv6Words(address);
  if (
    words.slice(0, 5).every((word) => word === 0) &&
    words[5] === 0xffff
  ) {
    const high = words[6] as number;
    const low = words[7] as number;
    return `ipv4:${[
      high >>> 8,
      high & 0xff,
      low >>> 8,
      low & 0xff,
    ].join(".")}`;
  }
  return `ipv6-64:${words
    .slice(0, 4)
    .map((word) => word.toString(16).padStart(4, "0"))
    .join(":")}`;
}

function verifyAccessMode(
  request: Request,
  configuration: ReturnType<typeof readConfiguration>,
) {
  if (configuration.accessMode === "public") return;
  if (configuration.canaryTokenSha256 === null) return unavailable();
  const authorization = request.headers.get("authorization");
  const match = /^Bearer ([A-Za-z0-9_-]{43,128})$/u.exec(
    authorization ?? "",
  );
  if (match?.[1] === undefined) return unavailable();
  const suppliedDigest = createHash("sha256")
    .update(match[1], "ascii")
    .digest();
  const expectedDigest = Buffer.from(
    configuration.canaryTokenSha256,
    "hex",
  );
  if (
    suppliedDigest.length !== expectedDigest.length ||
    !timingSafeEqual(suppliedDigest, expectedDigest)
  ) {
    return unavailable();
  }
}

async function readBoundedRedisEnvelope(
  response: Response,
  timeoutController: AbortController,
) {
  const contentType = response.headers.get("content-type")?.toLowerCase();
  if (contentType === undefined || !contentType.includes("application/json")) {
    return unavailable();
  }
  const declaredBytes = Number(response.headers.get("content-length"));
  if (
    Number.isFinite(declaredBytes) &&
    declaredBytes > MAX_REDIS_RESPONSE_BYTES
  ) {
    return unavailable();
  }
  let body: string;
  if (response.body === null) {
    body = await response.text();
    if (Buffer.byteLength(body, "utf8") > MAX_REDIS_RESPONSE_BYTES) {
      return unavailable();
    }
  } else {
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let receivedBytes = 0;
    try {
      while (true) {
        const chunk = await reader.read();
        if (chunk.done) break;
        receivedBytes += chunk.value.byteLength;
        if (receivedBytes > MAX_REDIS_RESPONSE_BYTES) {
          await reader.cancel();
          return unavailable();
        }
        chunks.push(chunk.value);
      }
    } finally {
      reader.releaseLock();
    }
    body = Buffer.concat(chunks, receivedBytes).toString("utf8");
  }
  if (timeoutController.signal.aborted) return unavailable();
  let decoded: unknown;
  try {
    decoded = JSON.parse(body);
  } catch {
    return unavailable();
  }
  const parsed = redisEnvelopeSchema.safeParse(decoded);
  if (!response.ok || !parsed.success) return unavailable();
  return parsed.data.result;
}

async function executeRedis(
  configuration: ReturnType<typeof readConfiguration>,
  command: readonly unknown[],
  fetchImpl: typeof fetch,
) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), configuration.timeoutMs);
  try {
    const response = await fetchImpl(configuration.redisUrl, {
      method: "POST",
      cache: "no-store",
      redirect: "error",
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${configuration.redisToken}`,
        "Content-Type": "application/json; charset=utf-8",
      },
      body: JSON.stringify(command),
      signal: controller.signal,
    });
    return await readBoundedRedisEnvelope(response, controller);
  } catch (error) {
    if (error instanceof ThermalAdmissionUnavailableError) throw error;
    return unavailable();
  } finally {
    clearTimeout(timeout);
  }
}

function clampRetryAfter(milliseconds: number) {
  return Math.min(
    MAX_RETRY_AFTER_SECONDS,
    Math.max(1, Math.ceil(milliseconds / 1_000)),
  );
}

/**
 * Acquires one distributed lease before the Supabase RPC. Missing or malformed
 * platform identity, configuration, Redis responses, and timeouts all fail
 * closed. The Redis script atomically applies two per-client windows and one
 * global in-flight ceiling across Vercel instances.
 */
export async function admitThermalAnomalyRequest(
  request: Request,
  options: ThermalAdmissionOptions = {},
): Promise<ThermalAdmissionDecision> {
  const configuration = readConfiguration(options.environment);
  const clientIp = trustedVercelClientIp(request);
  verifyAccessMode(request, configuration);
  const rateIdentity = clientRateIdentity(clientIp);
  const clientKey = createHmac("sha256", configuration.identitySecret)
    .update(rateIdentity, "utf8")
    .digest("hex");
  const leaseToken = (options.createLeaseToken ?? randomUUID)();
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u.test(leaseToken)) {
    return unavailable();
  }

  const prefix = `${REDIS_KEY_PREFIX}:${configuration.deploymentEnvironment}`;
  const burstKey = `${prefix}:burst:${clientKey}`;
  const sustainedKey = `${prefix}:sustained:${clientKey}`;
  const concurrencyKey = `${prefix}:leases`;
  const fetchImpl = options.fetchImpl ?? fetch;
  const reply = admissionReplySchema.safeParse(
    await executeRedis(
      configuration,
      [
        "EVAL",
        ACQUIRE_SCRIPT,
        "3",
        burstKey,
        sustainedKey,
        concurrencyKey,
        String(configuration.burstLimit),
        String(configuration.burstWindowMs),
        String(configuration.sustainedLimit),
        String(configuration.sustainedWindowMs),
        String(configuration.globalConcurrency),
        String(configuration.leaseMs),
        leaseToken,
      ],
      fetchImpl,
    ),
  );
  if (!reply.success) return unavailable();
  const [allowed, reason, retryMilliseconds] = reply.data;
  if (allowed === 0) {
    if (reason === "admitted") return unavailable();
    return Object.freeze({
      kind: "rejected" as const,
      reason,
      retryAfterSeconds: clampRetryAfter(retryMilliseconds),
    });
  }
  if (
    reason !== "admitted" ||
    retryMilliseconds !== configuration.leaseMs
  ) {
    return unavailable();
  }

  let released = false;
  return Object.freeze({
    kind: "admitted" as const,
    lease: Object.freeze({
      async release() {
        if (released) return;
        released = true;
        const release = releaseReplySchema.safeParse(
          await executeRedis(
            configuration,
            ["EVAL", RELEASE_SCRIPT, "1", concurrencyKey, leaseToken],
            fetchImpl,
          ),
        );
        if (!release.success || release.data !== 1) return unavailable();
      },
    }),
  });
}

export const thermalAdmissionBounds = Object.freeze({
  maximumRetryAfterSeconds: MAX_RETRY_AFTER_SECONDS,
  maximumRedisResponseBytes: MAX_REDIS_RESPONSE_BYTES,
});
