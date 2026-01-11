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

COPY --from=deps /app ./

# Build the app and its dependencies
ENV SKIP_ENV_VALIDATION=true
RUN pnpm turbo run build --filter=saleor-app-buylist

# Production stage
FROM base AS runner
WORKDIR /app

RUN apk add --no-cache openssl

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
ENV PORT=3003

CMD ["pnpm", "start"]
