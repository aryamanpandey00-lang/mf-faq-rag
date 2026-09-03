export const MISTRAL_API_KEY_ENV_VAR = "MISTRAL_API_KEY";

export const MISTRAL_MODEL_ENV_VAR = "MISTRAL_MODEL";

export const MISTRAL_DEFAULT_MODEL = "mistral-small-latest";

export const MISTRAL_TEMPERATURE = 0.0;

export const MISTRAL_MAX_OUTPUT_TOKENS = 300;

export const MISTRAL_TIMEOUT_MS = 30_000;

export const MISTRAL_MAX_RETRIES = 2;

export const MISTRAL_ENDPOINT = "https://api.mistral.ai/v1/chat/completions";

export const MISTRAL_RETRYABLE_STATUS_CODES: ReadonlySet<number> = new Set([
  429,
  500,
  502,
  503,
  504,
]);
