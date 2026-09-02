import { APPROVED_URLS, isApprovedUrl } from "../../config/sources";
import type { DocumentChunk, EmbeddingRecord } from "../types";

export class EmbeddingValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EmbeddingValidationError";
  }
}

export const NORM_TOLERANCE = 1e-3;

export function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

export function vectorMagnitude(vector: number[]): number {
  return Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0));
}

export function validateVector(vector: unknown, dimension: number, context: string): number[] {
  if (!Array.isArray(vector)) {
    throw new EmbeddingValidationError(`${context}: embedding is not an array`);
  }
  if (vector.length !== dimension) {
    throw new EmbeddingValidationError(
      `${context}: embedding has ${vector.length} dimensions; expected ${dimension}`
    );
  }
  for (const value of vector) {
    if (!isFiniteNumber(value)) {
      throw new EmbeddingValidationError(
        `${context}: embedding contains a non-finite value (NaN or Infinity)`
      );
    }
  }
  return vector as number[];
}

export function validateEmbeddingRecord(
  record: EmbeddingRecord,
  chunk: DocumentChunk,
  expectedModel: string,
  expectedDimension: number
): number[] {
  if (record.chunk_id !== chunk.chunk_id) {
    throw new EmbeddingValidationError(
      `chunk_id mismatch: record "${record.chunk_id}" vs chunk "${chunk.chunk_id}"`
    );
  }
  if (record.embedding_model !== expectedModel) {
    throw new EmbeddingValidationError(
      `chunk "${record.chunk_id}" used model "${record.embedding_model}"; expected "${expectedModel}"`
    );
  }
  if (record.embedding_dimensions !== expectedDimension) {
    throw new EmbeddingValidationError(
      `chunk "${record.chunk_id}" records ${record.embedding_dimensions} dimensions; expected ${expectedDimension}`
    );
  }
  if (record.chunk_text !== chunk.chunk_text) {
    throw new EmbeddingValidationError(
      `chunk "${record.chunk_id}" chunk_text does not match input chunk`
    );
  }
  if (record.scheme_id !== chunk.scheme_id || record.scheme_name !== chunk.scheme_name || record.source_url !== chunk.source_url) {
    throw new EmbeddingValidationError(
      `chunk "${record.chunk_id}" scheme/source metadata does not match input chunk`
    );
  }
  return validateVector(record.embedding, expectedDimension, `chunk "${record.chunk_id}"`);
}

export function validateEmbeddingSet(
  records: EmbeddingRecord[],
  chunks: DocumentChunk[],
  expectedModel: string,
  expectedDimension: number
): void {
  const chunkById = new Map(chunks.map((chunk) => [chunk.chunk_id, chunk]));
  const seen = new Set<string>();

  for (const record of records) {
    const chunk = chunkById.get(record.chunk_id);
    if (!chunk) {
      throw new EmbeddingValidationError(
        `Embedding references unknown chunk_id "${record.chunk_id}"`
      );
    }
    if (seen.has(record.chunk_id)) {
      throw new EmbeddingValidationError(`Duplicate embedding for chunk_id "${record.chunk_id}"`);
    }
    seen.add(record.chunk_id);
    validateEmbeddingRecord(record, chunk, expectedModel, expectedDimension);
  }

  if (seen.size !== chunks.length) {
    throw new EmbeddingValidationError(
      `Expected ${chunks.length} embeddings but found ${seen.size}`
    );
  }
}

export function validateNormalization(
  records: EmbeddingRecord[],
  tolerance: number = NORM_TOLERANCE
): void {
  for (const record of records) {
    if (!record.normalized) {
      continue;
    }
    const norm = vectorMagnitude(record.embedding);
    if (Math.abs(norm - 1) > tolerance) {
      throw new EmbeddingValidationError(
        `chunk "${record.chunk_id}" is not unit-norm normalized (norm=${norm})`
      );
    }
  }
}

export function validateCorpusUrls(records: EmbeddingRecord[]): void {
  for (const record of records) {
    if (!isApprovedUrl(record.source_url)) {
      throw new EmbeddingValidationError(
        `Embedding for chunk "${record.chunk_id}" references unapproved source URL "${record.source_url}"`
      );
    }
  }
}

export function approvedCorpusUrls(): string[] {
  return [...APPROVED_URLS];
}
