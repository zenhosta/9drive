FROM node:20-alpine AS base

WORKDIR /app

# mysqldump/mysql back the /system/backup and /system/restore endpoints.
RUN apk add --no-cache mysql-client

COPY package*.json ./
COPY prisma ./prisma

RUN npm ci

COPY tsconfig.json ./
COPY src ./src

RUN npm run build && npx prisma generate

EXPOSE 4000

CMD ["sh", "-c", "npm run db:migrate:deploy && npm run seed:google-config:docker && node dist/server.js"]
