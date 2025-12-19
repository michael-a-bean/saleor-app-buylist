# Prisma Schema

The Buylist app shares the PostgreSQL database with the Inventory-Ops app to enable:

1. Direct CostLayerEvent creation for WAC calculations
2. Shared AppInstallation table for multi-tenancy
3. Unified reporting across purchase orders, goods receipts, and buylists

## Schema Location

The canonical Prisma schema is located at:
```
../inventory-ops/prisma/schema.prisma
```

## Development

When running `prisma generate` or `prisma migrate`, use the inventory-ops schema:

```bash
cd ../inventory-ops
pnpm prisma generate
pnpm prisma migrate dev
```

## Models

Buylist-specific models added to the shared schema:
- `Buylist` - Buylist header with customer info and totals
- `BuylistLine` - Line items with product references and pricing
- `BuylistPayout` - Payment records
- `BuylistAuditEvent` - Append-only audit trail
- `BuylistPricingPolicy` - JSON-based pricing rules
- `SellPriceSnapshot` - Market price snapshots

## CostEventType

The `BUYLIST_RECEIPT` event type is added to the `CostEventType` enum for tracking
buylist receipts in the cost layer ledger.
