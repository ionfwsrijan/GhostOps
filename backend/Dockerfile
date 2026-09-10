# ---- build stage: compile TypeScript -------------------------------------------
FROM node:22-alpine AS build
WORKDIR /app

# npm workspace manifests (single hoisted lockfile lives at the repo root)
COPY package.json package-lock.json ./
COPY backend/package.json ./backend/
COPY frontend/package.json ./frontend/
RUN npm ci

COPY backend/migrate.config.js ./backend/
COPY backend/tsconfig.json ./backend/
COPY backend/src ./backend/src
COPY backend/migrations ./backend/migrations
RUN npm run build --workspace=backend

# ---- runtime stage --------------------------------------------------------------
FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=4000

COPY package.json package-lock.json ./
COPY backend/package.json ./backend/
COPY frontend/package.json ./frontend/
RUN npm ci --omit=dev --workspace=backend --include-workspace-root

COPY --from=build /app/backend/dist ./backend/dist
COPY --from=build /app/backend/migrate.config.js ./backend/
COPY --from=build /app/backend/migrations ./backend/migrations

WORKDIR /app/backend
EXPOSE 4000

# Run migrations on boot (schema is idempotent), then start the API + worker.
CMD ["sh", "-c", "npx node-pg-migrate up -m migrations && node dist/index.js"]