#!/usr/bin/env bash
# 9Drive Automated Setup Script for Linux/macOS

set -e

echo "=========================================="
echo "      9Drive Automated Setup (Linux)      "
echo "=========================================="
echo ""

if ! command -v node &> /dev/null; then
    echo "[!] Node.js is not installed. Please install Node.js 20+ first."
    exit 1
fi

echo "[+] Node.js detected: $(node -v)"

SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
BACKEND_DIR="$SCRIPT_DIR/backend"
FRONTEND_DIR="$SCRIPT_DIR/frontend"
BACKEND_ENV="$BACKEND_DIR/.env"
FRONTEND_ENV="$FRONTEND_DIR/.env"

generate_key() {
    if command -v openssl &> /dev/null; then
        openssl rand -hex 32
    else
        node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
    fi
}

if [ ! -f "$BACKEND_ENV" ]; then
    echo "[+] Creating backend/.env with secure random keys..."
    read -p "Enter MySQL DATABASE_URL [default: mysql://root:root@localhost:3306/9drive]: " DB_URL
    DB_URL=${DB_URL:-mysql://root:root@localhost:3306/9drive}

    read -p "Enter GOOGLE_CLIENT_ID (optional, press Enter to skip): " GOOGLE_CLIENT_ID
    read -p "Enter GOOGLE_CLIENT_SECRET (optional, press Enter to skip): " GOOGLE_CLIENT_SECRET

    JWT_SECRET=$(generate_key)
    TOKEN_ENCRYPTION_KEY=$(generate_key)

    cat <<EOF > "$BACKEND_ENV"
DATABASE_URL="$DB_URL"
APP_PORT=4000
FRONTEND_URL="http://localhost:5173"
JWT_ACCESS_SECRET="$JWT_SECRET"
TOKEN_ENCRYPTION_KEY="$TOKEN_ENCRYPTION_KEY"
ACCESS_TOKEN_TTL_SECONDS=3600
REFRESH_TOKEN_TTL_DAYS=30
MAX_UPLOAD_BYTES=5368709120
GOOGLE_CLIENT_ID="$GOOGLE_CLIENT_ID"
GOOGLE_CLIENT_SECRET="$GOOGLE_CLIENT_SECRET"
GOOGLE_REDIRECT_URI="http://localhost:4000/connected-accounts/google/callback"
FILE_ENCRYPTION_ENABLED=false
EOF
    echo "[+] backend/.env created successfully."
else
    echo "[i] backend/.env already exists."
fi

if [ ! -f "$FRONTEND_ENV" ]; then
    echo "[+] Creating frontend/.env..."
    cat <<EOF > "$FRONTEND_ENV"
VITE_API_URL=http://localhost:4000
VITE_RECAPTCHA_SITE_KEY=
EOF
    echo "[+] frontend/.env created successfully."
else
    echo "[i] frontend/.env already exists."
fi

echo ""
echo "[+] Installing backend dependencies..."
(cd "$BACKEND_DIR" && npm install && npx prisma generate)

echo ""
echo "[+] Installing frontend dependencies..."
(cd "$FRONTEND_DIR" && npm install)

echo ""
echo "=========================================="
echo "   Setup Completed Successfully!          "
echo "=========================================="
echo ""
echo "To start the application:"
echo "  1. Run Prisma database migrations:"
echo "     cd backend && npx prisma migrate dev"
echo "  2. Start backend server:"
echo "     cd backend && npm run dev"
echo "  3. Start frontend app:"
echo "     cd frontend && npm run dev"
echo ""
