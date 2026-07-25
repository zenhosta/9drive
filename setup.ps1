# 9Drive Automated Setup Script for Windows (PowerShell)

Write-Host "==========================================" -ForegroundColor Cyan
Write-Host "      9Drive Automated Setup              " -ForegroundColor Cyan
Write-Host "==========================================" -ForegroundColor Cyan
Write-Host ""

# Check Node.js
try {
    $nodeVersion = node -v
    Write-Host "[+] Node.js detected: $nodeVersion" -ForegroundColor Green
} catch {
    Write-Host "[!] Node.js is not installed or not in PATH. Please install Node.js 20+ first." -ForegroundColor Red
    exit 1
}

# Function to generate a random 32-byte hex key
function New-RandomKey {
    $bytes = New-Object byte[] 32
    (New-Object System.Security.Cryptography.RNGCryptoServiceProvider).GetBytes($bytes)
    return [System.BitConverter]::ToString($bytes).Replace("-", "").ToLower()
}

$backendDir = Join-Path $PSScriptRoot "backend"
$frontendDir = Join-Path $PSScriptRoot "frontend"
$backendEnv = Join-Path $backendDir ".env"
$frontendEnv = Join-Path $frontendDir ".env"

# Create backend .env if missing
if (-not (Test-Path $backendEnv)) {
    Write-Host "[+] Creating backend/.env with secure random keys..." -ForegroundColor Yellow
    
    $dbUrl = Read-Host "Enter MySQL DATABASE_URL [default: mysql://root:root@localhost:3306/9drive]"
    if ([string]::IsNullOrWhiteSpace($dbUrl)) {
        $dbUrl = "mysql://root:root@localhost:3306/9drive"
    }

    $googleClientId = Read-Host "Enter GOOGLE_CLIENT_ID (optional, press Enter to skip)"
    $googleClientSecret = Read-Host "Enter GOOGLE_CLIENT_SECRET (optional, press Enter to skip)"

    $jwtSecret = New-RandomKey
    $tokenEncryptionKey = New-RandomKey

    $envContent = @"
DATABASE_URL="$dbUrl"
APP_PORT=4000
FRONTEND_URL="http://localhost:5173"
JWT_ACCESS_SECRET="$jwtSecret"
TOKEN_ENCRYPTION_KEY="$tokenEncryptionKey"
ACCESS_TOKEN_TTL_SECONDS=3600
REFRESH_TOKEN_TTL_DAYS=30
MAX_UPLOAD_BYTES=5368709120
GOOGLE_CLIENT_ID="$googleClientId"
GOOGLE_CLIENT_SECRET="$googleClientSecret"
GOOGLE_REDIRECT_URI="http://localhost:4000/connected-accounts/google/callback"
FILE_ENCRYPTION_ENABLED=false
"@
    Set-Content -Path $backendEnv -Value $envContent
    Write-Host "[+] backend/.env created successfully." -ForegroundColor Green
} else {
    Write-Host "[i] backend/.env already exists." -ForegroundColor Gray
}

# Create frontend .env if missing
if (-not (Test-Path $frontendEnv)) {
    Write-Host "[+] Creating frontend/.env..." -ForegroundColor Yellow
    $frontendContent = @"
VITE_API_URL=http://localhost:4000
VITE_RECAPTCHA_SITE_KEY=
"@
    Set-Content -Path $frontendEnv -Value $frontendContent
    Write-Host "[+] frontend/.env created successfully." -ForegroundColor Green
} else {
    Write-Host "[i] frontend/.env already exists." -ForegroundColor Gray
}

# Install dependencies & run Prisma setup
Write-Host ""
Write-Host "[+] Installing backend dependencies..." -ForegroundColor Yellow
Push-Location $backendDir
npm install
Write-Host "[+] Generating Prisma Client..." -ForegroundColor Yellow
npx prisma generate
Pop-Location

Write-Host ""
Write-Host "[+] Installing frontend dependencies..." -ForegroundColor Yellow
Push-Location $frontendDir
npm install
Pop-Location

Write-Host ""
Write-Host "==========================================" -ForegroundColor Green
Write-Host "   Setup Completed Successfully!          " -ForegroundColor Green
Write-Host "==========================================" -ForegroundColor Green
Write-Host ""
Write-Host "To start the application:" -ForegroundColor Cyan
Write-Host "  1. Run Prisma database migrations:" -ForegroundColor White
Write-Host "     cd backend; npx prisma migrate dev" -ForegroundColor Gray
Write-Host "  2. Start backend server:" -ForegroundColor White
Write-Host "     cd backend; npm run dev" -ForegroundColor Gray
Write-Host "  3. Start frontend app:" -ForegroundColor White
Write-Host "     cd frontend; npm run dev" -ForegroundColor Gray
Write-Host ""
