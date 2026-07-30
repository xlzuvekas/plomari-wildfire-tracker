import { env as processEnvironment } from "node:process";

import { z } from "zod";

const providerSlugSchema = z
  .string()
  .trim()
  .regex(/^[a-z0-9][a-z0-9._-]{0,79}$/u);

export const OPENROUTER_FREE_MODEL = "openrouter/free" as const;

const strictBoolean = z.enum(["true", "false"]);

function numericEnvironment(
  minimum: number,
  maximum: number,
  integer = false,
) {
  return z
    .string()
    .trim()
    .regex(/^\d+(?:\.\d+)?$/u)
    .transform(Number)
    .pipe(
      integer
        ? z.number().int().min(minimum).max(maximum)
        : z.number().finite().min(minimum).max(maximum),
    );
}

const optionalHttpsUrl = z
  .string()
  .trim()
  .max(2_048)
  .refine((value) => {
    if (value === "") return true;
    try {
      const url = new URL(value);
      return (
        url.protocol === "https:" &&
        url.username === "" &&
        url.password === "" &&
        url.hash === ""
      );
    } catch {
      return false;
    }
  });

const enabledEnvironmentSchema = z.strictObject({
  OPENROUTER_API_KEY: z.string().trim().min(24).max(8_192),
  OPENROUTER_OODA_PROVIDER_ALLOWLIST: z
    .string()
    .trim()
    .min(1)
    .max(1_024)
    .transform((value, context) => {
      const providers = value
        .split(",")
        .map((provider) => provider.trim())
        .filter(Boolean);
      const parsed = z.array(providerSlugSchema).min(1).max(12).safeParse(providers);
      if (!parsed.success || new Set(providers).size !== providers.length) {
        context.addIssue({ code: "custom", message: "Invalid provider allowlist" });
        return z.NEVER;
      }
      return parsed.data;
    }),
  OPENROUTER_OODA_TIMEOUT_MS: numericEnvironment(1_000, 30_000, true),
  OPENROUTER_OODA_MAX_INPUT_BYTES: numericEnvironment(4_096, 131_072, true),
  OPENROUTER_OODA_MAX_RESPONSE_BYTES: numericEnvironment(4_096, 262_144, true),
  OPENROUTER_OODA_MAX_COMPLETION_TOKENS: numericEnvironment(128, 2_000, true),
  OPENROUTER_SITE_URL: optionalHttpsUrl,
});

export type OpenRouterOodaEnvironmentInput = Readonly<{
  [name: string]: string | undefined;
}>;

export type OpenRouterOodaConfiguration =
  | Readonly<{ enabled: false }>
  | Readonly<{
      enabled: true;
      apiKey: string;
      model: typeof OPENROUTER_FREE_MODEL;
      providers: readonly string[];
      timeoutMs: number;
      maxInputBytes: number;
      maxResponseBytes: number;
      maxCompletionTokens: number;
      siteUrl: string | null;
    }>;

export class OpenRouterOodaConfigurationError extends Error {
  readonly code = "openrouter_ooda_unconfigured";

  constructor() {
    super("OpenRouter OODA is not safely configured.");
    this.name = "OpenRouterOodaConfigurationError";
  }
}

export function readOpenRouterOodaEnvironment(
  environment: OpenRouterOodaEnvironmentInput = processEnvironment,
): OpenRouterOodaConfiguration {
  const enabled = strictBoolean.safeParse(
    environment.OPENROUTER_OODA_ENABLED ?? "false",
  );
  if (!enabled.success) throw new OpenRouterOodaConfigurationError();
  if (enabled.data === "false") return Object.freeze({ enabled: false });

  const parsed = enabledEnvironmentSchema.safeParse({
    OPENROUTER_API_KEY: environment.OPENROUTER_API_KEY,
    OPENROUTER_OODA_PROVIDER_ALLOWLIST:
      environment.OPENROUTER_OODA_PROVIDER_ALLOWLIST,
    OPENROUTER_OODA_TIMEOUT_MS:
      environment.OPENROUTER_OODA_TIMEOUT_MS ?? "15000",
    OPENROUTER_OODA_MAX_INPUT_BYTES:
      environment.OPENROUTER_OODA_MAX_INPUT_BYTES ?? "65536",
    OPENROUTER_OODA_MAX_RESPONSE_BYTES:
      environment.OPENROUTER_OODA_MAX_RESPONSE_BYTES ?? "131072",
    OPENROUTER_OODA_MAX_COMPLETION_TOKENS:
      environment.OPENROUTER_OODA_MAX_COMPLETION_TOKENS ?? "800",
    OPENROUTER_SITE_URL: environment.OPENROUTER_SITE_URL ?? "",
  });

  if (!parsed.success) throw new OpenRouterOodaConfigurationError();

  return Object.freeze({
    enabled: true,
    apiKey: parsed.data.OPENROUTER_API_KEY,
    model: OPENROUTER_FREE_MODEL,
    providers: Object.freeze([
      ...parsed.data.OPENROUTER_OODA_PROVIDER_ALLOWLIST,
    ]),
    timeoutMs: parsed.data.OPENROUTER_OODA_TIMEOUT_MS,
    maxInputBytes: parsed.data.OPENROUTER_OODA_MAX_INPUT_BYTES,
    maxResponseBytes: parsed.data.OPENROUTER_OODA_MAX_RESPONSE_BYTES,
    maxCompletionTokens: parsed.data.OPENROUTER_OODA_MAX_COMPLETION_TOKENS,
    siteUrl: parsed.data.OPENROUTER_SITE_URL || null,
  });
}
