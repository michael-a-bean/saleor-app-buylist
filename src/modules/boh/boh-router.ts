/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unused-vars, multiline-comment-style */
import { TRPCError } from "@trpc/server";
import { Decimal } from "decimal.js";
import { z } from "zod";

import { extractUserFromToken } from "@/lib/jwt-utils";
import { createLogger } from "@/lib/logger";
import { createSaleorClient, StockUpdateResult } from "@/lib/saleor-client";
import { computeWacForNewEventOptimized } from "@/lib/wac-service";
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
        actualVariantId: string; // The condition-specific variant ID for stock
      }> = [];

      // Create Saleor client for looking up condition variants
      const saleorClient = createSaleorClient(ctx.apiClient);

      for (const line of buylist.lines) {
        const update = lineUpdates.get(line.id);

        // Default qtyAccepted to original qty if not specified
        const qtyAccepted = update?.qtyAccepted ?? line.qty;

        // Get the final condition (may be updated by BOH)
        const finalCondition = (update?.condition ?? line.condition) as "NM" | "LP" | "MP" | "HP" | "DMG";

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

        // Look up the correct condition-specific variant for stock and costing.
        // This MUST resolve — fallback to base variant would corrupt WAC data.
        let actualVariantId = line.saleorVariantId;
        if (line.saleorVariantSku) {
          const conditionVariantId = await saleorClient.getConditionVariantId(
            line.saleorVariantSku,
            finalCondition
          );
          if (conditionVariantId) {
            actualVariantId = conditionVariantId;
            logger.info("Using condition-specific variant for stock", {
              lineId: line.id,
              originalVariantId: line.saleorVariantId,
              condition: finalCondition,
              actualVariantId,
            });
          } else {
            logger.error("Condition variant not found — cannot proceed without correct variant", {
              lineId: line.id,
              sku: line.saleorVariantSku,
              condition: finalCondition,
            });
            throw new TRPCError({
              code: "NOT_FOUND",
              message: `Condition variant not found for SKU ${line.saleorVariantSku} condition ${finalCondition}. ` +
                `Cannot add stock/cost to wrong variant. Verify the variant exists in Saleor.`,
            });
          }
        } else {
          logger.error("Buylist line missing saleorVariantSku — cannot resolve condition variant", {
            lineId: line.id,
          });
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: `Buylist line ${line.id} has no SKU. Cannot resolve condition-specific variant.`,
          });
        }

        linesToProcess.push({ line, qtyAccepted, actualVariantId });

        // Add stock adjustment (positive delta = adding to inventory)
        stockAdjustments.push({
          variantId: actualVariantId,
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
      // Use actualVariantId (condition-specific) for proper WAC tracking per condition
      let costEventsCreated = 0;
      for (const { line, qtyAccepted, actualVariantId } of linesToProcess) {
        // Use optimized O(1) WAC calculation with the condition-specific variant
        const wacResult = await computeWacForNewEventOptimized({
          prisma: ctx.prisma,
          installationId: ctx.installationId,
          variantId: actualVariantId, // Use condition-specific variant for WAC
          warehouseId: buylist.saleorWarehouseId,
          newQtyDelta: qtyAccepted,
          newUnitCost: new Decimal(line.finalPrice.toString()),
          newLandedCostDelta: new Decimal(0),
        });

        await ctx.prisma.costLayerEvent.create({
          data: {
            installationId: ctx.installationId,
            eventType: "BUYLIST_RECEIPT",
            saleorVariantId: actualVariantId, // Use condition-specific variant
            saleorWarehouseId: buylist.saleorWarehouseId,
            qtyDelta: qtyAccepted,
            unitCost: line.finalPrice, // Cost basis = what we paid the customer
            currency: line.currency,
            landedCostDelta: new Decimal(0),
            sourceBuylistLineId: line.id,
            wacAtEvent: wacResult.wacAtEvent,
            qtyOnHandAtEvent: wacResult.qtyOnHandAtEvent,
            totalValueAtEvent: wacResult.totalValueAtEvent,
            previousEventId: wacResult.previousEventId,
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

  /**
   * Recondition a buylist line — move some qty from one condition to another.
   * Creates or merges into an existing target line (price-aware: only merges if finalPrice matches).
   * Source line qty is decremented; deleted if it reaches 0.
   * Total qty across all lines is invariant.
   */
  reconditionLine: protectedClientProcedure
    .input(
      z.object({
        buylistId: z.string().uuid(),
        sourceLineId: z.string().uuid(),
        targetCondition: conditionEnum,
        qty: z.number().int().min(1),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const { buylistId, sourceLineId, targetCondition, qty } = input;

      return ctx.prisma.$transaction(async (tx) => {
        // 1. Fetch buylist with lines
        const buylist = await tx.buylist.findFirst({
          where: { id: buylistId, installationId: ctx.installationId },
          include: { lines: { orderBy: { lineNumber: "asc" } } },
        });

        if (!buylist) {
          throw new TRPCError({ code: "NOT_FOUND", message: "Buylist not found" });
        }

        if (buylist.status !== "PENDING_VERIFICATION") {
          throw new TRPCError({
            code: "PRECONDITION_FAILED",
            message: "Buylist must be pending verification to recondition lines",
          });
        }

        // 2. Find source line
        const sourceLine = buylist.lines.find((l) => l.id === sourceLineId);
        if (!sourceLine) {
          throw new TRPCError({ code: "NOT_FOUND", message: "Source line not found" });
        }

        if (qty > sourceLine.qty) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: `Cannot move ${qty} units — source line only has ${sourceLine.qty}`,
          });
        }

        // 3. No-op guard: target must differ from source
        if (targetCondition === sourceLine.condition) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Target condition is the same as source — nothing to recondition",
          });
        }

        // 4. Derive target SKU from source SKU
        let targetSku: string | null = null;
        if (sourceLine.saleorVariantSku) {
          const parts = sourceLine.saleorVariantSku.split("-");
          if (parts.length >= 3) {
            const finish = parts[parts.length - 1];
            const prefix = parts.slice(0, -2).join("-");
            targetSku = `${prefix}-${targetCondition}-${finish}`;
          }
        }

        // 5. Find existing target line with same card identity + condition + same finalPrice
        const existingTarget = buylist.lines.find((l) => {
          if (l.id === sourceLineId) return false;
          if (l.condition !== targetCondition) return false;
          // Price-aware merge: must have identical finalPrice
          if (!new Decimal(l.finalPrice.toString()).equals(new Decimal(sourceLine.finalPrice.toString()))) {
            return false;
          }
          // Match by SKU if available
          if (targetSku && l.saleorVariantSku === targetSku) return true;
          // Fallback: match by variant name pattern (less precise)
          if (!targetSku && l.saleorVariantName === sourceLine.saleorVariantName) return true;
          return false;
        });

        let targetLineId: string;

        if (existingTarget) {
          // 6a. Merge into existing target line
          await tx.buylistLine.update({
            where: { id: existingTarget.id },
            data: { qty: existingTarget.qty + qty },
          });
          targetLineId = existingTarget.id;
        } else {
          // 6b. Create new target line
          const maxLineNumber = Math.max(...buylist.lines.map((l) => l.lineNumber));

          const newLine = await tx.buylistLine.create({
            data: {
              buylistId,
              saleorVariantId: sourceLine.saleorVariantId,
              saleorVariantSku: targetSku ?? sourceLine.saleorVariantSku,
              saleorVariantName: sourceLine.saleorVariantName,
              qty,
              condition: targetCondition,
              marketPrice: sourceLine.marketPrice,
              quotedPrice: sourceLine.quotedPrice,
              finalPrice: sourceLine.finalPrice,
              currency: sourceLine.currency,
              lineNumber: maxLineNumber + 1,
            },
          });
          targetLineId = newLine.id;
        }

        // 7. Decrement source line qty (delete if zero)
        const newSourceQty = sourceLine.qty - qty;
        if (newSourceQty === 0) {
          await tx.buylistLine.delete({ where: { id: sourceLineId } });
        } else {
          await tx.buylistLine.update({
            where: { id: sourceLineId },
            data: { qty: newSourceQty },
          });
        }

        // 8. Create audit event
        const auditEvent = await tx.buylistAuditEvent.create({
          data: {
            buylistId,
            action: "RECONDITIONED",
            userId: getUserId(ctx),
            metadata: {
              sourceLineId,
              targetLineId,
              qty,
              fromCondition: sourceLine.condition,
              toCondition: targetCondition,
              sourceLineOriginalQty: sourceLine.qty,
              sourceSku: sourceLine.saleorVariantSku,
            },
          },
        });

        // 9. Fetch updated lines
        const updatedLines = await tx.buylistLine.findMany({
          where: { buylistId },
          orderBy: { lineNumber: "asc" },
        });

        logger.info("Reconditioned buylist line", {
          buylistId,
          sourceLineId,
          targetLineId,
          qty,
          fromCondition: sourceLine.condition,
          toCondition: targetCondition,
          merged: !!existingTarget,
          userId: getUserId(ctx),
        });

        return { lines: updatedLines, auditEvent };
      });
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
