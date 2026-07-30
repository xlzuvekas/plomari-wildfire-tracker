import { z } from "zod";

import {
  oodaEvidenceBundleSchema,
  orientationOutputJsonSchema,
  validateOrientationOutput,
  type OodaEvidenceBundle,
  type OrientationOutput,
} from "./contracts";
import {
  buildOrientationPrompt,
  OODA_PROMPT_RELEASE,
  OODA_SYSTEM_PROMPT,
} from "./prompt";
import {
  OPENROUTER_FREE_MODEL,
  type OpenRouterOodaConfiguration,
} from "./server-env";

const OPENROUTER_COMPLETIONS_URL =
  "https://openrouter.ai/api/v1/chat/completions";

const openRouterResponseSchema = z.object({
  id: z.string().min(1).max(512),
  model: z.string().min(1).max(256),
  provider: z.string().min(1).max(160).optional(),
  choices: z
    .array(
      z.object({
        message: z.object({
          content: z.string().min(1),
          role: z.string().optional(),
          refusal: z.string().nullable().optional(),
        }),
        error: z.unknown().optional(),
        finish_reason: z.string().nullable(),
        native_finish_reason: z.string().nullable().optional(),
        index: z.number().int().nonnegative(),
      }),
    )
    .length(1),
  usage: z
    .object({
      prompt_tokens: z.number().int().nonnegative(),
      completion_tokens: z.number().int().nonnegative(),
      total_tokens: z.number().int().nonnegative(),
      cost: z.number().finite().nonnegative().optional(),
    })
    .optional(),
});

export type OodaAdapterErrorCode =
  | "disabled"
  | "invalid_input"
  | "input_too_large"
  | "timeout"
  | "authentication"
  | "credit_exhausted"
  | "rate_limited"
  | "policy_rejected"
  | "upstream_unavailable"
  | "invalid_response"
  | "response_too_large";

export class OodaAdapterError extends Error {
  readonly retryable: boolean;
  readonly status: number | null;

  constructor(
    readonly code: OodaAdapterErrorCode,
    options: { retryable?: boolean; status?: number | null } = {},
  ) {
    super("The AI orientation request could not be completed safely.");
    this.name = "OodaAdapterError";
    this.retryable = options.retryable ?? false;
    this.status = options.status ?? null;
  }
}

export type OrientationGeneration = Readonly<{
  output: OrientationOutput;
  generationId: string;
  responseId: string;
  model: string;
  provider: string | null;
  finishReason: string | null;
  promptTokens: number | null;
  completionTokens: number | null;
  totalTokens: number | null;
  reportedCostUsd: number | null;
  promptRelease: typeof OODA_PROMPT_RELEASE;
}>;

async function readBoundedResponse(response: Response, maximumBytes: number) {
  const announcedLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(announcedLength) && announcedLength > maximumBytes) {
    throw new OodaAdapterError("response_too_large");
  }

  if (!response.body) return "";
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let totalBytes = 0;
  let text = "";

  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      totalBytes += chunk.value.byteLength;
      if (totalBytes > maximumBytes) {
        await reader.cancel();
        throw new OodaAdapterError("response_too_large");
      }
      text += decoder.decode(chunk.value, { stream: true });
    }
    text += decoder.decode();
    return text;
  } finally {
    reader.releaseLock();
  }
}

function upstreamError(status: number) {
  if (status === 401 || status === 403) {
    return new OodaAdapterError(
      status === 401 ? "authentication" : "policy_rejected",
      { status },
    );
  }
  if (status === 402) {
    return new OodaAdapterError("credit_exhausted", { status });
  }
  if (status === 408) {
    return new OodaAdapterError("timeout", { retryable: true, status });
  }
  if (status === 429) {
    return new OodaAdapterError("rate_limited", { retryable: true, status });
  }
  if ([500, 502, 503, 504].includes(status)) {
    return new OodaAdapterError("upstream_unavailable", {
      retryable: true,
      status,
    });
  }
  return new OodaAdapterError("invalid_response", { status });
}

export async function requestOrientation(options: {
  bundle: OodaEvidenceBundle;
  configuration: OpenRouterOodaConfiguration;
  fetchImpl?: typeof fetch;
  signal?: AbortSignal;
}): Promise<OrientationGeneration> {
  if (!options.configuration.enabled) throw new OodaAdapterError("disabled");
  if (options.configuration.model !== OPENROUTER_FREE_MODEL) {
    throw new OodaAdapterError("policy_rejected");
  }

  const parsedBundle = oodaEvidenceBundleSchema.safeParse(options.bundle);
  if (!parsedBundle.success) throw new OodaAdapterError("invalid_input");

  const prompt = buildOrientationPrompt(parsedBundle.data);
  const inputBytes = new TextEncoder().encode(
    `${OODA_SYSTEM_PROMPT}\n${prompt}`,
  ).byteLength;
  if (inputBytes > options.configuration.maxInputBytes) {
    throw new OodaAdapterError("input_too_large");
  }

  const controller = new AbortController();
  const onExternalAbort = () => controller.abort(options.signal?.reason);
  options.signal?.addEventListener("abort", onExternalAbort, { once: true });
  const timeout = setTimeout(
    () => controller.abort(new DOMException("Timed out", "TimeoutError")),
    options.configuration.timeoutMs,
  );

  try {
    const headers = new Headers({
      accept: "application/json",
      authorization: `Bearer ${options.configuration.apiKey}`,
      "content-type": "application/json",
      "x-openrouter-title": "Firewatch orientation",
    });
    if (options.configuration.siteUrl) {
      headers.set("http-referer", options.configuration.siteUrl);
    }

    const response = await (options.fetchImpl ?? fetch)(
      OPENROUTER_COMPLETIONS_URL,
      {
        method: "POST",
        cache: "no-store",
        signal: controller.signal,
        headers,
        body: JSON.stringify({
          model: OPENROUTER_FREE_MODEL,
          messages: [
            { role: "system", content: OODA_SYSTEM_PROMPT },
            { role: "user", content: prompt },
          ],
          stream: false,
          temperature: 0,
          max_completion_tokens: options.configuration.maxCompletionTokens,
          response_format: {
            type: "json_schema",
            json_schema: {
              name: "firewatch_orientation",
              strict: true,
              schema: orientationOutputJsonSchema,
            },
          },
          provider: {
            only: options.configuration.providers,
            allow_fallbacks: true,
            require_parameters: true,
            data_collection: "deny",
            zdr: true,
          },
        }),
      },
    );

    const responseText = await readBoundedResponse(
      response,
      options.configuration.maxResponseBytes,
    );
    if (!response.ok) throw upstreamError(response.status);

    let responseJson: unknown;
    try {
      responseJson = JSON.parse(responseText);
    } catch {
      throw new OodaAdapterError("invalid_response");
    }
    const parsedResponse = openRouterResponseSchema.safeParse(responseJson);
    if (!parsedResponse.success) throw new OodaAdapterError("invalid_response");
    if (
      !parsedResponse.data.model.endsWith(":free") ||
      (parsedResponse.data.usage?.cost !== undefined &&
        parsedResponse.data.usage.cost !== 0)
    ) {
      throw new OodaAdapterError("invalid_response");
    }

    const choice = parsedResponse.data.choices[0];
    if (!choice) throw new OodaAdapterError("invalid_response");
    if (
      choice.error !== undefined ||
      Boolean(choice.message.refusal) ||
      choice.finish_reason !== "stop"
    ) {
      throw new OodaAdapterError("invalid_response");
    }

    let candidate: unknown;
    try {
      candidate = JSON.parse(choice.message.content);
    } catch {
      throw new OodaAdapterError("invalid_response");
    }

    let output: OrientationOutput;
    try {
      output = validateOrientationOutput(candidate, parsedBundle.data);
    } catch {
      throw new OodaAdapterError("invalid_response");
    }

    return Object.freeze({
      output,
      generationId:
        response.headers.get("x-generation-id") ?? parsedResponse.data.id,
      responseId: parsedResponse.data.id,
      model: parsedResponse.data.model,
      provider: parsedResponse.data.provider ?? null,
      finishReason: choice.finish_reason,
      promptTokens: parsedResponse.data.usage?.prompt_tokens ?? null,
      completionTokens: parsedResponse.data.usage?.completion_tokens ?? null,
      totalTokens: parsedResponse.data.usage?.total_tokens ?? null,
      reportedCostUsd: parsedResponse.data.usage?.cost ?? null,
      promptRelease: OODA_PROMPT_RELEASE,
    });
  } catch (error) {
    if (error instanceof OodaAdapterError) throw error;
    if (controller.signal.aborted) {
      throw new OodaAdapterError("timeout", { retryable: true });
    }
    throw new OodaAdapterError("upstream_unavailable", { retryable: true });
  } finally {
    clearTimeout(timeout);
    options.signal?.removeEventListener("abort", onExternalAbort);
  }
}
