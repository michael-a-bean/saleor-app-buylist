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

// Condition enum for validation
const conditionEnum = z.enum(["NM", "LP", "MP", "HP", "DMG"]);

// BOH line review schema
const lineReviewSchema = z.object({
  lineId: z.string().uuid(),
  qtyAccepted: z.number().int().min(0),
  finalPrice: z.number().min(0).optional(),
  conditionNote: z.string().optional().nullable(),
});

// Payout schema
const payoutSchema = z.object({
  buylistId: z.string().uuid(),
  method: z.enum(["CASH", "STORE_CREDIT", "CHECK", "BANK_TRANSFER", "PAYPAL", "OTHER"]),
  amount: z.number().min(0),
  reference: z.string().optional().nullable(),
  notes: z.string().optional().nullable(),
});

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

/**
 * BOH (Back of House) Router - Review, approval, receiving, and payout
 */
export const bohRouter = router({
  /**
   * Get the BOH review queue (buylists pending review)
   */
  queue: protectedClientProcedure.input(queueSearchSchema.optional()).query(async ({ ctx, input }) => {
    const where: any = {
      installationId: ctx.installationId,
      status: "PENDING_REVIEW",
    };

    if (input?.warehouseId) {
      where.saleorWarehouseId = input.warehouseId;
    }

    if (input?.dateFrom || input?.dateTo) {
      where.submittedAt = {};
      if (input?.dateFrom) {
        where.submittedAt.gte = new Date(input.dateFrom);
      }
      if (input?.dateTo) {
        where.submittedAt.lte = new Date(input.dateTo);
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
        orderBy: { submittedAt: "asc" }, // FIFO
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
   * Get buylists ready for receiving
   */
  readyToReceive: protectedClientProcedure.input(queueSearchSchema.optional()).query(async ({ ctx, input }) => {
    const where: any = {
      installationId: ctx.installationId,
      status: "APPROVED",
    };

    if (input?.warehouseId) {
      where.saleorWarehouseId = input.warehouseId;
    }

    const [buylists, total] = await Promise.all([
      ctx.prisma.buylist.findMany({
        where,
        orderBy: { reviewedAt: "asc" },
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
   * Get buylists ready for payout
   */
  readyForPayout: protectedClientProcedure.input(queueSearchSchema.optional()).query(async ({ ctx, input }) => {
    const where: any = {
      installationId: ctx.installationId,
      status: "RECEIVED",
    };

    const [buylists, total] = await Promise.all([
      ctx.prisma.buylist.findMany({
        where,
        orderBy: { receivedAt: "asc" },
        take: input?.limit ?? 50,
        skip: input?.offset ?? 0,
        include: {
          _count: {
            select: { lines: true },
          },
          payouts: true,
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
   * Review a buylist - adjust quantities and prices
   */
  review: protectedClientProcedure
    .input(
      z.object({
        buylistId: z.string().uuid(),
        lines: z.array(lineReviewSchema),
        internalNotes: z.string().optional().nullable(),
      })
    )
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

      if (buylist.status !== "PENDING_REVIEW") {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "Buylist is not pending review",
        });
      }

      // Update each reviewed line
      for (const review of input.lines) {
        const existingLine = buylist.lines.find((l) => l.id === review.lineId);
        if (!existingLine) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: `Line ${review.lineId} not found in buylist`,
          });
        }

        await ctx.prisma.buylistLine.update({
          where: { id: review.lineId },
          data: {
            qtyAccepted: review.qtyAccepted,
            conditionNote: review.conditionNote ?? null,
            ...(review.finalPrice !== undefined && {
              finalPrice: new Decimal(review.finalPrice),
            }),
          },
        });
      }

      // Update internal notes if provided
      if (input.internalNotes !== undefined) {
        await ctx.prisma.buylist.update({
          where: { id: input.buylistId },
          data: { internalNotes: input.internalNotes },
        });
      }

      // Recalculate final total
      const updatedLines = await ctx.prisma.buylistLine.findMany({
        where: { buylistId: input.buylistId },
      });

      const totalFinalAmount = updatedLines.reduce((sum, line) => {
        const qty = line.qtyAccepted ?? line.qty;
        return sum.add(line.finalPrice.mul(qty));
      }, new Decimal(0));

      await ctx.prisma.buylist.update({
        where: { id: input.buylistId },
        data: {
          totalFinalAmount,
          reviewedAt: new Date(),
          reviewedBy: getUserId(ctx),
        },
      });

      // Audit event
      await ctx.prisma.buylistAuditEvent.create({
        data: {
          buylistId: input.buylistId,
          action: "REVIEWED",
          userId: getUserId(ctx),
          metadata: {
            linesReviewed: input.lines.length,
            totalFinalAmount: totalFinalAmount.toString(),
          },
        },
      });

      return { success: true, totalFinalAmount: totalFinalAmount.toString() };
    }),

  /**
   * Approve a buylist after review
   */
  approve: protectedClientProcedure
    .input(z.object({ buylistId: z.string().uuid() }))
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

      if (buylist.status !== "PENDING_REVIEW") {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "Buylist is not pending review",
        });
      }

      // Verify all lines have been reviewed (qtyAccepted set)
      const unreviewedLines = buylist.lines.filter((l) => l.qtyAccepted === null);
      if (unreviewedLines.length > 0) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: `${unreviewedLines.length} line(s) have not been reviewed`,
        });
      }

      const updated = await ctx.prisma.buylist.update({
        where: { id: input.buylistId },
        data: {
          status: "APPROVED",
          reviewedAt: new Date(),
          reviewedBy: getUserId(ctx),
        },
      });

      // Audit event
      await ctx.prisma.buylistAuditEvent.create({
        data: {
          buylistId: input.buylistId,
          action: "APPROVED",
          userId: getUserId(ctx),
        },
      });

      return updated;
    }),

  /**
   * Reject a buylist
   */
  reject: protectedClientProcedure
    .input(
      z.object({
        buylistId: z.string().uuid(),
        reason: z.string().min(1, "Rejection reason is required"),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const buylist = await ctx.prisma.buylist.findFirst({
        where: {
          id: input.buylistId,
          installationId: ctx.installationId,
        },
      });

      if (!buylist) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Buylist not found",
        });
      }

      if (buylist.status !== "PENDING_REVIEW") {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "Buylist is not pending review",
        });
      }

      const updated = await ctx.prisma.buylist.update({
        where: { id: input.buylistId },
        data: {
          status: "REJECTED",
          internalNotes: input.reason,
          reviewedAt: new Date(),
          reviewedBy: getUserId(ctx),
        },
      });

      // Audit event
      await ctx.prisma.buylistAuditEvent.create({
        data: {
          buylistId: input.buylistId,
          action: "REJECTED",
          userId: getUserId(ctx),
          metadata: { reason: input.reason },
        },
      });

      return updated;
    }),

  /**
   * Receive buylist into inventory
   * This creates CostLayerEvents and updates Saleor stock
   */
  receive: protectedClientProcedure
    .input(z.object({ buylistId: z.string().uuid() }))
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

      if (buylist.status !== "APPROVED") {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "Buylist must be approved before receiving",
        });
      }

      // Build the list of stock adjustments
      let totalReceivedQty = 0;
      const stockAdjustments: Array<{ variantId: string; warehouseId: string; delta: number }> = [];
      const linesToProcess: Array<{
        line: typeof buylist.lines[0];
        qtyAccepted: number;
      }> = [];

      for (const line of buylist.lines) {
        const qtyAccepted = line.qtyAccepted ?? 0;
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

      // Update Saleor stock FIRST (before changing buylist status)
      // This ensures we can retry if stock update fails
      let stockResults: StockUpdateResult[] = [];
      if (stockAdjustments.length > 0) {
        logger.info("Updating Saleor stock for buylist", {
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

          // If ALL failed, throw error to prevent status change
          if (failures.length === stockResults.length) {
            throw new TRPCError({
              code: "INTERNAL_SERVER_ERROR",
              message: `Failed to update stock in Saleor: ${failures[0].error}`,
            });
          }

          // If only some failed, log warning but continue
          // The audit event will record which ones failed
          logger.warn("Partial stock update failure - continuing with receive", {
            buylistId: input.buylistId,
            successCount: stockResults.length - failures.length,
            failureCount: failures.length,
          });
        }

        logger.info("Saleor stock update complete", {
          buylistId: input.buylistId,
          successCount: stockResults.filter((r) => r.success).length,
        });
      }

      // Create cost layer events with WAC calculation
      // Must process sequentially since each WAC depends on previous events
      let costEventsCreated = 0;
      for (const { line, qtyAccepted } of linesToProcess) {
        // Compute WAC for this new event
        const { wacAtEvent, qtyOnHandAtEvent } = await computeWacForNewEvent({
          prisma: ctx.prisma,
          installationId: ctx.installationId,
          variantId: line.saleorVariantId,
          warehouseId: buylist.saleorWarehouseId,
          newQtyDelta: qtyAccepted,
          newUnitCost: new Decimal(line.finalPrice.toString()),
          newLandedCostDelta: new Decimal(0),
        });

        // Create cost layer event with computed WAC
        await ctx.prisma.costLayerEvent.create({
          data: {
            installationId: ctx.installationId,
            eventType: "BUYLIST_RECEIPT",
            saleorVariantId: line.saleorVariantId,
            saleorWarehouseId: buylist.saleorWarehouseId,
            qtyDelta: qtyAccepted,
            unitCost: line.finalPrice,
            currency: line.currency,
            landedCostDelta: new Decimal(0),
            sourceBuylistLineId: line.id,
            wacAtEvent: wacAtEvent,
            qtyOnHandAtEvent: qtyOnHandAtEvent,
            createdBy: getUserId(ctx),
          },
        });

        costEventsCreated++;

        logger.debug("Created cost layer event", {
          buylistId: input.buylistId,
          lineId: line.id,
          variantId: line.saleorVariantId,
          qtyAccepted,
          unitCost: line.finalPrice.toString(),
          wacAtEvent: wacAtEvent.toFixed(4),
          qtyOnHandAtEvent,
        });
      }

      // Update buylist status
      const updated = await ctx.prisma.buylist.update({
        where: { id: input.buylistId },
        data: {
          status: "RECEIVED",
          totalReceivedQty,
          receivedAt: new Date(),
          receivedBy: getUserId(ctx),
        },
      });

      // Audit event with stock update results
      await ctx.prisma.buylistAuditEvent.create({
        data: {
          buylistId: input.buylistId,
          action: "RECEIVED",
          userId: getUserId(ctx),
          metadata: {
            totalReceivedQty,
            costEventsCreated,
            stockUpdates: {
              attempted: stockAdjustments.length,
              successful: stockResults.filter((r) => r.success).length,
              failed: stockResults.filter((r) => !r.success).length,
              details: stockResults.map((r) => ({
                variantId: r.variantId,
                success: r.success,
                previousQty: r.previousQuantity,
                newQty: r.newQuantity,
                error: r.error,
              })),
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
   * Record a payout for a received buylist
   */
  recordPayout: protectedClientProcedure.input(payoutSchema).mutation(async ({ ctx, input }) => {
    const buylist = await ctx.prisma.buylist.findFirst({
      where: {
        id: input.buylistId,
        installationId: ctx.installationId,
      },
      include: {
        payouts: true,
      },
    });

    if (!buylist) {
      throw new TRPCError({
        code: "NOT_FOUND",
        message: "Buylist not found",
      });
    }

    if (buylist.status !== "RECEIVED") {
      throw new TRPCError({
        code: "PRECONDITION_FAILED",
        message: "Buylist must be received before recording payout",
      });
    }

    // Calculate total already paid
    const totalPaid = buylist.payouts
      .filter((p) => p.status === "COMPLETED")
      .reduce((sum, p) => sum.add(p.amount), new Decimal(0));

    const newTotal = totalPaid.add(input.amount);

    if (newTotal.greaterThan(buylist.totalFinalAmount)) {
      throw new TRPCError({
        code: "PRECONDITION_FAILED",
        message: `Payout would exceed total owed. Max remaining: ${buylist.totalFinalAmount.sub(totalPaid).toString()}`,
      });
    }

    // Create payout record
    const payout = await ctx.prisma.buylistPayout.create({
      data: {
        buylistId: input.buylistId,
        method: input.method,
        status: "COMPLETED",
        amount: new Decimal(input.amount),
        currency: buylist.currency,
        reference: input.reference ?? null,
        notes: input.notes ?? null,
        processedAt: new Date(),
        processedBy: getUserId(ctx),
      },
    });

    // Check if fully paid
    const isFullyPaid = newTotal.equals(buylist.totalFinalAmount);

    if (isFullyPaid) {
      await ctx.prisma.buylist.update({
        where: { id: input.buylistId },
        data: {
          status: "PAID",
          paidAt: new Date(),
          paidBy: getUserId(ctx),
        },
      });

      // Audit event for completion
      await ctx.prisma.buylistAuditEvent.create({
        data: {
          buylistId: input.buylistId,
          action: "PAID",
          userId: getUserId(ctx),
          metadata: {
            totalPaid: newTotal.toString(),
            payoutId: payout.id,
          },
        },
      });
    } else {
      // Audit event for partial payout
      await ctx.prisma.buylistAuditEvent.create({
        data: {
          buylistId: input.buylistId,
          action: "PARTIAL_PAYOUT",
          userId: getUserId(ctx),
          metadata: {
            amount: input.amount,
            method: input.method,
            totalPaid: newTotal.toString(),
            remaining: buylist.totalFinalAmount.sub(newTotal).toString(),
          },
        },
      });
    }

    return {
      payout,
      isFullyPaid,
      totalPaid: newTotal.toString(),
      remaining: buylist.totalFinalAmount.sub(newTotal).toString(),
    };
  }),

  /**
   * Get BOH statistics
   */
  stats: protectedClientProcedure.query(async ({ ctx }) => {
    const [pendingReview, approved, received, todayReceived] = await Promise.all([
      ctx.prisma.buylist.count({
        where: {
          installationId: ctx.installationId,
          status: "PENDING_REVIEW",
        },
      }),
      ctx.prisma.buylist.count({
        where: {
          installationId: ctx.installationId,
          status: "APPROVED",
        },
      }),
      ctx.prisma.buylist.count({
        where: {
          installationId: ctx.installationId,
          status: "RECEIVED",
        },
      }),
      ctx.prisma.buylist.aggregate({
        where: {
          installationId: ctx.installationId,
          receivedAt: {
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
      pendingReview,
      approved,
      awaitingPayout: received,
      todayReceived: todayReceived._count,
      todayReceivedValue: todayReceived._sum.totalFinalAmount?.toString() ?? "0",
      todayReceivedQty: todayReceived._sum.totalReceivedQty ?? 0,
    };
  }),
});
