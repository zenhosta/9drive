# AI Memory Implementation Plan

## Phase 1 — Safe foundation (current)
- Keep the existing multi-account storage implementation unchanged.
- Add local environment-file ignore rules and a frontend environment template.
- Document the AI-memory design and security boundaries.

## Phase 2 — File inventory and indexing controls
- Add a user-owned document index table.
- Add explicit opt-in controls per connected account.
- Add resumable indexing jobs and progress status.
- Start with metadata-only inventory; do not download file bodies until indexing is enabled.

## Phase 3 — Text extraction
- Add bounded, streaming downloads for supported file types.
- Add TXT, Markdown, PDF, DOCX, and HTML extraction.
- Store extraction status and parser errors.
- Apply limits for file size, page count, and processing time.

## Phase 4 — Embeddings and vector storage
- Add provider-neutral embedding interface.
- Add Qdrant as an optional Docker service.
- Store vectors with user, account, file, chunk, and modified-time metadata.
- Make upserts idempotent.

## Phase 5 — Retrieval API
- Add authenticated semantic search.
- Enforce user scope on every vector query.
- Return source file metadata and relevant snippets.
- Add deletion and re-index controls.

## Phase 6 — Memory interface
- Add a Memory page with source accounts, indexing progress, searchable content, and delete controls.
- Add chat retrieval with source citations.
- Treat retrieved document text as untrusted data.
