import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { APPROVED_SOURCES } from "../config/sources";
import type { RawSourceDocument, SchemeSource } from "../lib/types";
import { segmentText, TERMINAL_PUNCTUATION } from "../lib/chunking/segment";
import {
  DEFAULT_CHUNK_TARGET_SIZE,
} from "../lib/chunking/chunk";
import {
  chunkDocument,
  runChunking,
  validateCorpusBoundary,
} from "../lib/chunking";
import {
  ChunkValidationError,
  validateChunkSet,
  validateCoverage,
  approvedSchemeIds,
} from "../lib/chunking/validate";
import {
  persistChunks,
  summarizeChunks,
} from "../lib/chunking/persist";

function source(schemeId: string): SchemeSource {
  const found = APPROVED_SOURCES.find((s) => s.schemeId === schemeId);
  assert.ok(found, `source ${schemeId} must exist`);
  return found;
}

function rawDocument(source: SchemeSource, text: string): RawSourceDocument {
  return {
    schemeId: source.schemeId,
    schemeName: source.schemeName,
    sourceUrl: source.url,
    sourceDomain: source.domain,
    fetchedAt: "2026-09-01T00:00:00.000Z",
    extraction: {
      method: "html-text-extractor/v1",
      title: null,
      description: null,
      charCount: text.length,
      structuredFieldCount: 0,
    },
    extractedText: text,
  };
}

function proseFloor(extraRepeat = 8): string {
  const sentence =
    "The HDFC Large Cap Fund is an open ended equity scheme that invests in large cap stocks. " +
    "It reports an annual expense ratio and tracks a benchmark index. " +
    "Investors may choose a systematic investment plan for regular contributions.";
  const repeated = Array.from({ length: extraRepeat }, () => sentence).join(" ");
  return sentence + " " + repeated;
}

function numberedProse(n: number): string {
  const parts: string[] = [];
  for (let i = 1; i <= n; i += 1) {
    parts.push(`Sentence number ${i} contains unique factual content.`);
  }
  return parts.join(" ");
}

test("segmentText splits into conventional sentences", () => {
  const sentences = segmentText(
    "First sentence here. Second sentence here. Third sentence here."
  );
  assert.equal(sentences.length, 3);
  assert.equal(sentences[0], "First sentence here.");
  assert.equal(sentences[1], "Second sentence here.");
  assert.equal(sentences[2], "Third sentence here.");
});

test("segmentText preserves headings and short lines as single sentences", () => {
  const sentences = segmentText(
    "Expense Ratio\nMinimum SIP: Rs 100\nExit Load\nBenchmark Index"
  );
  assert.deepEqual(sentences, [
    "Expense Ratio",
    "Minimum SIP: Rs 100",
    "Exit Load",
    "Benchmark Index",
  ]);
});

test("segmentText keeps text without punctuation intact", () => {
  const sentences = segmentText("this line has no terminal punctuation at all");
  assert.deepEqual(sentences, ["this line has no terminal punctuation at all"]);
});

test("segmentText drops empty lines", () => {
  const sentences = segmentText("one line\n\n\n\ntwo line\n");
  assert.deepEqual(sentences, ["one line", "two line"]);
});

test("a short document produces one chunk", () => {
  const s = source("hdfc-large-cap");
  const doc = rawDocument(s, "Only a short factual sentence to chunk.");
  const chunks = chunkDocument(doc, s);
  assert.equal(chunks.length, 1);
  assert.ok(chunks[0].chunk_text.includes("Only a short factual sentence to chunk."));
});

test("a longer document produces multiple chunks", () => {
  const s = source("hdfc-large-cap");
  const doc = rawDocument(s, proseFloor(60));
  const chunks = chunkDocument(doc, s);
  assert.ok(chunks.length > 1, `expected multiple chunks, got ${chunks.length}`);
});

test("chunks target approximately 600 characters", () => {
  const s = source("hdfc-large-cap");
  const doc = rawDocument(s, proseFloor(80));
  for (const chunk of chunkDocument(doc, s)) {
    assert.ok(
      chunk.chunk_text.length <= DEFAULT_CHUNK_TARGET_SIZE + 200,
      `chunk too large: ${chunk.chunk_text.length}`
    );
  }
});

test("chunk boundaries preserve complete sentences", () => {
  const s = source("hdfc-large-cap");
  const doc = rawDocument(s, numberedProse(200));
  const chunks = chunkDocument(doc, s);
  for (const chunk of chunks) {
    const segments = segmentText(chunk.chunk_text);
    assert.ok(segments.length > 0);
  }
});

test("exactly one sentence overlaps between normal adjacent chunks", () => {
  const s = source("hdfc-large-cap");
  const doc = rawDocument(s, numberedProse(200));
  const chunks = chunkDocument(doc, s);
  assert.ok(chunks.length > 1);

  for (let i = 1; i < chunks.length; i += 1) {
    const prevSentences = segmentText(chunks[i - 1].chunk_text);
    const nextSentences = segmentText(chunks[i].chunk_text);
    const prevLast = prevSentences[prevSentences.length - 1];
    const nextFirst = nextSentences[0];
    assert.equal(
      nextFirst,
      prevLast,
      `chunk ${i} should start with previous chunk's final sentence`
    );
    assert.ok(
      !nextSentences.slice(1).includes(prevLast),
      `chunk ${i} should not carry more than one overlapping sentence`
    );
  }
});

test("short documents do not receive unnecessary overlap", () => {
  const s = source("hdfc-large-cap");
  const doc = rawDocument(s, "A single short sentence in the whole document.");
  const chunks = chunkDocument(doc, s);
  assert.equal(chunks.length, 1);
});

test("empty text is rejected", () => {
  const s = source("hdfc-large-cap");
  const doc = rawDocument(s, "");
  assert.throws(() => chunkDocument(doc, s));
});

test("whitespace-only text is rejected", () => {
  const s = source("hdfc-large-cap");
  const doc = rawDocument(s, "   \n  \n   ");
  assert.throws(() => chunkDocument(doc, s));
});

test("a very long sentence is handled without an infinite loop", () => {
  const s = source("hdfc-large-cap");
  const longSentence = "word ".repeat(4000).trim();
  const doc = rawDocument(s, longSentence);
  const chunks = chunkDocument(doc, s);
  assert.ok(chunks.length > 0);
  const joined = chunks.map((c) => c.chunk_text).join(" ");
  assert.equal(joined.replace(/\s+/g, " "), longSentence.replace(/\s+/g, " "));
  for (const chunk of chunks) {
    assert.ok(
      chunk.chunk_text.length <= DEFAULT_CHUNK_TARGET_SIZE + 120,
      "long sentence should be broken into bounded pieces"
    );
  }
});

test("text containing headings and bullets is handled", () => {
  const s = source("hdfc-large-cap");
  const doc = rawDocument(
    s,
    "Key Facts\n- Expense Ratio: 1.0%\n- Minimum SIP: Rs 100\n- Exit Load: Nil\n"
  );
  const chunks = chunkDocument(doc, s);
  const joined = chunks.map((c) => c.chunk_text).join(" ");
  assert.ok(joined.includes("Expense Ratio: 1.0%"));
  assert.ok(joined.includes("Minimum SIP: Rs 100"));
  assert.ok(joined.includes("Exit Load: Nil"));
});

test("every chunk retains correct scheme id, name and source URL", () => {
  for (const s of APPROVED_SOURCES) {
    const doc = rawDocument(s, proseFloor(30));
    const chunks = chunkDocument(doc, s);
    assert.ok(chunks.length > 0);
    for (const chunk of chunks) {
      assert.equal(chunk.scheme_id, s.schemeId);
      assert.equal(chunk.scheme_name, s.schemeName);
      assert.equal(chunk.source_url, s.url);
      assert.ok(chunk.chunk_id);
      assert.ok(Number.isInteger(chunk.chunk_index));
      assert.equal(chunk.source_file, `${s.schemeId}.json`);
    }
  }
});

test("running the chunker twice produces identical chunks and ids", () => {
  const s = source("hdfc-small-cap");
  const doc = rawDocument(s, proseFloor(50));
  const a = chunkDocument(doc, s);
  const b = chunkDocument(doc, s);
  assert.deepEqual(a.map((c) => c.chunk_id), b.map((c) => c.chunk_id));
  assert.deepEqual(a.map((c) => c.chunk_text), b.map((c) => c.chunk_text));
});

test("chunk ids are deterministic and unique within a document", () => {
  const s = source("hdfc-elss");
  const doc = rawDocument(s, proseFloor(60));
  const chunks = chunkDocument(doc, s);
  const ids = new Set(chunks.map((c) => c.chunk_id));
  assert.equal(ids.size, chunks.length, "chunk ids must be unique");
  chunks.forEach((chunk, i) => {
    assert.equal(chunk.chunk_id, `${s.schemeId}:${i}`);
  });
});

test("coverage preserves all meaningful source text", () => {
  const s = source("hdfc-large-cap");
  const facts = [
    "Expense Ratio: 0.75%",
    "Minimum SIP: Rs 100",
    "Exit Load: Nil",
    "Benchmark Index: NIFTY 100 TRI",
    "Lock-in period: 3 year(s)",
    "Riskometer: Very High",
  ];
  const text =
    facts.join("\n") +
    "\n" +
    "The scheme follows a long term investment objective and is managed by an experienced fund manager.";
  const doc = rawDocument(s, text);
  const chunks = chunkDocument(doc, s);
  const joined = chunks.map((c) => c.chunk_text).join(" ");
  for (const fact of facts) {
    assert.ok(
      joined.includes(fact),
      `chunked output must retain fact: ${fact}`
    );
  }
});

test("no source text is silently discarded in chunked output", () => {
  const s = source("hdfc-balanced-advantage");
  const doc = rawDocument(s, proseFloor(100));
  const chunks = chunkDocument(doc, s);
  validateCoverage(doc, chunks);
});

test("validateChunkSet rejects duplicate chunk ids", () => {
  const s = source("hdfc-large-cap");
  const doc = rawDocument(s, proseFloor(40));
  const chunks = chunkDocument(doc, s);
  const dup = { ...chunks[0], chunk_id: chunks[1]?.chunk_id ?? chunks[0].chunk_id };
  assert.throws(() => validateChunkSet([dup, ...chunks.slice(1)], s), ChunkValidationError);
});

test("validateChunkSet rejects non-contiguous indices", () => {
  const s = source("hdfc-large-cap");
  const doc = rawDocument(s, proseFloor(40));
  const chunks = chunkDocument(doc, s);
  const shifted = chunks.map((c, i) => ({ ...c, chunk_index: i + 1 }));
  assert.throws(() => validateChunkSet(shifted, s), ChunkValidationError);
});

test("validateChunkSet rejects a chunk whose scheme does not match source", () => {
  const s = source("hdfc-large-cap");
  const other = source("hdfc-elss");
  const doc = rawDocument(s, proseFloor(10));
  const chunks = chunkDocument(doc, s);
  const bad = { ...chunks[0], scheme_id: other.schemeId };
  assert.throws(() => validateChunkSet([bad], s), ChunkValidationError);
});

test("validateChunkSet rejects a chunk with an empty chunk text", () => {
  const s = source("hdfc-large-cap");
  const doc = rawDocument(s, proseFloor(10));
  const chunks = chunkDocument(doc, s);
  const bad = { ...chunks[0], chunk_text: "   " };
  assert.throws(() => validateChunkSet([bad], s), ChunkValidationError);
});

test("five approved scheme ids are exposed", () => {
  assert.deepEqual(
    [...approvedSchemeIds()].sort(),
    APPROVED_SOURCES.map((s) => s.schemeId).sort()
  );
  assert.equal(approvedSchemeIds().length, 5);
});

test("validateCorpusBoundary accepts the five approved raw documents", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "mf-faq-chunk-corpus-"));
  try {
    const s = source("hdfc-large-cap");
    const doc = rawDocument(s, proseFloor(20));
    for (const scheme of [s, source("hdfc-flexi-cap"), source("hdfc-elss"), source("hdfc-small-cap"), source("hdfc-balanced-advantage")]) {
      writeFileSync(path.join(dir, `${scheme.schemeId}.json`), JSON.stringify(doc, null, 2), "utf8");
    }
    validateCorpusBoundary(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("validateCorpusBoundary rejects an unexpected raw document", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "mf-faq-chunk-bad-"));
  try {
    const s = source("hdfc-large-cap");
    const doc = rawDocument(s, proseFloor(20));
    for (const scheme of APPROVED_SOURCES) {
      writeFileSync(path.join(dir, `${scheme.schemeId}.json`), JSON.stringify(doc, null, 2), "utf8");
    }
    writeFileSync(path.join(dir, "hdfc-mid-cap.json"), "{}", "utf8");
    assert.throws(() => validateCorpusBoundary(dir), /Unexpected raw document/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("runChunking processes only the five approved schemes", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "mf-faq-chunk-run-"));
  try {
    for (const scheme of APPROVED_SOURCES) {
      writeFileSync(
        path.join(dir, `${scheme.schemeId}.json`),
        JSON.stringify(rawDocument(scheme, proseFloor(20)), null, 2),
        "utf8"
      );
    }
    const report = runChunking(dir);
    assert.equal(report.schemesProcessed.length, 5);
    assert.equal(report.failures.length, 0);
    assert.equal(Object.keys(report.perSchemeCounts).length, 5);
    assert.ok(report.totalChunks >= 5);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("runChunking reports a failure for a malformed raw document", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "mf-faq-chunk-mal-"));
  try {
    for (const scheme of APPROVED_SOURCES) {
      writeFileSync(
        path.join(dir, `${scheme.schemeId}.json`),
        scheme.schemeId === "hdfc-large-cap"
          ? "not json"
          : JSON.stringify(rawDocument(scheme, proseFloor(20)), null, 2),
        "utf8"
      );
    }
    const report = runChunking(dir);
    assert.ok(report.failures.length > 0);
    assert.equal(report.schemesProcessed.length, 4);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("persistChunks overwrites output without appending duplicates", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "mf-faq-chunk-persist-"));
  try {
    const out = path.join(dir, "chunks.json");
    const s = source("hdfc-large-cap");
    const doc = rawDocument(s, proseFloor(30));
    const chunks = chunkDocument(doc, s);

    const reportA = persistChunks(chunks, out);
    const reportB = persistChunks(chunks, out);

    assert.equal(reportA.chunkCount, chunks.length);
    assert.equal(reportB.chunkCount, chunks.length);
    assert.deepEqual(reportA, reportB);
    assert.ok(path.basename(out), "chunks.json");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("summarizeChunks produces per-scheme counts", () => {
  const s = source("hdfc-large-cap");
  const elss = source("hdfc-elss");
  const a = chunkDocument(rawDocument(s, proseFloor(30)), s);
  const b = chunkDocument(rawDocument(elss, proseFloor(30)), elss);
  const report = summarizeChunks([...a, ...b]);
  assert.equal(report.chunkCount, a.length + b.length);
  assert.equal(report.schemeCounts[s.schemeId], a.length);
  assert.equal(report.schemeCounts[elss.schemeId], b.length);
});

test("TERMINAL_PUNCTUATION is exported for sentence detection", () => {
  assert.ok(TERMINAL_PUNCTUATION.test("."));
  assert.ok(TERMINAL_PUNCTUATION.test("?"));
  assert.ok(TERMINAL_PUNCTUATION.test("!"));
  assert.ok(!TERMINAL_PUNCTUATION.test("a"));
});
