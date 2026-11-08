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

**Three storage providers.** `ConnectedAccount.provider` is `google_drive`, `s3` or `cloudinary`. An S3-compatible account is a `ConnectedAccount` plus an `S3StorageConfig` row (encrypted keys, bucket, optional endpoint, `prefix` defaulting to `9drive`, optional `quotaBytes`). Code that touches a stored file has to branch on provider:
- Streaming: `modules/files/stream-file.ts` (`streamProviderFile`) sends work to `stream-google-file.ts` or `s3/s3.service.ts`.
- Quota: `syncGoogleQuota` (google.service) vs `syncS3Quota` (s3.service). Both write to `StorageAccount`.
- Upload: `ensureGoogleAppFolder` + Drive resumable upload vs `buildS3ObjectKey` + `uploadS3Object` (`@aws-sdk/lib-storage`).

**Cloudinary provider.** One `ConnectedAccount` (provider `cloudinary`, `providerAccountId` = cloud name, no Google `providerConfig`) plus a `CloudinaryConfig` row (encrypted API key/secret, `folder` defaulting to `multinary`, optional `quotaBytes`). Code lives in `modules/cloudinary/`: `cloudinary.service.ts` (signed upload/destroy, Usage API quota sync, delivery streaming) and `cloudinary.utils.ts` (pure helpers: request signing, `providerFileId` parsing). It uses plain `fetch`, no Cloudinary SDK.
- `File.providerFileId` is `<resource_type>:<path used in the delivery URL>`, e.g. `video:multinary/<fileId>.mp4`. Resource type comes from the MIME type (audio is stored as `video`, anything else non-image/video is `raw`).
- Cloudinary does not expose a storage limit in bytes (plans are credit-based), so the limit is the user-entered `quotaBytes`; empty means unlimited. Used bytes is the larger of the Usage API figure and the sum of this app's file rows, because the API can lag.
- Files stream from `res.cloudinary.com` (public `upload` type). `GET /files/:id/view-url` returns that direct URL. Free plans cap per-file size (see `media_limits` in the Usage API) and may block PDF/ZIP/raw delivery until enabled in the Cloudinary security settings.
- Connect with `POST /connected-accounts/cloudinary`; it validates the credentials against the Usage API before keeping the account.

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
