# Security audit

Scope: backend API, database access and schema, password/session handling, file
sharing and uploads, deployment defaults, and the new Android client. Reviewed
against the `main` branch at commit `6c6ca48` plus the changes in this branch.

## Fixed in this branch

| # | Severity | Finding | Fix |
|---|----------|---------|-----|
| 1 | Critical | Every `/system/*` route (update, update log, database backup, database restore, Google OAuth config) only required a normal login. Any registered user could download the whole database, replace it, or trigger the update script. | `requireAdmin` middleware on all `/system` routes, gated by the new `ADMIN_EMAILS` environment variable. Denies everyone when unset. |
| 2 | Critical | `GET /files/:id/view-url` granted Google Drive permission `role: writer, type: anyone` on the user's file every time a view link was requested, silently making private files publicly editable. | Removed the permission grant. View links no longer change Drive sharing. |
| 3 | High | Unexpected errors were returned verbatim (Prisma messages, filesystem paths, provider errors) in 500 responses. | Error middleware logs details and returns a generic `INTERNAL_SERVER_ERROR`; Zod errors become `400 VALIDATION_ERROR`; Prisma `P2025`/`P2002` map to 404/409. |
| 4 | High | No rate limiting on login, registration, Google handoff exchange, or the Google start URL, allowing password brute force and CPU exhaustion through Argon2. | `express-rate-limit`: 300 requests / 15 min per IP on all auth routes, plus 20 failed credential attempts / 15 min on login, register, Google start and handoff exchange. |
| 5 | High | Passwords had a minimum length but no maximum; a 1 MB body could be fed to Argon2. | Password length is now 8–128 characters, e-mail is trimmed, lower-cased and capped at 191 characters. |
| 6 | High | `npm audit` reported 14 backend advisories (1 critical) and 2 frontend advisories. | `npm audit fix` for both packages. See remaining advisories below. |
| 7 | Medium | Access tokens were accepted for any session that existed and was not revoked, without checking that the session belongs to the token subject. | `requireAuth` now requires `session.userId === payload.sub`. |
| 8 | Medium | Android app allowed `adb backup` of its data, which contains the stored session and server URL. | `android:allowBackup="false"`. |
| 9 | Low | The update error message contained a hard-coded operator IP and SSH instructions. | Replaced with generic guidance. |
| 10 | Low | A missing public share returned HTTP 500 with the raw message. | Returns `404 FILE_NOT_FOUND`. |

## Verified as sound

- Passwords use Argon2id with library defaults (memory-hard, salted). No plaintext or reversible password storage anywhere.
- Google access/refresh tokens and S3 credentials are AES-256-GCM encrypted at rest; the key is derived from `TOKEN_ENCRYPTION_KEY`.
- App refresh tokens, API keys, auth handoff tokens, preview tokens and share tokens are stored as SHA-256 hashes (share tokens also keep a legacy plaintext column; see below).
- Refresh tokens are random 32-byte values, single-session-per-login, revocable, and expire after `REFRESH_TOKEN_TTL_DAYS`.
- OAuth state is random, hashed, expires after 10 minutes, and is marked used before the handoff token is issued. Tokens are never placed in query strings except the short-lived handoff token.
- File access is scoped by `userId` on every file, folder, invite, API-key and connected-account query; no IDOR was found in the reviewed routes.
- Uploads stream through the backend; nothing is written to server disk, file count and size are bounded by Busboy.
- Prisma is used for all SQL, so no SQL injection surface was found.
- CORS is restricted to `FRONTEND_URL`, plus the Capacitor origins only when `MOBILE_APP_REDIRECT_URL` is configured.
- Audit logging covers file, folder, share, API-key and account changes.

## Remaining risks (not changed here)

1. **Access and refresh tokens live in `localStorage`.** Any XSS in the frontend can read them. There is no Content-Security-Policy or `helmet`-style header set. Moving to httpOnly cookies or adding CSP are the next hardening steps.
2. **Docker defaults are insecure by design.** `docker-compose.yml` falls back to `root` / `change-this-...` secrets and publishes ports on all interfaces. Set real secrets in `.env` and bind `127.0.0.1:4000:4000` / `127.0.0.1:5173:80` on a public host. MySQL is not published, which is correct.
3. **Backup/restore still assume a SQLite file** (`DATABASE_URL=file:...`) while the schema is MySQL. With MySQL the backup endpoint returns 404 and restore would replace a non-existent file. The endpoints are now admin-only, but the feature needs a `mysqldump`-based implementation.
4. **Remaining dependency advisories** need major upgrades: backend `archiver`/`minimatch` chain (6 advisories) and frontend `vite-plugin-pwa` → `workbox` chain (6 advisories). `npm audit fix` cannot resolve them without breaking changes; both are build/dev-time or zip-related and should be scheduled.
5. **No refresh-token rotation or session/device cap.** A stolen refresh token stays valid until expiry or logout.
6. **Registration has no password complexity rule beyond 8 characters** and no per-account lockout (only per-IP limiting). Add a breach/complexity check and per-account throttling if this is exposed publicly.
7. **Malformed `filesMeta` JSON still produces a 500** instead of a 400 (upstream PR #33 addresses this).
8. **Android specifics:** cleartext HTTP and mixed content are enabled so self-hosted LAN servers work; prefer HTTPS. The `9drive://` deep link is single-use and expires in 5 minutes, but any app can register the scheme — treat the handoff token as sensitive.
9. **Google Drive still receives user files under a `9drive` folder**, and the OAuth scopes are full Drive (`auth/drive`), not least-privilege. Narrowing to `drive.file` would be safer if folder sync allowed it.

## Configuration required after upgrading

```env
# Comma-separated e-mails allowed to use update/backup/restore and the global
# Google OAuth configuration. Without it those endpoints return 403.
ADMIN_EMAILS=you@example.com

# Enables Google sign-in to return to the Android app.
MOBILE_APP_REDIRECT_URL=9drive://app
```

Then apply the new migration:

```bash
cd backend && npm run db:migrate:deploy
```
