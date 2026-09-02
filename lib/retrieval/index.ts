import {
  DEFAULT_TOP_K,
  DEFAULT_SIMILARITY_THRESHOLD,
} from "../../config/retrieval";
import { embedText } from "../embedding";
import type { Database } from "../vectordb/connection";
import type { RetrievalResult } from "../types";
import { RetrievalError, validateQuery } from "./validate";
import { searchSimilarChunks } from "./search";

export type QueryEmbedder = (text: string) => Promise<number[]>;

export interface RetrieveOptions {
  topK?: number;
  similarityThreshold?: number;
  embed?: QueryEmbedder;
}

export interface RetrievalOutcome {
  query: string;
  results: RetrievalResult[];
}

export async function retrieve(
  db: Database,
  rawQuery: unknown,
  options: RetrieveOptions = {}
): Promise<RetrievalOutcome> {
  const query = validateQuery(rawQuery);
  const topK = options.topK ?? DEFAULT_TOP_K;
  const threshold = options.similarityThreshold ?? DEFAULT_SIMILARITY_THRESHOLD;
  const embedder = options.embed ?? (async (text: string) => embedText(text));

  if (!Number.isInteger(topK) || topK <= 0) {
    throw new RetrievalError(`topK must be a positive integer (got ${topK})`);
  }

  const queryEmbedding = await embedder(query);

  if (!Array.isArray(queryEmbedding) || queryEmbedding.length === 0) {
    throw new RetrievalError("query embedding was empty");
  }

  const candidates = await searchSimilarChunks(db, queryEmbedding, topK);

  const results = candidates.filter(
    (candidate) => candidate.similarity >= threshold
  );

  return { query, results };
}
