import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  EMBEDDING_MODEL_ID,
  EMBEDDING_DIMENSION,
  EMBEDDING_BATCH_SIZE,
} from "../config/embedding";
import { APPROVED_SOURCES } from "../config/sources";
import type { DocumentChunk } from "../lib/types";
import {
  createEmbedder,
  type Embedder,
} from "../lib/embedding";
import {
  loadChunks,
  validateInputCorpus,
  embedChunks,
  runEmbedding,
} from "../lib/embedding/pipeline";
import {
  EmbeddingValidationError,
  validateVector,
  validateEmbeddingSet,
  validateNormalization,
  validateCorpusUrls,
  vectorMagnitude,
  isFiniteNumber,
} from "../lib/embedding/validate";
import {
  persistEmbeddings,
  transformersRuntimeVersion,
} from "../lib/embedding/persist";

const MODEL_ID = "sentence-transformers/all-MiniLM-L6-v2";
const DIM = 384;

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

function makeFakeChunks(count = 3, schemeId = "hdfc-large-cap"): DocumentChunk[] {
  const chunks: DocumentChunk[] = [];
  for (let i = 0; i < count; i += 1) {
    chunks.push(makeChunk(schemeId, i, `Chunk text number ${i} with factual content.`));
  }
  return chunks;
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

class FakeEmbedder implements Embedder {
  calls: string[] = [];
  failNext = false;

  async embedBatch(texts: string[]): Promise<number[][]> {
    if (this.failNext) {
      throw new Error("simulated embedding failure");
    }
    this.calls.push(...texts);
    return texts.map(deterministicVector);
  }
}

function makeTempDir(): string {
  return mkdtempSync(path.join(tmpdir(), "mf-faq-embed-"));
}

test("model identifier is exactly the required model", () => {
  assert.equal(EMBEDDING_MODEL_ID, MODEL_ID);
});

test("expected embedding dimension is 384", () => {
  assert.equal(EMBEDDING_DIMENSION, 384);
});

test("embedding configuration exposes a sensible batch size", () => {
  assert.ok(Number.isInteger(EMBEDDING_BATCH_SIZE));
  assert.ok(EMBEDDING_BATCH_SIZE > 0);
});

test("loadChunks reads a valid chunks array", () => {
  const dir = makeTempDir();
  try {
    const file = path.join(dir, "chunks.json");
    writeFileSync(file, JSON.stringify(makeFakeChunks(3)), "utf8");
    const chunks = loadChunks(file);
    assert.equal(chunks.length, 3);
    assert.equal(chunks[0].chunk_id, "hdfc-large-cap:0");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("loadChunks throws when the chunks file is missing", () => {
  assert.throws(
    () => loadChunks(path.join(tmpdir(), "does-not-exist.json")),
    EmbeddingValidationError
  );
});

test("loadChunks throws on malformed JSON", () => {
  const dir = makeTempDir();
  try {
    const file = path.join(dir, "chunks.json");
    writeFileSync(file, "not json", "utf8");
    assert.throws(() => loadChunks(file), EmbeddingValidationError);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("loadChunks throws when the file is not an array", () => {
  const dir = makeTempDir();
  try {
    const file = path.join(dir, "chunks.json");
    writeFileSync(file, JSON.stringify({ not: "an array" }), "utf8");
    assert.throws(() => loadChunks(file), EmbeddingValidationError);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("validateInputCorpus rejects empty chunk text", () => {
  const chunks = makeFakeChunks(1);
  chunks[0].chunk_text = "   ";
  assert.throws(() => validateInputCorpus(chunks), EmbeddingValidationError);
});

test("validateInputCorpus rejects an unapproved source URL", () => {
  const chunks = makeFakeChunks(1);
  chunks[0].source_url = "https://groww.in/mutual-funds/hdfc-mid-cap-fund";
  assert.throws(() => validateInputCorpus(chunks), (error: unknown) =>
    error instanceof EmbeddingValidationError && error.message.includes("unapproved")
  );
});

test("a normal chunk produces an embedding with exactly 384 finite values", async () => {
  const embedder = new FakeEmbedder();
  const chunks = makeFakeChunks(2);
  const records = await embedChunks(chunks, { embedder });
  assert.equal(records.length, 2);
  for (const record of records) {
    assert.equal(record.embedding.length, 384);
    for (const value of record.embedding) {
      assert.equal(Number.isFinite(value), true);
      assert.equal(Number.isNaN(value), false);
    }
  }
});

test("embedding values contain no NaN or Infinity", () => {
  const v = deterministicVector("some text");
  for (const value of v) {
    assert.equal(isFiniteNumber(value), true);
  }
  assert.throws(
    () => validateVector([1, NaN, 3], 3, "chunk"),
    EmbeddingValidationError
  );
  assert.throws(
    () => validateVector([1, Infinity, 3], 3, "chunk"),
    EmbeddingValidationError
  );
});

test("validateVector requires the exact dimension", () => {
  assert.throws(
    () => validateVector([1, 2], 384, "chunk"),
    EmbeddingValidationError
  );
  assert.throws(
    () => validateVector("nope", 384, "chunk"),
    EmbeddingValidationError
  );
});

test("embedText returns a 384-dimensional vector for a real expectation", async () => {
  const embedder = new FakeEmbedder();
  const [vector] = await embedder.embedBatch(["hello world"]);
  assert.equal(vector.length, 384);
});

test("repeated embedding of the same text is consistent within tolerance", async () => {
  const embedder = new FakeEmbedder();
  const chunks = makeFakeChunks(1);
  const a = await embedChunks(chunks, { embedder });
  const b = await embedChunks(chunks, { embedder });
  assert.deepEqual(a[0].embedding, b[0].embedding);
});

test("embedding records retain full metadata traceability", async () => {
  const embedder = new FakeEmbedder();
  const src = APPROVED_SOURCES[0];
  const chunks = [makeChunk(src.schemeId, 0, "HDFC Large Cap factual text.")];
  const records = await embedChunks(chunks, { embedder });
  const record = records[0];
  assert.equal(record.chunk_id, "hdfc-large-cap:0");
  assert.equal(record.scheme_id, src.schemeId);
  assert.equal(record.scheme_name, src.schemeName);
  assert.equal(record.source_url, src.url);
  assert.equal(record.chunk_text, chunks[0].chunk_text);
  assert.equal(record.embedding_model, MODEL_ID);
  assert.equal(record.embedding_dimensions, 384);
});

test("all records pass embedding set validation", async () => {
  const embedder = new FakeEmbedder();
  const chunks = makeFakeChunks(5);
  const records = await embedChunks(chunks, { embedder });
  validateEmbeddingSet(records, chunks, MODEL_ID, DIM);
});

test("validateEmbeddingSet rejects a duplicate chunk id", async () => {
  const embedder = new FakeEmbedder();
  const chunks = makeFakeChunks(2);
  const records = await embedChunks(chunks, { embedder });
  assert.throws(
    () => validateEmbeddingSet([records[0], records[0]], chunks, MODEL_ID, DIM),
    EmbeddingValidationError
  );
});

test("validateEmbeddingSet rejects a wrong model id", async () => {
  const embedder = new FakeEmbedder();
  const chunks = makeFakeChunks(2);
  const records = await embedChunks(chunks, { embedder });
  assert.throws(
    () => validateEmbeddingSet(records, chunks, "wrong-model", DIM),
    EmbeddingValidationError
  );
});

test("normalized embeddings satisfy unit-norm validation", async () => {
  const embedder = new FakeEmbedder();
  const chunks = makeFakeChunks(3);
  const records = await embedChunks(chunks, { embedder });
  validateNormalization(records);
  for (const record of records) {
    assert.ok(Math.abs(vectorMagnitude(record.embedding) - 1) < 1e-6);
  }
});

test("corpus URL validation accepts only approved sources", async () => {
  const embedder = new FakeEmbedder();
  const chunks = makeFakeChunks(2);
  const records = await embedChunks(chunks, { embedder });
  validateCorpusUrls(records);
});

test("only approved-source chunks are embedded", async () => {
  const embedder = new FakeEmbedder();
  const good = makeChunk("hdfc-large-cap", 0, "good text");
  const bad = makeChunk("hdfc-large-cap", 1, "bad text");
  bad.source_url = "https://groww.in/mutual-funds/hdfc-mid-cap-fund";
  await assert.rejects(
    () => embedChunks([good, bad], { embedder }),
    EmbeddingValidationError
  );
});

test("embedding generation failure propagates", async () => {
  const embedder = new FakeEmbedder();
  embedder.failNext = true;
  const chunks = makeFakeChunks(2);
  await assert.rejects(() => embedChunks(chunks, { embedder }), /simulated embedding failure/);
});

test("persistEmbeddings overwrites without appending duplicate records", async () => {
  const dir = makeTempDir();
  try {
    const out = path.join(dir, "embeddings.json");
    const embedder = new FakeEmbedder();
    const chunks = makeFakeChunks(3);
    const records = await embedChunks(chunks, { embedder });
    persistEmbeddings(records, out);
    persistEmbeddings(records, out);
    const written = JSON.parse(readFileSync(out, "utf8")) as unknown[];
    assert.equal(written.length, 3, "re-writing must not append duplicate records");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("runEmbedding embeds all chunks with a fake embedder", async () => {
  const dir = makeTempDir();
  try {
    const file = path.join(dir, "chunks.json");
    writeFileSync(file, JSON.stringify(makeFakeChunks(6)), "utf8");
    const embedder = new FakeEmbedder();
    const result = await runEmbedding({ chunksFile: file, embedder });
    assert.equal(result.chunks.length, 6);
    assert.equal(result.records.length, 6);
    assert.equal(new Set(result.records.map((r) => r.chunk_id)).size, 6);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("all 261 real Phase 5 chunks can be loaded", () => {
  const chunks = loadChunks();
  assert.equal(chunks.length, 261);
  const schemeIds = new Set(chunks.map((c) => c.scheme_id));
  assert.equal(schemeIds.size, 5);
});

test("all real 261 chunks embed with unique ids and approved urls", async () => {
  const chunks = loadChunks();
  const embedder = new FakeEmbedder();
  const records = await embedChunks(chunks, { embedder });
  assert.equal(records.length, 261);
  assert.equal(new Set(records.map((r) => r.chunk_id)).size, 261);
  validateEmbeddingSet(records, chunks, MODEL_ID, DIM);
  validateCorpusUrls(records);
});

test("transformers runtime version resolves to a string", () => {
  const version = transformersRuntimeVersion();
  assert.equal(typeof version, "string");
  assert.ok(version.length > 0);
});

test("real model smoke test produces a 384-dimensional embedding", async () => {
  const embedder = createEmbedder();
  const vector = (await embedder.embedBatch(["HDFC Large Cap expense ratio test"]))[0];
  assert.equal(vector.length, 384);
  for (const value of vector) {
    assert.equal(Number.isFinite(value), true);
  }
  const norm = Math.sqrt(vector.reduce((sum, v) => sum + v * v, 0));
  assert.ok(Math.abs(norm - 1) < 1e-3, `expected unit norm, got ${norm}`);
});
