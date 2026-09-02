import { APPROVED_SOURCES } from "../../config/sources";
import {
  DB_TABLE,
  DB_SCHEMA_COLUMNS,
  VECTOR_INDEX_NAME,
  VECTOR_OPCLASS,
  vectorDimension,
} from "../../config/database";
import type { Database } from "./connection";

function quoteSqlLiteral(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

function approvedUrlLiterals(): string {
  return APPROVED_SOURCES.map((source) => quoteSqlLiteral(source.url)).join(", ");
}

export function sqlCreateExtension(): string {
  return "CREATE EXTENSION IF NOT EXISTS vector;";
}

export function sqlCreateTable(): string {
  const dim = vectorDimension();
  return `
CREATE TABLE IF NOT EXISTS ${DB_TABLE} (
  chunk_id text PRIMARY KEY,
  scheme_id text NOT NULL,
  scheme_name text NOT NULL,
  source_url text NOT NULL,
  source_file text NOT NULL,
  chunk_text text NOT NULL,
  chunk_index integer NOT NULL,
  last_updated text,
  embedding vector(${dim}) NOT NULL,
  embedding_model text NOT NULL,
  embedding_dimensions integer NOT NULL,
  normalized boolean NOT NULL,
  CONSTRAINT ${DB_TABLE}_source_url_approved
    CHECK (source_url IN (${approvedUrlLiterals()}))
);`;
}

export function sqlCreateIndex(): string {
  return `CREATE INDEX IF NOT EXISTS ${VECTOR_INDEX_NAME}
  ON ${DB_TABLE} USING hnsw (embedding ${VECTOR_OPCLASS});`;
}

export function applySchema(db: Database): Promise<void> {
  return db
    .query(sqlCreateExtension())
    .then(() => db.query(sqlCreateTable()))
    .then(() => db.query(sqlCreateIndex()))
    .then(() => undefined);
}

export function schemaColumns(): readonly string[] {
  return DB_SCHEMA_COLUMNS;
}
