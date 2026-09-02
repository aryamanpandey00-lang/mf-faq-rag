import { createRequire } from "node:module";
import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { DATA_DIR } from "../ingestion/persist";
import { EMBEDDING_MODEL_ID } from "../../config/embedding";
import type { EmbeddingRecord } from "../types";

const require = createRequire(import.meta.url);

export const DATA_EMBEDDINGS_DIR = path.join(DATA_DIR, "embeddings");
export const EMBEDDINGS_FILE = path.join(DATA_EMBEDDINGS_DIR, "embeddings.json");
export const EMBEDDING_RUN_FILE = path.join(DATA_EMBEDDINGS_DIR, "run.json");

export interface EmbeddingPersistResult {
  filePath: string;
  count: number;
}

export function transformersRuntimeVersion(): string {
  try {
    const entry = require.resolve("@huggingface/transformers");
    const packageJsonPath = path.resolve(path.dirname(entry), "..", "package.json");
    const pkg = JSON.parse(readFileSync(packageJsonPath, "utf8")) as { version?: string };
    return pkg.version ?? "unknown";
  } catch {
    return "unknown";
  }
}

export function persistEmbeddings(
  records: EmbeddingRecord[],
  outputFile: string = EMBEDDINGS_FILE
): EmbeddingPersistResult {
  mkdirSync(path.dirname(outputFile), { recursive: true });
  writeFileSync(outputFile, `${JSON.stringify(records, null, 2)}\n`, "utf8");
  return { filePath: outputFile, count: records.length };
}

export interface EmbeddingRunMetadata {
  modelId: string;
  runtime: string;
  runtimeVersion: string;
  dimension: number;
  normalized: boolean;
  chunkCount: number;
  embeddingCount: number;
  generatedAt: string;
}

export function persistEmbeddingRunMetadata(metadata: EmbeddingRunMetadata): void {
  mkdirSync(DATA_EMBEDDINGS_DIR, { recursive: true });
  writeFileSync(
    EMBEDDING_RUN_FILE,
    `${JSON.stringify(metadata, null, 2)}\n`,
    "utf8"
  );
}

export function buildRunMetadata(
  chunkCount: number,
  embeddingCount: number,
  dimension: number,
  normalized: boolean
): EmbeddingRunMetadata {
  return {
    modelId: EMBEDDING_MODEL_ID,
    runtime: "@huggingface/transformers",
    runtimeVersion: transformersRuntimeVersion(),
    dimension,
    normalized,
    chunkCount,
    embeddingCount,
    generatedAt: new Date().toISOString(),
  };
}
