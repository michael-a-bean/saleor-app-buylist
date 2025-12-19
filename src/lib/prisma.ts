import { PrismaClient } from "@prisma/client";

import { env } from "./env";

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

/**
 * Prisma client for the shared inventory-ops database.
 *
 * The Buylist app shares the same PostgreSQL database as inventory-ops
 * to enable direct CostLayerEvent creation and WAC calculations.
 *
 * Schema is managed in: saleor-apps/apps/inventory-ops/prisma/schema.prisma
 * This app uses a symlink to that schema for type generation.
 */
export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: env.NODE_ENV === "development" ? ["query", "error", "warn"] : ["error"],
  });

if (env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}

export type { PrismaClient };
