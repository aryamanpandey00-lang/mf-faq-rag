import { readFileSync } from "node:fs";

import { isApprovedUrl } from "../../config/sources";
import {
  EMBEDDING_MODEL_ID,
  EMBEDDING_DIMENSION,
  EMBEDDING_NORMALIZED,
  EMBEDDING_BATCH_SIZE,
} from "../../config/embedding";
import { CHUNKS_FILE } from "../chunking/persist";
import type { DocumentChunk, EmbeddingRecord } from "../types";
import { getDefaultEmbedder, type Embedder } from "./index";
import { EmbeddingValidationError, validateEmbeddingSet } from "./validate";

export interface EmbedPipelineOptions {
  chunksFile?: string;
  embedder?: Embedder;
  batchSize?: number;
  modelId?: string;
  dimension?: number;
  normalized?: boolean;
  onProgress?: (embeddedCount: number, total: number) => void;
}

export interface EmbedPipelineResult {
  chunks: DocumentChunk[];
  records: EmbeddingRecord[];
}

export function loadChunks(chunksFile: string = CHUNKS_FILE): DocumentChunk[] {
  let raw: string;
  try {
    raw = readFileSync(chunksFile, "utf8");
  } catch (error) {
    throw new EmbeddingValidationError(
      `Unable to read chunks file "${chunksFile}": ${
        error instanceof Error ? error.message : String(error)
      }`
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new EmbeddingValidationError(`Chunks file is not valid JSON: ${chunksFile}`);
  }

  if (!Array.isArray(parsed)) {
    throw new EmbeddingValidationError(`Chunks file must contain an array: ${chunksFile}`);
  }

  const chunks = parsed as DocumentChunk[];
  for (const chunk of chunks) {
    if (!chunk || typeof chunk.chunk_id !== "string" || chunk.chunk_id.length === 0) {
      throw new EmbeddingValidationError("Encountered a malformed chunk: missing chunk_id");
    }
    if (typeof chunk.chunk_text !== "string") {
      throw new EmbeddingValidationError(
        `Chunk "${chunk.chunk_id}" has non-string chunk_text`
      );
    }
  }
  return chunks;
}

export function validateInputCorpus(chunks: DocumentChunk[]): void {
  for (const chunk of chunks) {
    if (chunk.chunk_text.trim().length === 0) {
      throw new EmbeddingValidationError(
        `Chunk "${chunk.chunk_id}" has empty chunk_text; nothing to embed`
      );
    }
    if (!isApprovedUrl(chunk.source_url)) {
      throw new EmbeddingValidationError(
        `Chunk "${chunk.chunk_id}" references unapproved source URL "${chunk.source_url}"`
      );
    }
  }
}

export async function embedChunks(
  chunks: DocumentChunk[],
  options: EmbedPipelineOptions = {}
): Promise<EmbeddingRecord[]> {
  const modelId = options.modelId ?? EMBEDDING_MODEL_ID;
  const dimension = options.dimension ?? EMBEDDING_DIMENSION;
  const normalized = options.normalized ?? EMBEDDING_NORMALIZED;
  const batchSize = options.batchSize ?? EMBEDDING_BATCH_SIZE;
  const onProgress = options.onProgress ?? (() => undefined);
  const embedder = options.embedder ?? getDefaultEmbedder();

  validateInputCorpus(chunks);

  const records: EmbeddingRecord[] = [];
  let completed = 0;

  for (let start = 0; start < chunks.length; start += batchSize) {
    const batch = chunks.slice(start, start + batchSize);
    const vectors = await embedder.embedBatch(batch.map((chunk) => chunk.chunk_text));

    for (let offset = 0; offset < batch.length; offset += 1) {
      const chunk = batch[offset];
      records.push({
        chunk_id: chunk.chunk_id,
        scheme_id: chunk.scheme_id,
        scheme_name: chunk.scheme_name,
        source_url: chunk.source_url,
        source_file: chunk.source_file,
        chunk_index: chunk.chunk_index,
        chunk_text: chunk.chunk_text,
        last_updated: chunk.last_updated ?? null,
        embedding: vectors[offset],
        embedding_model: modelId,
        embedding_dimensions: dimension,
        normalized,
      });
    }

    completed += batch.length;
    onProgress(completed, chunks.length);
  }

  validateEmbeddingSet(records, chunks, modelId, dimension);
  return records;
}

export async function runEmbedding(
  options: EmbedPipelineOptions = {}
): Promise<EmbedPipelineResult> {
  const chunks = loadChunks(options.chunksFile);
  const records = await embedChunks(chunks, options);
  return { chunks, records };
}
