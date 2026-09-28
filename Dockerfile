# =============================================================================
# Docker image for the MyFinance frontend.
#
# Runs the same `next build` / `next start` as Render — next.config.ts is left
# untouched (no `output: "standalone"`), so the Render deploy is unaffected.
#
#   docker compose up --build        # uses docker-compose.yml
#
# BACKEND_URL is read at RUNTIME (server-side only, never inlined into the
# browser bundle), so one image can point at any backend via `-e BACKEND_URL=`.
# =============================================================================

# Matches .node-version.
ARG NODE_VERSION=22

# --- deps: full install, cached until package-lock.json changes -------------
FROM node:${NODE_VERSION}-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --include=dev

# --- build -------------------------------------------------------------------
FROM node:${NODE_VERSION}-alpine AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .

# src/lib/api/client.ts throws when BACKEND_URL is unset under NODE_ENV=production,
# and `next build` imports it while collecting page data. The value only has to
# be present here; the runtime value set on the container is what requests use.
ARG BACKEND_URL=http://localhost:8080
ENV BACKEND_URL=${BACKEND_URL}
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build

# --- runtime -----------------------------------------------------------------
FROM node:${NODE_VERSION}-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000

# Production deps only. typescript stays (it is in `dependencies`), which
# `next start` needs to load next.config.ts.
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY --from=build /app/.next ./.next
COPY --from=build /app/public ./public
COPY --from=build /app/next.config.ts ./next.config.ts

USER node
EXPOSE 3000

# Answered by src/app/api/health/route.ts without calling the backend.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD wget -qO- http://127.0.0.1:${PORT}/api/health >/dev/null || exit 1

CMD ["npm", "start"]
