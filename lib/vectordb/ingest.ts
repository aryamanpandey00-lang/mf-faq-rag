import {
  DB_TABLE,
  DB_SCHEMA_COLUMNS,
  INGEST_BATCH_SIZE,
} from "../../config/database";
import type { Database, QueryRow } from "./connection";
import type { DbIngestCandidate } from "./validate";

export interface IngestResult {
  total: number;
  inserted: number;
  updated: number;
  skipped: number;
  batchCount: number;
}

const COLUMNS = [...DB_SCHEMA_COLUMNS];

function rowParams(candidate: DbIngestCandidate): unknown[] {
  const record = candidate.record;
  return [
    record.chunk_id,
    record.scheme_id,
    record.scheme_name,
    record.source_url,
    record.source_file,
    record.chunk_text,
    record.chunk_index,
    record.last_updated ?? null,
    candidate.vectorLiteral,
    record.embedding_model,
    record.embedding_dimensions,
    !!record.normalized,
  ];
}

const UPDATE_SET = `
  scheme_id = EXCLUDED.scheme_id,
  scheme_name = EXCLUDED.scheme_name,
  source_url = EXCLUDED.source_url,
  source_file = EXCLUDED.source_file,
  chunk_text = EXCLUDED.chunk_text,
  chunk_index = EXCLUDED.chunk_index,
  last_updated = EXCLUDED.last_updated,
  embedding = EXCLUDED.embedding,
  embedding_model = EXCLUDED.embedding_model,
  embedding_dimensions = EXCLUDED.embedding_dimensions,
  normalized = EXCLUDED.normalized`;

async function existingChunkIds(
  db: Database,
  candidates: DbIngestCandidate[]
): Promise<Set<string>> {
  const ids = candidates.map((c) => c.record.chunk_id);
  if (ids.length === 0) {
    return new Set();
  }
  const result = await db.query<QueryRow>(
    `SELECT chunk_id FROM ${DB_TABLE} WHERE chunk_id = ANY($1::text[])`,
    [ids]
  );
  return new Set(result.rows.map((row) => String(row.chunk_id)));
}

async function upsertBatch(
  db: Database,
  batch: DbIngestCandidate[]
): Promise<void> {
  if (batch.length === 0) {
    return;
  }
  const placeholders: string[] = [];
  const params: unknown[] = [];
  let paramIndex = 1;

  for (const candidate of batch) {
    const values = rowParams(candidate);
    const tuple = values.map(() => `$${paramIndex++}`).join(", ");
    placeholders.push(`(${tuple})`);
    params.push(...values);
  }

  const sql = `INSERT INTO ${DB_TABLE} (${COLUMNS.join(", ")})
VALUES ${placeholders.join(", ")}
ON CONFLICT (chunk_id) DO UPDATE SET ${UPDATE_SET}`;

  await db.query(sql, params);
}

export async function ingestEmbeddings(
  db: Database,
  candidates: DbIngestCandidate[]
): Promise<IngestResult> {
  await db.query("BEGIN");

  try {
    const existing = await existingChunkIds(db, candidates);

    let inserted = 0;
    let updated = 0;
    let batchCount = 0;

    for (let i = 0; i < candidates.length; i += INGEST_BATCH_SIZE) {
      const batch = candidates.slice(i, i + INGEST_BATCH_SIZE);
      await upsertBatch(db, batch);
      batchCount += 1;
      for (const candidate of batch) {
        if (existing.has(candidate.record.chunk_id)) {
          updated += 1;
        } else {
          inserted += 1;
        }
      }
    }

    await db.query("COMMIT");

    return {
      total: candidates.length,
      inserted,
      updated,
      skipped: 0,
      batchCount,
    };
  } catch (error) {
    await db.query("ROLLBACK");
    throw error;
  }
}
