import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { APPROVED_SOURCES } from "../config/sources";
import { EMBEDDING_MODEL_ID, EMBEDDING_DIMENSION } from "../config/embedding";
import {
  DB_TABLE,
  DB_SCHEMA_COLUMNS,
  VECTOR_INDEX_NAME,
  VECTOR_OPCLASS,
  INGEST_BATCH_SIZE,
} from "../config/database";
import type { DocumentChunk, EmbeddingRecord } from "../lib/types";
import {
  DbConnectionError,
  VectordbError,
  getDatabaseUrl,
  redactConnectionString,
  createNeonDatabase,
  type Database,
  type QueryRow,
} from "../lib/vectordb/connection";
import {
  sqlCreateExtension,
  sqlCreateTable,
  sqlCreateIndex,
  applySchema,
} from "../lib/vectordb/schema";
import {
  validateIngestableRecords,
  loadEmbeddingsFile,
} from "../lib/vectordb/validate";
import { ingestEmbeddings } from "../lib/vectordb/ingest";
import {
  validateDatabaseState,
  checkDbAgainstLocal,
  assertHealthyDatabase,
} from "../lib/vectordb/dbcheck";

const MODEL_ID = EMBEDDING_MODEL_ID;
const DIM = EMBEDDING_DIMENSION;

function makeChunk(schemeId: string, index: number, text: string): DocumentChunk {
  const source = APPROVED_SOURCES.find((s) => s.schemeId === schemeId);
  assert.ok(source, `source ${schemeId} must exist`);
  return {
    chunk_id: `${schemeId}:${index}`,
    scheme_id: schemeId,
    scheme_name: source.schemeName,
    source_url: source.url,
    source_file: `${schemeId}.json`,
    chunk_text: text,
    chunk_index: index,
    last_updated: null,
  };
}

function deterministicVector(text: string): number[] {
  let seed = 7;
  for (const ch of text) seed = (Math.imul(seed, 31) + ch.charCodeAt(0)) >>> 0;
  const values: number[] = [];
  for (let i = 0; i < DIM; i += 1) {
    seed = (Math.imul(seed, 1103515245) + 12345) >>> 0;
    values.push((seed % 1000) / 1000 - 0.5);
  }
  const norm = Math.sqrt(values.reduce((sum, v) => sum + v * v, 0));
  return values.map((v) => v / norm);
}

function makeRecord(schemeId: string, index: number, text: string): EmbeddingRecord {
  const chunk = makeChunk(schemeId, index, text);
  return {
    ...chunk,
    embedding: deterministicVector(text),
    embedding_model: MODEL_ID,
    embedding_dimensions: DIM,
    normalized: true,
  };
}

function makeRecordsForAllSchemes(perScheme = 2): EmbeddingRecord[] {
  const records: EmbeddingRecord[] = [];
  for (const source of APPROVED_SOURCES) {
    for (let i = 0; i < perScheme; i += 1) {
      records.push(makeRecord(source.schemeId, i, `Fact ${source.schemeId} #${i}.`));
    }
  }
  return records;
}

const COLUMN_COUNT = DB_SCHEMA_COLUMNS.length;

interface StoredRow extends QueryRow {
  chunk_id: string;
  scheme_id: string;
  scheme_name: string;
  source_url: string;
  source_file: string;
  chunk_text: string;
  chunk_index: number;
  last_updated: string | null;
  embedding_model: string;
  embedding_dimensions: number;
  normalized: boolean;
  dims: number;
}

class MemoryDb implements Database {
  rows = new Map<string, StoredRow>();
  commands: string[] = [];
  connectError: Error | null = null;
  failInsert = false;
  connected = false;
  ended = false;
  private queryFailures = 0;

  normalize(sql: string): string {
    return sql.replace(/\s+/g, " ").trim();
  }

  async connect(): Promise<void> {
    if (this.connectError) {
      throw this.connectError;
    }
    this.connected = true;
  }

  async end(): Promise<void> {
    this.ended = true;
  }

  async query<T extends QueryRow = QueryRow>(
    sql: string,
    params: unknown[] = []
  ): Promise<{ rows: T[] }> {
    const cmd = this.normalize(sql);
    this.commands.push(cmd);

    if (cmd.startsWith("BEGIN") || cmd.startsWith("COMMIT") || cmd.startsWith("ROLLBACK")) {
      return { rows: [] };
    }

    if (cmd.startsWith("CREATE EXTENSION")) {
      return { rows: [] };
    }
    if (cmd.startsWith("CREATE TABLE")) {
      return { rows: [] };
    }
    if (cmd.startsWith("CREATE INDEX")) {
      return { rows: [] };
    }

    if (cmd.startsWith("SELECT extname FROM pg_extension")) {
      return { rows: this.rows.has("__ext__") ? [{ extname: "vector" } as unknown as T] : [] };
    }
    if (cmd.includes("to_regclass")) {
      return { rows: this.tableCreated ? [{ reg: DB_TABLE } as unknown as T] : [] };
    }

    if (cmd.includes("GROUP BY chunk_id HAVING count(*)")) {
      return { rows: [{ n: 0 } as unknown as T] };
    }

    if (cmd.includes("count(*)") && cmd.includes("FROM chunks")) {
      return { rows: [{ n: this.rows.size } as unknown as T] };
    }

    if (cmd.replace(/.*FROM chunks/, "").includes("ANY($1::text[])")) {
      const ids = params[0] as string[];
      const out: StoredRow[] = [];
      for (const id of ids) {
        const row = this.rows.get(id);
        if (row) out.push(row);
      }
      return { rows: out as unknown as T[] };
    }

    if (cmd.includes("min(vector_dims")) {
      const dims = [...this.rows.values()].map((r) => r.dims);
      const minDim = dims.length ? Math.min(...dims) : null;
      const maxDim = dims.length ? Math.max(...dims) : null;
      return { rows: [{ min_dim: minDim, max_dim: maxDim } as unknown as T] };
    }

    if (cmd.includes("DISTINCT embedding_model")) {
      const models = [...new Set([...this.rows.values()].map((r) => r.embedding_model))];
      return { rows: models.map((m) => ({ embedding_model: m }) as unknown as T) };
    }

    if (cmd.includes("DISTINCT scheme_id")) {
      const schemes = [...new Set([...this.rows.values()].map((r) => r.scheme_id))];
      return { rows: schemes.map((s) => ({ scheme_id: s }) as unknown as T) };
    }

    if (cmd.includes("DISTINCT source_url")) {
      const urls = [...new Set([...this.rows.values()].map((r) => r.source_url))];
      return { rows: urls.map((u) => ({ source_url: u }) as unknown as T) };
    }

    if (cmd.startsWith("INSERT INTO chunks")) {
      this.queryFailures += 1;
      if (this.failInsert) {
        throw new Error("simulated insert failure");
      }
      for (let i = 0; i < params.length; i += COLUMN_COUNT) {
        const p = params.slice(i, i + COLUMN_COUNT);
        const vectorLiteral = String(p[8]);
        const dims = vectorLiteral.split(",").length;
        const row: StoredRow = {
          chunk_id: String(p[0]),
          scheme_id: String(p[1]),
          scheme_name: String(p[2]),
          source_url: String(p[3]),
          source_file: String(p[4]),
          chunk_text: String(p[5]),
          chunk_index: Number(p[6]),
          last_updated: p[7] === null ? null : String(p[7]),
          embedding_model: String(p[9]),
          embedding_dimensions: Number(p[10]),
          normalized: Boolean(p[11]),
          dims,
        };
        this.rows.set(row.chunk_id, row);
      }
      return { rows: [] };
    }

    return { rows: [] };
  }

  get tableCreated(): boolean {
    return this._tableCreated;
  }
  private _tableCreated = false;
  setTableCreated(value: boolean): void {
    this._tableCreated = value;
  }

  get insertAttempts(): number {
    return this.queryFailures;
  }
}

const COLUMN_NAMES = [...DB_SCHEMA_COLUMNS];

function makeTempDir(): string {
  return mkdtempSync(path.join(tmpdir(), "mf-faq-vd-"));
}

// ------------------------- Config: DATABASE_URL -------------------------

test("getDatabaseUrl requires DATABASE_URL and fails clearly when missing", () => {
  assert.throws(() => getDatabaseUrl({}), DbConnectionError);
  try {
    getDatabaseUrl({});
    assert.fail("expected throw");
  } catch (error) {
    const e = error as DbConnectionError;
    assert.match(e.message, /DATABASE_URL/);
    assert.match(e.message, /\.env\.local/);
  }
});

test("getDatabaseUrl returns the configured connection string", () => {
  assert.equal(
    getDatabaseUrl({ DATABASE_URL: "postgres://u:p@host:5432/db" }),
    "postgres://u:p@host:5432/db"
  );
});

test("connection string is redacted so credentials are not exposed", () => {
  const redacted = redactConnectionString("postgres://user:secret@host:5432/db");
  assert.ok(!redacted.includes("secret"));
  assert.ok(redacted.includes("REDACTED"));
  assert.match(redacted, /^postgres:\/\/user:REDACTED@host:5432\/db$/);
});

test("connect failure is reported as a clear DbConnectionError", async () => {
  const db = createNeonDatabase(
    "postgres://user:secret@host:5432/db",
    () => ({
      query: async () => ({ rows: [] }),
      connect: async () => {
        throw new Error("ECONNREFUSED to the database");
      },
      end: async () => undefined,
    })
  );
  await assert.rejects(() => db.connect(), (error: unknown) => {
    assert.ok(error instanceof DbConnectionError);
    assert.match((error as Error).message, /ECONNREFUSED/);
    assert.ok(!(error as Error).message.includes("secret"));
    return true;
  });
});

test("query failures surface as a VectordbError, not swallowed", async () => {
  const db = createNeonDatabase(
    "postgres://user:secret@host:5432/db",
    () => ({
      query: async () => {
        throw new Error("relation does not exist");
      },
      connect: async () => undefined,
      end: async () => undefined,
    })
  );
  await assert.rejects(() => db.query("SELECT 1"), (error: unknown) => {
    assert.ok(error instanceof VectordbError);
    assert.match((error as Error).message, /relation does not exist/);
    return true;
  });
});

// ------------------------- Schema -------------------------

test("pgvector extension DDL is idempotent", () => {
  assert.equal(sqlCreateExtension(), "CREATE EXTENSION IF NOT EXISTS vector;");
});

test("table schema defines vector(384), chunk_id primary key, and required metadata columns", () => {
  const ddl = sqlCreateTable();
  assert.match(ddl, new RegExp(`embedding vector\\(${DIM}\\) NOT NULL`));
  assert.match(ddl, /chunk_id text PRIMARY KEY/);
  for (const column of COLUMN_NAMES) {
    assert.ok(ddl.includes(column), `expected column ${column} in DDL`);
  }
  assert.match(ddl, /source_url text NOT NULL/);
  assert.match(ddl, /CHECK \(source_url IN \(/);
});

test("schema DDL enforces the approved source URL boundary", () => {
  const ddl = sqlCreateTable();
  for (const source of APPROVED_SOURCES) {
    assert.ok(ddl.includes(source.url), `expected ${source.url} in CHECK constraint`);
  }
});

test("index DDL uses HNSW with vector_cosine_ops", () => {
  const ddl = sqlCreateIndex();
  assert.match(ddl, /USING hnsw/);
  assert.match(ddl, new RegExp(`\\(embedding ${VECTOR_OPCLASS}\\)`));
  assert.ok(ddl.includes(VECTOR_INDEX_NAME));
});

test("applySchema issues extension, table, then index creation", async () => {
  const db = new MemoryDb();
  await applySchema(db);
  const joined = db.commands.join("\n");
  const extIndex = joined.indexOf("CREATE EXTENSION IF NOT EXISTS vector");
  const tableIndex = joined.indexOf("CREATE TABLE IF NOT EXISTS chunks");
  const indexIndex = joined.indexOf("CREATE INDEX IF NOT EXISTS");
  assert.ok(extIndex >= 0);
  assert.ok(tableIndex > extIndex);
  assert.ok(indexIndex > tableIndex);
});

// ------------------------- Corpus validation -------------------------

test("unapproved URL is rejected", () => {
  const record = makeRecord("hdfc-large-cap", 0, "text");
  record.source_url = "https://example.com/not-approved";
  assert.throws(() => validateIngestableRecords([record]), VectordbError);
  try {
    validateIngestableRecords([record]);
    assert.fail("expected throw");
  } catch (error) {
    assert.match((error as Error).message, /unapproved source URL/);
  }
});

test("incorrect embedding model is rejected", () => {
  const record = makeRecord("hdfc-large-cap", 0, "text");
  record.embedding_model = "some/other-model";
  assert.throws(() => validateIngestableRecords([record]), /does not match expected/);
});

test("incorrect dimensions are rejected", () => {
  const record = makeRecord("hdfc-large-cap", 0, "text");
  record.embedding_dimensions = 1536;
  assert.throws(() => validateIngestableRecords([record]), VectordbError);
});

test("malformed embedding record is rejected", () => {
  assert.throws(() => validateIngestableRecords([{ chunk_id: "x" }]), /malformed/);
  assert.throws(() => validateIngestableRecords([null]), VectordbError);
});

test("duplicate chunk ids in the input are rejected", () => {
  const a = makeRecord("hdfc-large-cap", 0, "one");
  const b = makeRecord("hdfc-large-cap", 0, "two");
  assert.throws(() => validateIngestableRecords([a, b]), /duplicate chunk_id/);
});

test("Flexi Cap source uses the legacy equity-fund URL mapping", () => {
  const flexi = APPROVED_SOURCES.find((s) => s.schemeId === "hdfc-flexi-cap");
  assert.ok(flexi);
  assert.equal(
    flexi.url,
    "https://groww.in/mutual-funds/hdfc-equity-fund-direct-growth"
  );
  assert.notEqual(
    flexi.url,
    "https://groww.in/mutual-funds/hdfc-flexi-cap-fund-direct-growth"
  );
});

test("missing chunk_id is rejected", () => {
  const record = makeRecord("hdfc-large-cap", 0, "text");
  record.chunk_id = "";
  assert.throws(() => validateIngestableRecords([record]), /chunk_id/);
});

test("valid records pass validation and produce vector literals", () => {
  const records = makeRecordsForAllSchemes(2);
  const candidates = validateIngestableRecords(records);
  assert.equal(candidates.length, records.length);
  for (const candidate of candidates) {
    assert.match(candidate.vectorLiteral, /^\[/);
    assert.match(candidate.vectorLiteral, /\]$/);
  }
});

test("loadEmbeddingsFile reads a valid embeddings array", () => {
  const dir = makeTempDir();
  try {
    const file = path.join(dir, "embeddings.json");
    writeFileSync(file, JSON.stringify(makeRecordsForAllSchemes(2)), "utf8");
    const records = loadEmbeddingsFile(file);
    assert.equal(records.length, APPROVED_SOURCES.length * 2);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("loadEmbeddingsFile fails clearly on a missing file", () => {
  assert.throws(() => loadEmbeddingsFile(path.join("nonexistent", "x.json")), VectordbError);
});

// ------------------------- Ingestion -------------------------

test("valid embedding records can be inserted idempotently (upsert, no duplicates)", async () => {
  const records = makeRecordsForAllSchemes(2);
  const candidates = validateIngestableRecords(records);
  const db = new MemoryDb();
  db.setTableCreated(true);

  const first = await ingestEmbeddings(db, candidates);
  assert.equal(first.inserted, candidates.length);
  assert.equal(first.updated, 0);
  assert.equal(first.total, candidates.length);
  assert.equal(db.rows.size, candidates.length);

  const second = await ingestEmbeddings(db, candidates);
  assert.equal(second.inserted, 0);
  assert.equal(second.updated, candidates.length);
  assert.equal(db.rows.size, candidates.length, "rerun must not create duplicate rows");
});

test("changed data for an existing chunk updates the row in place", async () => {
  const db = new MemoryDb();
  db.setTableCreated(true);
  const original = [makeRecord("hdfc-large-cap", 0, "first version")];
  const first = await ingestEmbeddings(db, validateIngestableRecords(original));
  assert.equal(first.inserted, 1);

  const changed = [makeRecord("hdfc-large-cap", 0, "updated version")];
  const second = await ingestEmbeddings(db, validateIngestableRecords(changed));
  assert.equal(second.updated, 1);
  assert.equal(db.rows.size, 1, "same chunk_id must not create a second row");
  assert.equal(db.rows.get("hdfc-large-cap:0")?.chunk_text, "updated version");
});

test("a failing batch rolls the transaction back (no partial corrupt corpus)", async () => {
  const db = new MemoryDb();
  db.setTableCreated(true);
  const candidates = validateIngestableRecords(makeRecordsForAllSchemes(8));
  db.failInsert = true;

  await assert.rejects(() => ingestEmbeddings(db, candidates), /simulated insert failure/);

  const committed = db.commands.filter((c) => c.startsWith("COMMIT")).length;
  const rolledBack = db.commands.filter((c) => c.startsWith("ROLLBACK")).length;
  assert.equal(committed, 0, "COMMIT must not run on failure");
  assert.equal(rolledBack, 1, "ROLLBACK must be issued on failure");
  assert.equal(db.rows.size, 0);
});

// ------------------------- Integrity / DB state -------------------------

test("all five approved sources are represented after ingestion", async () => {
  const db = new MemoryDb();
  db.setTableCreated(true);
  const candidates = validateIngestableRecords(makeRecordsForAllSchemes(3));
  await ingestEmbeddings(db, candidates);
  const report = await validateDatabaseState(db);
  assert.equal(db.rows.size, APPROVED_SOURCES.length * 3);
  assert.equal(report.rowCount, APPROVED_SOURCES.length * 3);
  assert.equal(report.duplicateChunkIds, 0);
  assert.deepEqual(report.missingSchemes.sort(), []);
  assert.deepEqual(report.unapprovedUrls, []);
});

test("database state reports correct dimensions and model", async () => {
  const db = new MemoryDb();
  db.setTableCreated(true);
  await ingestEmbeddings(db, validateIngestableRecords(makeRecordsForAllSchemes(2)));
  const report = await validateDatabaseState(db);
  assert.equal(report.minDimensions, DIM);
  assert.equal(report.maxDimensions, DIM);
  assert.deepEqual(report.distinctModels, [EMBEDDING_MODEL_ID]);
});

test("extension and table presence are reported", async () => {
  const db = new MemoryDb();
  db.setTableCreated(true);
  db.rows.set("__ext__", {} as StoredRow);
  const fresh = await validateDatabaseState(db);
  assert.equal(fresh.extensionPresent, true);
  assert.equal(fresh.tablePresent, true);

  const noDb = new MemoryDb();
  const missing = await validateDatabaseState(noDb);
  assert.equal(missing.extensionPresent, false);
  assert.equal(missing.tablePresent, false);
  assert.equal(missing.rowCount, 0);
});

test("assertHealthyDatabase flags missing table/extension", () => {
  assert.throws(() => assertHealthyDatabase({
    extensionPresent: false, tablePresent: true, rowCount: 0, duplicateChunkIds: 0,
    minDimensions: null, maxDimensions: null, distinctModels: [], distinctUrls: [],
    missingSchemes: [], unapprovedUrls: [],
  }), /pgvector extension/);
  assert.throws(() => assertHealthyDatabase({
    extensionPresent: true, tablePresent: false, rowCount: 0, duplicateChunkIds: 0,
    minDimensions: null, maxDimensions: null, distinctModels: [], distinctUrls: [],
    missingSchemes: [], unapprovedUrls: [],
  }), /does not exist/);
});

test("integrity check verifies stored metadata matches local source", async () => {
  const db = new MemoryDb();
  db.setTableCreated(true);
  const candidates = validateIngestableRecords(makeRecordsForAllSchemes(2));
  await ingestEmbeddings(db, candidates);

  const integrity = await checkDbAgainstLocal(db, candidates);
  assert.equal(integrity.checked, candidates.length);
  assert.deepEqual(integrity.mismatches, []);
});

test("integrity check detects a stored metadata mismatch", async () => {
  const db = new MemoryDb();
  db.setTableCreated(true);
  const candidates = validateIngestableRecords(makeRecordsForAllSchemes(1));
  await ingestEmbeddings(db, candidates);
  // corrupt one stored row in memory
  const stored = db.rows.get(`${APPROVED_SOURCES[0].schemeId}:0`);
  assert.ok(stored);
  stored.chunk_text = "tampered text";

  const integrity = await checkDbAgainstLocal(db, candidates);
  assert.notEqual(integrity.mismatches.length, 0);
  assert.ok(integrity.mismatches.some((m) => m.includes("chunk_text mismatch")));
});

test("config batch size is a positive integer", () => {
  assert.ok(Number.isInteger(INGEST_BATCH_SIZE));
  assert.ok(INGEST_BATCH_SIZE > 0);
});
