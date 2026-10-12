# syntax=docker/dockerfile:1
# ============================================
# SkyNest HRGSMS frontend image (React + Vite, served by nginx)
# ============================================
# The Vite build produces a static SPA (frontend/dist). nginx serves those files
# and reverse-proxies /api to the backend container, so the browser talks to a
# single origin and the HTTP-only session cookie is sent unchanged.

# ============================================
# Stage 1: Build the Vite application
# ============================================
FROM node:22-bookworm-slim AS build

WORKDIR /app
ENV NODE_ENV=development

# The repository is an npm workspace with one root lockfile, so all workspace
# manifests must be copied before `npm ci`.
COPY package.json package-lock.json ./
COPY frontend/package.json ./frontend/package.json
COPY backend/package.json ./backend/package.json

RUN npm ci

COPY frontend ./frontend

# `build` runs `tsc && vite build` and writes frontend/dist.
RUN npm run build --workspace=frontend

# ============================================
# Stage 2: Serve the static build with nginx
# ============================================
FROM nginx:1.27-alpine AS runner

# Single-origin static host + /api reverse proxy (SPA history fallback).
COPY frontend/nginx.conf /etc/nginx/conf.d/default.conf

COPY --from=build /app/frontend/dist /usr/share/nginx/html

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
