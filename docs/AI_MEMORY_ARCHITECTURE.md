# AI Memory Integration Architecture

This document defines the planned AI memory layer for 9Drive. It does not change the existing storage or Google OAuth flows.

## Goal

Use connected Google Drive and S3 storage accounts as the source of files for a personal AI memory system. The AI layer indexes supported files and retrieves relevant passages. It must not treat combined storage quota as a model context window.

## Existing capabilities

- 9Drive can connect multiple Google Drive accounts to one user.
- 9Drive can connect S3-compatible storage.
- The backend stores connected-account tokens encrypted.
- The existing file index stores provider file IDs and metadata.
- Google Drive content is stored under the `9drive` app folder.
- Uploads are routed to an account with available capacity.

## Proposed data flow

1. Enumerate connected accounts for the authenticated user.
2. Sync eligible file metadata from each account.
3. Extract text from supported formats (initial targets: TXT, Markdown, PDF, DOCX, HTML).
4. Normalize text and split it into chunks with source metadata.
5. Generate embeddings with a configurable embedding provider.
6. Store vectors and metadata in a vector database.
7. Retrieve relevant chunks for a user query.
8. Pass retrieved chunks to an LLM with source citations.

## Proposed components

- Ingestion worker: asynchronous, resumable jobs; per-account rate limits.
- Extractors: isolated parsers with file-size and content-type limits.
- Embeddings: provider interface; do not hard-code a paid API.
- Vector store: Qdrant as an optional service.
- Metadata: existing MySQL records plus indexed document/chunk status.
- Retrieval API: authenticated, user-scoped search endpoint.
- UI: future Memory page for indexing status, search, and account-level controls.

## Security and privacy

- Never expose Google refresh tokens to the browser or indexing worker logs.
- Enforce user ownership on every document and chunk query.
- Encrypt credentials at rest.
- Keep vector payloads scoped by user ID and source account ID.
- Support pausing and removing an account from indexing.
- Support deleting indexed chunks when source files are removed or access is revoked.
- Do not index files by default without an explicit user action and clear status.
- Treat retrieved file content as untrusted data, not as system instructions.
- Do not send document contents to third-party embedding or LLM APIs without clear user configuration and consent.

## Reliability

- Use stable provider file IDs plus modified time/etag/checksum for incremental sync.
- Make chunk upserts idempotent.
- Track job status, retries, and last successful sync.
- Apply exponential backoff to provider rate limits.
- Avoid loading entire large files into memory; stream downloads and enforce limits.

## Delivery phases

1. Environment and security hygiene.
2. Read-only document inventory and explicit indexing controls.
3. Text extraction and durable ingestion queue.
4. Embeddings and vector storage.
5. Semantic retrieval API with source references.
6. Chat interface with citations and deletion controls.

## Important distinction

9Drive combines storage capacity. AI memory is a separate retrieval system. A larger file pool increases the amount of information available for retrieval, not the amount of text that fits in one LLM prompt.
