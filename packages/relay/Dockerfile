# syntax=docker/dockerfile:1.7
#
# LYY relay container — Node 20 + pnpm monorepo (only @lyy/shared + @lyy/relay
# are needed at runtime). Multi-stage so the final image carries dist/ + the
# pruned production node_modules, no source / dev deps.
#
# Build from the monorepo root:
#   docker build -f packages/relay/Dockerfile -t lyy-relay:dev .

# ─── stage 1: builder ─────────────────────────────────────────────────────────
FROM node:20-alpine AS builder

# git is needed for some npm postinstalls; libc6-compat for native modules
RUN apk add --no-cache git libc6-compat

WORKDIR /workspace

# Enable pnpm via corepack (matches the version pinned in root package.json)
RUN corepack enable

# Copy lockfile + workspace manifest + only the packages relay actually depends
# on (shared + relay). cli/daemon/mcp are CLI tools, not deployed by this image.
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json tsconfig.base.json ./
COPY packages/shared/package.json packages/shared/tsconfig.json ./packages/shared/
COPY packages/relay/package.json packages/relay/tsconfig.json ./packages/relay/

# Install dev+prod deps for the two workspaces we need
RUN pnpm install --frozen-lockfile --filter '@lyy/shared...' --filter '@lyy/relay...'

# Copy sources and build
COPY packages/shared/src ./packages/shared/src
COPY packages/relay/src ./packages/relay/src
RUN pnpm -F @lyy/shared build && pnpm -F @lyy/relay build

# Prune dev deps so the final image only carries runtime modules
RUN pnpm prune --prod

# ─── stage 2: runtime ─────────────────────────────────────────────────────────
FROM node:20-alpine AS runtime

# tini = signal-correct PID 1; libc6-compat for any native module loaded at runtime
RUN apk add --no-cache tini libc6-compat

WORKDIR /app

# Run as a non-root user
RUN addgroup -S lyy && adduser -S lyy -G lyy

# Copy the pruned workspace from builder
COPY --from=builder --chown=lyy:lyy /workspace /app

USER lyy

ENV NODE_ENV=production \
    PORT=3000 \
    HOST=0.0.0.0

EXPOSE 3000

# tini reaps zombies and forwards signals (Fastify's graceful shutdown depends
# on receiving SIGTERM unmodified)
ENTRYPOINT ["/sbin/tini", "--"]

# Run the compiled relay entry
WORKDIR /app/packages/relay
CMD ["node", "dist/main.js"]
