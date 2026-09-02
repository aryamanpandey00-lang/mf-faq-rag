import { DATA_EMBEDDINGS_DIR, EMBEDDINGS_FILE } from "../embedding/persist";
import { applySchema, sqlCreateExtension, sqlCreateTable, sqlCreateIndex } from "./schema";
import { validateIngestableRecords, loadEmbeddingsFile } from "./validate";
import { ingestEmbeddings, type IngestResult } from "./ingest";
import { validateDatabaseState, checkDbAgainstLocal, type DatabaseCheckReport } from "./dbcheck";
import {
  createNeonDatabase,
  getDatabaseUrl,
  redactConnectionString,
  VectordbError,
  type Database,
} from "./connection";
import { loadLocalEnv } from "./env";

export * from "./connection";
export * from "./schema";
export * from "./validate";
export * from "./ingest";
export * from "./dbcheck";
export * from "./env";

export interface IngestionReport {
  inputFile: string;
  records: number;
  ingest: IngestResult;
  database: DatabaseCheckReport;
}

export async function openDatabase(databaseUrl?: string): Promise<Database> {
  loadLocalEnv();
  const url = databaseUrl ?? getDatabaseUrl();
  const db = createNeonDatabase(url);
  await db.connect();
  return db;
}

export async function closeDatabase(db: Database): Promise<void> {
  await db.end();
}

export function databaseLabel(databaseUrl?: string): string {
  const url = databaseUrl ?? getDatabaseUrl();
  return redactConnectionString(url);
}

export async function runDbSetup(db: Database): Promise<DatabaseCheckReport> {
  await applySchema(db);
  return validateDatabaseState(db);
}

export interface RunIngestOptions {
  embeddingsFile?: string;
  ensureSchema?: boolean;
}

export async function runDbIngest(
  db: Database,
  options: RunIngestOptions = {}
): Promise<IngestionReport> {
  const inputFile = options.embeddingsFile ?? EMBEDDINGS_FILE;
  const raw = loadEmbeddingsFile(inputFile);
  const candidates = validateIngestableRecords(raw);

  if (options.ensureSchema !== false) {
    await applySchema(db);
  }

  const ingest = await ingestEmbeddings(db, candidates);
  const database = await validateDatabaseState(db);

  return {
    inputFile,
    records: candidates.length,
    ingest,
    database,
  };
}

export interface RunCheckOptions {
  embeddingsFile?: string;
}

export interface CheckReport {
  database: DatabaseCheckReport;
  integrity: {
    checked: number;
    mismatches: string[];
  } | null;
}

export async function runDbCheck(
  db: Database,
  options: RunCheckOptions = {}
): Promise<CheckReport> {
  const database = await validateDatabaseState(db);

  let integrity: { checked: number; mismatches: string[] } | null = null;
  if (options.embeddingsFile) {
    const raw = loadEmbeddingsFile(options.embeddingsFile);
    const candidates = validateIngestableRecords(raw);
    integrity = await checkDbAgainstLocal(db, candidates);
  }

  return { database, integrity };
}

export function assertIngestionHealth(report: IngestionReport): void {
  if (report.ingest.total !== report.database.rowCount) {
    throw new VectordbError(
      `Row count ${report.database.rowCount} does not match ingested total ${report.ingest.total}`
    );
  }
  if (report.database.duplicateChunkIds > 0) {
    throw new VectordbError(
      `Duplicate chunk_id rows detected: ${report.database.duplicateChunkIds}`
    );
  }
  if (report.database.unapprovedUrls.length > 0) {
    throw new VectordbError(
      `Unapproved source URLs present: ${report.database.unapprovedUrls.join(", ")}`
    );
  }
  if (report.database.missingSchemes.length > 0) {
    throw new VectordbError(
      `Schemes missing from database: ${report.database.missingSchemes.join(", ")}`
    );
  }
}

export { DATA_EMBEDDINGS_DIR, EMBEDDINGS_FILE, sqlCreateExtension, sqlCreateTable, sqlCreateIndex };
