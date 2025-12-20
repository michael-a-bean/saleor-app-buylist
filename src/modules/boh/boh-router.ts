/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unused-vars, multiline-comment-style */
import { TRPCError } from "@trpc/server";
import { Decimal } from "decimal.js";
import { z } from "zod";

import { extractUserFromToken } from "@/lib/jwt-utils";
import { createLogger } from "@/lib/logger";
import { createSaleorClient, StockUpdateResult } from "@/lib/saleor-client";
import { computeWacForNewEvent } from "@/lib/wac-service";
import { protectedClientProcedure } from "@/modules/trpc/protected-client-procedure";
import { router } from "@/modules/trpc/trpc-server";

const logger = createLogger("boh-router");

/**
 * Get a user-friendly identifier from context
 */
function getUserId(ctx: { token?: string | null }): string | null {
  return extractUserFromToken(ctx.token);
}

// Condition enum for validation (used by verifyLineSchema)
const conditionEnum = z.enum(["NM", "LP", "MP", "HP", "DMG"]);

// Search schema for queue
const queueSearchSchema = z.object({
  warehouseId: z.string().optional(),
  dateFrom: z.string().datetime().optional(),
  dateTo: z.string().datetime().optional(),
  minValue: z.number().min(0).optional(),
  maxValue: z.number().min(0).optional(),
  limit: z.number().min(1).max(100).optional().default(50),
  offset: z.number().min(0).optional().default(0),
});

// Verify line schema - for BOH verification
const verifyLineSchema = z.object({
  lineId: z.string().uuid(),
  qtyAccepted: z.number().int().min(0).optional(), // Default to original qty if not specified
  condition: z.enum(["NM", "LP", "MP", "HP", "DMG"]).optional(), // Can update condition (doesn't affect price)
  conditionNote: z.string().optional().nullable(), // Note if condition differs from original
});

// Verify and receive schema
const verifyAndReceiveSchema = z.object({
  buylistId: z.string().uuid(),
  lines: z.array(verifyLineSchema).optional(), // Only need to specify lines with changes
  internalNotes: z.string().optional().nullable(),
});

/**
 * BOH (Back of House) Router - Verification and stock receiving
 */
export const bohRouter = router({
  /**
   * Get the BOH verification queue (buylists pending verification)
   */
  queue: protectedClientProcedure.input(queueSearchSchema.optional()).query(async ({ ctx, input }) => {
    const where: any = {
      installationId: ctx.installationId,
      status: "PENDING_VERIFICATION",
    };

    if (input?.warehouseId) {
      where.saleorWarehouseId = input.warehouseId;
    }

    if (input?.dateFrom || input?.dateTo) {
      where.paidAt = {};
      if (input?.dateFrom) {
        where.paidAt.gte = new Date(input.dateFrom);
      }
      if (input?.dateTo) {
        where.paidAt.lte = new Date(input.dateTo);
      }
    }

    if (input?.minValue !== undefined || input?.maxValue !== undefined) {
      where.totalQuotedAmount = {};
      if (input?.minValue !== undefined) {
        where.totalQuotedAmount.gte = input.minValue;
      }
      if (input?.maxValue !== undefined) {
        where.totalQuotedAmount.lte = input.maxValue;
      }
    }

    const [buylists, total] = await Promise.all([
      ctx.prisma.buylist.findMany({
        where,
        orderBy: { paidAt: "asc" }, // FIFO - oldest first
        take: input?.limit ?? 50,
        skip: input?.offset ?? 0,
        include: {
          _count: {
            select: { lines: true },
          },
        },
      }),
      ctx.prisma.buylist.count({ where }),
    ]);

    return {
      buylists,
      total,
      hasMore: (input?.offset ?? 0) + buylists.length < total,
    };
  }),

  /**
   * Verify cards and receive into stock (simplified workflow)
   * - Updates condition if needed (doesn't change price - customer already paid)
   * - Sets qtyAccepted for each line (defaults to original qty)
   * - Updates Saleor stock
   * - Creates cost layer events
   * - Sets status to COMPLETED
   */
  verifyAndReceive: protectedClientProcedure
    .input(verifyAndReceiveSchema)
    .mutation(async ({ ctx, input }) => {
      const buylist = await ctx.prisma.buylist.findFirst({
        where: {
          id: input.buylistId,
          installationId: ctx.installationId,
        },
        include: {
          lines: true,
        },
      });

      if (!buylist) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Buylist not found",
        });
      }

      if (buylist.status !== "PENDING_VERIFICATION") {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "Buylist must be pending verification",
        });
      }

      // Build a map of line updates from input
      const lineUpdates = new Map<string, typeof input.lines extends (infer T)[] | undefined ? T : never>();
      for (const lineUpdate of input.lines ?? []) {
        lineUpdates.set(lineUpdate.lineId, lineUpdate);
      }

      // Process each line - apply updates and prepare stock adjustments
      let totalReceivedQty = 0;
      const stockAdjustments: Array<{ variantId: string; warehouseId: string; delta: number }> = [];
      const linesToProcess: Array<{
        line: typeof buylist.lines[0];
        qtyAccepted: number;
      }> = [];

      for (const line of buylist.lines) {
        const update = lineUpdates.get(line.id);

        // Default qtyAccepted to original qty if not specified
        const qtyAccepted = update?.qtyAccepted ?? line.qty;

        // Update line with condition changes and qtyAccepted
        await ctx.prisma.buylistLine.update({
          where: { id: line.id },
          data: {
            qtyAccepted,
            ...(update?.condition && { condition: update.condition }),
            ...(update?.conditionNote !== undefined && { conditionNote: update.conditionNote }),
          },
        });

        if (qtyAccepted <= 0) continue;

        totalReceivedQty += qtyAccepted;
        linesToProcess.push({ line, qtyAccepted });

        // Add stock adjustment (positive delta = adding to inventory)
        stockAdjustments.push({
          variantId: line.saleorVariantId,
          warehouseId: buylist.saleorWarehouseId,
          delta: qtyAccepted,
        });
      }

      // Update Saleor stock
      let stockResults: StockUpdateResult[] = [];
      if (stockAdjustments.length > 0) {
        logger.info("Updating Saleor stock for buylist verification", {
          buylistId: input.buylistId,
          adjustmentCount: stockAdjustments.length,
        });

        const saleorClient = createSaleorClient(ctx.apiClient);
        stockResults = await saleorClient.bulkAdjustStock(stockAdjustments);

        // Check for failures
        const failures = stockResults.filter((r) => !r.success);
        if (failures.length > 0) {
          logger.error("Some stock updates failed", {
            buylistId: input.buylistId,
            failures: failures.map((f) => ({
              variantId: f.variantId,
              error: f.error,
            })),
          });

          // If ALL failed, throw error
          if (failures.length === stockResults.length) {
            throw new TRPCError({
              code: "INTERNAL_SERVER_ERROR",
              message: `Failed to update stock in Saleor: ${failures[0].error}`,
            });
          }
        }

        logger.info("Saleor stock update complete", {
          buylistId: input.buylistId,
          successCount: stockResults.filter((r) => r.success).length,
        });
      }

      // Create cost layer events - use finalPrice (what we paid customer) as unit cost
      let costEventsCreated = 0;
      for (const { line, qtyAccepted } of linesToProcess) {
        const { wacAtEvent, qtyOnHandAtEvent } = await computeWacForNewEvent({
          prisma: ctx.prisma,
          installationId: ctx.installationId,
          variantId: line.saleorVariantId,
          warehouseId: buylist.saleorWarehouseId,
          newQtyDelta: qtyAccepted,
          newUnitCost: new Decimal(line.finalPrice.toString()),
          newLandedCostDelta: new Decimal(0),
        });

        await ctx.prisma.costLayerEvent.create({
          data: {
            installationId: ctx.installationId,
            eventType: "BUYLIST_RECEIPT",
            saleorVariantId: line.saleorVariantId,
            saleorWarehouseId: buylist.saleorWarehouseId,
            qtyDelta: qtyAccepted,
            unitCost: line.finalPrice, // Cost basis = what we paid the customer
            currency: line.currency,
            landedCostDelta: new Decimal(0),
            sourceBuylistLineId: line.id,
            wacAtEvent,
            qtyOnHandAtEvent,
            createdBy: getUserId(ctx),
          },
        });

        costEventsCreated++;
      }

      // Update buylist status to COMPLETED
      const updated = await ctx.prisma.buylist.update({
        where: { id: input.buylistId },
        data: {
          status: "COMPLETED",
          totalReceivedQty,
          verifiedAt: new Date(),
          verifiedBy: getUserId(ctx),
          ...(input.internalNotes !== undefined && { internalNotes: input.internalNotes }),
        },
      });

      // Audit event
      await ctx.prisma.buylistAuditEvent.create({
        data: {
          buylistId: input.buylistId,
          action: "VERIFIED_AND_RECEIVED",
          userId: getUserId(ctx),
          metadata: {
            totalReceivedQty,
            costEventsCreated,
            stockUpdates: {
              attempted: stockAdjustments.length,
              successful: stockResults.filter((r) => r.success).length,
              failed: stockResults.filter((r) => !r.success).length,
            },
          },
        },
      });

      return {
        buylist: updated,
        totalReceivedQty,
        costEventsCreated,
        stockUpdates: {
          attempted: stockAdjustments.length,
          successful: stockResults.filter((r) => r.success).length,
          failed: stockResults.filter((r) => !r.success).length,
        },
      };
    }),

  // =============================================================================
  // DEPRECATED ENDPOINTS - Removed during workflow simplification
  // The following endpoints were removed as they're no longer used in the
  // simplified workflow where customers are paid at the counter and BOH only
  // verifies cards:
  // - readyToReceive (used APPROVED status)
  // - readyForPayout (used RECEIVED status)
  // - review (used PENDING_REVIEW status)
  // - approve (used PENDING_REVIEW -> APPROVED transition)
  // - reject (used PENDING_REVIEW -> REJECTED transition)
  // - receive (used APPROVED -> RECEIVED transition)
  // - recordPayout (used RECEIVED -> PAID transition)
  // =============================================================================

  /**
   * Get BOH statistics
   */
  stats: protectedClientProcedure.query(async ({ ctx }) => {
    const [pendingVerification, todayVerified] = await Promise.all([
      ctx.prisma.buylist.count({
        where: {
          installationId: ctx.installationId,
          status: "PENDING_VERIFICATION",
        },
      }),
      ctx.prisma.buylist.aggregate({
        where: {
          installationId: ctx.installationId,
          verifiedAt: {
            gte: new Date(new Date().setHours(0, 0, 0, 0)),
          },
        },
        _count: true,
        _sum: {
          totalFinalAmount: true,
          totalReceivedQty: true,
        },
      }),
    ]);

    return {
      pendingVerification,
      todayVerified: todayVerified._count,
      todayVerifiedValue: todayVerified._sum.totalFinalAmount?.toString() ?? "0",
      todayVerifiedQty: todayVerified._sum.totalReceivedQty ?? 0,
    };
  }),
});
