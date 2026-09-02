import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { DATA_DIR } from "../ingestion/persist";
import type { DocumentChunk } from "../types";

export const DATA_CHUNKS_DIR = path.join(DATA_DIR, "chunks");
export const CHUNKS_FILE = path.join(DATA_CHUNKS_DIR, "chunks.json");

export interface ChunkReport {
  chunkCount: number;
  schemeCounts: Record<string, number>;
}

export function chunkFileName(container: string): string {
  return `${container}.json`;
}

export function persistChunks(
  chunks: DocumentChunk[],
  outputFile: string = CHUNKS_FILE
): ChunkReport {
  mkdirSync(path.dirname(outputFile), { recursive: true });
  writeFileSync(outputFile, `${JSON.stringify(chunks, null, 2)}\n`, "utf8");
  return summarizeChunks(chunks);
}

export function summarizeChunks(chunks: DocumentChunk[]): ChunkReport {
  const schemeCounts: Record<string, number> = {};
  for (const chunk of chunks) {
    schemeCounts[chunk.scheme_id] = (schemeCounts[chunk.scheme_id] ?? 0) + 1;
  }
  return { chunkCount: chunks.length, schemeCounts };
}
