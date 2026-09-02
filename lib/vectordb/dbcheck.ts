import { APPROVED_SOURCES } from "../../config/sources";
import { DB_TABLE } from "../../config/database";
import type { Database, QueryRow } from "./connection";
import { VectordbError } from "./connection";
import type { DbIngestCandidate } from "./validate";

export interface DatabaseCheckReport {
  extensionPresent: boolean;
  tablePresent: boolean;
  rowCount: number;
  duplicateChunkIds: number;
  minDimensions: number | null;
  maxDimensions: number | null;
  distinctModels: string[];
  distinctUrls: string[];
  missingSchemes: string[];
  unapprovedUrls: string[];
}

export async function checkExtension(db: Database): Promise<boolean> {
  const result = await db.query<QueryRow>(
    `SELECT extname FROM pg_extension WHERE extname = 'vector'`
  );
  return result.rows.length > 0;
}

export async function tableExists(db: Database): Promise<boolean> {
  const result = await db.query<QueryRow>(
    `SELECT to_regclass($1) AS reg`,
    [DB_TABLE]
  );
  const reg = result.rows[0]?.reg;
  return reg !== null && reg !== undefined;
}

export async function validateDatabaseState(db: Database): Promise<DatabaseCheckReport> {
  const extensionPresent = await checkExtension(db);
  const present = await tableExists(db);

  const rowCount = present
    ? Number((await db.query<QueryRow>(`SELECT count(*) AS n FROM ${DB_TABLE}`)).rows[0]?.n ?? 0)
    : 0;

  const duplicateChunkIds = present
    ? Number(
        (
          await db.query<QueryRow>(
            `SELECT count(*) AS n FROM (
              SELECT chunk_id FROM ${DB_TABLE} GROUP BY chunk_id HAVING count(*) > 1
            ) AS dup`
          )
        ).rows[0]?.n ?? 0
      )
    : 0;

  let minDimensions: number | null = null;
  let maxDimensions: number | null = null;
  let distinctModels: string[] = [];
  let distinctUrls: string[] = [];

  if (present && rowCount > 0) {
    const dims = await db.query<QueryRow>(
      `SELECT min(vector_dims(embedding)) AS min_dim, max(vector_dims(embedding)) AS max_dim FROM ${DB_TABLE}`
    );
    minDimensions = Number(dims.rows[0]?.min_dim ?? null);
    maxDimensions = Number(dims.rows[0]?.max_dim ?? null);

    const models = await db.query<QueryRow>(
      `SELECT DISTINCT embedding_model FROM ${DB_TABLE}`
    );
    distinctModels = models.rows.map((row) => String(row.embedding_model));

    const urls = await db.query<QueryRow>(
      `SELECT DISTINCT source_url FROM ${DB_TABLE}`
    );
    distinctUrls = urls.rows.map((row) => String(row.source_url));
  }

  const approvedIds = new Set(APPROVED_SOURCES.map((source) => source.schemeId));
  const approvedUrls = new Set(APPROVED_SOURCES.map((source) => source.url));

  const presentSchemes = new Set(
    distinctUrls.length > 0
      ? (
          await db.query<QueryRow>(`SELECT DISTINCT scheme_id FROM ${DB_TABLE}`)
        ).rows.map((row) => String(row.scheme_id))
      : []
  );

  const missingSchemes = [...approvedIds].filter((id) => !presentSchemes.has(id));

  const unapprovedUrls = distinctUrls.filter((url) => !approvedUrls.has(url));

  return {
    extensionPresent,
    tablePresent: present,
    rowCount,
    duplicateChunkIds,
    minDimensions,
    maxDimensions,
    distinctModels,
    distinctUrls,
    missingSchemes,
    unapprovedUrls,
  };
}

export function assertHealthyDatabase(report: DatabaseCheckReport): void {
  if (!report.extensionPresent) {
    throw new VectordbError("pgvector extension is not present");
  }
  if (!report.tablePresent) {
    throw new VectordbError(`table "${DB_TABLE}" does not exist`);
  }
  if (report.duplicateChunkIds > 0) {
    throw new VectordbError(
      `duplicate chunk_id rows detected: ${report.duplicateChunkIds}`
    );
  }
}

export interface LocalIntegrityReport {
  checked: number;
  mismatches: string[];
}

export async function checkDbAgainstLocal(
  db: Database,
  candidates: DbIngestCandidate[]
): Promise<LocalIntegrityReport> {
  if (candidates.length === 0) {
    return { checked: 0, mismatches: [] };
  }

  const ids = candidates.map((c) => c.record.chunk_id);
  const result = await db.query<QueryRow>(
    `SELECT
       chunk_id, scheme_id, scheme_name, source_url, source_file,
       chunk_text, chunk_index, last_updated,
       vector_dims(embedding) AS dims,
       embedding_model, embedding_dimensions, normalized
     FROM ${DB_TABLE}
     WHERE chunk_id = ANY($1::text[])`,
    [ids]
  );

  const byId = new Map<string, QueryRow>();
  for (const row of result.rows) {
    byId.set(String(row.chunk_id), row);
  }

  const mismatches: string[] = [];
  for (const candidate of candidates) {
    const id = candidate.record.chunk_id;
    const row = byId.get(id);
    if (!row) {
      mismatches.push(`${id}: missing from database`);
      continue;
    }
    const record = candidate.record;
    if (record.scheme_id !== row.scheme_id) mismatches.push(`${id}: scheme_id mismatch`);
    if (record.scheme_name !== row.scheme_name) mismatches.push(`${id}: scheme_name mismatch`);
    if (record.source_url !== row.source_url) mismatches.push(`${id}: source_url mismatch`);
    if (record.source_file !== row.source_file) mismatches.push(`${id}: source_file mismatch`);
    if (record.chunk_text !== row.chunk_text) mismatches.push(`${id}: chunk_text mismatch`);
    if (record.chunk_index !== Number(row.chunk_index)) mismatches.push(`${id}: chunk_index mismatch`);
    if ((record.last_updated ?? null) !== (row.last_updated === null ? null : String(row.last_updated))) {
      mismatches.push(`${id}: last_updated mismatch`);
    }
    if (Number(row.dims) !== record.embedding_dimensions) mismatches.push(`${id}: dimensions mismatch`);
    if (record.embedding_model !== row.embedding_model) mismatches.push(`${id}: embedding_model mismatch`);
    if (Number(row.embedding_dimensions) !== record.embedding_dimensions) {
      mismatches.push(`${id}: embedding_dimensions mismatch`);
    }
    if (Boolean(record.normalized) !== Boolean(row.normalized)) mismatches.push(`${id}: normalized mismatch`);
  }

  return { checked: candidates.length, mismatches };
}
