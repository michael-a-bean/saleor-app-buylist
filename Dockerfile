FROM node:22-alpine AS base

# Install dependencies only when needed
FROM base AS deps
RUN apk add --no-cache libc6-compat openssl
WORKDIR /app

ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
RUN corepack enable

# Copy root package files for monorepo
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY turbo.json ./

# Copy all package.json files to preserve workspace structure
COPY packages/ ./packages/
COPY apps/buylist/ ./apps/buylist/
# Copy inventory-ops prisma schema (shared database)
COPY apps/inventory-ops/prisma/ ./apps/inventory-ops/prisma/

# Install dependencies
# IMPORTANT: Use --frozen-lockfile for reproducible builds
# If this fails, update pnpm-lock.yaml locally first: pnpm install
RUN pnpm install --frozen-lockfile

# Build stage
FROM base AS builder
WORKDIR /app

RUN apk add --no-cache openssl

ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
RUN corepack enable

# Skip env validation during build - real values come from runtime env
# BASE_PATH enables path-based ALB routing in staging
ARG BASE_PATH=""
ENV BASE_PATH=${BASE_PATH}
ENV NEXT_PUBLIC_BASE_PATH=${BASE_PATH}

COPY --from=deps /app ./

# Write BASE_PATH to .env file for Next.js to read during build
# This ensures basePath is baked into the static assets
RUN echo "BASE_PATH=${BASE_PATH}" > /app/apps/buylist/.env && \
    echo "NEXT_PUBLIC_BASE_PATH=${BASE_PATH}" >> /app/apps/buylist/.env

# Build the app and its dependencies
ENV SKIP_ENV_VALIDATION=true
RUN pnpm turbo run build --filter=saleor-app-buylist

# Production stage
FROM base AS runner
WORKDIR /app

# Install curl for health checks, openssl for Prisma
# Upgrade base packages to pick up security fixes (e.g., zlib CVE-2026-22184)
RUN apk upgrade --no-cache && apk add --no-cache curl openssl

ENV NODE_ENV=production
ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
RUN corepack enable

RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 nextjs

# Copy built application with correct ownership
COPY --from=builder --chown=nextjs:nodejs /app/node_modules ./node_modules
COPY --from=builder --chown=nextjs:nodejs /app/packages ./packages
COPY --from=builder --chown=nextjs:nodejs /app/apps/buylist ./apps/buylist

WORKDIR /app/apps/buylist

# Create data directory for APL storage with correct ownership
RUN mkdir -p data && chown nextjs:nodejs data

USER nextjs

EXPOSE 3003
ENV HOSTNAME=0.0.0.0
ENV PORT=3003

CMD ["pnpm", "start"]
