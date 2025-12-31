/* eslint-disable @typescript-eslint/no-explicit-any, prefer-const */
import { TRPCError } from "@trpc/server";
import { Decimal } from "decimal.js";
import { z } from "zod";

import { extractUserFromToken } from "@/lib/jwt-utils";
import { createLogger } from "@/lib/logger";
import { createEnhancedSaleorClient, createSaleorClient } from "@/lib/saleor-client";
import { DEFAULT_CONDITION_MULTIPLIERS } from "@/modules/pricing";
import { protectedClientProcedure } from "@/modules/trpc/protected-client-procedure";
import { router } from "@/modules/trpc/trpc-server";

const logger = createLogger("buylists-router");

/**
 * Get a user-friendly identifier from context
 */
function getUserId(ctx: { token?: string | null }): string | null {
  return extractUserFromToken(ctx.token);
}

// Condition enum for validation
const conditionEnum = z.enum(["NM", "LP", "MP", "HP", "DMG"]);

// Buylist line input schema
const buylistLineSchema = z.object({
  saleorVariantId: z.string(),
  saleorVariantSku: z.string().optional().nullable(),
  saleorVariantName: z.string().optional().nullable(),
  qty: z.number().int().min(1),
  condition: conditionEnum,
  marketPrice: z.number().min(0),
  buyPrice: z.number().min(0).optional().nullable(), // Optional override for quoted price
  notes: z.string().optional().nullable(),
});

// Buylist create schema
const buylistCreateSchema = z.object({
  saleorWarehouseId: z.string(),
  customerName: z.string().optional().nullable(),
  customerEmail: z.string().email().optional().nullable(),
  customerPhone: z.string().optional().nullable(),
  saleorUserId: z.string().optional().nullable(),
  currency: z.string().length(3).default("USD"),
  pricingPolicyId: z.string().uuid().optional().nullable(),
  notes: z.string().optional().nullable(),
  lines: z.array(buylistLineSchema).min(1, "At least one line is required"),
});

// Buylist update schema (for drafts only)
const buylistUpdateSchema = z.object({
  customerName: z.string().optional().nullable(),
  customerEmail: z.string().email().optional().nullable(),
  customerPhone: z.string().optional().nullable(),
  saleorUserId: z.string().optional().nullable(),
  pricingPolicyId: z.string().uuid().optional().nullable(),
  notes: z.string().optional().nullable(),
});

// Line update schema
const lineUpdateSchema = z.object({
  qty: z.number().int().min(1).optional(),
  condition: conditionEnum.optional(),
  notes: z.string().optional().nullable(),
});

// Payout method enum (must match Prisma schema)
const payoutMethodEnum = z.enum(["CASH", "STORE_CREDIT", "CHECK", "BANK_TRANSFER", "PAYPAL", "OTHER"]);

// Search schema
const searchSchema = z.object({
  query: z.string().optional(),
  status: z.enum([
    "PENDING_VERIFICATION",
    "COMPLETED",
    "CANCELLED",
  ]).optional(),
  warehouseId: z.string().optional(),
  customerId: z.string().optional(),
  dateFrom: z.string().datetime().optional(),
  dateTo: z.string().datetime().optional(),
  limit: z.number().min(1).max(100).optional().default(50),
  offset: z.number().min(0).optional().default(0),
});

// Create and pay schema (simplified workflow)
const createAndPaySchema = z.object({
  saleorWarehouseId: z.string(),
  customerName: z.string().optional().nullable(),
  customerEmail: z.string().email().optional().nullable(),
  customerPhone: z.string().optional().nullable(),
  currency: z.string().length(3).default("USD"),
  notes: z.string().optional().nullable(),
  payoutMethod: payoutMethodEnum,
  payoutReference: z.string().optional().nullable(), // Check #, transaction ID, etc.
  lines: z.array(buylistLineSchema).min(1, "At least one line is required"),
  idempotencyKey: z.string().optional(), // Client-provided key to prevent duplicate submissions
});

/**
 * Generate a unique buylist number
 */
async function generateBuylistNumber(prisma: any, installationId: string): Promise<string> {
  const today = new Date();
  const prefix = `BL-${today.getFullYear()}${String(today.getMonth() + 1).padStart(2, "0")}${String(today.getDate()).padStart(2, "0")}`;

  // Find the highest number for today
  const lastBuylist = await prisma.buylist.findFirst({
    where: {
      installationId,
      buylistNumber: { startsWith: prefix },
    },
    orderBy: { buylistNumber: "desc" },
  });

  let sequence = 1;
  if (lastBuylist) {
    const lastSequence = parseInt(lastBuylist.buylistNumber.split("-").pop() ?? "0", 10);
    sequence = lastSequence + 1;
  }

  return `${prefix}-${String(sequence).padStart(4, "0")}`;
}

/**
 * Buylists Router - FOH buylist management
 */
export const buylistsRouter = router({
  /**
   * List buylists with filtering
   */
  list: protectedClientProcedure.input(searchSchema.optional()).query(async ({ ctx, input }) => {
    const where: any = {
      installationId: ctx.installationId,
    };

    if (input?.status) {
      where.status = input.status;
    }

    if (input?.warehouseId) {
      where.saleorWarehouseId = input.warehouseId;
    }

    if (input?.customerId) {
      where.saleorUserId = input.customerId;
    }

    if (input?.query) {
      where.OR = [
        { buylistNumber: { contains: input.query, mode: "insensitive" } },
        { customerName: { contains: input.query, mode: "insensitive" } },
        { customerEmail: { contains: input.query, mode: "insensitive" } },
      ];
    }

    if (input?.dateFrom || input?.dateTo) {
      where.createdAt = {};
      if (input?.dateFrom) {
        where.createdAt.gte = new Date(input.dateFrom);
      }
      if (input?.dateTo) {
        where.createdAt.lte = new Date(input.dateTo);
      }
    }

    const [buylists, total] = await Promise.all([
      ctx.prisma.buylist.findMany({
        where,
        orderBy: { createdAt: "desc" },
        take: input?.limit ?? 50,
        skip: input?.offset ?? 0,
        include: {
          _count: {
            select: { lines: true },
          },
          pricingPolicy: {
            select: { id: true, name: true },
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
   * Get a single buylist by ID
   */
  getById: protectedClientProcedure
    .input(z.object({ id: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const buylist = await ctx.prisma.buylist.findFirst({
        where: {
          id: input.id,
          installationId: ctx.installationId,
        },
        include: {
          lines: {
            orderBy: { lineNumber: "asc" },
          },
          payouts: {
            orderBy: { createdAt: "desc" },
          },
          pricingPolicy: true,
          events: {
            orderBy: { createdAt: "desc" },
            take: 10,
          },
        },
      });

      if (!buylist) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Buylist not found",
        });
      }

      return buylist;
    }),

  /**
   * Create a new buylist
   */
  create: protectedClientProcedure.input(buylistCreateSchema).mutation(async ({ ctx, input }) => {
    // Generate buylist number
    const buylistNumber = await generateBuylistNumber(ctx.prisma, ctx.installationId);

    // Get pricing policy (use specified or default)
    let pricingPolicy;
    if (input.pricingPolicyId) {
      pricingPolicy = await ctx.prisma.buylistPricingPolicy.findFirst({
        where: {
          id: input.pricingPolicyId,
          installationId: ctx.installationId,
        },
      });
    } else {
      pricingPolicy = await ctx.prisma.buylistPricingPolicy.findFirst({
        where: {
          installationId: ctx.installationId,
          isDefault: true,
          isActive: true,
        },
      });
    }

    // Calculate prices for each line
    const linesWithPrices = input.lines.map((line, index) => {
      // Use buyPrice override if provided, otherwise calculate from policy
      let quotedPrice: number;
      let finalPrice: number;

      if (line.buyPrice !== null && line.buyPrice !== undefined) {
        // Use the provided buy price as both quoted and final
        quotedPrice = line.buyPrice;
        finalPrice = line.buyPrice;
      } else {
        // Calculate from pricing policy
        const calculated = calculateLinePrice(
          line.marketPrice,
          line.condition,
          pricingPolicy
        );
        quotedPrice = calculated.quotedPrice;
        finalPrice = calculated.finalPrice;
      }

      return {
        ...line,
        quotedPrice: new Decimal(quotedPrice),
        finalPrice: new Decimal(finalPrice),
        marketPrice: new Decimal(line.marketPrice),
        currency: input.currency,
        lineNumber: index + 1,
      };
    });

    // Calculate totals
    const totalQuotedAmount = linesWithPrices.reduce(
      (sum, line) => sum.add(line.quotedPrice.mul(line.qty)),
      new Decimal(0)
    );

    // Create buylist with lines
    const buylist = await ctx.prisma.buylist.create({
      data: {
        installationId: ctx.installationId,
        buylistNumber,
        saleorWarehouseId: input.saleorWarehouseId,
        status: "PENDING_VERIFICATION", // Note: Old workflow used DRAFT, now uses simplified workflow
        customerName: input.customerName ?? null,
        customerEmail: input.customerEmail ?? null,
        customerPhone: input.customerPhone ?? null,
        saleorUserId: input.saleorUserId ?? null,
        currency: input.currency,
        pricingPolicyId: pricingPolicy?.id ?? null,
        totalQuotedAmount,
        totalFinalAmount: totalQuotedAmount, // Same as quoted for new buylist
        notes: input.notes ?? null,
        lines: {
          create: linesWithPrices,
        },
      },
      include: {
        lines: true,
      },
    });

    // Create audit event
    await ctx.prisma.buylistAuditEvent.create({
      data: {
        buylistId: buylist.id,
        action: "CREATED",
        userId: getUserId(ctx),
        newState: {
          buylistNumber,
          lineCount: input.lines.length,
          totalQuotedAmount: totalQuotedAmount.toString(),
        },
      },
    });

    return buylist;
  }),

  /**
   * Create and pay buylist in one step (simplified face-to-face workflow)
   * Creates buylist, records payout, sets status to PENDING_VERIFICATION
   */
  createAndPay: protectedClientProcedure.input(createAndPaySchema).mutation(async ({ ctx, input }) => {
    // Generate or use provided idempotency key
    const idempotencyKey =
      input.idempotencyKey ??
      `buylist-${ctx.installationId}-${Date.now()}-${input.customerName ?? "walkin"}-${input.lines.length}`;

    // Idempotency check: Return existing buylist if this key was already processed
    const existingPayout = await ctx.prisma.buylistPayout.findUnique({
      where: { idempotencyKey },
      include: {
        buylist: {
          include: { lines: true },
        },
      },
    });

    if (existingPayout?.buylist) {
      logger.info("Idempotency check: returning existing buylist", {
        idempotencyKey,
        buylistId: existingPayout.buylist.id,
        buylistNumber: existingPayout.buylist.buylistNumber,
      });
      return existingPayout.buylist;
    }

    // Generate buylist number
    const buylistNumber = await generateBuylistNumber(ctx.prisma, ctx.installationId);

    // Get default pricing policy
    const pricingPolicy = await ctx.prisma.buylistPricingPolicy.findFirst({
      where: {
        installationId: ctx.installationId,
        isDefault: true,
        isActive: true,
      },
    });

    // Calculate prices for each line
    const linesWithPrices = input.lines.map((line, index) => {
      let buyPrice: number;

      if (line.buyPrice !== null && line.buyPrice !== undefined) {
        buyPrice = line.buyPrice;
      } else {
        const calculated = calculateLinePrice(
          line.marketPrice,
          line.condition,
          pricingPolicy
        );
        buyPrice = calculated.finalPrice;
      }

      return {
        saleorVariantId: line.saleorVariantId,
        saleorVariantSku: line.saleorVariantSku ?? null,
        saleorVariantName: line.saleorVariantName ?? null,
        qty: line.qty,
        condition: line.condition,
        marketPrice: new Decimal(line.marketPrice),
        quotedPrice: new Decimal(buyPrice),
        finalPrice: new Decimal(buyPrice),
        currency: input.currency,
        lineNumber: index + 1,
        notes: line.notes ?? null,
      };
    });

    // Calculate total payout amount
    const totalAmount = linesWithPrices.reduce(
      (sum, line) => sum.add(line.finalPrice.mul(line.qty)),
      new Decimal(0)
    );

    const now = new Date();
    const userId = getUserId(ctx);

    // Create buylist with lines and payout in a transaction
    const buylist = await ctx.prisma.$transaction(async (tx: any) => {
      // Create buylist
      const newBuylist = await tx.buylist.create({
        data: {
          installationId: ctx.installationId,
          buylistNumber,
          saleorWarehouseId: input.saleorWarehouseId,
          status: "PENDING_VERIFICATION",
          customerName: input.customerName ?? null,
          customerEmail: input.customerEmail ?? null,
          customerPhone: input.customerPhone ?? null,
          currency: input.currency,
          pricingPolicyId: pricingPolicy?.id ?? null,
          totalQuotedAmount: totalAmount,
          totalFinalAmount: totalAmount,
          notes: input.notes ?? null,
          payoutMethod: input.payoutMethod,
          payoutReference: input.payoutReference ?? null,
          paidAt: now,
          paidBy: userId,
          lines: {
            create: linesWithPrices,
          },
        },
        include: {
          lines: true,
        },
      });

      // Create payout record with idempotency key
      await tx.buylistPayout.create({
        data: {
          buylistId: newBuylist.id,
          method: input.payoutMethod,
          status: "COMPLETED",
          amount: totalAmount,
          currency: input.currency,
          reference: input.payoutReference ?? null,
          processedAt: now,
          processedBy: userId,
          idempotencyKey,
        },
      });

      // Create audit event
      await tx.buylistAuditEvent.create({
        data: {
          buylistId: newBuylist.id,
          action: "CREATED_AND_PAID",
          userId,
          newState: {
            buylistNumber,
            lineCount: input.lines.length,
            totalAmount: totalAmount.toString(),
            payoutMethod: input.payoutMethod,
          },
        },
      });

      return newBuylist;
    });

    return buylist;
  }),

  /**
   * Update a buylist (draft only) - DEPRECATED in simplified workflow
   */
  update: protectedClientProcedure
    .input(
      z.object({
        id: z.string().uuid(),
        data: buylistUpdateSchema,
      })
    )
    .mutation(async ({ ctx, input }) => {
      const existing = await ctx.prisma.buylist.findFirst({
        where: {
          id: input.id,
          installationId: ctx.installationId,
        },
      });

      if (!existing) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Buylist not found",
        });
      }

      if (existing.status !== "PENDING_VERIFICATION") {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "Only pending buylists can be edited",
        });
      }

      const buylist = await ctx.prisma.buylist.update({
        where: { id: input.id },
        data: {
          ...(input.data.customerName !== undefined && { customerName: input.data.customerName }),
          ...(input.data.customerEmail !== undefined && { customerEmail: input.data.customerEmail }),
          ...(input.data.customerPhone !== undefined && { customerPhone: input.data.customerPhone }),
          ...(input.data.saleorUserId !== undefined && { saleorUserId: input.data.saleorUserId }),
          ...(input.data.pricingPolicyId !== undefined && { pricingPolicyId: input.data.pricingPolicyId }),
          ...(input.data.notes !== undefined && { notes: input.data.notes }),
        },
      });

      return buylist;
    }),

  /**
   * Add a line to a buylist
   */
  addLine: protectedClientProcedure
    .input(
      z.object({
        buylistId: z.string().uuid(),
        line: buylistLineSchema,
      })
    )
    .mutation(async ({ ctx, input }) => {
      const buylist = await ctx.prisma.buylist.findFirst({
        where: {
          id: input.buylistId,
          installationId: ctx.installationId,
        },
        include: {
          pricingPolicy: true,
          lines: {
            orderBy: { lineNumber: "desc" },
            take: 1,
          },
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
          message: "Only pending buylists can be modified",
        });
      }

      // Calculate prices - use buyPrice override if provided
      let quotedPrice: number;
      let finalPrice: number;

      if (input.line.buyPrice !== null && input.line.buyPrice !== undefined) {
        quotedPrice = input.line.buyPrice;
        finalPrice = input.line.buyPrice;
      } else {
        const calculated = calculateLinePrice(
          input.line.marketPrice,
          input.line.condition,
          buylist.pricingPolicy
        );
        quotedPrice = calculated.quotedPrice;
        finalPrice = calculated.finalPrice;
      }

      const nextLineNumber = (buylist.lines[0]?.lineNumber ?? 0) + 1;

      // Create line
      const line = await ctx.prisma.buylistLine.create({
        data: {
          buylistId: input.buylistId,
          saleorVariantId: input.line.saleorVariantId,
          saleorVariantSku: input.line.saleorVariantSku ?? null,
          saleorVariantName: input.line.saleorVariantName ?? null,
          qty: input.line.qty,
          condition: input.line.condition,
          marketPrice: new Decimal(input.line.marketPrice),
          quotedPrice: new Decimal(quotedPrice),
          finalPrice: new Decimal(finalPrice),
          currency: buylist.currency,
          lineNumber: nextLineNumber,
          notes: input.line.notes ?? null,
        },
      });

      // Update buylist totals
      await updateBuylistTotals(ctx.prisma, input.buylistId);

      return line;
    }),

  /**
   * Update a line
   */
  updateLine: protectedClientProcedure
    .input(
      z.object({
        lineId: z.string().uuid(),
        data: lineUpdateSchema,
      })
    )
    .mutation(async ({ ctx, input }) => {
      const line = await ctx.prisma.buylistLine.findUnique({
        where: { id: input.lineId },
        include: {
          buylist: {
            include: { pricingPolicy: true },
          },
        },
      });

      if (!line) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Line not found",
        });
      }

      if (line.buylist.installationId !== ctx.installationId) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Line not found",
        });
      }

      if (line.buylist.status !== "PENDING_VERIFICATION") {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "Only pending buylists can be modified",
        });
      }

      // Recalculate if condition changed
      let updates: any = {};
      if (input.data.condition && input.data.condition !== line.condition) {
        const { quotedPrice, finalPrice } = calculateLinePrice(
          line.marketPrice.toNumber(),
          input.data.condition,
          line.buylist.pricingPolicy
        );
        updates.condition = input.data.condition;
        updates.quotedPrice = new Decimal(quotedPrice);
        updates.finalPrice = new Decimal(finalPrice);
      }

      if (input.data.qty !== undefined) {
        updates.qty = input.data.qty;
      }

      if (input.data.notes !== undefined) {
        updates.notes = input.data.notes;
      }

      const updatedLine = await ctx.prisma.buylistLine.update({
        where: { id: input.lineId },
        data: updates,
      });

      // Update buylist totals
      await updateBuylistTotals(ctx.prisma, line.buylistId);

      return updatedLine;
    }),

  /**
   * Remove a line from a buylist
   */
  removeLine: protectedClientProcedure
    .input(z.object({ lineId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const line = await ctx.prisma.buylistLine.findUnique({
        where: { id: input.lineId },
        include: { buylist: true },
      });

      if (!line) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Line not found",
        });
      }

      if (line.buylist.installationId !== ctx.installationId) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Line not found",
        });
      }

      if (line.buylist.status !== "PENDING_VERIFICATION") {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "Only pending buylists can be modified",
        });
      }

      await ctx.prisma.buylistLine.delete({
        where: { id: input.lineId },
      });

      // Update buylist totals
      await updateBuylistTotals(ctx.prisma, line.buylistId);

      return { success: true };
    }),

  /**
   * Generate/refresh quote for a buylist
   */
  generateQuote: protectedClientProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const buylist = await ctx.prisma.buylist.findFirst({
        where: {
          id: input.id,
          installationId: ctx.installationId,
        },
        include: {
          pricingPolicy: true,
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
          message: "Can only recalculate prices for pending buylists",
        });
      }

      if (buylist.lines.length === 0) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "Cannot generate quote for empty buylist",
        });
      }

      // Recalculate all line prices
      for (const line of buylist.lines) {
        const { quotedPrice, finalPrice } = calculateLinePrice(
          line.marketPrice.toNumber(),
          line.condition,
          buylist.pricingPolicy
        );

        await ctx.prisma.buylistLine.update({
          where: { id: line.id },
          data: {
            quotedPrice: new Decimal(quotedPrice),
            finalPrice: new Decimal(finalPrice),
          },
        });
      }

      // Update totals and status
      const totalQuotedAmount = buylist.lines.reduce((sum, line) => {
        const { quotedPrice } = calculateLinePrice(
          line.marketPrice.toNumber(),
          line.condition,
          buylist.pricingPolicy
        );
        return sum.add(new Decimal(quotedPrice).mul(line.qty));
      }, new Decimal(0));

      const updated = await ctx.prisma.buylist.update({
        where: { id: input.id },
        data: {
          // Status stays PENDING_VERIFICATION (simplified workflow)
          totalQuotedAmount,
          totalFinalAmount: totalQuotedAmount,
        },
        include: {
          lines: true,
        },
      });

      // Audit event
      await ctx.prisma.buylistAuditEvent.create({
        data: {
          buylistId: input.id,
          action: "QUOTED",
          userId: getUserId(ctx),
          newState: {
            totalQuotedAmount: totalQuotedAmount.toString(),
            lineCount: buylist.lines.length,
          },
        },
      });

      return updated;
    }),

  /**
   * Submit buylist for review (customer accepted quote)
   */
  submit: protectedClientProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const buylist = await ctx.prisma.buylist.findFirst({
        where: {
          id: input.id,
          installationId: ctx.installationId,
        },
      });

      if (!buylist) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Buylist not found",
        });
      }

      /*
       * In the simplified workflow, this endpoint is deprecated.
       * Buylists go directly to PENDING_VERIFICATION via createAndPay.
       */
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "This endpoint is deprecated. Use createAndPay for the new workflow.",
      });
    }),

  /**
   * Cancel a buylist
   */
  cancel: protectedClientProcedure
    .input(
      z.object({
        id: z.string().uuid(),
        reason: z.string().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const buylist = await ctx.prisma.buylist.findFirst({
        where: {
          id: input.id,
          installationId: ctx.installationId,
        },
      });

      if (!buylist) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Buylist not found",
        });
      }

      if (buylist.status === "COMPLETED") {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "Cannot cancel completed buylists",
        });
      }

      const updated = await ctx.prisma.buylist.update({
        where: { id: input.id },
        data: {
          status: "CANCELLED",
        },
      });

      // Audit event
      await ctx.prisma.buylistAuditEvent.create({
        data: {
          buylistId: input.id,
          action: "CANCELLED",
          userId: getUserId(ctx),
          metadata: { reason: input.reason },
        },
      });

      return updated;
    }),

  /**
   * Get buylist statistics
   */
  stats: protectedClientProcedure.query(async ({ ctx }) => {
    const [statusCounts, recentTotal, todayCount] = await Promise.all([
      ctx.prisma.buylist.groupBy({
        by: ["status"],
        where: { installationId: ctx.installationId },
        _count: true,
      }),
      ctx.prisma.buylist.aggregate({
        where: {
          installationId: ctx.installationId,
          createdAt: {
            gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000), // Last 30 days
          },
          status: "COMPLETED",
        },
        _sum: {
          totalFinalAmount: true,
        },
      }),
      ctx.prisma.buylist.count({
        where: {
          installationId: ctx.installationId,
          createdAt: {
            gte: new Date(new Date().setHours(0, 0, 0, 0)),
          },
        },
      }),
    ]);

    return {
      statusCounts: Object.fromEntries(
        statusCounts.map((s) => [s.status, s._count])
      ),
      recentTotalValue: recentTotal._sum.totalFinalAmount?.toString() ?? "0",
      todayCount,
    };
  }),

  /**
   * Search for cards by name or set number
   * Set number format: "SET-123" or "123-SET" (e.g., "NEO-123" or "2ed-233")
   */
  searchCards: protectedClientProcedure
    .input(
      z.object({
        query: z.string().min(1),
        limit: z.number().min(1).max(50).optional().default(20),
      })
    )
    .query(async ({ ctx, input }) => {
      // Use enhanced client to get prices from snapshots when available
      const saleorClient = createEnhancedSaleorClient(ctx.apiClient, {
        prisma: ctx.prisma,
        installationId: ctx.installationId,
        channel: "webstore",
      });

      const results = await saleorClient.searchCards(input.query, input.limit);

      return results;
    }),

  /**
   * Get a single card by variant ID
   */
  getCard: protectedClientProcedure
    .input(z.object({ variantId: z.string() }))
    .query(async ({ ctx, input }) => {
      // Use enhanced client to get prices from snapshots when available
      const saleorClient = createEnhancedSaleorClient(ctx.apiClient, {
        prisma: ctx.prisma,
        installationId: ctx.installationId,
        channel: "webstore",
      });

      const card = await saleorClient.getVariantById(input.variantId);

      if (!card) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Card not found",
        });
      }

      return card;
    }),

  /**
   * List available warehouses
   */
  listWarehouses: protectedClientProcedure.query(async ({ ctx }) => {
    const saleorClient = createSaleorClient(ctx.apiClient);

    const warehouses = await saleorClient.listWarehouses();

    return warehouses;
  }),
});

/**
 * Calculate line price based on market price, condition, and policy
 */
function calculateLinePrice(
  marketPrice: number,
  condition: string,
  policy: any
): { quotedPrice: number; finalPrice: number } {
  let baseOffer: number;

  if (!policy) {
    // Default: 50% of market price
    baseOffer = marketPrice * 0.5;
  } else {
    switch (policy.policyType) {
      case "PERCENTAGE":
        baseOffer = marketPrice * ((policy.basePercentage?.toNumber() ?? 50) / 100);
        break;
      case "FIXED_DISCOUNT":
        baseOffer = Math.max(0, marketPrice - (policy.basePercentage?.toNumber() ?? 0));
        break;
      case "TIERED": {
        const rules = policy.tieredRules as Array<{
          minValue: number;
          maxValue: number | null;
          percentage: number;
        }> | null;
        const tier = rules?.find(
          (r) => marketPrice >= r.minValue && (r.maxValue === null || marketPrice < r.maxValue)
        );
        baseOffer = marketPrice * ((tier?.percentage ?? 50) / 100);
        break;
      }
      default:
        baseOffer = marketPrice * 0.5;
    }
  }

  // Apply condition multiplier
  const multipliers = (policy?.conditionMultipliers as Record<string, number>) ?? DEFAULT_CONDITION_MULTIPLIERS;
  const conditionMultiplier = multipliers[condition] ?? 1.0;
  let finalOffer = baseOffer * conditionMultiplier;

  // Apply min/max constraints
  if (policy?.minimumPrice && finalOffer < policy.minimumPrice.toNumber()) {
    finalOffer = policy.minimumPrice.toNumber();
  }
  if (policy?.maximumPrice && finalOffer > policy.maximumPrice.toNumber()) {
    finalOffer = policy.maximumPrice.toNumber();
  }

  // Round to 2 decimal places
  const quotedPrice = Math.round(finalOffer * 100) / 100;

  return { quotedPrice, finalPrice: quotedPrice };
}

/**
 * Update buylist totals after line changes
 */
async function updateBuylistTotals(prisma: any, buylistId: string) {
  const lines = await prisma.buylistLine.findMany({
    where: { buylistId },
  });

  const totalQuotedAmount = lines.reduce(
    (sum: Decimal, line: any) => sum.add(line.quotedPrice.mul(line.qty)),
    new Decimal(0)
  );

  const totalFinalAmount = lines.reduce(
    (sum: Decimal, line: any) => sum.add(line.finalPrice.mul(line.qty)),
    new Decimal(0)
  );

  await prisma.buylist.update({
    where: { id: buylistId },
    data: {
      totalQuotedAmount,
      totalFinalAmount,
    },
  });
}
