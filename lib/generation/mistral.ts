import {
  MISTRAL_API_KEY_ENV_VAR,
  MISTRAL_MODEL_ENV_VAR,
  MISTRAL_DEFAULT_MODEL,
  MISTRAL_TEMPERATURE,
  MISTRAL_MAX_OUTPUT_TOKENS,
  MISTRAL_TIMEOUT_MS,
  MISTRAL_ENDPOINT,
  MISTRAL_MAX_RETRIES,
  MISTRAL_RETRYABLE_STATUS_CODES,
} from "../../config/mistral";
import type { GenerationContext } from "./prompt";

export class MistralConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MistralConfigurationError";
  }
}

export class MistralApiError extends Error {
  readonly status: number | null;
  constructor(message: string, status: number | null = null) {
    super(message);
    this.name = "MistralApiError";
    this.status = status;
  }
}

export class MistralTimeoutError extends MistralApiError {
  constructor(message: string) {
    super(message);
    this.name = "MistralTimeoutError";
  }
}

export class MistralMalformedResponseError extends MistralApiError {
  constructor(message: string) {
    super(message);
    this.name = "MistralMalformedResponseError";
  }
}

export interface MistralConfig {
  apiKey: string;
  model: string;
  temperature: number;
  maxOutputTokens: number;
  timeoutMs: number;
  maxRetries: number;
  endpoint: string;
}

export function resolveMistralConfig(
  env: Record<string, string | undefined> = process.env
): MistralConfig {
  const apiKey = env[MISTRAL_API_KEY_ENV_VAR];
  if (!apiKey || apiKey.trim() === "") {
    throw new MistralConfigurationError(
      `Missing required environment variable ${MISTRAL_API_KEY_ENV_VAR}. ` +
        `Set it in .env.local to use Mistral.`
    );
  }

  const model = env[MISTRAL_MODEL_ENV_VAR]?.trim() || MISTRAL_DEFAULT_MODEL;

  return {
    apiKey: apiKey.trim(),
    model,
    temperature: MISTRAL_TEMPERATURE,
    maxOutputTokens: MISTRAL_MAX_OUTPUT_TOKENS,
    timeoutMs: MISTRAL_TIMEOUT_MS,
    maxRetries: MISTRAL_MAX_RETRIES,
    endpoint: MISTRAL_ENDPOINT,
  };
}

export interface MistralChatResponse {
  content: string;
}

export type MistralRequestFn = (
  config: MistralConfig,
  messages: Array<{ role: "system" | "user"; content: string }>
) => Promise<MistralChatResponse>;

export async function fetchMistralCompletion(
  config: MistralConfig,
  messages: Array<{ role: "system" | "user"; content: string }>
): Promise<MistralChatResponse> {
  const attempt = async (): Promise<Response> => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), config.timeoutMs);

    try {
      return await fetch(config.endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${config.apiKey}`,
        },
        body: JSON.stringify({
          model: config.model,
          messages,
          temperature: config.temperature,
          max_tokens: config.maxOutputTokens,
        }),
        signal: controller.signal,
      } as RequestInit);
    } finally {
      clearTimeout(timeout);
    }
  };

  let lastError: Error | null = null;
  const attempts = Math.max(1, config.maxRetries + 1);

  for (let attemptNumber = 0; attemptNumber < attempts; attemptNumber += 1) {
    let response: Response;
    try {
      response = await attempt();
    } catch (error) {
      if (
        error instanceof Error &&
        (error.name === "AbortError" ||
          (typeof error === "object" &&
            error !== null &&
            "name" in error &&
            (error as { name?: string }).name === "AbortError"))
      ) {
        throw new MistralTimeoutError(
          `Mistral request timed out after ${config.timeoutMs}ms`
        );
      }
      lastError = error instanceof Error ? error : new Error(String(error));
      if (attemptNumber < attempts - 1) {
        continue;
      }
      break;
    }

    if (response.ok) {
      let body: unknown;
      try {
        body = await response.json();
      } catch {
        throw new MistralMalformedResponseError(
          "Mistral returned a non-JSON response"
        );
      }
      return parseCompletion(body);
    }

    const status = response.status;
    if (MISTRAL_RETRYABLE_STATUS_CODES.has(status) && attemptNumber < attempts - 1) {
      continue;
    }
    throw new MistralApiError(
      `Mistral API request failed with HTTP ${status}`,
      status
    );
  }

  throw new MistralApiError(
    `Mistral request failed: ${lastError ? lastError.message : "unknown error"}`
  );
}

export function parseCompletion(body: unknown): MistralChatResponse {
  if (typeof body !== "object" || body === null) {
    throw new MistralMalformedResponseError(
      "Mistral returned an unexpected response structure"
    );
  }

  const choices = (body as { choices?: unknown }).choices;
  if (!Array.isArray(choices) || choices.length === 0) {
    throw new MistralMalformedResponseError(
      "Mistral returned no choices in the response"
    );
  }

  const firstChoice = choices[0];
  if (typeof firstChoice !== "object" || firstChoice === null) {
    throw new MistralMalformedResponseError(
      "Mistral returned an invalid first choice"
    );
  }

  const message = (firstChoice as { message?: unknown }).message;
  if (typeof message !== "object" || message === null) {
    throw new MistralMalformedResponseError(
      "Mistral returned no message field"
    );
  }

  const content = (message as { content?: unknown }).content;
  if (typeof content !== "string") {
    throw new MistralMalformedResponseError(
      "Mistral returned a non-string content field"
    );
  }

  const trimmed = content.trim();
  if (trimmed.length === 0) {
    throw new MistralMalformedResponseError(
      "Mistral returned an empty response"
    );
  }

  return { content: trimmed };
}

export interface MistralClient {
  generate(context: GenerationContext): Promise<MistralChatResponse>;
}

export function createMistralClient(
  config: MistralConfig,
  requestFn: MistralRequestFn = fetchMistralCompletion
): MistralClient {
  return {
    async generate(messages: GenerationContext): Promise<MistralChatResponse> {
      const { buildMessages } = await import("./prompt");
      const built = buildMessages(messages);
      return requestFn(config, built);
    },
  };
}
