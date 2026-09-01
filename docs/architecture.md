# Architecture Document
# Mutual Fund FAQ RAG Assistant

## 1. Purpose and Scope

This document defines the technical architecture for the Mutual Fund FAQ RAG Assistant prototype described in `docs/PRD.md`.

The PRD is the single source of truth for product requirements. This document fills in the implementation decisions the PRD explicitly deferred:

- Chunk size and overlap
- Chunk metadata implementation details
- Vector similarity metric
- Top-k
- Similarity threshold
- Vector index strategy
- Exact Mistral model
- Mistral temperature and max tokens
- Environment variable names
- Hallucination evaluation approach

Throughout this document, such choices are explicitly labeled **ARCHITECTURE DECISION**.

This architecture introduces **no features outside the PRD**. It adds no authentication, user accounts, analytics, chat history, payments, admin dashboards, multiple AMCs, or data sources beyond the five approved Groww pages.

---

## 2. Architecture Overview

The system has two distinct paths:

1. **Ingestion path** — a local, repeatable offline process that fetches the five approved Groww pages, chunks them, embeds them, and persists them in Neon PostgreSQL + pgvector.
2. **User-query path** — a Vercel-deployed Next.js application that embeds the user question, retrieves relevant chunks from the pre-populated vector store, and generates a facts-only answer via the Mistral API.

The ingestion path never runs during normal user queries, and Vercel user requests never scrape Groww pages.

### 2.1 Ingestion Path

```
Approved Groww URLs (exactly 5)
        ↓
Phase 1: Data Loading          (fetch → extract → validate)
        ↓
Raw Documents                  (data/raw/ + data/metadata.json)
        ↓
Phase 2: Chunking              (sentence-aware splitting)
        ↓
Chunks + Metadata              (data/chunks/)
        ↓
Phase 3: Embedding             (all-MiniLM-L6-v2, 384-d)
        ↓
Embeddings                     (data/embeddings/ optional staging)
        ↓
Phase 4: Vector Store          (Neon PostgreSQL + pgvector)
```

### 2.2 User-Query Path

```
User
 ↓
Next.js UI  (chat input, example questions, disclaimer)
 ↓
Server/API layer  (Next.js route handler, server-side, no secret exposure)
 ↓
Phase 3b: Query Embedding  (same model + compatible runtime, 384-d)
 ↓
Phase 4b/5: Neon + pgvector  (cosine similarity search)
 ↓
Retrieved context  (approved chunks + source metadata, single-source validated)
 ↓
Phase 7: Mistral API  (facts-only generation)
 ↓
Validated factual response  (1 source link + last-updated line, ≤3-sentence body)
 ↓
UI display
```

---

## 3. Technology Stack

The architecture uses exactly the stack from PRD Section 15:

| Concern | Technology |
|---|---|
| Frontend | Next.js |
| Deployment | Vercel |
| Database | Neon PostgreSQL |
| Vector search | pgvector |
| Embedding model | sentence-transformers/all-MiniLM-L6-v2 (384-dimensional) |
| LLM | Mistral API |
| Development environment | VS Code |
| Coding assistant | OpenCode |
| Version control | Git and GitHub |

These technologies are not replaced; the PRD does not allow swapping them.

### 3.1 Approved Source Corpus

The RAG corpus contains exactly these five URLs (PRD Section 5). No other website or page is part of the corpus.

| # | Scheme (PRD Section 4) | URL |
|---|---|---|
| 1 | HDFC Large Cap Fund Direct Growth | `https://groww.in/mutual-funds/hdfc-large-cap-fund-direct-growth` |
| 2 | HDFC Flexi Cap Fund Direct Growth | `https://groww.in/mutual-funds/hdfc-equity-fund-direct-growth` (legacy slug; see note below) |
| 3 | HDFC ELSS Tax Saver Fund Direct Plan Growth | `https://groww.in/mutual-funds/hdfc-elss-tax-saver-fund-direct-plan-growth` |
| 4 | HDFC Small Cap Fund Direct Growth | `https://groww.in/mutual-funds/hdfc-small-cap-fund-direct-growth` |
| 5 | HDFC Balanced Advantage Fund Direct Growth | `https://groww.in/mutual-funds/hdfc-balanced-advantage-fund-direct-growth` |

**Note:** Groww uses the legacy `equity fund` URL slug for HDFC Flexi Cap Fund Direct Growth. The scheme-name-to-URL mapping is maintained explicitly in a single configuration file (`config/sources.ts`, see Section 11) so the correct URL is always associated with the correct scheme. Every ingestion, retrieval-validation, and citation step reads from this one source of truth.

---

## 4. Phase 1 — Data Loading

### Objective

Fetch the five approved Groww pages locally, extract the relevant textual content, validate quality, and store a raw representation separate from processed data. Data loading is a local, repeatable process and must never run as part of a Vercel user request.

### Input

- The five approved Groww URLs from `config/sources.ts`.
- The scheme-name-to-URL mapping from the same configuration.

### Processing

1. Read the five approved URLs. No other URL is ever requested.
2. For each URL, fetch the public HTML page.
3. Extract the readable text relevant to the scheme (headings, tables, and the factual fund-detail content). Charts, images, scripts, and navigation boilerplate are discarded.
4. Detect failures:
   - Non-2xx HTTP status, network error, or timeout → report a fetch failure.
   - Successful fetch but empty/negligible extracted text → report an unusable-document failure.
5. Write one raw text file per scheme and one metadata file per ingestion run.

### Output

- `data/raw/<scheme-slug>.txt` — the extracted source text for each scheme.
- `data/raw/metadata.json` (or per-scheme `<scheme-slug>.meta.json`) — ingestion metadata.

Raw content is stored separately from processed data so re-chunking or re-embedding never requires re-fetching.

### Storage / Location

Local `data/raw/` directory only. Raw Groww content is not stored in Neon and is never available to the deployed application.

### Dependencies

- Node.js runtime and a script entry point (e.g., `npm run ingest`).
- Network access to groww.in (local machine only).
- The URL configuration.

### Important Constraints

- Only the five approved URLs may be requested. The loader reads the URL list from configuration; there is no other source of URLs.
- Each URL maps to exactly one scheme.
- Loading is repeatable: re-running the process re-fetches and produces an equivalent corpus.
- No data loading occurs during normal user queries.

### Failure Handling

- Any fetch failure aborts or is clearly reported for that scheme; failures are never silently ignored (PRD Section 19).
- A partially failed run must not be mistaken for a complete corpus; the ingestion run summary records success/failure per URL.

---

## 5. Phase 2 — Chunking

### Objective

Split each raw document into small chunks suitable for short factual FAQ retrieval, preserving the metadata needed to attribute every chunk to its scheme and source page.

### Input

- Raw documents in `data/raw/`.

### Processing

Each raw document is split into chunks using a sentence-aware approach:

- **ARCHITECTURE DECISION — Chunking method:** sentence-aware fixed-size chunking. Text is split into sentences, then sentences are joined into chunks until a target length is reached. A chunk is never split in the middle of a sentence unless a single sentence exceeds the target length, in which case sentence fragments are split at a character boundary.
- **ARCHITECTURE DECISION — Chunk size:** target of **600 characters** (approximately 130–160 tokens) per chunk. This is appropriate for short factual FAQ attributes (expense ratio, minimum SIP, exit load, lock-in period, riskometer, benchmark).
- **ARCHITECTURE DECISION — Chunk overlap:** **one sentence (~80–120 characters)**, which provides context continuity while keeping the corpus small.
- Each chunk is assigned a unique identifier and the full metadata schema below.
- The source URL and scheme name are taken from `config/sources.ts` (never parsed from page content).

### Metadata Schema

| Field | Type | Purpose |
|---|---|---|
| `chunk_id` | uuid | Globally unique chunk identifier (primary key on the application side) |
| `scheme_id` | text | Stable slug for the scheme (e.g., `hdfc-large-cap-direct-growth`) |
| `scheme_name` | text | Display name from PRD Section 4 (e.g., `HDFC Large Cap Fund Direct Growth`) |
| `source_url` | text | The approved Groww URL this chunk came from |
| `source_file` | text | Reference to the raw file in `data/raw/` |
| `chunk_text` | text | The chunk content |
| `chunk_index` | integer | Sequential position of the chunk within the document (for ordering) |
| `last_updated` | text or null | Explicit source update date if present on the page, else null; never invented |

### Output

- `data/chunks/chunks.json` (or `.ndjson`) — one record per chunk with the metadata above.

### Storage / Location

Local `data/chunks/`. This is an intermediate artifact; the persisted form used at query time is produced after embedding (Phase 4).

### Dependencies

- Raw documents from Phase 1.
- `config/sources.ts` for URL/scheme mapping.

### Important Constraints

- The source URL and scheme name are preserved exactly on every chunk.
- Chunking is deterministic for the same raw input (repeatable ingestion).
- Chunk size/overlap are tunable constants, documented here, not user-facing.

### Failure Handling

- Malformed or empty raw input produces a chunking failure report for that scheme rather than silent empty chunks.

---

## 6. Phase 3 — Embedding

### Objective

Produce 384-dimensional embeddings for every chunk and for user queries, using the required model `sentence-transformers/all-MiniLM-L6-v2`, such that document embeddings and query embeddings are compatible for similarity search.

### Input

- Chunks + metadata from Phase 2.
- User questions at query time.

### Processing

- The model is the required `sentence-transformers/all-MiniLM-L6-v2`; it produces 384-dimensional embeddings (PRD Section 14/15).
- **ARCHITECTURE DECISION — Runtime consistency:** both the local ingestion path and the Vercel query path use the **same JavaScript-compatible implementation of the model** (Transformers.js / ONNX Runtime Web backend for Node.js). Using one runtime in both paths avoids the cross-runtime drift that PRD Section 14 (lines 245–247) requires validating against.

  - Local ingestion script: runs the JS-compatible implementation under Node.js.
  - Query-time (Vercel serverless): runs the same JS-compatible implementation under Node.js in the Next.js route handler.

- Because both paths share the same runtime and model, embeddings are consistent by construction. PRD Section 14 additionally requires: **if different runtimes are used, retrieval quality must be validated.** Since this design uses one runtime, the mandatory compatibility check below still verifies this assumption holds.
- **ARCHITECTURE DECISION — Determinism/provenance:** the embedding script records the model id and runtime version in the ingestion run metadata so compatibility is auditable.

### Output

- An embedding vector for every chunk, paired with its `chunk_id`.
- A 384-dimensional query embedding per user question at query time.

### Storage / Location

- Local staging: `data/embeddings/` (optional serialized vectors, e.g., `.json`/`.arrow`), used by Phase 4 for a single batch insert into Neon.
- Production: the vector column in Neon + pgvector (see Phase 4). The deployed application does not read `data/embeddings/`.

### Dependencies

- The embedding model artifact (downloaded locally during ingestion; cached in `node_modules`/model cache at build or lazily at serverless runtime).
- Chunks from Phase 2.

### Important Constraints

- Document chunks and queries must use the same model and a compatible implementation (PRD Section 14).
- Embeddings are always 384-dimensional.
- The embedding call must not require the Mistral API key or Neon credentials.

### Failure Handling

- A chunk that fails to embed is reported; the ingestion run summary marks it and does not silently skip it.
- At query time, embedding failure is surfaced as a user-friendly error (PRD Section 24).

---

## 7. Phase 4 — Vector Store

### Objective

Persist chunks, metadata, and 384-dimensional embeddings in Neon PostgreSQL using pgvector, so the deployed application can perform semantic similarity search against a pre-populated store.

### Input

- Chunks + embeddings + metadata produced in Phases 2–3.

### Processing

- Enable the pgvector extension in the Neon database: `CREATE EXTENSION IF NOT EXISTS vector;`
- **ARCHITECTURE DECISION — Similarity metric:** **cosine distance**, using the pgvector `<=>` operator. MiniLM embeddings are suitable for cosine similarity, and the metric is scale-invariant, which makes retrieval robust across the ingestion and query runtimes.

### Vector Store Schema

**ARCHITECTURE DECISION — Single-table design.** One table `chunks` holds everything required for retrieval and citation. This keeps the prototype small.

| Column | Type | Description |
|---|---|---|
| `id` | bigint GENERATED ALWAYS AS IDENTITY | Physical primary key |
| `chunk_id` | uuid | Logical chunk identifier; `UNIQUE NOT NULL` |
| `scheme_id` | text NOT NULL | Scheme slug from `config/sources.ts` |
| `scheme_name` | text NOT NULL | Scheme display name |
| `source_url` | text NOT NULL | Approved Groww URL (one of exactly five) |
| `chunk_index` | integer NOT NULL | Order within the source document |
| `chunk_text` | text NOT NULL | Chunk content |
| `last_updated` | text | Explicit source date if available; else NULL |
| `embedding` | vector(384) NOT NULL | Chunk embedding |

Constraints:

- `UNIQUE (chunk_id)` — prevents duplicate chunks.
- `source_url` is validated at write time: only the five approved URLs may be inserted.
- **ARCHITECTURE DECISION — Duplicate ingestion avoidance:** ingestion is idempotent per source document. The ingestion run replaces the chunks of a scheme that has been re-ingested (delete where `scheme_id` in this run, then insert) rather than appending duplicates. This makes re-ingestion after a source-page change safe and repeatable (PRD Section 19).

### Index Strategy

**ARCHITECTURE DECISION — Index:** create a **HNSW index** on the embedding column using vector cosine distance:

```
CREATE INDEX ON chunks USING hnsw (embedding vector_cosine_ops);
```

HNSW is appropriate for this small corpus and supports fast approximate nearest-neighbor search with cosine distance in pgvector. (Requires pgvector ≥ 0.5.0; fallback to IVFFlat is noted in the decision log if the server version requires it. The exact SQL and any fallback are validated against the Neon pgvector version during implementation, not in this document.)

### Persistence Verification

After ingestion, the process verifies:

- Row count for each `scheme_id` is greater than zero and matches the chunking output count.
- A sample of `chunk_text` values matches the source chunks.
- A sample of vector dimensions is 384 (`vector_dims(embedding) = 384`).
- Only the five approved `source_url` values exist in the table.

### Storage / Location

- Neon PostgreSQL (cloud) — the single persistence layer used by the deployed application.
- `data/vectordb/` is reserved for any local vector artifacts or SQL/seed scripts used to stage/populate Neon. It is **not** a runtime database store for the deployed app.

### Dependencies

- Neon PostgreSQL instance with pgvector extension.
- Embeddings and chunks from Phases 2–3.

### Important Constraints

- Chunk text, source URL, and scheme name are stored with every embedding for citation and filtering (PRD Section 16/17).
- The deployed application never ingests; it only reads an already-populated Neon database (PRD Section 19).

### Failure Handling

- Connection failures during persistence are reported; the run summary indicates the store was not fully populated.
- Insertion of a non-approved `source_url` is rejected (application-level check in addition to configuration).

---

## 8. Phase 5 — Retrieval Logic

### Objective

Given a user question, produce the relevant chunks (with metadata) used to generate a fact-only answer, while strictly honoring the single-source citation rule and the five-URL corpus.

### Input

- User question (normalized text).
- Pre-populated Neon + pgvector store.

### Processing

The complete retrieval flow:

```
User question
  → Query embedding (384-d, same model/runtime as ingestion)
  → pgvector cosine similarity search
  → Top-k candidate chunks
  → Source validation (all candidate chunk URLs are among the approved five)
  → Single-source resolution
  → Context bundle for the LLM (chunk text + source metadata)
```

### Retrieval Parameters

**ARCHITECTURE DECISION — Top-k:** **3** chunks for this small corpus. This is enough context to answer typical single-attribute FAQ questions without flooding the prompt.

**ARCHITECTURE DECISION — Similarity metric:** **cosine** (`<=>` distance, small distance = high similarity).

**ARCHITECTURE DECISION — Similarity threshold:** a **soft minimum cosine-similarity guard** of **0.5** (configurable in `config/retrieval.ts`). The top-k query still returns k candidates, but if the top result falls below the guard, retrieval is treated as "no relevant information found in the approved sources" and the system responds accordingly instead of forcing a low-quality answer.

**ARCHITECTURE DECISION — Retrieval filtering:** pre-search filter on `source_url IN (five approved URLs)`. Although only approved URLs exist in the table by construction, the filter is enforced at the query layer too (defense in depth).

### Single-Source Rule Enforcement

- The retrieval layer groups retrieved chunks by `source_url`.
- If the question can be answered from chunks of **one** source page, generation proceeds with that single source (single-scheme questions, including multi-attribute questions such as "What are the expense ratio and minimum SIP of HDFC Large Cap?").
- If answering requires combining chunks from **multiple** source pages (e.g., any cross-fund comparison), the system must **refuse** the question politely rather than combine sources. Per PRD Sections 9, 20, and 27 (Test 9), cross-fund questions are refused.

  Implementation shape: the retrieval layer returns the top-k chunks plus their `source_url` identity. The generation layer (Phase 7) is instructed that multi-source combinations are impermissible and that such questions must be refused. If the question itself explicitly references two distinct schemes, the server layer rejects it before generation as a cross-fund question (fast-path refusal).

### Output

- A context bundle: query embedding, retrieved chunk(s) with `chunk_text`, `source_url`, `scheme_name`, `last_updated`.
- A single selected `source_url` for the citation (the page from which the answer derives).
- A refusal signal for multi-source/cross-fund questions.

### Storage / Location

- In-memory only; no persistence of user questions or retrieved context.

### Dependencies

- Neon + pgvector (Phase 4).
- Query embedding (Phase 3).
- Approved URL configuration.

### Important Constraints

- Retrieval must not use information outside the five approved URLs (PRD Section 20).
- The single-source citation model is preserved end to end.
- No user queries or PII are persisted (PRD Sections 13/25).

### Failure Handling

- Neon/retrieval failure → user-friendly error (PRD Section 24).
- No chunk above the relevance guard → "information not available in the approved sources" response.
- Multi-source requirement detected → polite refusal.

---

## 9. Phase 6 — Retrieval Testing

### Objective

Validate that retrieval selects the expected source page for known questions, and that refusal behaviors work, using a manual, repeatable test procedure during development.

### Approach

A manual script (or set of prepared queries in `tests/retrieval/`) runs each query through the retrieval layer (Phase 5) **without** generation, then a reviewer checks the returned `source_url`.

### Factual Query Suite (PRD Section 27)

| # | Query | Expected source |
|---|---|---|
| 1 | What is the expense ratio of HDFC Large Cap? | HDFC Large Cap page |
| 2 | What is the lock-in period for HDFC ELSS? | HDFC ELSS page |
| 3 | What is the minimum SIP for HDFC Small Cap? | HDFC Small Cap page |
| 4 | What is the exit load of HDFC Flexi Cap? | HDFC Flexi Cap page (legacy URL) |
| 5 | What is the riskometer of HDFC Balanced Advantage? | HDFC Balanced Advantage page |

### Refusal / Edge-Case Suite (PRD Sections 23, 26, 27)

| # | Query | Expected behavior |
|---|---|---|
| 6 | Which HDFC fund should I invest in? | Polite facts-only refusal (investment advice) |
| 7 | Which HDFC fund has the best returns? | Polite refusal (performance comparison) |
| 8 | What is the expense ratio of SBI Bluechip Fund? | Inform scheme is outside supported corpus |
| 9 | What are the expense ratios of HDFC Large Cap and HDFC Small Cap? | Polite refusal (multi-source / cross-fund) |
| 10 | What is the capital of France? | Irrelevant question → no general-model answer; "not in approved sources" response |
| 11 | What is the expense ratio of HDFC Large Cap if taxes were different? | Response that the information is not available in the approved source |

### Definition of Successful Retrieval

- Query #1–5: the top-k results include the expected `source_url`, and the question is answerable from that single source.
- Query #6–11: the correct refusal/unsupported/information-unavailable response is produced; no hallucinated content appears; no non-approved source is cited or retrieved.
- No run retrieves a URL outside the five approved URLs.
- The `last_updated` value (if present in the source) is returned with the chunk metadata.

---

## 10. Phase 7 — Answer Generation

### Objective

Generate concise, facts-only answers from the retrieved single-source context using the Mistral API, enforcing every answer constraint from the PRD.

### Where the Mistral API Call Occurs

- The Mistral API is called **server-side** in the Next.js application (inside the server/API layer). The Mistral API key is a server-only environment variable and is never exposed to the browser (PRD Sections 19/25).

### Model and Generation Parameters

**ARCHITECTURE DECISION — Mistral model:** `mistral-small-latest` as the default (a low-cost, capable model suited to a small factual RAG prototype). The model name is configurable via environment variable `MISTRAL_MODEL` so it can be changed without code changes.

**ARCHITECTURE DECISION — Temperature:** `0.0`. Answers must be strictly factual and grounded in the retrieved context; no creative latitude.

**ARCHITECTURE DECISION — Max tokens:** `300`. Enough for a ≤3-sentence answer body plus the last-updated line, with margin, while keeping latency and cost low.

### API Key Protection

- Key is read from `MISTRAL_API_KEY` server-side only.
- Never sent to the client, never logged, never committed to Git.

### System Prompt Responsibility

The system prompt instructs the model to:

- Use only the retrieved context provided.
- Answer factual questions only.
- Never invent facts.
- Never provide investment advice.
- Never make performance predictions or calculate/compare returns.
- Keep the factual answer **body** within three sentences.
- Provide exactly one source link (the single source URL from the context).
- Include the required "Last updated from sources: …" line.
- State when the requested information is not available in the retrieved source.
- Refuse cross-fund/multi-source questions.
- Refuse investment-advice and opinion questions with a polite facts-only message.

### Context Passed to Mistral

- The retrieved chunk texts.
- The single selected `source_url`.
- The `scheme_name`.
- The `last_updated` metadata (or an explicit "date unavailable on source" marker).

### Answer Constraints (Enforced at Generation and Post-Validation)

- **3-sentence body:** the factual answer body is at most three sentences. The source link and the "Last updated from sources" line are metadata and do not count toward the limit (PRD Sections 9/10).
- **Exactly one source link:** the citation is the single approved URL the answer derives from; never a different or non-approved source (PRD Section 9).
- **Last-updated line:** always present in the exact format from PRD Section 11:
  - `"Last updated from sources: [date/information available from the source]."`
  - If the source has no explicit date: `"Last updated from sources: Date unavailable on source."`
  - The system never invents or infers a date.
- **No PII** requested or stored (PRD Sections 13/25).

### Citation and Last-Updated Handling

- Citation is appended as a metadata element (e.g., a source link) rather than counted inside the body sentence limit.
- `last_updated` is drawn solely from ingestion metadata (Phase 2); if null, the "Date unavailable on source" text is used.

### Refusal Behavior

- Investment advice, opinions, performance questions, cross-fund questions, irrelevant questions, and questions whose information is unavailable → a polite, facts-only refusal or information-unavailable response. No general model knowledge is used (PRD Section 23).

### Failure Handling

- Mistral failure or rate limiting → user-friendly error message (PRD Section 24); API keys/stack traces never exposed.

---

## 11. Phase 8 — Frontend Integration

### Objective

Provide a small chat UI in the Next.js application matching PRD Section 21, with a simple Groww-inspired visual style, without replicating Groww's website.

### UI Structure

The page must contain (PRD Section 21):

1. Welcome message
2. Chat/question input
3. Three example questions (PRD Section 22):
   - What is the expense ratio of HDFC Large Cap?
   - What is the lock-in period for HDFC ELSS?
   - What is the minimum SIP for HDFC Small Cap?
4. Facts-only disclaimer: `"Facts-only. No investment advice."`
5. Assistant response
6. One source link
7. Last-updated information

### Interaction Flow

```
User submits question
  → Loading state (indicator while embedding+retrieval+generation run)
  → Answer rendered: response body, one source link, last-updated line
  → Error state if a failure occurred (user-friendly, no internals)
```

- **Loading state:** shown while the server-side pipeline is in progress.
- **Error state:** friendly message for Neon/Mistral/embedding failures; no stack traces, API keys, or credentials (PRD Section 24).
- **Source link display:** the single approved URL from the answer metadata, rendered as a link.
- **Last-updated display:** the exact "Last updated from sources: …" line.

### Client/Server Boundary

- The browser renders the UI and sends the question to the server/API layer.
- Mistral API key and Neon credentials remain server-side only (PRD Sections 19/25). The client never receives them.
- UI sends no PII; the app does not collect PAN, Aadhaar, account numbers, OTPs, phone numbers, or email addresses (PRD Section 13).

### Style

- Simple visuals inspired by Groww's clean, green-accented design language (PRD Section 21), implemented with Tailwind already present in the project. It is a small original UI; it does not replicate the Groww website.

### Note on Next.js Version

This repository uses Next.js 16 and React 19 (see `package.json`). Per the project AGENTS.md, this Next.js version has breaking changes from older versions. Before implementing the frontend, the relevant guides under `node_modules/next/dist/docs/` must be reviewed so that the App Router pages and server code follow this specific version's conventions. The architecture intentionally keeps the UI thin (page + API route/server call) to minimize version-specific surface area.

---

## 12. Phase 9 — Deployment

### Objective

Deploy the Next.js application to Vercel such that it answers questions against the already-populated Neon vector store. The vector database is populated by the separate local ingestion process; deployment does not fetch Groww pages.

### What Runs Where

| Concern | Runs at |
|---|---|
| Data loading (Groww fetch) | Local ingestion only — **never** on Vercel |
| Chunking | Local ingestion only |
| Embedding of chunks | Local ingestion only |
| Populating Neon/pgvector | Local ingestion only |
| User-query embedding | Vercel serverless (query time) |
| Vector retrieval | Vercel serverless (query time) |
| Mistral generation | Vercel serverless (query time) |
| UI rendering | Vercel (client + server components) |

### Why Ingestion Is Not Performed on Every Request

- Ingestion is an offline, repeatable process (PRD Section 19). Running it per request would be wasteful, slow, and violate the PRD's local-only requirement.
- At request time the application reads the pre-populated Neon database only.
- Re-ingestion is a deliberate manual re-run after approved source pages change (PRD Section 19), not part of the serving path.

### Environment Variables

Defined in `.env` locally and as Vercel project environment variables in production. Names below are the working set (generic; actual values are never committed):

| Variable | Server-only | Purpose |
|---|---|---|
| `MISTRAL_API_KEY` | Yes | Mistral API authentication |
| `DATABASE_URL` | Yes | Neon PostgreSQL connection string (with pgvector) |
| `MISTRAL_MODEL` | Yes | Mistral model name (default `mistral-small-latest`) |

No `NEXT_PUBLIC_` secret variables are used; Mistral and Neon credentials must not reach the browser.

### Secret Handling

- Local: `.env` (already excluded from Git via `.gitignore`).
- Production: Vercel environment variables (PRD Section 25).
- The browser never receives the Mistral API key or database credentials (PRD Section 25).

### Neon Connection Handling

- The server/API layer opens a short-lived connection to Neon on each request using `DATABASE_URL`.
- Connection errors surface as user-friendly errors; connection pooling is kept minimal for a prototype.

### Mistral API Handling

- Called server-side with `MISTRAL_API_KEY`.
- Rate-limit and API failures are caught and reported as user-friendly errors (PRD Section 24).

### Production Failure Handling

| Failure | Behavior |
|---|---|
| Neon connection failure | User-friendly error; no credentials/stack traces exposed |
| Mistral API failure | User-friendly error; retry is optional and not required for the prototype |
| Retrieval failure | User-friendly error; no internal details |
| Embedding failure (query time) | User-friendly error; no internal details |

Detailed production monitoring is outside the scope of this prototype (PRD Section 24).

---

## 13. Data Directory

Clear separation between local working data and application code.

| Path | Contents |
|---|---|
| `data/raw/` | One extracted text file per scheme (`.txt`) from Phase 1, plus ingestion metadata (`.json`). Never served by the app; never deployed. |
| `data/chunks/` | Chunk records (`.json`/`.ndjson`) produced by Phase 2, including metadata. |
| `data/embeddings/` | Optional staged embeddings produced by Phase 3, used to batch-load Neon. |
| `data/vectordb/` | Local vector artifacts or seed/SQL scripts used to stage and populate Neon. The final/runtime vector store is Neon + pgvector, not a local file. |

These directories are gitignored (`/data`) so raw Groww content and staged artifacts are not committed.

---

## 14. Code Structure

A simple prototype-appropriate layout separating concerns:

```
mf-faq-rag/
├── app/                         # Next.js UI (App Router)
│   ├── layout.tsx
│   ├── page.tsx                 # Chat page (input, examples, disclaimer, answers)
│   └── globals.css
├── app/api/                     # Server/API layer (server-side)
│   └── chat/route.ts            # Handles question → answer (embeddings, retrieval, Mistral)
├── config/
│   ├── sources.ts               # Single source of truth: 5 approved URLs ↔ scheme mapping
│   └── retrieval.ts             # Top-k, similarity threshold, embedding/model settings
├── lib/
│   ├── ingestion/
│   │   ├── load.ts              # Phase 1: fetch + extract + validate the 5 URLs
│   │   └── index.ts             # Orchestrates the full local ingestion run
│   ├── chunking/index.ts        # Phase 2: chunking + metadata
│   ├── embedding/index.ts       # Phase 3: 384-d embeddings (shared by ingest + query)
│   ├── vectorstore/
│   │   ├── schema.sql           # Phase 4: table + pgvector index definitions
│   │   └── client.ts            # Neon connection + CRUD/insert helpers
│   ├── retrieval/index.ts       # Phase 5: query embed, top-k search, source validation
│   ├── generation/
│   │   ├── prompt.ts            # Phase 7: system prompt
│   │   └── mistral.ts           # Phase 7: Mistral client (server-side)
│   └── types.ts                 # Shared types (chunk, metadata, answer)
├── scripts/
│   └── ingest.ts                # CLI entry: npm run ingest (Phase 1–4, local)
├── tests/
│   ├── retrieval/               # Phase 6: retrieval test queries + expected sources
│   └── ...                      # Unit tests for chunking, metadata, retrieval, refusals
├── docs/
│   ├── PRD.md
│   └── architecture.md
├── data/                        # Local working data (gitignored): raw/, chunks/, embeddings/, vectordb/
├── .env                         # Local secrets (gitignored)
└── .gitignore
```

### Configuration as Single Source of Truth

- `config/sources.ts` holds the five approved URLs and their scheme mapping (including the legacy Flexi Cap URL). All phases read from it: no hardcoded URL lists outside this file.

---

## 15. Security

- **`.env` usage:** local secrets live in `.env`, which is gitignored (`/docs/.env` is not used; the root `.env` is excluded by the existing `.gitignore` `.env*` rule).
- **Required environment variables:** `MISTRAL_API_KEY`, `DATABASE_URL`, `MISTRAL_MODEL` (see Phase 9).
- **Secret handling:** local = `.env`; production = Vercel environment variables. Secrets are never committed to GitHub (PRD Section 25).
- **Server-only API keys:** `MISTRAL_API_KEY` and `DATABASE_URL` are read only in the server/API layer and never exposed to the browser.
- **No PII storage:** the application does not request or store PAN, Aadhaar, account numbers, bank account numbers, OTPs, phone numbers, or email addresses. No PII is persisted as part of chat interactions (PRD Sections 13/25).
- **No credentials in Git:** enforced by `.gitignore` (`.env*`) and by never committing secrets.
- **No sensitive data sent to the client:** only the answer body, one source URL, and the last-updated line cross to the client.

---

## 16. Constraint Compliance Checklist

The architecture preserves every PRD constraint:

| Constraint | Where enforced |
|---|---|
| Exactly five approved Groww URLs | `config/sources.ts`; ingestion filters; retrieval `source_url IN (...)`; persistence verification |
| No third-party sources | Same five-URL enforcement throughout |
| Facts-only | System prompt + retrieval grounding + UI disclaimer |
| No investment advice | System prompt + refusal logic (PRD Sections 7/23) |
| No performance claims | System prompt + refusal logic (PRD Sections 8/23) |
| No return calculations | System prompt + no such features in code structure |
| No return predictions | System prompt + no such features in code structure |
| No PII | No PII fields in UI, API, or store (PRD Section 13) |
| Exactly one source link per factual answer | Single-source validation (Phase 5) + citation handling (Phase 7) |
| Max three sentences in answer BODY | Prompt instruction + generation constraint (PRD Section 10) |
| Last-updated information required | Metadata (`last_updated`) + exact display format (PRD Section 11) |
| Refuse cross-fund/multi-source questions | Fast-path scheme check + single-source rule + refusal tests (#9) |
| No hallucinated information | Retrieval-only grounding; "not available in sources" responses; no general model knowledge |
| Local repeatable ingestion | `scripts/ingest.ts`, idempotent per scheme, run locally only |
| Vercel for deployment | Phase 9 |
| Neon + pgvector for vector storage | Phase 4 |

---

## 17. Architecture Decision Log

All choices filled in for PRD-deferred items are listed here with rationale and tunability.

| Decision | Value | Rationale | Where |
|---|---|---|---|
| Chunking method | Sentence-aware fixed-size | Keeps facts intact; simple | Phase 2 |
| Chunk size | ~600 characters | Short FAQ attributes | Phase 2 |
| Chunk overlap | ~1 sentence (80–120 chars) | Context continuity | Phase 2 |
| Embedding runtime | Single JS-compatible runtime (Transformers.js/ONNX) for ingest + query | Avoids cross-runtime drift; satisfies PRD compatibility requirement | Phase 3 |
| Similarity metric | Cosine (`<=>`) | Scale-invariant; appropriate for MiniLM | Phase 4/5 |
| Vector index | HNSW with `vector_cosine_ops` (fallback IVFFlat if server version requires) | Fast approximate search on small corpus | Phase 4 |
| Duplicate avoidance | Per-scheme idempotent replace on re-ingest | Repeatable ingestion | Phase 4 |
| Top-k | 3 | Small corpus; enough single-source context | Phase 5 |
| Similarity threshold | Soft guard 0.5 (configurable) | Reject low-quality/no-match retrieval | Phase 5 |
| Mistral model | `mistral-small-latest` (configurable via `MISTRAL_MODEL`) | Low-cost, factual-capable | Phase 7 |
| Mistral temperature | 0.0 | Strictly factual | Phase 7 |
| Mistral max tokens | 300 | 3-sentence body + metadata | Phase 7 |

---

## 18. Open Items (Non-Blocking)

- Web scraping/HTML extraction mechanism for Groww pages (implementation detail; the loader may use a lightweight HTML-to-text parser; to be decided during implementation based on page structure).
- Exact Neon pgvector version determines HNSW vs IVFFlat availability (checked at implementation time).
- Exact Mistral model name availability is confirmed against the Mistral API catalog when the key is provisioned (the code references the configurable env var).
- Hallucination evaluation is manual review of generated answers during development (no automated rubric; PRD does not require one).