import {
  APPROVED_URLS,
  getSourceBySchemeId,
  isApprovedUrl,
} from "../../config/sources";
import { APPROVED_SOURCES } from "../../config/sources";
import type { DocumentChunk, RawSourceDocument, SchemeSource } from "../types";

export class ChunkValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ChunkValidationError";
  }
}

const WHITESPACE_PATTERN = /\s+/g;

export function normalizeForCoverage(text: string): string {
  return text.replace(WHITESPACE_PATTERN, " ").trim();
}

export function validateCorpus(schemeId: string, url: string): void {
  const source = getSourceBySchemeId(schemeId);
  if (!source) {
    throw new ChunkValidationError(`Chunk references unapproved scheme id: ${schemeId}`);
  }
  if (!isApprovedUrl(url)) {
    throw new ChunkValidationError(`Chunk references unapproved source URL: ${url}`);
  }
  if (source.url !== url) {
    throw new ChunkValidationError(
      `Chunk scheme/URL mismatch: scheme "${schemeId}" expects URL "${source.url}" but chunk has "${url}"`
    );
  }
}

export function validateChunk(
  chunk: DocumentChunk,
  source: SchemeSource
): void {
  if (!chunk.chunk_id || chunk.chunk_id.trim().length === 0) {
    throw new ChunkValidationError("Chunk must have a non-empty chunk_id");
  }
  if (chunk.scheme_id !== source.schemeId) {
    throw new ChunkValidationError(
      `Chunk scheme_id "${chunk.scheme_id}" does not match source "${source.schemeId}"`
    );
  }
  if (chunk.scheme_name !== source.schemeName) {
    throw new ChunkValidationError(
      `Chunk scheme_name mismatch for chunk "${chunk.chunk_id}"`
    );
  }
  if (chunk.source_url !== source.url) {
    throw new ChunkValidationError(
      `Chunk source_url mismatch for chunk "${chunk.chunk_id}"`
    );
  }
  if (!chunk.chunk_text || chunk.chunk_text.trim().length === 0) {
    throw new ChunkValidationError(
      `Chunk "${chunk.chunk_id}" has empty chunk_text`
    );
  }
  if (!Number.isInteger(chunk.chunk_index) || chunk.chunk_index < 0) {
    throw new ChunkValidationError(
      `Chunk "${chunk.chunk_id}" has invalid chunk_index`
    );
  }
}

export function validateChunkSet(
  chunks: DocumentChunk[],
  source: SchemeSource
): void {
  const seenIds = new Set<string>();
  for (const chunk of chunks) {
    validateChunk(chunk, source);
    if (seenIds.has(chunk.chunk_id)) {
      throw new ChunkValidationError(`Duplicate chunk_id: ${chunk.chunk_id}`);
    }
    seenIds.add(chunk.chunk_id);
  }

  const indexes = chunks.map((chunk) => chunk.chunk_index).sort((a, b) => a - b);
  for (let expected = 0; expected < chunks.length; expected += 1) {
    if (indexes[expected] !== expected) {
      throw new ChunkValidationError(
        `Chunk indices for "${source.schemeId}" must be contiguous from 0`
      );
    }
  }
}

export function validateCoverage(
  document: RawSourceDocument,
  chunks: DocumentChunk[],
  options: { tokenThreshold?: number } = {}
): void {
  const sourceTokens = tokens(document.extractedText);
  if (sourceTokens.length === 0) {
    throw new ChunkValidationError(
      `Cannot validate coverage for empty source text "${document.schemeId}"`
    );
  }

  const chunkTokens = tokens(chunks.map((chunk) => chunk.chunk_text).join(" "));
  if (chunkTokens.length === 0) {
    throw new ChunkValidationError(
      `No chunk text produced for "${document.schemeId}"`
    );
  }

  const threshold = options.tokenThreshold ?? 0;
  let matched = 0;
  let sourceIndex = 0;
  for (const token of chunkTokens) {
    if (token === sourceTokens[sourceIndex]) {
      sourceIndex += 1;
      matched += 1;
      if (sourceIndex >= sourceTokens.length) {
        break;
      }
    }
  }

  const missing = sourceTokens.length - matched;
  if (missing > threshold) {
    const samples = sourceTokens.slice(sourceIndex, sourceIndex + 10).join(" ");
    throw new ChunkValidationError(
      `Source content missing across chunks for "${document.schemeId}": ${samples}`
    );
  }
}

function tokens(text: string): string[] {
  return normalizeForCoverage(text).split(" ").filter((token) => token.length > 0);
}

export function approvedSchemeIds(): string[] {
  return APPROVED_SOURCES.map((source) => source.schemeId);
}

export function approvedUrls(): string[] {
  return [...APPROVED_URLS];
}
