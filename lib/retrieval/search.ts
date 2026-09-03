import { DB_TABLE } from "../../config/database";
import { APPROVED_URLS } from "../../config/sources";
import { DEFAULT_TOP_K } from "../../config/retrieval";
import type { Database, QueryRow } from "../vectordb/connection";
import { RetrievalError } from "./validate";
import type { RetrievalResult } from "../types";

interface RawSearchRow extends QueryRow {
  chunk_id: string;
  scheme_id: string;
  scheme_name: string;
  source_url: string;
  source_file: string;
  chunk_text: string;
  chunk_index: number;
  last_updated: string | null;
  similarity: number;
}

const APPROVED_URL_LIST = [...APPROVED_URLS];

export function buildSearchSql(sourceUrl?: string): string {
  const sourceCondition =
    sourceUrl !== undefined
      ? `source_url = $3`
      : `source_url = ANY($3::text[])`;
  return `
SELECT
  chunk_id,
  scheme_id,
  scheme_name,
  source_url,
  source_file,
  chunk_text,
  chunk_index,
  last_updated,
  1 - (embedding <=> $1::vector) AS similarity
FROM ${DB_TABLE}
WHERE ${sourceCondition}
ORDER BY embedding <=> $1::vector
LIMIT $2
`;
}

export async function searchSimilarChunks(
  db: Database,
  queryEmbedding: number[],
  topK: number = DEFAULT_TOP_K,
  sourceUrl?: string
): Promise<RetrievalResult[]> {
  if (!Array.isArray(queryEmbedding) || queryEmbedding.length === 0) {
    throw new RetrievalError("query embedding must be a non-empty array");
  }

  const vectorLiteral = `[${queryEmbedding.join(",")}]`;

  const sourceParam =
    sourceUrl !== undefined ? sourceUrl : APPROVED_URL_LIST;

  const result = await db.query<RawSearchRow>(buildSearchSql(sourceUrl), [
    vectorLiteral,
    topK,
    sourceParam,
  ]);

  return result.rows.map((row) => ({
    chunkId: String(row.chunk_id),
    schemeId: String(row.scheme_id),
    schemeName: String(row.scheme_name),
    sourceUrl: String(row.source_url),
    sourceFile: String(row.source_file),
    chunkText: String(row.chunk_text),
    chunkIndex: Number(row.chunk_index),
    lastUpdated: row.last_updated === null ? null : String(row.last_updated),
    similarity: Number(row.similarity),
  }));
}
