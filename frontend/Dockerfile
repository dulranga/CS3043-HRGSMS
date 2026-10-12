# syntax=docker/dockerfile:1
# ============================================
# SkyNest HRGSMS frontend image (React + Vite, served by Vite preview)
# ============================================
# The Vite build produces a static SPA (frontend/dist). The preview server
# serves those files and reverse-proxies /api to the backend, so the browser
# talks to a single origin and the HTTP-only session cookie is sent unchanged.

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
# Stage 2: Serve the static build with Vite preview
# ============================================
FROM node:22-bookworm-slim AS runner

WORKDIR /app
ENV NODE_ENV=production

# Reuse the build stage's workspace node_modules (which include the `vite`
# dev dependency the preview server needs) instead of installing again.
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/frontend ./frontend

# Preview server port; VITE_BACKEND_URL selects the /api proxy target.
EXPOSE 4173

CMD ["npm", "run", "preview", "--workspace=frontend", "--", "--host", "0.0.0.0", "--port", "4173"]
