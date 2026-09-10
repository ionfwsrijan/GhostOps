# ---- build stage: compile + bundle the SPA -------------------------------------
FROM node:22-alpine AS build
WORKDIR /app

# npm workspace manifests (single hoisted lockfile lives at the repo root)
COPY package.json package-lock.json ./
COPY backend/package.json ./backend/
COPY frontend/package.json ./frontend/
RUN npm ci

COPY frontend/ ./frontend/
ARG VITE_API_PROXY=http://localhost:4000
ENV VITE_API_PROXY=$VITE_API_PROXY
RUN npm run build --workspace=frontend

# ---- runtime stage --------------------------------------------------------------
FROM node:22-alpine
WORKDIR /app
ENV PORT=5173
ARG VITE_API_PROXY=http://localhost:4000
ENV VITE_API_PROXY=$VITE_API_PROXY

COPY package.json package-lock.json ./
COPY backend/package.json ./backend/
COPY frontend/package.json ./frontend/
RUN npm ci --workspace=frontend

COPY --from=build /app/frontend/dist ./frontend/dist
COPY --from=build /app/frontend/vite.config.ts ./frontend/
COPY --from=build /app/frontend/index.html ./frontend/

WORKDIR /app/frontend
EXPOSE 5173
# vite preview serves the static build and proxies /api to the backend container
CMD ["npx", "vite", "preview", "--host", "--port", "5173"]