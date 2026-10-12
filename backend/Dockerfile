# syntax=docker/dockerfile:1
# ============================================
# SkyNest HRGSMS backend image (Express + TypeScript, PostgreSQL)
# ============================================
# The repository is an npm workspace with one root lockfile, so the build
# context is the repository root and the manifests for both workspaces must be
# present before `npm ci` can reproduce the install. The `migrate` and `seed`
# compose services reuse this same image and only override the start command.

# ============================================
# Stage 1: Install all workspace dependencies (with dev deps for the build)
# ============================================
FROM node:22-bookworm-slim AS deps

WORKDIR /app

COPY package.json package-lock.json ./
COPY frontend/package.json ./frontend/package.json
COPY backend/package.json ./backend/package.json

RUN npm ci

# ============================================
# Stage 2: Compile the backend TypeScript to dist/
# ============================================
FROM deps AS build

WORKDIR /app

COPY backend ./backend

# tsc emits backend/dist, including dist/migrations/cli.js and dist/seed/cli.js
# which the compose `migrate`/`seed` services invoke.
RUN npm run build --workspace=backend

# ============================================
# Stage 3: Production dependencies only
# ============================================
FROM node:22-bookworm-slim AS prod-deps

WORKDIR /app
ENV NODE_ENV=production

COPY package.json package-lock.json ./
COPY frontend/package.json ./frontend/package.json
COPY backend/package.json ./backend/package.json

RUN npm ci --omit=dev \
    && npm cache clean --force

# ============================================
# Stage 4: Minimal runtime image
# ============================================
FROM node:22-bookworm-slim AS runner

WORKDIR /app

ENV NODE_ENV=production
ENV PORT=4000

# Production node_modules, compiled JavaScript and the SQL migration files.
# The migrations runner resolves MIGRATIONS_DIR relative to the compiled CLI,
# so the folder must sit next to dist/ at runtime.
COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=build /app/backend/dist ./backend/dist
COPY backend/migrations ./backend/migrations
COPY backend/package.json ./backend/package.json

# Run as the unprivileged user that ships with the Node image.
USER node

EXPOSE 4000

CMD ["node", "backend/dist/index.js"]
