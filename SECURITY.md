# Security

9Drive is a self-hosted application. Operators are responsible for HTTPS, secret management, database access, and keeping dependencies current.

## Authentication

- Access tokens are short-lived JWTs.
- Refresh tokens are hashed and rotated after every successful refresh.
- Reuse of a rotated refresh token revokes the complete session family.
- Sessions can be revoked by logout or account disablement.
- Browser sessions use HttpOnly access and refresh cookies. A separate double-submit CSRF cookie/header protects unsafe cookie-authenticated requests.

## Provider credentials

Google and S3 credentials are encrypted with AES-256-GCM before database storage. They are never returned by API responses. Google account disconnection attempts provider revocation and clears stored credentials.

## File privacy

Uploads are private by default. Public Google Drive permissions are explicit, read-only by default, and writer permissions require confirmation. Public permissions can be revoked. Application share links are separate proxy links and should be treated as bearer credentials.

## Administration

Set `ADMIN_EMAILS` during bootstrap or assign `users.role = 'admin'` through a controlled database procedure. Administrative endpoints include global OAuth configuration, system update, backup, restore, and update-log access.

The current rate limiter is process-local and suitable for one backend instance. Horizontal deployments require shared counter storage such as Redis and coordinated reverse-proxy limits.

## Dependency status

The latest backend production audit reports six unresolved advisories: `prisma` and `@prisma/config` through `deepmerge-ts`, plus `archiver` and `readdir-glob` through `minimatch`. npm only offers Prisma 7 or Archiver 7 fixes, so those upgrades require a separate compatibility review. Backend runtime totals are 3 moderate and 3 high.

The frontend production audit reports two unresolved advisories: `react-router` (high) and `react-router-dom` (moderate). The full frontend audit also reports development/build-chain advisories in `vite`, `vite-plugin-pwa`, `workbox-build`, `rollup`, `postcss`, `source-map-js`, `nanoid`, `browserslist`, `baseline-browser-mapping`, `fast-uri`, `glob`, `minimatch`, `brace-expansion`, `deepmerge`, and Vitest's `vitest`/`tinypool`/`@vitest/mocker` packages. No forced major upgrade was applied during this phase.

## Reporting

Do not include credentials, access tokens, refresh tokens, API keys, or share tokens in reports. Store diagnostic logs securely and rotate them according to the host policy.