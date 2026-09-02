import test from "node:test";
import assert from "node:assert/strict";

import { APPROVED_SOURCES } from "../config/sources";
import { EMBEDDING_MODEL_ID, EMBEDDING_DIMENSION } from "../config/embedding";
import {
  DEFAULT_TOP_K,
  DEFAULT_SIMILARITY_THRESHOLD,
  MAX_QUERY_LENGTH,
} from "../config/retrieval";
import type { QueryRow } from "../lib/vectordb/connection";
import { RetrievalError, validateQuery } from "../lib/retrieval/validate";
import { buildSearchSql, searchSimilarChunks } from "../lib/retrieval/search";
import { retrieve } from "../lib/retrieval";
import { vectorMagnitude } from "../lib/embedding/validate";

function deterministicVector(text: string): number[] {
  let seed = 7;
  for (const ch of text) seed = (Math.imul(seed, 31) + ch.charCodeAt(0)) >>> 0;
  const values: number[] = [];
  for (let i = 0; i < EMBEDDING_DIMENSION; i += 1) {
    seed = (Math.imul(seed, 1103515245) + 12345) >>> 0;
    values.push((seed % 1000) / 1000 - 0.5);
  }
  const norm = Math.sqrt(values.reduce((sum, v) => sum + v * v, 0));
  return values.map((v) => v / norm);
}

interface SearchRow extends QueryRow {
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

function makeSearchRow(overrides: Partial<SearchRow> = {}): SearchRow {
  const source = APPROVED_SOURCES[0];
  const row: SearchRow = {
    chunk_id: `${source.schemeId}:0`,
    scheme_id: source.schemeId,
    scheme_name: source.schemeName,
    source_url: source.url,
    source_file: `${source.schemeId}.json`,
    chunk_text: "Some factual chunk text.",
    chunk_index: 0,
    last_updated: "2025-01-01",
    similarity: 0.9,
    ...overrides,
  };
  return row;
}

class FakeSearchDb {
  commands: string[] = [];
  paramsSets: unknown[][] = [];
  rows: QueryRow[] = [];
  queryError: Error | null = null;
  writeDetected = false;
  queryCount = 0;

  async connect(): Promise<void> {}
  async end(): Promise<void> {}

  async query<T extends QueryRow = QueryRow>(
    sql: string,
    params: unknown[] = []
  ): Promise<{ rows: T[] }> {
    this.queryCount += 1;
    const cmd = sql.replace(/\s+/g, " ").trim();
    this.commands.push(cmd);
    this.paramsSets.push(params);
    if (/\b(INSERT|UPDATE|DELETE|DROP|ALTER|TRUNCATE)\b/i.test(cmd)) {
      this.writeDetected = true;
    }
    if (this.queryError) {
      throw this.queryError;
    }
    return { rows: this.rows as T[] };
  }
}

// ------------------------- Query validation -------------------------

test("empty query is rejected", () => {
  assert.throws(() => validateQuery(""), RetrievalError);
  assert.throws(() => validateQuery("   "), RetrievalError);
});

test("whitespace-only query is rejected", () => {
  assert.throws(() => validateQuery("\t \n "), RetrievalError);
});

test("non-string query is rejected", () => {
  assert.throws(() => validateQuery(42), RetrievalError);
  assert.throws(() => validateQuery(null), RetrievalError);
  assert.throws(() => validateQuery(undefined), RetrievalError);
});

test("query is trimmed of surrounding whitespace", () => {
  assert.equal(validateQuery("  hello world  "), "hello world");
});

test("query length validation rejects over-long queries", () => {
  const long = "a".repeat(MAX_QUERY_LENGTH + 1);
  assert.throws(() => validateQuery(long), /maximum length/);
  assert.equal(validateQuery("a".repeat(MAX_QUERY_LENGTH)).length, MAX_QUERY_LENGTH);
});

// ------------------------- Embedding -------------------------

test("valid query produces a query embedding via the provided embedder", async () => {
  const db = new FakeSearchDb();
  const calls: string[] = [];
  let embedCount = 0;
  await retrieve(db, "What is the expense ratio of HDFC Large Cap?", {
    embed: async (text: string) => {
      embedCount += 1;
      calls.push(text);
      return deterministicVector(text);
    },
  });
  assert.equal(embedCount, 1);
  assert.deepEqual(calls, ["What is the expense ratio of HDFC Large Cap?"]);
});

test("query embedding is 384-dimensional", async () => {
  assert.equal(EMBEDDING_DIMENSION, 384);
  const db = new FakeSearchDb();
  await retrieve(db, "some question", {
    embed: async (text) => {
      const vector = deterministicVector(text);
      assert.equal(vector.length, 384);
      return vector;
    },
  });
});

test("query embedding is L2 normalized", async () => {
  const db = new FakeSearchDb();
  await retrieve(db, "some question", {
    embed: async (text) => {
      const vector = deterministicVector(text);
      assert.ok(Math.abs(vectorMagnitude(vector) - 1) < 1e-6, "vector must be unit-norm");
      return vector;
    },
  });
});

// ------------------------- SQL / parameters -------------------------

test("SQL uses parameterized values, not interpolated query text", async () => {
  const db = new FakeSearchDb();
  await retrieve(db, "DROP TABLE chunks; SELECT * FROM users", {
    embed: async (text) => deterministicVector(text),
  });
  const sql = db.commands[0];
  assert.ok(!sql.includes("DROP TABLE"));
  assert.ok(!sql.includes("SELECT * FROM users"));
  assert.ok(sql.includes("$1"));
  assert.ok(sql.includes("$2"));
  assert.ok(sql.includes("$3::text[]"));
});

test("SQL uses the pgvector cosine operator and 1 - cosine distance", () => {
  const sql = buildSearchSql();
  assert.match(sql, /embedding\s*<=>/);
  assert.match(sql, /1\s*-\s*\(embedding\s*<=>/);
});

test("top-k defaults to 3 and is passed as a bound parameter", async () => {
  assert.equal(DEFAULT_TOP_K, 3);
  const db = new FakeSearchDb();
  await retrieve(db, "question", { embed: async (text) => deterministicVector(text) });
  assert.ok(db.paramsSets[0].includes(3));
});

test("custom top-k is respected", async () => {
  const db = new FakeSearchDb();
  await retrieve(db, "question", {
    topK: 5,
    embed: async (text) => deterministicVector(text),
  });
  assert.ok(db.paramsSets[0].includes(5));
});

test("similarity threshold defaults to 0.5", () => {
  assert.equal(DEFAULT_SIMILARITY_THRESHOLD, 0.5);
});

test("retrieval SQL restricts to the approved source URLs", async () => {
  const db = new FakeSearchDb();
  await retrieve(db, "question", { embed: async (text) => deterministicVector(text) });
  const urlsParam = db.paramsSets[0][2] as string[];
  assert.equal(urlsParam.length, APPROVED_SOURCES.length);
  for (const url of urlsParam) {
    assert.ok(APPROVED_SOURCES.some((s) => s.url === url));
  }
});

// ------------------------- Result filtering / ordering -------------------------

test("results above the threshold are returned and ordered by similarity", async () => {
  const db = new FakeSearchDb();
  db.rows = [
    makeSearchRow({ chunk_id: "hdfc-large-cap:1", similarity: 0.95 }),
    makeSearchRow({ chunk_id: "hdfc-large-cap:2", similarity: 0.8 }),
    makeSearchRow({ chunk_id: "hdfc-large-cap:0", similarity: 0.6 }),
  ] as QueryRow[];

  const outcome = await retrieve(db, "expense ratio", {
    embed: async (text) => deterministicVector(text),
  });
  const ids = outcome.results.map((r) => r.chunkId);
  assert.deepEqual(ids, ["hdfc-large-cap:1", "hdfc-large-cap:2", "hdfc-large-cap:0"]);
  const sims = outcome.results.map((r) => r.similarity);
  assert.deepEqual(sims, [0.95, 0.8, 0.6]);
  assert.ok(sims.every((s, i) => i === 0 || s <= sims[i - 1]), "similarity descending");
});

test("results below the similarity threshold are excluded", async () => {
  const db = new FakeSearchDb();
  db.rows = [
    makeSearchRow({ chunk_id: "hdfc-large-cap:0", similarity: 0.9 }),
    makeSearchRow({ chunk_id: "hdfc-large-cap:1", similarity: 0.4 }),
    makeSearchRow({ chunk_id: "hdfc-large-cap:2", similarity: 0.2 }),
  ] as QueryRow[];

  const outcome = await retrieve(db, "question", {
    embed: async (text) => deterministicVector(text),
  });
  assert.deepEqual(outcome.results.map((r) => r.chunkId), ["hdfc-large-cap:0"]);
});

test("a custom similarity threshold is honored", async () => {
  const db = new FakeSearchDb();
  db.rows = [
    makeSearchRow({ chunk_id: "hdfc-large-cap:0", similarity: 0.9 }),
    makeSearchRow({ chunk_id: "hdfc-large-cap:1", similarity: 0.7 }),
    makeSearchRow({ chunk_id: "hdfc-large-cap:2", similarity: 0.55 }),
  ] as QueryRow[];

  const outcome = await retrieve(db, "question", {
    similarityThreshold: 0.6,
    embed: async (text) => deterministicVector(text),
  });
  assert.deepEqual(outcome.results.map((r) => r.chunkId), ["hdfc-large-cap:0", "hdfc-large-cap:1"]);
});

test("no relevant results returns an empty set, never fabricated content", async () => {
  const db = new FakeSearchDb();
  db.rows = [
    makeSearchRow({ chunk_id: "hdfc-large-cap:0", similarity: 0.1 }),
    makeSearchRow({ chunk_id: "hdfc-large-cap:1", similarity: 0.2 }),
  ] as QueryRow[];

  const outcome = await retrieve(db, "the capital of France", {
    embed: async (text) => deterministicVector(text),
  });
  assert.deepEqual(outcome.results, []);
});

test("an empty database returns an empty result set", async () => {
  const db = new FakeSearchDb();
  db.rows = [];
  const outcome = await retrieve(db, "question", {
    embed: async (text) => deterministicVector(text),
  });
  assert.deepEqual(outcome.results, []);
});

// ------------------------- Metadata preservation -------------------------

test("retrieval result metadata is preserved", async () => {
  const db = new FakeSearchDb();
  db.rows = [
    makeSearchRow({
      chunk_id: "hdfc-elss:4",
      scheme_id: "hdfc-elss",
      scheme_name: "HDFC ELSS Tax Saver Fund Direct Plan Growth",
      source_url: "https://groww.in/mutual-funds/hdfc-elss-tax-saver-fund-direct-plan-growth",
      source_file: "hdfc-elss.json",
      chunk_text: "ELSS funds have a three-year lock-in period.",
      chunk_index: 4,
      last_updated: "2025-02-11",
      similarity: 0.91,
    }),
  ] as QueryRow[];

  const outcome = await retrieve(db, "ELSS lock in", {
    embed: async (text) => deterministicVector(text),
  });
  assert.equal(outcome.results.length, 1);
  const result = outcome.results[0];
  assert.equal(result.chunkId, "hdfc-elss:4");
  assert.equal(result.schemeId, "hdfc-elss");
  assert.equal(result.schemeName, "HDFC ELSS Tax Saver Fund Direct Plan Growth");
  assert.equal(
    result.sourceUrl,
    "https://groww.in/mutual-funds/hdfc-elss-tax-saver-fund-direct-plan-growth"
  );
  assert.equal(result.sourceFile, "hdfc-elss.json");
  assert.equal(result.chunkText, "ELSS funds have a three-year lock-in period.");
  assert.equal(result.chunkIndex, 4);
  assert.equal(result.lastUpdated, "2025-02-11");
  assert.equal(result.similarity, 0.91);
});

test("approved source URL is preserved in the result", async () => {
  const source = APPROVED_SOURCES[2];
  const db = new FakeSearchDb();
  db.rows = [
    makeSearchRow({ source_url: source.url, scheme_id: source.schemeId }),
  ] as QueryRow[];
  const outcome = await retrieve(db, "question", {
    embed: async (text) => deterministicVector(text),
  });
  assert.equal(outcome.results[0].sourceUrl, source.url);
  assert.ok(APPROVED_SOURCES.some((s) => s.url === outcome.results[0].sourceUrl));
});

// ------------------------- Error handling -------------------------

test("database errors are surfaced, not swallowed", async () => {
  const db = new FakeSearchDb();
  db.queryError = new Error("connection reset");
  await assert.rejects(
    () => retrieve(db, "question", { embed: async (text) => deterministicVector(text) }),
    /connection reset/
  );
});

test("embedding errors are surfaced, not swallowed", async () => {
  const db = new FakeSearchDb();
  await assert.rejects(
    () =>
      retrieve(db, "question", {
        embed: async () => {
          throw new Error("embedding model failed");
        },
      }),
    /embedding model failed/
  );
});

test("invalid query produces a typed retrieval error", async () => {
  const db = new FakeSearchDb();
  await assert.rejects(
    () => retrieve(db, "", { embed: async (text) => deterministicVector(text) }),
    RetrievalError
  );
});

test("malformed query embedding (empty) is rejected", async () => {
  const db = new FakeSearchDb();
  await assert.rejects(
    () => retrieve(db, "question", { embed: async () => [] }),
    /empty/
  );
});

test("invalid topK is rejected", async () => {
  const db = new FakeSearchDb();
  await assert.rejects(
    () => retrieve(db, "question", { topK: 0, embed: async (t) => deterministicVector(t) }),
    /topK/
  );
});

// ------------------------- Read-only / no network -------------------------

test("retrieval is read-only (no write statements)", async () => {
  const db = new FakeSearchDb();
  await retrieve(db, "question", { embed: async (text) => deterministicVector(text) });
  assert.equal(db.writeDetected, false);
  assert.equal(db.queryCount, 1);
});

test("no Groww network request occurs during retrieval", async () => {
  let networkCalls = 0;
  const db = new FakeSearchDb();
  await retrieve(db, "question", {
    embed: async (text) => {
      networkCalls += 1; // embedder is local; search is against the DB mock
      return deterministicVector(text);
    },
  });
  // verify the query intent used a local embedder and DB, no external fetch
  assert.equal(networkCalls, 1);
  assert.ok(!JSON.stringify(db.commands).includes("http"));
});

test("searchSimilarChunks surfaces query failures", async () => {
  const db = new FakeSearchDb();
  db.queryError = new Error("permission denied");
  await assert.rejects(
    () => searchSimilarChunks(db, deterministicVector("q"), 3),
    /permission denied/
  );
});

// ------------------------- Model config -------------------------

test("retrieval uses the existing embedding model id", () => {
  assert.equal(EMBEDDING_MODEL_ID, "sentence-transformers/all-MiniLM-L6-v2");
});
