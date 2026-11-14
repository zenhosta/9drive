# Architecture

9Drive is a React/Vite frontend backed by an Express/TypeScript API and Prisma/MySQL database.

## Storage model

`ConnectedAccount` identifies a user-owned Google Drive or S3 account. `StorageAccount` stores quota snapshots. Files are metadata rows; content remains in the provider. Google Drive content is placed under the provider-side `9drive` folder. Virtual folders are application metadata.

## Authentication

Password and Google login create a database session. Access JWTs identify the user and session. Refresh tokens are stored as hashes in a token family and rotated on use. OAuth state is hashed, expires, and is atomically claimed before code exchange.

## Uploads

Normal uploads pass through a counted transform stream into Google Drive or S3. The stream enforces the configured limit and validates the declared byte count. Provider cleanup is attempted after failures. Google Drive resumable uploads use persisted `UploadSession` records.

## Administration

The `User.role` field and `ADMIN_EMAILS` bootstrap list protect global configuration, updates, and MySQL backup/restore. Provider-specific account operations remain user-owned.

## Sharing

Provider public permissions are opt-in. Application share links are hashed for lookup and stream content through the backend.