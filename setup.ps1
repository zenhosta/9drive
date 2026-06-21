# 9Drive Easy Setup Script for Windows (PowerShell)
# This script automates dependency installation, env config generation, DB creation, and prisma migrations.

Clear-Host
Write-Host "==================================================" -ForegroundColor Cyan
Write-Host "        9Drive Automated Setup Script             " -ForegroundColor Green
Write-Host "==================================================" -ForegroundColor Cyan
Write-Host "This script will configure your environments, install packages,"
Write-Host "and run Prisma migrations."
Write-Host ""

# Choose Database Type
Write-Host "--- 1. Select Database ---" -ForegroundColor Yellow
Write-Host "[1] SQLite (Recommended - No installation required, zero-config)" -ForegroundColor Green
Write-Host "[2] MySQL (Requires MySQL Server running locally)"
$dbChoice = Read-Host "Choose option [default: 1]"
if ([string]::IsNullOrEmpty($dbChoice)) { $dbChoice = "1" }

$dbUrl = ""

if ($dbChoice -eq "1") {
    Write-Host "Using SQLite..." -ForegroundColor Gray
    # Delete old MySQL migrations if switching to SQLite
    if (Test-Path "backend\prisma\migrations") {
        Remove-Item -Path "backend\prisma\migrations" -Recurse -Force
        Write-Host "Removed old MySQL migrations to prevent provider conflicts." -ForegroundColor Gray
    }
    $dbUrl = "file:./dev.db"
} else {
    Write-Host "Using MySQL..." -ForegroundColor Gray
    # Restore backup MySQL schema if it exists
    if (Test-Path "backend\prisma\schema.prisma.backup") {
        Copy-Item -Path "backend\prisma\schema.prisma.backup" -Destination "backend\prisma\schema.prisma" -Force
        Write-Host "Restored MySQL Prisma schema." -ForegroundColor Gray
    }

    # 1. Database Configuration
    Write-Host ""
    Write-Host "--- MySQL Database Configuration ---" -ForegroundColor Yellow
    $dbHost = Read-Host "Enter MySQL Host [default: localhost]"
    if ([string]::IsNullOrEmpty($dbHost)) { $dbHost = "localhost" }

    $dbPort = Read-Host "Enter MySQL Port [default: 3306]"
    if ([string]::IsNullOrEmpty($dbPort)) { $dbPort = "3306" }

    $dbUser = Read-Host "Enter MySQL Username [default: root]"
    if ([string]::IsNullOrEmpty($dbUser)) { $dbUser = "root" }

    $dbPass = Read-Host "Enter MySQL Password [default: empty]"

    $dbName = Read-Host "Enter Database Name [default: 9drive]"
    if ([string]::IsNullOrEmpty($dbName)) { $dbName = "9drive" }

    # Try creating the database
    Write-Host "Attempting to create database '$dbName'..." -ForegroundColor Gray
    $passArg = ""
    if (![string]::IsNullOrEmpty($dbPass)) {
        $passArg = "-p$dbPass"
    }

    try {
        if (Get-Command mysql -ErrorAction SilentlyContinue) {
            if ($passArg) {
                mysql -h $dbHost -P $dbPort -u $dbUser $passArg -e "CREATE DATABASE IF NOT EXISTS $dbName;" 2>$null
            } else {
                mysql -h $dbHost -P $dbPort -u $dbUser -e "CREATE DATABASE IF NOT EXISTS $dbName;" 2>$null
            }
            Write-Host "Database '$dbName' created or already exists!" -ForegroundColor Green
        } else {
            Write-Host "[!] 'mysql' command line tool not found in PATH. Please ensure MySQL is running and a database named '$dbName' exists." -ForegroundColor Yellow
        }
    } catch {
        Write-Host "[!] Failed to automatically create database. Please make sure MySQL is running." -ForegroundColor Red
    }

    $escapedPass = [uri]::EscapeDataString($dbPass)
    if ([string]::IsNullOrEmpty($dbPass)) {
        $dbUrl = "mysql://$dbUser@$dbHost`:$dbPort/$dbName"
    } else {
        $dbUrl = "mysql://$dbUser`:$escapedPass@$dbHost`:$dbPort/$dbName"
    }
}
Write-Host ""

# 2. Google Client ID / Secret Configuration
Write-Host "--- 2. Google OAuth Credentials (Optional) ---" -ForegroundColor Yellow
Write-Host "You can skip this now and configure it later in backend/.env" -ForegroundColor Gray
$googleClientId = Read-Host "Enter Google Client ID"
$googleClientSecret = Read-Host "Enter Google Client Secret"
Write-Host ""

# 3. Generate Random Secrets for Security
Write-Host "--- 3. Generating Environment Secrets ---" -ForegroundColor Yellow
# Generate a 32-character random key for Token Encryption
$tokenEncryptionKey = -join ((48..57) + (65..90) + (97..122) | Get-Random -Count 32 | ForEach-Object {[char]$_})
# Generate a 64-character random key for JWT
$jwtAccessSecret = -join ((48..57) + (65..90) + (97..122) | Get-Random -Count 64 | ForEach-Object {[char]$_})

# 4. Create backend/.env File
Write-Host "Writing backend/.env..." -ForegroundColor Gray

$backendEnvContent = @"
DATABASE_URL="$dbUrl"
APP_PORT=4000
FRONTEND_URL="http://localhost:5173"
JWT_ACCESS_SECRET="$jwtAccessSecret"
TOKEN_ENCRYPTION_KEY="$tokenEncryptionKey"
ACCESS_TOKEN_TTL_SECONDS=900
REFRESH_TOKEN_TTL_DAYS=30
MAX_UPLOAD_BYTES=5368709120
RECAPTCHA_SECRET_KEY=""

# Google OAuth Config (stored encrypted in DB via seed script)
GOOGLE_CLIENT_ID="$googleClientId"
GOOGLE_CLIENT_SECRET="$googleClientSecret"
GOOGLE_REDIRECT_URI="http://localhost:4000/connected-accounts/google/callback"
"@

$backendEnvContent | Out-File -FilePath "backend\.env" -Encoding utf8 -Force
Write-Host "backend/.env created successfully!" -ForegroundColor Green
Write-Host ""

# 5. Installing Backend Dependencies and running Migrations
Write-Host "--- 4. Installing Backend Dependencies & Migrations ---" -ForegroundColor Yellow
cd backend
Write-Host "Running npm install in backend..." -ForegroundColor Gray
npm install
if ($LASTEXITCODE -ne 0) {
    Write-Host "Backend installation failed. Please check Node.js & npm setup." -ForegroundColor Red
    cd ..
    Exit
}

Write-Host "Running Prisma generate and migrations..." -ForegroundColor Gray
npx prisma generate
npx prisma migrate dev --name init

if (![string]::IsNullOrEmpty($googleClientId) -and ![string]::IsNullOrEmpty($googleClientSecret)) {
    Write-Host "Seeding Google Config to database..." -ForegroundColor Gray
    npm run seed:google-config
} else {
    Write-Host "Google Config seeding skipped (credentials empty)." -ForegroundColor Yellow
}
cd ..
Write-Host ""

# 6. Installing Frontend Dependencies
Write-Host "--- 5. Installing Frontend Dependencies ---" -ForegroundColor Yellow
cd frontend
Write-Host "Running npm install in frontend..." -ForegroundColor Gray
npm install
cd ..
Write-Host ""

# 7. Create Root package.json for Concurrently Running
Write-Host "--- 6. Creating Root Runner Package ---" -ForegroundColor Yellow
$rootPackageJson = @"
{
  "name": "9drive-root",
  "version": "1.0.0",
  "scripts": {
    "dev": "npx concurrently \"npm run dev --prefix backend\" \"npm run dev --prefix frontend\""
  },
  "devDependencies": {
    "concurrently": "^8.2.2"
  }
}
"@
$rootPackageJson | Out-File -FilePath "package.json" -Encoding utf8 -Force
Write-Host "Root package.json created. Installing 'concurrently'..." -ForegroundColor Gray
npm install -D concurrently
Write-Host ""

Write-Host "==================================================" -ForegroundColor Green
Write-Host "              Setup Complete!                     " -ForegroundColor Green
Write-Host "==================================================" -ForegroundColor Green
Write-Host "To run the application (both Frontend and Backend):"
Write-Host "  npm run dev" -ForegroundColor Cyan
Write-Host "Or manually:"
Write-Host "  Backend: cd backend; npm run dev"
Write-Host "  Frontend: cd frontend; npm run dev"
Write-Host "==================================================" -ForegroundColor Green
