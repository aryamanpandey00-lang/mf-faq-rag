import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";

import { APPROVED_SOURCES } from "../../config/sources";
import {
  DATA_RAW_DIR,
  rawDocumentFileName,
} from "../ingestion/persist";
import type {
  DocumentChunk,
  RawSourceDocument,
  SchemeSource,
} from "../types";
import { segmentText } from "./segment";
import {
  buildChunks,
  DEFAULT_CHUNK_TARGET_SIZE,
  type ChunkingOptions,
} from "./chunk";
import {
  approvedSchemeIds,
  validateChunkSet,
  validateCoverage,
} from "./validate";

export interface DocumentChunkingResult {
  source: SchemeSource;
  chunks: DocumentChunk[];
}

export interface ChunkingFailure {
  source: SchemeSource;
  error: string;
}

export interface ChunkingRunReport {
  rawDocumentsFound: number;
  schemesProcessed: string[];
  totalChunks: number;
  perSchemeCounts: Record<string, number>;
  results: DocumentChunkingResult[];
  failures: ChunkingFailure[];
}

export function chunkDocument(
  document: RawSourceDocument,
  source: SchemeSource,
  options: ChunkingOptions = {}
): DocumentChunk[] {
  const sentences = segmentText(document.extractedText);
  const targetSize = options.targetSize ?? DEFAULT_CHUNK_TARGET_SIZE;
  const groups = buildChunks(sentences, { targetSize });

  const chunks: DocumentChunk[] = groups.map((group, index) => ({
    chunk_id: `${source.schemeId}:${index}`,
    scheme_id: source.schemeId,
    scheme_name: source.schemeName,
    source_url: source.url,
    source_file: rawDocumentFileName({ schemeId: source.schemeId } as RawSourceDocument),
    chunk_text: group.join(" "),
    chunk_index: index,
    last_updated: null,
  }));

  validateChunkSet(chunks, source);
  validateCoverage(document, chunks);
  return chunks;
}

export function runChunking(
  rawDir: string = DATA_RAW_DIR,
  options: ChunkingOptions = {}
): ChunkingRunReport {
  validateCorpusBoundary(rawDir);

  const results: DocumentChunkingResult[] = [];
  const failures: ChunkingFailure[] = [];
  const perSchemeCounts: Record<string, number> = {};

  for (const source of APPROVED_SOURCES) {
    const filePath = path.join(rawDir, rawDocumentFileName({ schemeId: source.schemeId } as RawSourceDocument));
    let document: RawSourceDocument;
    try {
      const raw = readFileSync(filePath, "utf8");
      document = JSON.parse(raw) as RawSourceDocument;
    } catch (error) {
      failures.push({
        source,
        error: error instanceof Error ? error.message : String(error),
      });
      continue;
    }

    if (document.schemeId !== source.schemeId) {
      failures.push({
        source,
        error: `Raw document schemeId "${document.schemeId}" does not match expected "${source.schemeId}"`,
      });
      continue;
    }

    try {
      const chunks = chunkDocument(document, source, options);
      results.push({ source, chunks });
      perSchemeCounts[source.schemeId] = chunks.length;
    } catch (error) {
      failures.push({
        source,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  const schemesProcessed = results.map((result) => result.source.schemeId);
  const totalChunks = results.reduce((sum, result) => sum + result.chunks.length, 0);

  return {
    rawDocumentsFound: results.length + failures.length,
    schemesProcessed,
    totalChunks,
    perSchemeCounts,
    results,
    failures,
  };
}

export function validateCorpusBoundary(rawDir: string = DATA_RAW_DIR): void {
  let files: string[];
  try {
    files = readdirSync(rawDir);
  } catch (error) {
    throw new Error(
      `Unable to read raw directory "${rawDir}": ${error instanceof Error ? error.message : String(error)}`
    );
  }

  const approved = new Set(approvedSchemeIds());
  const rawFiles = files.filter((file) => file.endsWith(".json"));
  const unexpected = rawFiles.filter((file) => {
    const schemeId = file.replace(/\.json$/, "");
    return !approved.has(schemeId);
  });

  if (unexpected.length > 0) {
    throw new Error(
      `Unexpected raw document(s) present outside the approved corpus: ${unexpected.join(", ")}`
    );
  }

  for (const schemeId of approved) {
    if (!rawFiles.includes(rawDocumentFileName({ schemeId } as RawSourceDocument))) {
      throw new Error(
        `Missing raw document for approved scheme "${schemeId}" in "${rawDir}"`
      );
    }
  }
}
