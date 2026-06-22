#!/bin/bash
# Go to the project root directory
cd "$(dirname "$0")"
PROJECT_ROOT="$(pwd)"
LOG_FILE="$PROJECT_ROOT/update.log"

echo "=== System Update Started: $(date) ===" > "$LOG_FILE"

echo "1. Pulling latest code from GitHub..." >> "$LOG_FILE"
git reset --hard >> "$LOG_FILE" 2>&1
git pull >> "$LOG_FILE" 2>&1

echo "2. Installing backend dependencies and building..." >> "$LOG_FILE"
cd "$PROJECT_ROOT/backend"
npm install >> "$LOG_FILE" 2>&1
npx prisma generate >> "$LOG_FILE" 2>&1
npm run build >> "$LOG_FILE" 2>&1
npx prisma migrate deploy >> "$LOG_FILE" 2>&1

echo "3. Installing frontend dependencies and building..." >> "$LOG_FILE"
cd "$PROJECT_ROOT/frontend"
npm install >> "$LOG_FILE" 2>&1
npm run build >> "$LOG_FILE" 2>&1

echo "4. Restarting application via PM2..." >> "$LOG_FILE"
echo "=== System Update Completed: $(date) ===" >> "$LOG_FILE"
pm2 restart 9drive-backend >> "$LOG_FILE" 2>&1
