export interface SchemeSource {
  schemeId: string;
  schemeName: string;
  url: string;
  domain: string;
  identityKeywords: string[];
}

export interface ExtractionMetadata {
  method: string;
  title: string | null;
  description: string | null;
  charCount: number;
  structuredFieldCount: number;
}

export interface RawSourceDocument {
  schemeId: string;
  schemeName: string;
  sourceUrl: string;
  sourceDomain: string;
  fetchedAt: string;
  extraction: ExtractionMetadata;
  extractedText: string;
}

export interface DocumentChunk {
  chunk_id: string;
  scheme_id: string;
  scheme_name: string;
  source_url: string;
  source_file: string;
  chunk_text: string;
  chunk_index: number;
  last_updated: string | null;
}

export interface EmbeddingRecord {
  chunk_id: string;
  scheme_id: string;
  scheme_name: string;
  source_url: string;
  source_file: string;
  chunk_index: number;
  chunk_text: string;
  last_updated: string | null;
  embedding: number[];
  embedding_model: string;
  embedding_dimensions: number;
  normalized: boolean;
}

export interface RetrievalResult {
  chunkId: string;
  schemeId: string;
  schemeName: string;
  sourceUrl: string;
  sourceFile: string;
  chunkText: string;
  chunkIndex: number;
  lastUpdated: string | null;
  similarity: number;
}

export type AnswerStatus =
  | "answered"
  | "insufficient_information"
  | "out_of_scope"
  | "configuration_error"
  | "generation_error";

export interface GeneratedAnswer {
  answer: string | null;
  sourceUrl: string | null;
  schemeId: string | null;
  schemeName: string | null;
  lastUpdated: string | null;
  status: AnswerStatus;
}