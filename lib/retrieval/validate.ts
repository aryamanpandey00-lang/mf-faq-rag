import { MAX_QUERY_LENGTH } from "../../config/retrieval";

export class RetrievalError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RetrievalError";
  }
}

export function validateQuery(raw: unknown): string {
  if (typeof raw !== "string") {
    throw new RetrievalError("query must be a string");
  }

  const trimmed = raw.trim();
  if (trimmed.length === 0) {
    throw new RetrievalError("query must not be empty");
  }

  if (trimmed.length > MAX_QUERY_LENGTH) {
    throw new RetrievalError(
      `query exceeds maximum length of ${MAX_QUERY_LENGTH} characters (got ${trimmed.length})`
    );
  }

  return trimmed;
}

export function formatVectorForPgvector(vector: number[]): string {
  return `[${vector.join(",")}]`;
}
