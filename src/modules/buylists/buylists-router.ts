/* eslint-disable @typescript-eslint/no-explicit-any, prefer-const */
import { TRPCError } from "@trpc/server";
import { Decimal } from "decimal.js";
import { z } from "zod";

import { extractUserFromToken } from "@/lib/jwt-utils";
import { createSaleorClient } from "@/lib/saleor-client";
import { DEFAULT_CONDITION_MULTIPLIERS } from "@/modules/pricing";
import { protectedClientProcedure } from "@/modules/trpc/protected-client-procedure";
import { router } from "@/modules/trpc/trpc-server";

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

// Search schema
const searchSchema = z.object({
  query: z.string().optional(),
  status: z.enum([
    "DRAFT",
    "QUOTED",
    "SUBMITTED",
    "PENDING_REVIEW",
    "APPROVED",
    "RECEIVED",
    "PAID",
    "REJECTED",
    "CANCELLED",
  ]).optional(),
  warehouseId: z.string().optional(),
  customerId: z.string().optional(),
  dateFrom: z.string().datetime().optional(),
  dateTo: z.string().datetime().optional(),
  limit: z.number().min(1).max(100).optional().default(50),
  offset: z.number().min(0).optional().default(0),
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
      const { quotedPrice, finalPrice } = calculateLinePrice(
        line.marketPrice,
        line.condition,
        pricingPolicy
      );

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
        status: "DRAFT",
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
   * Update a buylist (draft only)
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

      if (existing.status !== "DRAFT") {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "Only draft buylists can be edited",
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

      if (buylist.status !== "DRAFT") {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "Only draft buylists can be modified",
        });
      }

      // Calculate prices
      const { quotedPrice, finalPrice } = calculateLinePrice(
        input.line.marketPrice,
        input.line.condition,
        buylist.pricingPolicy
      );

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

      if (line.buylist.status !== "DRAFT") {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "Only draft buylists can be modified",
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

      if (line.buylist.status !== "DRAFT") {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "Only draft buylists can be modified",
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

      if (!["DRAFT", "QUOTED"].includes(buylist.status)) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "Can only generate quotes for draft or quoted buylists",
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
          status: "QUOTED",
          totalQuotedAmount,
          totalFinalAmount: totalQuotedAmount,
          quotedAt: new Date(),
          quotedBy: getUserId(ctx),
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

      if (buylist.status !== "QUOTED") {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "Buylist must be quoted before submission",
        });
      }

      const updated = await ctx.prisma.buylist.update({
        where: { id: input.id },
        data: {
          status: "PENDING_REVIEW",
          submittedAt: new Date(),
        },
      });

      // Audit event
      await ctx.prisma.buylistAuditEvent.create({
        data: {
          buylistId: input.id,
          action: "SUBMITTED",
          userId: getUserId(ctx),
        },
      });

      return updated;
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

      if (["RECEIVED", "PAID"].includes(buylist.status)) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "Cannot cancel received or paid buylists",
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
          status: { in: ["RECEIVED", "PAID"] },
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
      const saleorClient = createSaleorClient(ctx.apiClient);

      const results = await saleorClient.searchCards(input.query, input.limit);

      return results;
    }),

  /**
   * Get a single card by variant ID
   */
  getCard: protectedClientProcedure
    .input(z.object({ variantId: z.string() }))
    .query(async ({ ctx, input }) => {
      const saleorClient = createSaleorClient(ctx.apiClient);

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
