/**
 * Attributes Router
 *
 * tRPC endpoints for managing product attribute cache.
 */

import { z } from "zod";

import { createInstrumentedGraphqlClient } from "@/lib/graphql-client";
import { createLogger } from "@/lib/logger";
import { saleorApp } from "@/lib/saleor-app";
import { protectedClientProcedure } from "@/modules/trpc/protected-client-procedure";
import { router } from "@/modules/trpc/trpc-server";

import { AttributeCacheService } from "./attribute-cache";

const logger = createLogger("attributes-router");

/**
 * Get an AttributeCacheService for the current context
 */
async function getAttributeCacheService(ctx: {
  prisma: import("@prisma/client").PrismaClient;
  saleorApiUrl: string;
  installationId: string;
}) {
  // Get auth data for GraphQL client
  const authData = await saleorApp.apl.get(ctx.saleorApiUrl);
  if (!authData) {
    throw new Error("Auth data not found");
  }

  const gqlClient = createInstrumentedGraphqlClient({
    saleorApiUrl: authData.saleorApiUrl,
    token: authData.token,
  });

  return new AttributeCacheService(ctx.prisma, gqlClient, ctx.installationId);
}

export const attributesRouter = router({
  /**
   * Get cached attributes for a single variant
   */
  get: protectedClientProcedure
    .input(
      z.object({
        variantId: z.string().min(1),
        forceRefresh: z.boolean().default(false),
      })
    )
    .query(async ({ ctx, input }) => {
      logger.debug("Getting attributes", { variantId: input.variantId });

      const service = await getAttributeCacheService(ctx);
      const result = await service.getAttributes(input.variantId, {
        force: input.forceRefresh,
      });

      return {
        success: result.success,
        attributes: result.cached,
        error: result.error,
        fetchedFromSaleor: result.fetchedFromSaleor,
        wasStale: result.wasStale,
      };
    }),

  /**
   * Get cached attributes for multiple variants
   */
  getBulk: protectedClientProcedure
    .input(
      z.object({
        variantIds: z.array(z.string().min(1)).max(100),
      })
    )
    .query(async ({ ctx, input }) => {
      logger.debug("Getting attributes (bulk)", { count: input.variantIds.length });

      const service = await getAttributeCacheService(ctx);
      const cached = await service.getCachedBulk(input.variantIds);

      // Convert Map to plain object for response
      const result: Record<string, ReturnType<typeof cached.get> | null> = {};
      for (const variantId of input.variantIds) {
        result[variantId] = cached.get(variantId) ?? null;
      }

      return {
        attributes: result,
        found: cached.size,
        missing: input.variantIds.length - cached.size,
      };
    }),

  /**
   * Sync attributes for variants (fetch from Saleor and update cache)
   */
  sync: protectedClientProcedure
    .input(
      z.object({
        variantIds: z.array(z.string().min(1)).max(100),
        force: z.boolean().default(false),
        ttlHours: z.number().min(1).max(168).default(24), // 1 hour to 1 week
      })
    )
    .mutation(async ({ ctx, input }) => {
      logger.info("Syncing attributes", {
        count: input.variantIds.length,
        force: input.force,
      });

      const service = await getAttributeCacheService(ctx);
      const result = await service.syncBulk(input.variantIds, {
        force: input.force,
        ttlHours: input.ttlHours,
      });

      return {
        total: result.total,
        success: result.success,
        failed: result.failed,
        skipped: result.skipped,
        results: result.results.map((r) => ({
          variantId: r.variantId,
          success: r.success,
          error: r.error,
          fetchedFromSaleor: r.fetchedFromSaleor,
        })),
      };
    }),

  /**
   * Search cached attributes by criteria
   */
  search: protectedClientProcedure
    .input(
      z.object({
        setCode: z.string().optional(),
        rarity: z.string().optional(),
        finish: z.string().optional(),
        minQtyOnHand: z.number().int().optional(),
        maxQtyOnHand: z.number().int().optional(),
        limit: z.number().int().min(1).max(100).default(50),
        offset: z.number().int().min(0).default(0),
      })
    )
    .query(async ({ ctx, input }) => {
      logger.debug("Searching cached attributes", input);

      const service = await getAttributeCacheService(ctx);
      const results = await service.searchCached(input);

      return {
        results,
        count: results.length,
        hasMore: results.length === input.limit,
      };
    }),

  /**
   * Get cache statistics
   */
  stats: protectedClientProcedure.query(async ({ ctx }) => {
    logger.debug("Getting attribute cache stats");

    const service = await getAttributeCacheService(ctx);
    const stats = await service.getStats();

    return {
      ...stats,
      avgAgeHours: Math.round(stats.avgAge / 3600 * 10) / 10, // Convert seconds to hours
    };
  }),

  /**
   * Invalidate cache for specific variants
   */
  invalidate: protectedClientProcedure
    .input(
      z.object({
        variantIds: z.array(z.string().min(1)).max(100),
      })
    )
    .mutation(async ({ ctx, input }) => {
      logger.info("Invalidating attribute cache", { count: input.variantIds.length });

      const service = await getAttributeCacheService(ctx);
      let invalidated = 0;

      for (const variantId of input.variantIds) {
        await service.invalidate(variantId);
        invalidated++;
      }

      return {
        invalidated,
      };
    }),

  /**
   * Invalidate entire cache for this installation
   */
  invalidateAll: protectedClientProcedure.mutation(async ({ ctx }) => {
    logger.warn("Invalidating entire attribute cache");

    const service = await getAttributeCacheService(ctx);
    const count = await service.invalidateAll();

    return {
      invalidated: count,
    };
  }),
});
