# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

@AGENTS.md

`AGENTS.md` (imported above) holds the conventions, security rules, env vars, and API list. This file adds what it leaves out, and notes where the code has moved past it.

## Commands

Neither package has a test runner or linter. Verification means running the type-check/build:

- `cd backend && npm run build` (`tsc`)
- `cd frontend && npm run build` (`tsc && vite build`)

Other scripts that `AGENTS.md` doesn't list:

- `cd backend && npm run start:deploy`: `prisma migrate deploy`, then start. For production, never use `migrate reset` there.
- `cd backend && npm run test:s3` / `npm run test:api-upload`: manual smoke scripts in `backend/src/scripts/`.
- `setup.sh` / `setup.ps1`: create `backend/.env` and `frontend/.env` with random secrets, run `npm install`, and generate the Prisma client.
- On Windows, if `prisma generate` fails because a file is locked, stop the running dev servers first.

## Architecture beyond AGENTS.md

**Two storage providers.** `ConnectedAccount.provider` is `google_drive` or `s3`. An S3-compatible account is a `ConnectedAccount` plus an `S3StorageConfig` row (encrypted keys, bucket, optional endpoint, `prefix` defaulting to `9drive`, optional `quotaBytes`). Code that touches a stored file has to branch on provider:
- Streaming: `modules/files/stream-file.ts` (`streamProviderFile`) sends work to `stream-google-file.ts` or `s3/s3.service.ts`.
- Quota: `syncGoogleQuota` (google.service) vs `syncS3Quota` (s3.service). Both write to `StorageAccount`.
- Upload: `ensureGoogleAppFolder` + Drive resumable upload vs `buildS3ObjectKey` + `uploadS3Object` (`@aws-sdk/lib-storage`).

**Upload routing** (`modules/uploads/upload.routes.ts`, `selectAccount`):
1. Re-sync quota for any account whose last sync is more than 5 minutes old.
2. Subtract bytes already reserved by earlier files in the same multipart request.
3. Apply the user's `UploadRoutingPolicy` mode: `most_available` (default), `round_robin` (cursor kept in the DB), or `priority` (`priorityAccountIds`).
4. If `availableBytes` is null, treat the account as unlimited. When quotas are unknown, S3 accounts are preferred.

`handleUpload` is shared with the external API, mounted as `POST /api/v1/uploads` (`modules/public-api`). That route is guarded by `requireApiKey('files:upload')` in `middleware/api-key.middleware.ts`, not by `requireAuth`. API keys are stored hashed and carry scopes.

**Virtual vs physical.** Folders exist only in MySQL (`Folder.parentId` tree). Files are stored flat in the provider's `9drive` folder or prefix. `File.folderId` is purely app-side. Folders and files are soft-deleted (`deletedAt`/`status`), which is what the Trash and Archived pages rely on.

**Google OAuth config comes from the DB, not env.** `env.ts` doesn't read `GOOGLE_*`. Those vars are read only by the seed scripts, which write a global `ProviderConfig` row (`userId` null) with encrypted credentials. It can also be set in Settings via `POST /system/google-config`. In Docker, `seed:google-config:docker` skips seeding when the credentials are blank or placeholders.

**Other modules missing from AGENTS.md:** `api-keys`, `audit-logs` (`utils/audit.ts` `createAuditLog`, shown on ActivityLogPage), `system` (self-update that runs `update.sh` from the repo root and falls back to `git pull`, `update-log`, `google-config`, backup/restore), and `s3`.

**Backend module style.** The backend is ESM with `module: NodeNext`, so relative imports need a `.js` suffix even in `.ts` files. Most route files hold their logic inline; services exist only for provider integrations (`google/`, `s3/`). Token encrypt/hash helpers are in `utils/crypto.ts`.

**Frontend API base URL.** `lib/api.ts` uses `VITE_API_URL` unless it's unset or still the default `http://localhost:4000`. In that case a production build falls back to `/api`, which `frontend/nginx.conf` proxies to `backend:4000` with request buffering off so streamed uploads work. Upload queue and progress state live in `context/UploadContext.tsx`. The PWA service worker (`vite.config.ts`) has a `navigateFallbackDenylist` of backend path prefixes, so add any new top-level backend route there.

## Cross-drive moves and file types (added later)

- **Move jobs**: `modules/jobs/` (`job.service.ts` validates and creates jobs, `move-runner.ts` is the in-process worker started from `server.ts`, `move-logic.ts` holds the pure rules). Each `MoveJobItem` is a persisted step machine (`pending/copying -> copied -> db_updated -> done`) so restarts resume safely. `google/google-copy.ts` has the streamed copy, export and delete primitives. Never delete a source before the DB row points at a verified copy. Rebalance planning is pure code in `modules/storage/rebalance-plan.ts`.
- **Drive index**: `modules/drive-index/` scans every owned file of a connected Drive into `drive_items` (`drive-scan.ts`, in-process, one scan per account, rows replaced by scan id so failed scans keep the old index) and serves the browser API. Move jobs accept either `fileId` (tracked 9Drive file) or `driveItemId`; an indexed file that 9Drive also tracks is moved as the tracked file. Raw items land in the target's `9drive` folder unless a destination folder is chosen. `operation` is `move`, `copy` or `delete` (delete jobs reuse the same tables and runner); selected folders are expanded into files with a `targetSubpath` so structure is recreated. Scans run one at a time and retry on MySQL deadlocks (`retryOnLock`). Text-colour gotcha: `style.css` forces colours on every span/div/p, so use the `.on-accent`, `.tag-c*` and `.t-ok/.t-warn/.t-bad/.t-link` classes for text on coloured backgrounds instead of Tailwind colour utilities.
- **File types**: `modules/files/file-types.ts` is the only place categories are defined; it builds both the JS classifier and the Prisma `where` filters, so keep them in sync by editing the data, not the builders.
- **Tests**: `cd backend && npm test` (node's test runner through tsx; add new test files to the `test` script). There is no Node on some dev hosts, so type-check by building the Docker images (`docker compose build backend frontend`). `src/scripts/test-move.ts` runs live against connected drives with throwaway files.
- Frontend routes `/jobs`, `/files`, `/storage` etc. collide with the PWA `navigateFallbackDenylist`; the Jobs page therefore lives at `/move-jobs` and Files by Type at `/files-by-type`.
