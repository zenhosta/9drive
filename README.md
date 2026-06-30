![9Drive cover](https://i.ibb.co.com/35BySv1C/image.png)

# 9Drive

9Drive is a storage gateway web app for connecting multiple Google Drive accounts into one virtual storage dashboard. Users can register with email/password or Google, automatically connect their first Google Drive account during Google sign-in, track quota, upload files into a dedicated `9drive` Drive folder, organize files with virtual folders, preview files, sync MySQL from Google Drive, and let the backend route uploads to the Drive account with enough free space.

## Features

- Google Drive and S3-compatible storage gateway in one virtual storage dashboard.
- S3-compatible storage support with custom endpoints for providers like MinIO, Cloudflare R2, Wasabi, Backblaze B2, and AWS S3.
- Direct upload stream to Google Drive. Files are not stored on the server.
- Google Drive uploads are stored under a root `9drive` folder.
- Direct upload stream to S3-compatible storage through the backend without exposing storage credentials to the frontend.
- Upload routing policies with most-available, round-robin, and priority-order modes.
- External upload API using API keys at `POST /api/v1/uploads`.
- API key management with one-time secret display, hashed key storage, last-used tracking, and revocation.
- Email/password auth plus Google sign-in/register with automatic first Drive connection.
- Multi-account storage quota summary.
- Quota tracker page.
- Manual sync from the Google Drive `9drive` folder back into MySQL.
- Virtual folders.
- File preview, download, rename, move, and delete actions.
- In-app API documentation with cURL and JavaScript upload examples.
- Bottom-right upload progress panel.
- Bearer token authentication.
- Global Google OAuth config stored encrypted in DB (can be set via seed command or directly in Settings UI).
- Automated system updates via `update.sh` directly from the Settings UI (PM2 setup).
- Optional reCAPTCHA on email/password registration.
- MySQL database with Prisma migrations.
- Express + TypeScript backend.
- React + Vite frontend.

## Preview

Live preview: https://9drive.zenhosta.com

![9Drive dashboard preview](https://i.ibb.co.com/HLjG3JRf/image.png)

![9Drive shared file preview](https://i.ibb.co.com/QLpYGmx/image.png)

## Star History

[![Star History Chart](https://api.star-history.com/svg?repos=zenhosta/9drive&type=Date)](https://www.star-history.com/#zenhosta/9drive&Date)

## Project Structure

```txt
backend/   Express API, Prisma schema, Google Drive integration
frontend/  Vite React app
```

## Requirements

- Node.js 20+
- npm
- MySQL running locally
- Google Cloud project
- Google OAuth Client ID and Client Secret

Default database used by this project:

```txt
host: localhost
port: 3306
database: 9drive
user: root
password: empty
```

## 1. Quick Setup & Installation (Recommended)

The easiest way to set up and run the project is using the automated setup script. It automatically generates all environment files with secure keys, installs dependencies, handles Prisma migrations, and configures either **SQLite** (zero installation/config) or **MySQL**.

### Windows (PowerShell)
Make sure to open PowerShell and navigate to the project directory first. For example, if you cloned the project to `E:\AUTO KLIK\9Drive`:

```powershell
# 1. Switch to the drive where the project is located (if necessary)
E:

# 2. Navigate to the project folder
cd "E:\AUTO KLIK\9Drive"

# 3. Run the automated setup script
powershell -ExecutionPolicy Bypass -File .\setup.ps1
```


1. **Database**: Choose **SQLite (Option 1)** for zero-configuration, or **MySQL (Option 2)**.
2. **Google Credentials**: Enter Client ID/Secret or skip (press Enter) to set up later.

Once setup is complete, run the entire application (both frontend and backend) in one command:

```bash
npm run dev
```

---

## 2. Manual Installation (Alternative)

If you prefer to configure the project manually:

### 2.1 Install Dependencies
Install backend dependencies:

```bash
cd backend
npm install
```

Install frontend dependencies:

```bash
cd ../frontend
npm install
```

### 2.2 Create Database (For MySQL)
Create a database:
```sql
CREATE DATABASE 9drive;
```
If using MySQL CLI:
```bash
mysql -u root -e "CREATE DATABASE IF NOT EXISTS 9drive;"
```

### 2.3 Environment Setup


Create `backend/.env`:

```env
DATABASE_URL="mysql://root@localhost:3306/9drive"
APP_PORT=4000
FRONTEND_URL="http://localhost:5173"
JWT_ACCESS_SECRET="change-this-jwt-secret-at-least-32-chars"
TOKEN_ENCRYPTION_KEY="change-this-encryption-key-32bytes!"
ACCESS_TOKEN_TTL_SECONDS=900
REFRESH_TOKEN_TTL_DAYS=30
MAX_UPLOAD_BYTES=5368709120
RECAPTCHA_SECRET_KEY=""

# Used only by `npm run seed:google-config`.
# These values are encrypted and stored in DB as global Google OAuth config.
GOOGLE_CLIENT_ID=""
GOOGLE_CLIENT_SECRET=""
GOOGLE_REDIRECT_URI="http://localhost:4000/connected-accounts/google/callback"
```

Important:

- `JWT_ACCESS_SECRET` should be long and random.
- `TOKEN_ENCRYPTION_KEY` should be long and random.
- Do not commit `backend/.env`.
- Google OAuth credentials are used by the seed script, then stored encrypted in the database.

## 4. Frontend Environment

Create or confirm `frontend/.env`:

```env
VITE_API_URL=http://localhost:4000
VITE_RECAPTCHA_SITE_KEY=
```

Captcha is disabled when `VITE_RECAPTCHA_SITE_KEY` or backend `RECAPTCHA_SECRET_KEY` is empty. Set both values to enable captcha on registration.

## 5. Run Prisma Migrations

```bash
cd backend
npm run prisma:migrate
```

If Prisma client generation is blocked on Windows by a running Node process, stop running backend/frontend dev servers and run:

```bash
npx prisma generate
```

## 6. Google Cloud Setup

Google setup is done in Google Cloud Console, not Google Search Console. Google Search Console is for website indexing/search ownership. OAuth and Drive API are managed in Google Cloud Console.

Open Google Cloud Console:

```txt
https://console.cloud.google.com/
```

### 6.1 Create Or Select Project

1. Open Google Cloud Console.
2. Click project selector in top bar.
3. Create a new project or select an existing project.
4. Remember the project name because OAuth client and Drive API must be in the same project.

### 6.2 Enable Google Drive API

1. Go to:

```txt
APIs & Services -> Library
```

2. Search:

```txt
Google Drive API
```

3. Open `Google Drive API`.
4. Click `Enable`.
5. Wait a few minutes if Google says the API was enabled recently.

Direct URL pattern:

```txt
https://console.developers.google.com/apis/api/drive.googleapis.com/overview?project=YOUR_PROJECT_ID
```

If Google Drive API is disabled, you will see an error like:

```txt
Google Drive API has not been used in project ... before or it is disabled.
```

### 6.3 Configure OAuth Consent Screen

1. Go to:

```txt
APIs & Services -> OAuth consent screen
```

2. Choose app type:

```txt
External
```

3. Fill required fields:

```txt
App name
User support email
Developer contact email
```

4. Add scopes:

```txt
https://www.googleapis.com/auth/drive
https://www.googleapis.com/auth/userinfo.email
https://www.googleapis.com/auth/userinfo.profile
```

Full Drive access is required so Google sign-in can connect the first Drive account automatically and sync files manually added to the `9drive` folder.

5. If publishing status is `Testing`, add test users.

Add every Google account that will test the app:

```txt
OAuth consent screen -> Test users -> Add users
```

If you do not add test users, Google may show:

```txt
Access blocked: app has not completed the Google verification process
Error 403: access_denied
```

### 6.4 Create OAuth Client

1. Go to:

```txt
APIs & Services -> Credentials
```

2. Click:

```txt
Create Credentials -> OAuth client ID
```

3. Application type:

```txt
Web application
```

4. Add authorized JavaScript origin:

```txt
http://localhost:5173
```

5. Add authorized redirect URI:

```txt
http://localhost:4000/connected-accounts/google/callback
```

6. Click Create.
7. Copy:

```txt
Client ID
Client Secret
```

### 6.5 Seed Google OAuth Config

Put values into `backend/.env`:

```env
GOOGLE_CLIENT_ID="your-client-id"
GOOGLE_CLIENT_SECRET="your-client-secret"
GOOGLE_REDIRECT_URI="http://localhost:4000/connected-accounts/google/callback"
```

Then run:

```bash
cd backend
npm run seed:google-config
```

This stores the Google OAuth config as a global encrypted provider config in MySQL. Google sign-in uses the same config and automatically connects the first Drive account. Logged-in users can still click `Connect Drive` in Settings to add more Drive accounts.

## 7. Run Development Servers

Start backend:

```bash
cd backend
npm run dev
```

Backend runs at:

```txt
http://localhost:4000
```

Start frontend:

```bash
cd frontend
npm run dev
```

Frontend runs at:

```txt
http://localhost:5173
```

## Docker Deployment

This repository includes Docker files for running MySQL, backend, and frontend together.

Files:

```txt
docker-compose.yml
.env.docker.example
backend/Dockerfile
frontend/Dockerfile
frontend/nginx.conf
```

### 1. Prepare Docker Env

Copy the example env file:

```bash
cp .env.docker.example .env
```

On Windows PowerShell:

```powershell
Copy-Item .env.docker.example .env
```

Edit `.env`:

```env
MYSQL_ROOT_PASSWORD=root
MYSQL_DATABASE=9drive

FRONTEND_URL=http://localhost:5173
VITE_API_URL=http://localhost:4000
VITE_RECAPTCHA_SITE_KEY=

JWT_ACCESS_SECRET=replace-with-long-random-secret
TOKEN_ENCRYPTION_KEY=replace-with-long-random-secret
RECAPTCHA_SECRET_KEY=

GOOGLE_CLIENT_ID=your-google-client-id
GOOGLE_CLIENT_SECRET=your-google-client-secret
GOOGLE_REDIRECT_URI=http://localhost:4000/connected-accounts/google/callback
```

Captcha is disabled when either `VITE_RECAPTCHA_SITE_KEY` or `RECAPTCHA_SECRET_KEY` is empty.

### 2. Start Containers

```bash
docker compose up -d --build
```

Services:

```txt
frontend: http://localhost:5173
backend:  http://localhost:4000
mysql:    localhost:3306
```

The backend container runs Prisma migrations automatically on startup:

```txt
npm run db:migrate:deploy
```

This applies pending migrations such as S3 storage support before the API starts, so deployments from an older database can update safely without dropping data.

It also seeds the global Google OAuth config automatically when `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` are set to real values in `.env`. If those values are blank or still placeholders, the backend still starts and logs a warning. Google connect/sign-in will be unavailable until you set real Google OAuth credentials and restart the stack:

```bash
docker compose up -d --build
```

### 3. Seed Google OAuth Config Manually

Automatic Docker startup seeding is usually enough. If you update Google OAuth values while containers are already running, seed the global Google OAuth config manually:

```bash
docker compose exec backend npm run seed:google-config
```

This stores `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, and `GOOGLE_REDIRECT_URI` from Docker env into MySQL as encrypted global config.

### 4. View Logs

```bash
docker compose logs -f backend
docker compose logs -f frontend
docker compose logs -f mysql
```

### 5. Stop Containers

```bash
docker compose down
```

Remove database volume too:

```bash
docker compose down -v
```

### Docker Production Notes

- Replace localhost URLs with production domain.
- Update Google OAuth authorized JavaScript origin.
- Update Google OAuth redirect URI.
- Use strong `JWT_ACCESS_SECRET` and `TOKEN_ENCRYPTION_KEY`.
- Do not expose MySQL port publicly in production.
- Put frontend/backend behind HTTPS reverse proxy.
- Rebuild frontend when `VITE_API_URL` changes because Vite embeds env at build time.
- Rebuild frontend when `VITE_RECAPTCHA_SITE_KEY` changes because Vite embeds env at build time.

### VPS Deployment (Step-by-Step)

Follow these steps to deploy 9Drive to a VPS (such as Ubuntu/Debian) using Docker:

#### 1. Install Docker & Docker Compose on your VPS
```bash
sudo apt update
sudo apt install -y docker.io docker-compose
sudo systemctl enable --now docker
```

#### 2. Clone the Repository
```bash
git clone https://github.com/your-github-username/9drive.git
cd 9drive
```

#### 3. Setup the Production Environment
Copy the example environment file to `.env`:
```bash
cp .env.docker.example .env
```
Edit the `.env` file (e.g., `nano .env`) and configure the values for your production VPS domain/IP:
* **`FRONTEND_URL`**: Set to your public domain or VPS IP (e.g., `http://103.xxx.xxx.xxx:5173` or `https://9drive.yourdomain.com`).
* **`VITE_API_URL`**: Set to your public backend URL (e.g., `http://103.xxx.xxx.xxx:4000` or `https://api.9drive.yourdomain.com`).
* **`GOOGLE_REDIRECT_URI`**: Set to your public redirect callback URL (e.g., `http://103.xxx.xxx.xxx:4000/connected-accounts/google/callback`).
* Set secure credentials for **`JWT_ACCESS_SECRET`** and **`TOKEN_ENCRYPTION_KEY`** (encryption key must be exactly 32 characters/bytes).
* Add your **`GOOGLE_CLIENT_ID`** and **`GOOGLE_CLIENT_SECRET`**.

#### 4. Deploy the Containers
Run Docker Compose to build and start the database, backend, and frontend containers in the background:
```bash
docker compose up -d --build
```

#### 5. Seed the Google Configuration
Initialize the encrypted Google configuration in the database:
```bash
docker compose exec backend npm run seed:google-config
```

#### 6. Add Authorized URIs in Google Cloud Console
1. Go to **APIs & Services** -> **Credentials** in the Google Cloud Console.
2. Edit your OAuth 2.0 Web Client.
3. In **Authorized JavaScript origins**, add your frontend URL (e.g., `http://your-vps-ip:5173` or `https://9drive.yourdomain.com`).
4. In **Authorized redirect URIs**, add your redirect URI (e.g., `http://your-vps-ip:4000/connected-accounts/google/callback` or `https://api.9drive.yourdomain.com/connected-accounts/google/callback`).
5. Save changes.

### Non-Docker Production Startup

Run production migrations before starting the backend:

```bash
cd backend
npm run db:migrate:deploy
npm run start
```

Or use the combined command:

```bash
cd backend
npm run start:deploy
```

`npm run db:migrate:deploy` uses Prisma production migrations and does not reset the database. If Prisma reports migration drift, stop the deploy and repair migration history first; do not run `prisma migrate reset` on production.

## 8. Manual Test Flow

1. Open frontend:

```txt
http://localhost:5173
```

2. Register a user with email/password and captcha, or click `Continue with Google and connect Drive`.
3. If using Google sign-in, approve Drive access once and confirm `/settings` already shows the connected account.
4. If using email/password, open `Settings`, click `Connect Drive`, approve access, and confirm the account appears.
5. Open `Quota Tracker`.
6. Confirm quota appears.
7. Open `All Files`.
8. Create nested virtual folders.
9. Upload a file and confirm it appears under Google Drive root folder `9drive`.
10. Add or remove a file manually inside Google Drive folder `9drive`, then click `Sync Drive` in All Files.
11. Watch bottom-right upload progress.
12. Right-click file row for actions:

```txt
View
Download
Rename
Move to Folder
Delete
```

## API Overview

Auth:

```txt
POST /auth/register
POST /auth/login
GET /auth/google/url
GET /auth/google/callback
POST /auth/google/exchange
POST /auth/refresh
POST /auth/logout
GET /auth/me
```

Google accounts:

```txt
GET /connected-accounts/google/connect-url
GET /connected-accounts/google/callback
GET /connected-accounts
POST /connected-accounts/:id/sync-quota
DELETE /connected-accounts/:id
```

Storage:

```txt
GET /storage/summary
```

Folders:

```txt
GET /folders
GET /folders/recent?limit=4
POST /folders
DELETE /folders/:id
```

Files:

```txt
GET /files
GET /files?folderId=<id>
GET /files?q=<search>
GET /files/shared-links
GET /files/:id
PATCH /files/:id
PATCH /files/batch
DELETE /files/batch
POST /files/sync-google
POST /files/:id/share
DELETE /files/:id/share
POST /files/:id/preview-token
GET /files/:id/view-url
GET /files/:id/download
DELETE /files/:id
GET /files/preview/:token
```

Uploads:

```txt
POST /uploads
```

Upload is `multipart/form-data`. Metadata fields should be appended before the file:

```txt
sizeBytes
fileName
mimeType
folderId optional
file
```

## Security Notes

- Backend never stores uploaded files on disk.
- Uploads are streamed through the backend to Google Drive folder `9drive`.
- Google tokens are encrypted in MySQL.
- Refresh tokens for app sessions are hashed in MySQL.
- Google auth handoff tokens, public share tokens, and preview tokens are hashed before lookup/use.
- `backend/.env` is ignored by git.
- Do not expose `TOKEN_ENCRYPTION_KEY`, `JWT_ACCESS_SECRET`, `RECAPTCHA_SECRET_KEY`, OAuth client secrets, or raw share/preview/handoff tokens.

## Production Notes

- Replace localhost redirect URIs with production URLs.
- Add production domain to Google OAuth authorized origins.
- Set OAuth consent screen to production when ready.
- Google may require verification for public apps.
- Use strong secrets.
- Put the backend behind HTTPS.
- Consider secure cookies or stronger token storage for production.

## Google OAuth Configuration via UI

Instead of seeding Google credentials manually using `npm run seed:google-config`, you can set them up directly from the frontend dashboard:
1. Log in to the dashboard.
2. Go to **Settings** -> **Google Credentials**.
3. Input your **Google Client ID**, **Google Client Secret**, and **Redirect URI** (e.g. `https://103.65.237.136.nip.io:4000/connected-accounts/google/callback`).
4. Click **Save Configuration**.

The config is automatically encrypted and saved into the database, enabling Google sign-in and Google Drive connections instantly.

## Automated Updates & PM2 Management

For native VPS setups running with PM2, 9Drive includes a fully automated system update trigger and log monitor in the **Settings** UI.

### How it works
1. When you trigger an update from the frontend dashboard, the backend triggers the `update.sh` script in the background.
2. The script:
   - Resets any local Git conflicts (`git reset --hard`) and pulls the latest changes.
   - Installs dependencies and builds both backend and frontend.
   - Deploys Prisma database migrations.
   - Restarts the backend process using PM2 (`pm2 restart 9drive-backend`).
3. You can monitor the real-time rebuild progress using the log viewer inside the Settings UI.

### Manual update command
If you want to update manually via the terminal, run:
```bash
./update.sh
```
Or run the commands individually:
```bash
git reset --hard
git pull origin main
cd backend && npm install && npx prisma generate && npm run build && npx prisma migrate deploy
cd ../frontend && npm install && npm run build
pm2 restart 9drive-backend
```

## Build

Backend:

```bash
cd backend
npm run build
```

Frontend:

```bash
cd frontend
npm run build
```
