import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  APPROVED_SOURCES,
  APPROVED_URLS,
  getSourceByUrl,
  isApprovedUrl,
} from "../config/sources";
import { fetchSourceHtml, FetchError, type Fetcher } from "../lib/ingestion/fetch";
import { extractTextFromHtml } from "../lib/ingestion/extract";
import {
  buildRawDocument,
  validateSourceUrl,
  MIN_EXTRACTED_CHARACTERS,
  SourceValidationError,
} from "../lib/ingestion/validate";
import { persistRawDocument } from "../lib/ingestion/persist";
import { loadSource, type SourceLoadOutcome } from "../lib/ingestion/load";
import type { RawSourceDocument, SchemeSource } from "../lib/types";

const EXPECTED_URLS = [
  "https://groww.in/mutual-funds/hdfc-large-cap-fund-direct-growth",
  "https://groww.in/mutual-funds/hdfc-equity-fund-direct-growth",
  "https://groww.in/mutual-funds/hdfc-elss-tax-saver-fund-direct-plan-growth",
  "https://groww.in/mutual-funds/hdfc-small-cap-fund-direct-growth",
  "https://groww.in/mutual-funds/hdfc-balanced-advantage-fund-direct-growth",
];

const FLEXI_CAP_LEGACY_URL = "https://groww.in/mutual-funds/hdfc-equity-fund-direct-growth";

function htmlFixture(keyword: string): string {
  const body = `
    <p>HDFC ${keyword} Fund is an open ended scheme. The scheme invests in ${keyword} stocks.
    The minimum SIP amount is 100 rupees. The minimum lumpsum investment is 5000 rupees.
    The expense ratio is charged annually. The exit load is applied on redemption before one year.
    The riskometer indicates the level of risk of the scheme. The benchmark index is used to compare the scheme.
    The scheme follows an investment objective that is stated in the scheme information document.
    This paragraph exists so the extracted text crosses the minimum character threshold required
    for a valid source document and remains useful for retrieval in later phases.</p>
  `;
  return `<!DOCTYPE html>
<html>
<head>
  <title>HDFC ${keyword} Fund - Groww</title>
  <meta name="description" content="Overview of the HDFC ${keyword} Fund direct plan." />
  <script type="application/javascript">const notContent = true;</script>
  <style>.hidden { display: none; }</style>
</head>
<body>
  <nav>Mutual Funds Stocks ETFs</nav>
  ${body}
</body>
</html>`;
}

function textResponse(html: string): Response {
  return new Response(html, {
    status: 200,
    headers: { "content-type": "text/html; charset=utf-8" },
  });
}

function largeCapSource(): SchemeSource {
  const source = APPROVED_SOURCES.find((s) => s.schemeId === "hdfc-large-cap");
  assert.ok(source, "hdfc-large-cap source must be configured");
  return source;
}

function makeTempDir(): string {
  return mkdtempSync(path.join(tmpdir(), "mf-faq-rag-raw-"));
}

function successOutcome(outcome: SourceLoadOutcome) {
  return outcome.kind === "success"
    ? outcome
    : assert.fail(`expected success, got failure: ${outcome.error}`);
}

test("source configuration contains exactly five approved URLs", () => {
  assert.equal(APPROVED_SOURCES.length, 5);
  assert.deepEqual(
    APPROVED_SOURCES.map((source) => source.url),
    EXPECTED_URLS
  );
  assert.equal(APPROVED_URLS.size, 5);
  assert.equal(
    new Set(APPROVED_SOURCES.map((source) => source.schemeId)).size,
    5,
    "scheme ids must be unique"
  );
});

test("no URL outside the allowlist is accepted", () => {
  const rejected = [
    "https://groww.in/mutual-funds/hdfc-mid-cap-fund-direct-growth",
    "https://groww.in/mutual-funds/hdfc-large-cap-fund-growth",
    "https://groww.in/",
    "http://groww.in/mutual-funds/hdfc-large-cap-fund-direct-growth",
    "https://groww.com/mutual-funds/hdfc-large-cap-fund-direct-growth",
    "https://example.com/mutual-funds/hdfc-large-cap-fund-direct-growth",
    "https://groww.in/mutual-funds/hdfc-large-cap-fund-direct-growth/extra",
    "",
  ];
  for (const url of rejected) {
    assert.equal(isApprovedUrl(url), false, `should reject: ${url}`);
    assert.throws(() => validateSourceUrl(url), SourceValidationError);
  }
});

test("legacy Flexi Cap URL maps to HDFC Flexi Cap Fund Direct Growth", () => {
  const flexiCap = APPROVED_SOURCES.find((s) => s.schemeId === "hdfc-flexi-cap");
  assert.ok(flexiCap, "hdfc-flexi-cap must be configured");
  assert.equal(flexiCap.url, FLEXI_CAP_LEGACY_URL);
  assert.equal(getSourceByUrl(FLEXI_CAP_LEGACY_URL)?.schemeName, "HDFC Flexi Cap Fund Direct Growth");
});

test("successful HTML extraction produces non-empty text", () => {
  const extracted = extractTextFromHtml(htmlFixture("Large Cap"));
  assert.ok(extracted.text.length > 0);
  assert.ok(extracted.title, "title should be extracted");
  assert.ok(extracted.description, "meta description should be extracted");
});

test("scripts, styles, comments and markup are not retained as document content", () => {
  const extracted = extractTextFromHtml(htmlFixture("Large Cap"));
  assert.ok(extracted.text.length >= MIN_EXTRACTED_CHARACTERS);
  assert.ok(!extracted.text.includes("notContent"));
  assert.ok(!extracted.text.includes("display: none"));
  assert.ok(!extracted.text.includes("<p>"));
  assert.ok(!extracted.text.includes("</p>"));
  assert.ok(!extracted.text.includes("<title>"));
  assert.ok(!extracted.text.includes("<!--"));
  assert.ok(extracted.text.toLowerCase().includes("large cap"));
});

function nextDataFixture(): string {
  const nextData = JSON.stringify({
    props: {
      pageProps: {
        mfServerSideData: {
          scheme_name: "HDFC Large Cap Fund Direct Growth",
          expense_ratio: 1.02,
          exit_load: "Exit load of 1% if redeemed within 1 year",
          min_sip_investment: 100,
          benchmark: "NIFTY 100 TRI",
          description: "The scheme seeks long-term capital appreciation.",
          lock_in: { years: null, months: null, days: null },
        },
      },
    },
  });
  return `<!DOCTYPE html>
<html>
<head><title>Page</title></head>
<body>
  <p>HDFC Large Cap Fund</p>
  <script id="__NEXT_DATA__" type="application/json">${nextData}</script>
</body>
</html>`;
}

test("structured fund facts from the __NEXT_DATA__ payload are preserved", () => {
  const extracted = extractTextFromHtml(nextDataFixture());
  assert.ok(extracted.structuredFieldCount >= 4);
  assert.ok(extracted.text.includes("Expense ratio (%): 1.02"));
  assert.ok(extracted.text.includes("Minimum SIP investment: Rs 100"));
  assert.ok(extracted.text.includes("Exit load: Exit load of 1% if redeemed within 1 year"));
  assert.ok(extracted.text.includes("Investment objective: The scheme seeks long-term capital appreciation."));
  assert.ok(extracted.text.includes("== Structured fund data =="));
});

test("empty lock-in object is omitted from structured facts", () => {
  const extracted = extractTextFromHtml(nextDataFixture());
  assert.ok(!extracted.text.includes("Lock-in period"));
});

test("empty or unusable extracted content is rejected", () => {
  const source = largeCapSource();

  assert.throws(
    () =>
      buildRawDocument(source, {
        title: null,
        description: null,
        text: "",
        structuredFieldCount: 0,
      }),
    SourceValidationError
  );

  const shortText = htmlFixture("Large Cap").slice(0, 60);
  const extracted = extractTextFromHtml(shortText);
  assert.throws(
    () => buildRawDocument(source, extracted),
    SourceValidationError
  );
});

test("extracted text that does not match the scheme identity is rejected", () => {
  const source = largeCapSource();
  const html = htmlFixture("Mid Cap").replace(/mid cap/gi, "Mid Cap");
  const extracted = extractTextFromHtml(html);
  assert.throws(
    () => buildRawDocument(source, extracted),
    SourceValidationError
  );
});

test("raw documents contain the required metadata", async () => {
  const source = largeCapSource();
  const fetcher: Fetcher = async () => textResponse(htmlFixture("Large Cap"));
  const rawDir = makeTempDir();
  try {
    const outcome = successOutcome(await loadSource(source, { fetcher, rawDir }));

    const stored = JSON.parse(
      readFileSync(path.join(rawDir, `${source.schemeId}.json`), "utf8")
    ) as RawSourceDocument;

    assert.equal(stored.schemeId, source.schemeId);
    assert.equal(stored.schemeName, source.schemeName);
    assert.equal(stored.sourceUrl, source.url);
    assert.equal(stored.sourceDomain, "groww.in");
    assert.ok(stored.extractedText.length > 0, "extracted text must be non-empty");
    assert.ok(stored.fetchedAt, "fetched timestamp must be present");
    assert.ok(!Number.isNaN(Date.parse(stored.fetchedAt)), "fetchedAt must be a valid timestamp");
    assert.equal(
      stored.extraction.charCount,
      stored.extractedText.length,
      "charCount must reflect the extracted text length"
    );
    assert.ok(Array.isArray(Object.keys(outcome.document.extraction)));
  } finally {
    rmSync(rawDir, { recursive: true, force: true });
  }
});

test("re-running the loader does not create duplicate corpus files", async () => {
  const source = largeCapSource();
  const fetcher: Fetcher = async () => textResponse(htmlFixture("Large Cap"));
  const rawDir = makeTempDir();
  try {
    await loadSource(source, { fetcher, rawDir });
    await loadSource(source, { fetcher, rawDir });

    const files = readdirSync(rawDir).filter((file) => file.endsWith(".json"));
    assert.deepEqual(files, ["hdfc-large-cap.json"]);
  } finally {
    rmSync(rawDir, { recursive: true, force: true });
  }
});

test("persistRawDocument overwrites the same scheme file on re-run", () => {
  const source = largeCapSource();
  const rawDir = makeTempDir();
  try {
    const document = buildRawDocument(source, extractTextFromHtml(htmlFixture("Large Cap")));
    persistRawDocument(document, rawDir);
    persistRawDocument(document, rawDir);
    assert.deepEqual(readdirSync(rawDir), [`${source.schemeId}.json`]);
  } finally {
    rmSync(rawDir, { recursive: true, force: true });
  }
});

test("fetch rejects an unapproved URL without making a network call", async () => {
  const unapproved: SchemeSource = {
    schemeId: "evil",
    schemeName: "Evil",
    url: "https://example.com/not-approved",
    domain: "example.com",
    identityKeywords: ["evil"],
  };
  await assert.rejects(
    () => fetchSourceHtml(unapproved, { fetcher: async () => textResponse("<p>x</p>") }),
    (error: unknown) =>
      error instanceof FetchError && error.message.includes("unapproved URL")
  );
});

test("fetch reports non-2xx HTTP responses", async () => {
  const source = largeCapSource();
  const fetcher: Fetcher = async () =>
    new Response("Not Found", { status: 404, headers: { "content-type": "text/html" } });
  await assert.rejects(
    () => fetchSourceHtml(source, { fetcher }),
    (error: unknown) => error instanceof FetchError && error.message.includes("HTTP 404")
  );
});

test("fetch reports unexpected content types", async () => {
  const source = largeCapSource();
  const fetcher: Fetcher = async () =>
    new Response("{}", { status: 200, headers: { "content-type": "application/json" } });
  await assert.rejects(
    () => fetchSourceHtml(source, { fetcher }),
    (error: unknown) => error instanceof FetchError && error.message.includes("Unexpected content type")
  );
});

test("fetch reports timeouts", async () => {
  const source = largeCapSource();
  const fetcher: Fetcher = (_url, init) =>
    new Promise<Response>((_, reject) => {
      (init?.signal as AbortSignal | undefined)?.addEventListener("abort", () =>
        reject(new DOMException("aborted", "AbortError"))
      );
    });
  await assert.rejects(
    () => fetchSourceHtml(source, { fetcher, timeoutMs: 20 }),
    (error: unknown) => error instanceof FetchError && error.message.includes("timed out")
  );
});

test("loadSource surfaces a failure as a structured outcome, not a thrown error", async () => {
  const source = largeCapSource();
  const fetcher: Fetcher = async () =>
    new Response("Service Unavailable", {
      status: 503,
      headers: { "content-type": "text/html" },
    });
  const outcome = await loadSource(source, { fetcher, rawDir: makeTempDir() });
  assert.equal(outcome.kind, "failure");
  if (outcome.kind === "failure") {
    assert.ok(outcome.error.includes("HTTP 503"));
  }
});

test("loadSource rejects empty extracted content", async () => {
  const source = largeCapSource();
  const fetcher: Fetcher = async () => textResponse("<html><body></body></html>");
  const outcome = await loadSource(source, { fetcher, rawDir: makeTempDir() });
  assert.equal(outcome.kind, "failure");
  if (outcome.kind === "failure") {
    assert.ok(outcome.error.includes("empty"));
  }
});