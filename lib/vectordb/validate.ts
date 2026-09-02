import { readFileSync } from "node:fs";
import { isApprovedUrl } from "../../config/sources";
import { EMBEDDING_MODEL_ID, EMBEDDING_DIMENSION } from "../../config/embedding";
import { validateVector } from "../embedding/validate";
import type { EmbeddingRecord } from "../types";
import { VectordbError } from "./connection";

export interface DbIngestCandidate {
  record: EmbeddingRecord;
  vectorLiteral: string;
}

const RECORD_KEYS = [
  "chunk_id",
  "scheme_id",
  "scheme_name",
  "source_url",
  "source_file",
  "chunk_text",
  "chunk_index",
  "last_updated",
  "embedding",
  "embedding_model",
  "embedding_dimensions",
  "normalized",
] as const;

export function loadEmbeddingsFile(file: string): EmbeddingRecord[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(file, "utf8"));
  } catch (error) {
    throw new VectordbError(
      `Could not read embeddings file: ${error instanceof Error ? error.message : String(error)}`
    );
  }
  if (!Array.isArray(parsed)) {
    throw new VectordbError("Embeddings file is not a JSON array");
  }
  return parsed as EmbeddingRecord[];
}

export function isEmbeddingRecord(value: unknown): value is EmbeddingRecord {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const candidate = value as Record<string, unknown>;
  return RECORD_KEYS.every((key) => key in candidate);
}

function formatVectorLiteral(vector: number[]): string {
  return `[${vector.join(",")}]`;
}

export function validateIngestableRecords(records: unknown[]): DbIngestCandidate[] {
  const seen = new Set<string>();

  return records.map((entry, index) => {
    const context = `record ${index}`;

    if (!isEmbeddingRecord(entry)) {
      throw new VectordbError(`${context}: malformed embedding record (missing required fields)`);
    }

    const record = entry as EmbeddingRecord;

    if (typeof record.chunk_id !== "string" || record.chunk_id === "") {
      throw new VectordbError(`${context}: chunk_id must be a non-empty string`);
    }

    if (seen.has(record.chunk_id)) {
      throw new VectordbError(`${context}: duplicate chunk_id "${record.chunk_id}"`);
    }
    seen.add(record.chunk_id);

    if (!isApprovedUrl(record.source_url)) {
      throw new VectordbError(
        `${context}: chunk "${record.chunk_id}" has unapproved source URL "${record.source_url}"`
      );
    }

    if (typeof record.scheme_id !== "string" || record.scheme_id === "") {
      throw new VectordbError(`${context}: chunk "${record.chunk_id}" missing scheme_id`);
    }

    if (record.embedding_model !== EMBEDDING_MODEL_ID) {
      throw new VectordbError(
        `${context}: chunk "${record.chunk_id}" model "${record.embedding_model}" does not match expected "${EMBEDDING_MODEL_ID}"`
      );
    }

    if (record.embedding_dimensions !== EMBEDDING_DIMENSION) {
      throw new VectordbError(
        `${context}: chunk "${record.chunk_id}" declares ${record.embedding_dimensions} dimensions; expected ${EMBEDDING_DIMENSION}`
      );
    }

    const vector = validateVector(record.embedding, EMBEDDING_DIMENSION, `chunk "${record.chunk_id}"`);

    return {
      record,
      vectorLiteral: formatVectorLiteral(vector),
    };
  });
}
