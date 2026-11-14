# Deployment Guide

1. Copy `.env.docker.example` to `.env`.
2. Replace every placeholder password and secret with generated values.
3. Set `FRONTEND_URL`, `VITE_API_URL`, and the Google redirect URI for the public HTTPS deployment.
4. Set `ADMIN_EMAILS` to one or more trusted operator emails.
5. For production, set `NODE_ENV=production`, `COOKIE_SECURE=true`, `TRUST_PROXY=true`, and use an HTTPS `FRONTEND_URL`.
6. Run `docker compose up -d --build`.
7. Verify `GET /health`, login, and an administrator-only Settings operation.

Put the frontend and backend behind HTTPS. Do not expose MySQL publicly. Restrict access to `.env`, Docker volumes, backup files, and server logs. The backend image includes the MySQL client for administrator-only backup and restore operations.

Do not use placeholder Docker defaults in production. Rebuild the frontend after changing frontend build arguments.

The built-in rate limiter is process-local. Multi-instance deployments must use shared counter storage, such as Redis, before scaling the backend horizontally.