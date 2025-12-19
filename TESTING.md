# Buylist App Testing Guide

## Prerequisites

Ensure all services are running:
```bash
docker compose up -d api dashboard inventory-ops-db
```

## Step 1: Install Dependencies

From the saleor-apps directory:
```bash
cd saleor-apps
pnpm install
```

## Step 2: Build the Buylist App

Option A - Docker build (recommended for testing integration):
```bash
cd /home/michael/saleor-platform
docker compose build buylist-app
docker compose up -d buylist-app
```

Option B - Local development:
```bash
cd saleor-apps/apps/buylist
pnpm dev
```

## Step 3: Verify the App is Running

1. Check the app is accessible: http://localhost:3003
2. Check the manifest: http://localhost:3003/api/manifest

## Step 4: Install the App in Saleor Dashboard

1. Open the Saleor Dashboard: http://localhost:9000
2. Go to Apps > Install App
3. Enter the manifest URL: `http://buylist-app:3003/api/manifest` (Docker) or `http://localhost:3003/api/manifest` (local)
4. Click Install

## Step 5: Access the App

After installation, click on the Buylist app in the Apps list to open it.

## Troubleshooting

### App not connecting
- Check logs: `docker compose logs -f buylist-app`
- Verify DATABASE_URL is correct
- Ensure inventory-ops-db is running

### Build fails
- Run `pnpm install` from saleor-apps root
- Check for TypeScript errors: `pnpm check-types`

### Registration fails
- Check API logs: `docker compose logs -f api`
- Verify ALLOWED_HOSTS includes `buylist-app`

## Next Steps (Phase 2)

After successful testing, continue with:
1. Add Prisma schema models to inventory-ops
2. Run migrations
3. Implement tRPC procedures for buylists

## File Structure

```
apps/buylist/
├── Dockerfile
├── package.json
├── next.config.ts
├── tsconfig.json
├── graphql/
│   └── schema.graphql
├── src/
│   ├── app/api/
│   │   ├── manifest/
│   │   ├── register/
│   │   └── trpc/[trpc]/
│   ├── lib/
│   │   ├── env.ts
│   │   ├── prisma.ts
│   │   └── ...
│   ├── modules/trpc/
│   ├── pages/
│   │   ├── _app.tsx
│   │   └── index.tsx
│   └── ui/components/
└── public/
```
