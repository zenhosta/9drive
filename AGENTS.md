# AGENTS.md

## Project Overview

9Drive is a Google Drive storage gateway. It lets users register/login with email/password or Google, automatically connect the first Drive account during Google sign-in, connect additional Google Drive accounts, track combined quota, upload files through the backend into a dedicated Google Drive `9drive` folder, organize files in virtual folders, preview/download/share files, sync MySQL file records from Google Drive, invite other users to files/folders, and route uploads to a connected Drive account with enough free space.

## Repository Structure

- `backend/`: Express API, TypeScript, Prisma schema/migrations, MySQL access, auth, Google OAuth/Drive integration.
- `frontend/`: Vite React app, protected dashboard UI, file/folder management, sharing, uploads, quota/settings pages.
- `docker-compose.yml`: MySQL, backend, and nginx-served frontend services.
- `.env.docker.example`: Docker environment template.
- `README.md`: local setup, Google Cloud setup, Docker notes, deployment notes.

## Requirements

- Node.js 20+
- npm
- MySQL 8+
- Google Cloud project with Google Drive API enabled
- Google OAuth client ID and secret

## Backend

Stack:
- Express 5
- TypeScript
- Prisma 6
- MySQL
- Zod
- JWT bearer auth
- Argon2 password hashing
- Busboy streaming uploads
- Google APIs client
- Undici for Google file streaming

Important files:
- `backend/src/server.ts`: server entrypoint.
- `backend/src/app.ts`: Express app and route mounting.
- `backend/src/config/env.ts`: environment validation.
- `backend/src/config/prisma.ts`: Prisma client.
- `backend/prisma/schema.prisma`: database schema.
- `backend/src/middleware/auth.middleware.ts`: bearer auth.
- `backend/src/middleware/error.middleware.ts`: JSON error responses.
- `backend/src/modules/**`: feature route modules and provider services.
- `backend/src/modules/files/stream-google-file.ts`: Google file preview/download streaming.
- `backend/src/scripts/seed-google-config.ts`: stores encrypted global Google OAuth config.

Commands:
- `cd backend && npm run dev`: start development server.
- `cd backend && npm run build`: typecheck/build backend.
- `cd backend && npm run start`: run compiled backend from `dist/server.js`.
- `cd backend && npm run prisma:migrate`: run Prisma dev migration.
- `cd backend && npm run prisma:generate`: regenerate Prisma client.
- `cd backend && npm run seed:google-config`: store encrypted Google OAuth config.

Environment:
- `DATABASE_URL`
- `APP_PORT`
- `FRONTEND_URL`
- `JWT_ACCESS_SECRET`
- `TOKEN_ENCRYPTION_KEY`
- `RECAPTCHA_SECRET_KEY` (optional; enables captcha verification when paired with frontend site key)
- `ALLOW_REGISTRATION` (optional, default `true`; `false` blocks new email and Google sign-ups except the first account)
- `ACCESS_TOKEN_TTL_SECONDS`
- `REFRESH_TOKEN_TTL_DAYS`
- `MAX_UPLOAD_BYTES`
- `GOOGLE_CLIENT_ID`
- `GOOGLE_CLIENT_SECRET`
- `GOOGLE_REDIRECT_URI`

Backend conventions:
- Put route logic under `backend/src/modules/<feature>/<feature>.routes.ts`.
- Mount new routers in `backend/src/app.ts`.
- Use `requireAuth` for authenticated routes, and add `requireAdmin` after it for instance-wide settings or maintenance (everything under `/system`).
- Use `AuthRequest` when accessing `req.user`.
- Validate request bodies/query params with Zod.
- Use Prisma from `backend/src/config/prisma.ts`.
- Return JSON errors with stable `code` and human-readable `message`.
- Pass unexpected errors to `next(error)`.
- Convert `bigint` values to strings before sending JSON responses.
- Keep Google-specific OAuth/Drive behavior in provider modules/services when possible.
- Keep public-token routes outside `requireAuth`; verify token hash, status, and expiry before streaming/returning data.
- Google sign-in/register uses one-time auth handoff tokens; never send app access/refresh tokens through URL query params.
- Email/password registration verifies reCAPTCHA only when `RECAPTCHA_SECRET_KEY` is configured.

Security rules:
- Never commit `.env` files or secrets.
- Never log access tokens, refresh tokens, OAuth client secrets, JWT secrets, encryption keys, or raw public share tokens.
- Google tokens are encrypted before database storage.
- App refresh tokens are hashed before database storage.
- Auth handoff, share, and preview tokens are stored as hashes where applicable.
- Uploaded files must stream through backend to Google Drive folder `9drive`; do not store uploaded files on disk.
- Keep CORS restricted by `FRONTEND_URL`.
- Keep auth/token storage behavior centralized; do not change without explicit reason.

Database rules:
- Change DB schema through Prisma schema and migrations.
- Do not hand-edit generated Prisma client files.
- After schema changes, run Prisma migration/generation and backend build.
- Add indexes for new common filters before relying on them in hot paths.

## Frontend

Stack:
- React 19
- Vite 8
- TypeScript
- React Router 7
- Tailwind CSS 4
- lucide-react
- class-variance-authority
- clsx
- tailwind-merge

Important files:
- `frontend/src/main.tsx`: React entrypoint.
- `frontend/src/App.tsx`: route registration.
- `frontend/src/layouts/DriveLayout.tsx`: protected app shell, sidebar, header search, storage sidebar stats.
- `frontend/src/pages/AllFilesPage.tsx`: core file/folder UI, uploads, context menus, preview, share/invite modals.
- `frontend/src/pages/SharedPage.tsx`: shared links and invites UI.
- `frontend/src/pages/QuotaTrackerPage.tsx`: connected-account quota UI.
- `frontend/src/pages/SettingsPage.tsx`: Google account/settings UI.
- `frontend/src/pages/GoogleAuthPage.tsx`: Google auth handoff exchange page.
- `frontend/src/pages/PublicFilePage.tsx`: public shared file viewer/embed page.
- `frontend/src/components/auth/GoogleLogo.tsx`: Google button logo.
- `frontend/src/components/drive/**`: drive-specific UI components.
- `frontend/src/components/ui/**`: reusable UI primitives.
- `frontend/src/lib/api.ts`: API helper, token refresh retry, formatting utilities.
- `frontend/src/lib/auth.ts`: local auth session storage.
- `frontend/src/lib/plyr.ts`: video preview player loading.
- `frontend/src/style.css`: Tailwind import and global styles.

Commands:
- `cd frontend && npm run dev`: start Vite dev server.
- `cd frontend && npm run build`: typecheck/build frontend.
- `cd frontend && npm run preview`: preview production build.

Environment:
- `VITE_API_URL`: backend base URL. Vite embeds this at build time.
- `VITE_RECAPTCHA_SITE_KEY`: optional reCAPTCHA site key. Vite embeds this at build time; blank disables captcha UI.

Frontend conventions:
- Use `@/*` imports for files under `frontend/src`.
- Keep route registration in `frontend/src/App.tsx`.
- Use `apiFetch` for normal JSON API calls.
- Use raw `fetch` or `XMLHttpRequest` only when response streaming/blob/progress requires it.
- Keep access/refresh token handling centralized in `frontend/src/lib/api.ts` and `frontend/src/lib/auth.ts`.
- Use existing `Button`, `Card`, and `Input` primitives before adding new UI primitives.
- Use `cn` from `frontend/src/lib/utils.ts` for conditional class names.
- Preserve current Tailwind visual style unless task explicitly asks redesign.
- Keep protected dashboard pages inside `ProtectedRoute` and `DriveLayout`.
- Keep file/folder URL state in query params when it affects navigation, e.g. `folderId` and file search `q`.

## API Notes

General:
- `GET /health`
- Authenticated routes expect `Authorization: Bearer <accessToken>` unless listed as public.

Auth:
- `POST /auth/register`
- `POST /auth/login`
- `GET /auth/google/url`
- `GET /auth/google/callback`
- `POST /auth/google/exchange`
- `POST /auth/refresh`
- `POST /auth/logout`
- `GET /auth/me`

Provider configs:
- `POST /provider-configs/google`
- `GET /provider-configs`
- `DELETE /provider-configs/:id`

Google connected accounts:
- `GET /connected-accounts/google/connect-url`
- `GET /connected-accounts/google/connect`
- `GET /connected-accounts/google/callback`
- `GET /connected-accounts`
- `POST /connected-accounts/:id/sync-quota`
- `DELETE /connected-accounts/:id`

Storage:
- `GET /storage/summary`
- `GET /storage/breakdown`

Folders:
- `GET /folders?parentId=<id>`
- `GET /folders?all=1`
- `GET /folders/recent?limit=4`
- `POST /folders`
- `PATCH /folders/:id`
- `DELETE /folders/:id`

Files:
- `GET /files`
- `GET /files?folderId=<id>`
- `GET /files?q=<search>`
- `GET /files/shared-links`
- `GET /files/:id`
- `PATCH /files/:id`
- `PATCH /files/batch`
- `DELETE /files/batch`
- `POST /files/sync-google`
- `POST /files/:id/share`
- `DELETE /files/:id/share`
- `POST /files/:id/preview-token`
- `GET /files/:id/view-url`
- `GET /files/:id/download`
- `DELETE /files/:id`
- `GET /files/preview/:token`

Invites:
- `GET /invites`
- `POST /invites`
- `DELETE /invites/:id`

Public shared files:
- `GET /public/files/:token`
- `GET /public/files/:token/download`
- `GET /public/files/:token/preview`

Uploads:
- `POST /uploads`
- Content type: `multipart/form-data`.
- Current frontend sends metadata first as `filesMeta`: JSON array of `{ fieldName, fileName, mimeType, sizeBytes, folderId? }`.
- File fields then match `filesMeta[*].fieldName`, e.g. `file-0`, `file-1`.
- Backend selects a connected Drive account with enough available quota and streams each file directly to Google Drive.
- Google Drive uploads are placed under the root Drive folder named `9drive`; virtual folders remain app/database-only.
- `POST /files/sync-google` treats Google Drive folder `9drive` as source of truth for physical files: create missing MySQL file rows, update changed metadata, and mark missing Drive files as deleted.

## Docker

Commands:
- `docker compose up -d --build`: build and start MySQL, backend, frontend.
- `docker compose exec backend npm run seed:google-config`: seed Google config inside backend container.
- `docker compose logs -f backend`: backend logs.
- `docker compose logs -f frontend`: frontend logs.
- `docker compose logs -f mysql`: MySQL logs.
- `docker compose down`: stop services.
- `docker compose down -v`: stop services and remove DB volume.

Docker notes:
- MySQL image is `mysql:8.4`.
- Backend listens on `4000`.
- Frontend build is served by nginx on host port `5173`.
- Frontend build arg `VITE_API_URL` is embedded at build time.
- Rebuild frontend when `VITE_API_URL` changes.

## Verification

Before finishing backend changes:
- `cd backend && npm run build`

Before finishing frontend changes:
- `cd frontend && npm run build`

Before finishing schema changes:
- `cd backend && npm run prisma:migrate`
- `cd backend && npm run build`

Manual smoke test:
- Register/login.
- Open Settings.
- Connect Google Drive.
- Verify connected account appears.
- Open Quota Tracker and sync quota.
- Create nested folders in All Files.
- Use header search for an uploaded file name.
- Upload one or more files and verify progress panel.
- Switch file list/grid view.
- Right-click file and test preview/download/rename/move/share/invite/delete where relevant.
- Open Shared page and verify shared links/invites.
- Open public file link and test preview/download.

## Agent Rules

- Prefer small, targeted changes.
- Preserve existing architecture and naming.
- Do not introduce new dependencies unless necessary.
- Do not commit secrets.
- Do not edit `node_modules`, build output, or generated Prisma client.
- Do not change auth/token storage behavior without explicit reason.
- Do not change Google OAuth scopes or redirect behavior without checking README and env requirements.
- Do not change upload behavior to write files to disk.
