import { EMBEDDING_DIMENSION } from "./embedding";

export const DB_ENV_VAR = "DATABASE_URL";

export const DB_TABLE = "chunks";

export const DB_SCHEMA_COLUMNS = [
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

export const VECTOR_INDEX_NAME = "chunks_embedding_hnsw_idx";
export const VECTOR_OPCLASS = "vector_cosine_ops";

export const INGEST_BATCH_SIZE = 100;

export function vectorDimension(): number {
  return EMBEDDING_DIMENSION;
}
