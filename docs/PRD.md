# Product Requirements Document

# Mutual Fund FAQ RAG Assistant

## 1. Product Overview

A small Retrieval-Augmented Generation (RAG) based FAQ assistant that answers factual questions about five HDFC mutual fund schemes.

The assistant will retrieve information only from the five approved Groww public pages and use the retrieved information to generate concise factual answers.

The assistant is a prototype/hobby project intended to demonstrate a small RAG system.

---

## 2. Product Objective

Build a working RAG chatbot that can:

* Retrieve relevant information from the approved mutual fund source pages.
* Answer factual questions about the supported schemes.
* Provide one source link with every factual answer.
* Keep answers concise.
* Refuse investment advice and opinion-based questions.
* Avoid hallucinating information that is not available in the approved sources.

---

## 3. Target Users

### Primary Users

Retail users who want to find factual information about the five supported mutual fund schemes.

### Secondary Users

Support/content teams that need quick answers to repetitive factual mutual fund questions.

---

## 4. Supported Mutual Fund Schemes

The chatbot supports exactly these five schemes:

1. HDFC Large Cap Fund Direct Growth
2. HDFC Flexi Cap Fund Direct Growth
3. HDFC ELSS Tax Saver Fund Direct Plan Growth
4. HDFC Small Cap Fund Direct Growth
5. HDFC Balanced Advantage Fund Direct Growth

---

## 5. Approved Source Corpus

The RAG system must use only the following five public Groww pages.

### HDFC Large Cap Fund Direct Growth

https://groww.in/mutual-funds/hdfc-large-cap-fund-direct-growth

### HDFC Flexi Cap Fund Direct Growth

https://groww.in/mutual-funds/hdfc-equity-fund-direct-growth

Note: Groww uses the legacy "equity fund" URL slug for HDFC Flexi Cap Fund.

### HDFC ELSS Tax Saver Fund Direct Plan Growth

https://groww.in/mutual-funds/hdfc-elss-tax-saver-fund-direct-plan-growth

### HDFC Small Cap Fund Direct Growth

https://groww.in/mutual-funds/hdfc-small-cap-fund-direct-growth

### HDFC Balanced Advantage Fund Direct Growth

https://groww.in/mutual-funds/hdfc-balanced-advantage-fund-direct-growth

No other websites or pages are part of the RAG corpus.

The scheme name and URL mapping must be explicitly maintained in the application configuration so that the legacy Flexi Cap URL is correctly associated with HDFC Flexi Cap Fund Direct Growth.

---

## 6. Supported Questions

The assistant should answer factual questions about one supported scheme using information from that scheme's approved Groww page.

Examples include:

* What is the expense ratio of HDFC Large Cap?
* What is the minimum SIP for HDFC Small Cap?
* What is the exit load of HDFC Flexi Cap?
* What is the lock-in period for HDFC ELSS?
* What is the riskometer of HDFC Balanced Advantage?
* What are the expense ratio and minimum SIP of HDFC Large Cap?

Cross-fund factual comparison questions are outside the scope of this prototype because each supported scheme has a separate source page and every answer must contain exactly one source link.

---

## 7. Unsupported Questions

The assistant must not provide investment advice or opinions.

Examples:

* Should I buy this fund?
* Should I sell this fund?
* Which fund should I invest in?
* Which fund is best?
* Which fund is safest?
* Which fund will give better returns?
* Which fund should I choose?

For such questions, the assistant should provide a polite facts-only refusal.

---

## 8. Performance Restrictions

The assistant must not:

* Calculate investment returns.
* Compare fund performance.
* Predict future returns.
* Make performance-based investment recommendations.
* Recommend a fund based on historical or expected returns.

Questions involving factual attributes of a single supported scheme are allowed.

For example:

* What is the expense ratio of HDFC Large Cap?
* What are the expense ratio and exit load of HDFC Small Cap?

Cross-fund comparisons are not supported, even when the comparison involves factual attributes such as expense ratio or minimum SIP.

---

## 9. Citation Requirement

Every factual answer must contain exactly one clear source link.

The source link must correspond to the approved Groww page from which the answer was derived.

The source link and the "Last updated from sources" information are metadata and do not count toward the three-sentence answer limit.

If a question requires information from multiple source pages, the assistant must not combine information from multiple pages into a single answer because the prototype requires one source link per answer.

Instead, the assistant should politely state that the requested answer cannot be provided under the single-source constraint.

---

## 10. Answer Length

The factual answer body must contain no more than three sentences.

The following are excluded from the three-sentence limit:

* The source link.
* The "Last updated from sources" line.

Answers should be:

* Direct
* Concise
* Factual
* Easy to understand

---

## 11. Last Updated Requirement

Every answer must include:

"Last updated from sources: [date/information available from the source]."

The system must not invent a last-updated date.

If an exact source update date is available on the approved source page, use that date.

If an exact update date is not available, display:

"Last updated from sources: Date unavailable on source."

The system should not infer or fabricate an update date.

---

## 12. Facts-Only Disclaimer

The UI must display:

"Facts-only. No investment advice."

The assistant provides factual information from the approved public sources and does not provide investment recommendations.

---

## 13. PII Restrictions

The application must not accept, store, or request unnecessary personally identifiable information.

The system must not collect or store:

* PAN
* Aadhaar
* Mutual fund account numbers
* Bank account numbers
* OTPs
* Phone numbers
* Email addresses

The application should not require any of these details to answer FAQ questions.

---

## 14. RAG Requirements

The system will use a Retrieval-Augmented Generation architecture.

### Data Ingestion

Approved Groww URLs
→ Document loading
→ Text extraction
→ Raw documents

### Chunking

Raw documents
→ Smaller chunks
→ Chunk metadata

### Embedding

Chunks
→ `sentence-transformers/all-MiniLM-L6-v2`
→ 384-dimensional embeddings

The embedding model must produce consistent embeddings for both document chunks and user queries.

The implementation may use a JavaScript-compatible implementation of the same model for query-time embeddings where required by the deployment architecture.

Document and query embeddings must use the same model and compatible implementation.

If different runtimes are used for ingestion and query-time embedding, the implementation must validate that the resulting embeddings preserve retrieval quality during testing.

### Vector Store

Embeddings and metadata
→ Neon PostgreSQL
→ pgvector

### Retrieval

User question
→ Query embedding
→ Vector similarity search
→ Relevant chunks

### Generation

Relevant chunks
→ Mistral API
→ Factual answer
→ One source citation
→ Last-updated information

---

## 15. Technology Requirements

### Development Environment

VS Code

### Coding Assistant

OpenCode

### Frontend

Next.js

### Deployment

Vercel

### Database

Neon PostgreSQL

### Vector Search

pgvector

### Embedding Model

`sentence-transformers/all-MiniLM-L6-v2`

The model produces 384-dimensional embeddings.

### LLM

Mistral API

The exact Mistral model variant and generation parameters will be defined in `architecture.md`.

### Version Control

Git and GitHub

---

## 16. Chunking Requirements

The system must split the five source documents into smaller chunks suitable for semantic retrieval.

Chunk size, overlap, and exact chunking implementation are architectural decisions and must be documented in `architecture.md`.

Every chunk must retain sufficient metadata to identify:

* Chunk ID
* Source document
* Scheme name
* Source URL
* Source/update information where available

---

## 17. Vector Retrieval Requirements

The vector store must support semantic similarity search using pgvector.

The following parameters must be explicitly defined in `architecture.md`:

* Embedding dimension
* Similarity/distance metric
* Top-k retrieval count
* Similarity threshold, if used
* Vector index strategy, if used

The retrieval implementation must return source metadata together with the retrieved content.

---

## 18. LLM Requirements

Mistral will be used for answer generation.

The exact Mistral model variant and generation parameters will be defined in `architecture.md`.

The LLM must be instructed to:

* Use only the retrieved context.
* Answer factual questions only.
* Never invent information.
* Never provide investment advice.
* Never make performance predictions.
* Keep the factual answer body within three sentences.
* Provide one source link.
* Include last-updated information.
* State when the requested information is not available in the retrieved source.

---

## 19. Data Ingestion Lifecycle

Data ingestion is a local, repeatable process.

The ingestion pipeline will:

1. Read the five approved Groww URLs.
2. Fetch the source pages.
3. Extract relevant content.
4. Create chunks.
5. Generate embeddings.
6. Persist chunks, metadata, and embeddings in Neon + pgvector.

Ingestion does not run during normal user queries.

The application deployed to Vercel retrieves data from the already-populated Neon database.

The ingestion process should be rerunnable when the approved source pages change.

The implementation should report page-fetch or extraction failures instead of silently ignoring them.

---

## 20. Multi-Source Query Handling

The prototype uses a single-source-per-answer citation model.

If a question can be answered completely from one approved source page, the assistant should answer it.

If a question requires information from multiple approved source pages, the assistant must not combine those sources into one response.

Instead, it should politely state that the question requires information from multiple sources and cannot be answered under the current single-source constraint.

Cross-fund questions are therefore outside the scope of the prototype.

---

## 21. User Interface Requirements

The UI should be intentionally small.

It must contain:

1. Welcome message
2. Chat/question input
3. Three example questions
4. Facts-only disclaimer
5. Assistant response
6. One source link
7. Last-updated information

The UI should use a simple visual style inspired by Groww.

The UI should not attempt to replicate the entire Groww website.

---

## 22. Example Questions

The UI should provide three example questions:

1. What is the expense ratio of HDFC Large Cap?
2. What is the lock-in period for HDFC ELSS?
3. What is the minimum SIP for HDFC Small Cap?

---

## 23. Edge Cases

The system should handle:

### Investment Advice

Refuse politely.

### Unsupported Scheme

Inform the user that the scheme is outside the supported corpus.

### Unsupported Information

Inform the user when the requested information cannot be found in the approved source.

### Irrelevant Questions

Do not answer using general model knowledge.

### PII

Do not request or store PII.

### Performance Questions

Do not calculate, compare, predict, or recommend based on returns.

### Ambiguous Questions

Ask for clarification or provide a cautious facts-only response rather than assuming the user's intended scheme.

### Multi-Source Questions

Do not combine multiple source pages.

Politely refuse questions that require information from multiple source pages.

---

## 24. Infrastructure Failure Handling

The prototype should provide user-friendly error handling for:

* Source page fetch failure
* Retrieval failure
* Neon database connection failure
* Mistral API failure
* Mistral API rate limiting
* Embedding generation failure

The application must not expose API keys, database credentials, stack traces, or internal infrastructure details to users.

Detailed production monitoring is outside the scope of this prototype.

---

## 25. Security Requirements

API keys must never be committed to GitHub.

Local secrets must be stored in `.env`.

Production secrets must be stored as Vercel environment variables.

The browser must not receive the Mistral API key or database credentials.

No PII should be persisted as part of the chatbot interaction.

---

## 26. Testing Requirements

The prototype must include testing for:

### Data Loading

* All five URLs load successfully.
* No unexpected source URLs are ingested.

### Chunking

* Chunks are created for all five documents.
* Chunks are non-empty.
* Chunk metadata is present.

### Embeddings

* Every chunk has an embedding.
* Embedding dimensions are correct.
* Document and query embeddings use the same embedding approach.
* If different runtimes are used, retrieval quality is validated.

### Vector Store

* Chunks and embeddings persist in Neon.
* Source URLs are correctly stored.
* No unexpected documents exist in the vector store.

### Retrieval

Test known factual questions against expected source pages.

### Generation

Verify that generated answers:

* Use retrieved context.
* Stay within the three-sentence answer-body limit.
* Include one source link.
* Include last-updated information.
* Do not hallucinate unsupported facts.

### Edge Cases

Test:

* Investment advice
* Irrelevant questions
* Unsupported schemes
* PII-related questions
* Performance questions
* Ambiguous questions
* Multi-source questions
* Cross-fund comparisons

---

## 27. Retrieval and Edge-Case Test Queries

### Test 1 — Expense Ratio

Input:

"What is the expense ratio of HDFC Large Cap?"

Expected source:

HDFC Large Cap Fund Direct Growth Groww page.

### Test 2 — ELSS Lock-in

Input:

"What is the lock-in period for HDFC ELSS?"

Expected source:

HDFC ELSS Tax Saver Fund Direct Plan Growth Groww page.

### Test 3 — Minimum SIP

Input:

"What is the minimum SIP for HDFC Small Cap?"

Expected source:

HDFC Small Cap Fund Direct Growth Groww page.

### Test 4 — Exit Load

Input:

"What is the exit load of HDFC Flexi Cap?"

Expected source:

HDFC Flexi Cap Fund Direct Growth Groww page using the approved legacy URL.

### Test 5 — Riskometer

Input:

"What is the riskometer of HDFC Balanced Advantage?"

Expected source:

HDFC Balanced Advantage Fund Direct Growth Groww page.

### Test 6 — Investment Advice

Input:

"Which HDFC fund should I invest in?"

Expected:

Polite facts-only refusal.

### Test 7 — Performance Question

Input:

"Which HDFC fund has the best returns?"

Expected:

Polite refusal because performance comparison is outside scope.

### Test 8 — Unsupported Scheme

Input:

"What is the expense ratio of SBI Bluechip Fund?"

Expected:

Inform the user that the scheme is outside the supported corpus.

### Test 9 — Cross-Fund Comparison

Input:

"What are the expense ratios of HDFC Large Cap and HDFC Small Cap?"

Expected:

Polite refusal because the question requires information from multiple source pages.

---

## 28. Success Criteria

The prototype is considered successful when:

1. All five approved source pages can be ingested.
2. No unapproved source pages are ingested.
3. Documents are correctly chunked.
4. Chunks retain source metadata.
5. Chunks receive embeddings.
6. Embeddings and metadata are persisted in Neon + pgvector.
7. Relevant chunks can be retrieved for factual questions.
8. Mistral generates answers using retrieved context.
9. The factual answer body contains no more than three sentences.
10. Every factual answer contains exactly one clear source link.
11. Every answer includes last-updated information.
12. Investment advice questions are refused.
13. PII is not collected or stored.
14. Performance calculations/comparisons are not performed.
15. Unsupported information is not hallucinated.
16. Cross-fund questions are refused.
17. The application works locally.
18. The application can be deployed to Vercel.
19. The production application successfully performs the complete RAG flow.

---

## 29. Known Limitations

* The knowledge corpus is intentionally restricted to five Groww pages.
* The assistant cannot answer questions requiring information outside those sources.
* The assistant is not an investment advisor.
* The assistant does not provide personalized financial recommendations.
* The assistant does not calculate or compare investment performance.
* Cross-fund comparison questions are outside the scope of this prototype.
* Source pages may change after ingestion.
* The prototype does not provide comprehensive production monitoring.
* Last-updated information may be unavailable when the approved source does not expose an explicit update date.
* Multi-source answers are intentionally restricted because each answer must contain one source link.
* Retrieval and answer quality depend on the quality and structure of the approved source pages.
