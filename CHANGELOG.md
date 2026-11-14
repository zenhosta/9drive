# Changelog

## Unreleased

- Removed automatic public-writer permissions from standard and resumable uploads.
- Added explicit read-only public sharing, confirmed writer access, and public-permission revocation.
- Added administrator authorization for global OAuth configuration, system updates, and MySQL backup/restore.
- Added refresh-token rotation, reuse detection, and session-family revocation.
- Added OAuth state atomic consumption and Google token revocation on account disconnect.
- Added security headers, rate limiting, sanitized error responses, and streaming upload cleanup.
- Added the security remediation migration and initial Vitest coverage.