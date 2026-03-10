/* eslint-disable @typescript-eslint/no-explicit-any, prefer-const */
import type { BuylistPricingPolicy, PricingRule as PrismaPricingRule } from "@prisma/client";
import { TRPCError } from "@trpc/server";
import { Decimal } from "decimal.js";
import { z } from "zod";

import { extractUserFromToken } from "@/lib/jwt-utils";
import { createLogger } from "@/lib/logger";
import { createEnhancedSaleorClient, createSaleorClient, type StockUpdateResult } from "@/lib/saleor-client";
import { computeWacForNewEventOptimized } from "@/lib/wac-service";
import { ruleEngine } from "@/modules/pricing/rule-engine";
import { protectedClientProcedure } from "@/modules/trpc/protected-client-procedure";
import { router } from "@/modules/trpc/trpc-server";

const logger = createLogger("buylists-router");

/**
 * Get a user-friendly identifier from context
 */
function getUserId(ctx: { token?: string | null }): string | null {
  return extractUserFromToken(ctx.token);
}

type GroupInfo = { id: string; name: string; discountPercent: number };

/**
 * Look up a customer's group memberships and return the highest discount percent.
 * Used by both `create` and `createAndPay` to apply group premium on buy prices.
 */
async function resolveGroupPremium(
  prisma: { customerGroupMember: { findMany: (...args: any[]) => Promise<any[]> } },
  saleorUserId: string | undefined | null,
  installationId: string,
): Promise<{ percent: number; info: GroupInfo | null }> {
  if (!saleorUserId) return { percent: 0, info: null };

  const memberships = await prisma.customerGroupMember.findMany({
    where: {
      saleorCustomerId: saleorUserId,
      group: { installationId, isActive: true },
    },
    include: {
      group: { select: { id: true, name: true, discountPercent: true } },
    },
  });

  const activeGroups = memberships.filter(
    (m: any) => m.group.discountPercent && m.group.discountPercent.toNumber() > 0,
  );

  if (activeGroups.length === 0) return { percent: 0, info: null };

  const best = activeGroups.reduce((a: any, b: any) =>
    b.group.discountPercent.toNumber() > a.group.discountPercent.toNumber() ? b : a,
  );
  const percent = best.group.discountPercent.toNumber();

  return {
    percent,
    info: { id: best.group.id, name: best.group.name, discountPercent: percent },
  };
}

function buildBuylistNotes(
  userNotes: string | undefined | null,
  groupInfo: GroupInfo | null,
): string | null {
  const parts: string[] = [];
  if (userNotes) parts.push(userNotes);
  if (groupInfo) {
    parts.push(`[Group Premium: ${groupInfo.name} +${groupInfo.discountPercent}%]`);
  }
  return parts.length > 0 ? parts.join(" | ") : null;
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
  saleorUserId: z.string().optional().nullable(), // Required for STORE_CREDIT payout
  currency: z.string().length(3).default("USD"),
  notes: z.string().optional().nullable(),
  payoutMethod: payoutMethodEnum,
  payoutReference: z.string().optional().nullable(), // Check #, transaction ID, etc.
  posRegisterSessionId: z.string().uuid().optional().nullable(), // POS register for CASH payout
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

    // Get pricing policy with rules (use specified or default)
    let pricingPolicy: PolicyWithRules | null;
    if (input.pricingPolicyId) {
      pricingPolicy = await ctx.prisma.buylistPricingPolicy.findFirst({
        where: {
          id: input.pricingPolicyId,
          installationId: ctx.installationId,
        },
        include: {
          rules: {
            where: { isActive: true },
            orderBy: { priority: "asc" },
          },
        },
      });
    } else {
      pricingPolicy = await ctx.prisma.buylistPricingPolicy.findFirst({
        where: {
          installationId: ctx.installationId,
          isDefault: true,
          isActive: true,
        },
        include: {
          rules: {
            where: { isActive: true },
            orderBy: { priority: "asc" },
          },
        },
      });
    }

    // Resolve customer group premium
    const { percent: groupPremiumPercent, info: groupInfo } = await resolveGroupPremium(
      ctx.prisma,
      input.saleorUserId,
      ctx.installationId,
    );

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
        // Calculate from pricing policy with rule engine
        const calculated = calculateLinePrice(
          line.marketPrice,
          line.condition,
          pricingPolicy,
          { variantId: line.saleorVariantId }
        );
        quotedPrice = calculated.quotedPrice;
        finalPrice = calculated.finalPrice;
      }

      // Apply customer group premium (customer gets MORE for their cards)
      if (groupPremiumPercent > 0) {
        const multiplier = 1 + groupPremiumPercent / 100;
        quotedPrice = Math.round(quotedPrice * multiplier * 100) / 100;
        finalPrice = Math.round(finalPrice * multiplier * 100) / 100;
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
        notes: buildBuylistNotes(input.notes, groupInfo),
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
          ...(groupInfo && { customerGroupPremium: groupInfo }),
        },
      },
    });

    return { ...buylist, groupInfo };
  }),

  /**
   * Create and pay buylist in one step (simplified face-to-face workflow)
   * Creates buylist, records payout, sets status to PENDING_VERIFICATION
   * For STORE_CREDIT payouts, credits the customer's store credit account
   */
  createAndPay: protectedClientProcedure.input(createAndPaySchema).mutation(async ({ ctx, input }) => {
    // Validate store credit payout requires a customer
    if (input.payoutMethod === "STORE_CREDIT" && !input.saleorUserId) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "Store credit payout requires a customer. Please attach a customer to this buylist.",
      });
    }

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
      // Return consistent shape with groupInfo (matches normal success path)
      // groupInfo is not stored on the Buylist model — it's only in audit event newState JSON
      return { ...existingPayout.buylist, groupInfo: null };
    }

    // Generate buylist number
    const buylistNumber = await generateBuylistNumber(ctx.prisma, ctx.installationId);

    // Get default pricing policy with rules
    const pricingPolicy = await ctx.prisma.buylistPricingPolicy.findFirst({
      where: {
        installationId: ctx.installationId,
        isDefault: true,
        isActive: true,
      },
      include: {
        rules: {
          where: { isActive: true },
          orderBy: { priority: "asc" },
        },
      },
    });

    // Resolve customer group premium
    const { percent: groupPremiumPercent, info: groupInfo } = await resolveGroupPremium(
      ctx.prisma,
      input.saleorUserId,
      ctx.installationId,
    );

    // Calculate prices for each line
    const linesWithPrices = input.lines.map((line, index) => {
      let buyPrice: number;

      if (line.buyPrice !== null && line.buyPrice !== undefined) {
        buyPrice = line.buyPrice;
      } else {
        const calculated = calculateLinePrice(
          line.marketPrice,
          line.condition,
          pricingPolicy,
          { variantId: line.saleorVariantId }
        );
        buyPrice = calculated.finalPrice;
      }

      // Apply customer group premium (customer gets MORE for their cards)
      if (groupPremiumPercent > 0) {
        const multiplier = 1 + groupPremiumPercent / 100;
        buyPrice = Math.round(buyPrice * multiplier * 100) / 100;
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
          saleorUserId: input.saleorUserId ?? null,
          currency: input.currency,
          pricingPolicyId: pricingPolicy?.id ?? null,
          totalQuotedAmount: totalAmount,
          totalFinalAmount: totalAmount,
          notes: buildBuylistNotes(input.notes, groupInfo),
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
      const payout = await tx.buylistPayout.create({
        data: {
          buylistId: newBuylist.id,
          method: input.payoutMethod,
          status: "COMPLETED",
          amount: totalAmount,
          currency: input.currency,
          reference: input.payoutReference ?? null,
          posRegisterSessionId: input.posRegisterSessionId ?? null,
          processedAt: now,
          processedBy: userId,
          idempotencyKey,
        },
      });

      // Record cash movement if CASH payout with register session
      if (input.payoutMethod === "CASH" && input.posRegisterSessionId) {
        // Verify register session is open
        const session = await tx.registerSession.findFirst({
          where: {
            id: input.posRegisterSessionId,
            installationId: ctx.installationId,
            status: { in: ["OPEN", "SUSPENDED"] },
          },
        });

        if (!session) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Selected register is not open. Please select an open register.",
          });
        }

        // Create cash movement (negative = cash out of drawer)
        const cashMovement = await tx.cashMovement.create({
          data: {
            registerSessionId: input.posRegisterSessionId,
            movementType: "PAYOUT",
            amount: totalAmount.negated(), // Negative for cash out
            currency: input.currency,
            reason: `Buylist payout: ${buylistNumber}`,
            referenceNumber: payout.id,
            buylistPayoutId: payout.id,
            performedBy: userId ?? "system",
            performedAt: now,
            notes: `Customer: ${input.customerName ?? "Walk-in"}`,
          },
        });

        // Update payout with cash movement ID
        await tx.buylistPayout.update({
          where: { id: payout.id },
          data: { posCashMovementId: cashMovement.id },
        });

        // Update register session totalCashOut
        await tx.registerSession.update({
          where: { id: input.posRegisterSessionId },
          data: {
            totalCashOut: { increment: totalAmount.toNumber() },
          },
        });

        logger.info("Cash payout recorded against register", {
          buylistNumber,
          payoutId: payout.id,
          registerSessionId: input.posRegisterSessionId,
          registerCode: session.registerCode,
          amount: totalAmount.toString(),
          cashMovementId: cashMovement.id,
        });
      }

      // Issue store credit if payout method is STORE_CREDIT
      if (input.payoutMethod === "STORE_CREDIT" && input.saleorUserId) {
        // Get or create credit account
        let credit = await tx.customerCredit.findUnique({
          where: {
            installationId_saleorCustomerId: {
              installationId: ctx.installationId,
              saleorCustomerId: input.saleorUserId,
            },
          },
        });

        const previousBalance = credit?.balance.toNumber() ?? 0;
        const creditAmount = totalAmount.toNumber();
        const newBalance = previousBalance + creditAmount;

        if (!credit) {
          credit = await tx.customerCredit.create({
            data: {
              installationId: ctx.installationId,
              saleorCustomerId: input.saleorUserId,
              balance: newBalance,
              currency: input.currency,
            },
          });
        } else {
          credit = await tx.customerCredit.update({
            where: { id: credit.id },
            data: { balance: newBalance },
          });
        }

        // Record credit transaction
        await tx.creditTransaction.create({
          data: {
            creditAccountId: credit.id,
            transactionType: "BUYLIST_PAYOUT",
            amount: creditAmount,
            currency: input.currency,
            balanceAfter: newBalance,
            sourceBuylistId: newBuylist.id,
            note: `Store credit from buylist ${buylistNumber}`,
            createdBy: userId,
          },
        });

        logger.info("Store credit issued from buylist", {
          buylistId: newBuylist.id,
          buylistNumber,
          customerId: input.saleorUserId,
          creditAmount,
          newBalance,
        });
      }

      /*
       * NOTE: Cost layer events are NOT created here.
       * They are created in BOH verifyAndReceive when cards are actually verified and received.
       * This prevents duplicate cost events and ensures WAC is only updated when inventory
       * is actually added (after verification, not at time of payment).
       */

      logger.info("Buylist created and paid, pending BOH verification", {
        buylistId: newBuylist.id,
        buylistNumber,
        lineCount: newBuylist.lines.length,
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
            ...(input.payoutMethod === "STORE_CREDIT" && { customerId: input.saleorUserId }),
            ...(input.payoutMethod === "CASH" && input.posRegisterSessionId && { registerSessionId: input.posRegisterSessionId }),
            ...(groupInfo && { customerGroupPremium: groupInfo }),
          },
        },
      });

      return newBuylist;
    });

    return { ...buylist, groupInfo };
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
          pricingPolicy: {
            include: {
              rules: {
                where: { isActive: true },
                orderBy: { priority: "asc" },
              },
            },
          },
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
          buylist.pricingPolicy,
          { variantId: input.line.saleorVariantId }
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
            include: {
              pricingPolicy: {
                include: {
                  rules: {
                    where: { isActive: true },
                    orderBy: { priority: "asc" },
                  },
                },
              },
            },
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
          line.buylist.pricingPolicy,
          { variantId: line.saleorVariantId }
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
          pricingPolicy: {
            include: {
              rules: {
                where: { isActive: true },
                orderBy: { priority: "asc" },
              },
            },
          },
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

      // Recalculate all line prices using rule engine
      for (const line of buylist.lines) {
        const { quotedPrice, finalPrice } = calculateLinePrice(
          line.marketPrice.toNumber(),
          line.condition,
          buylist.pricingPolicy,
          { variantId: line.saleorVariantId }
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
          buylist.pricingPolicy,
          { variantId: line.saleorVariantId }
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
        include: {
          payouts: {
            where: { status: "COMPLETED" },
          },
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

      // Block cancellation after payout has been made
      if (buylist.payouts.length > 0 || buylist.paidAt) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "Cannot cancel buylist after payout. Use 'void' operation to reverse.",
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
   * Void a buylist after payment — reverses financial, stock, and cost records.
   *
   * Handles two scenarios:
   *   A: PENDING_VERIFICATION — payout made but cards not yet received (reverse payout only)
   *   B: COMPLETED — cards received into stock (reverse payout + stock + cost events)
   *
   * Accounting invariants preserved:
   *   - Append-only ledger: creates reversal entries, never deletes existing records
   *   - WAC integrity: BUYLIST_RECEIPT_REVERSAL events recalculate WAC with negative qtyDelta
   *   - Financial records: payouts status-transitioned to CANCELLED, never deleted
   */
  void: protectedClientProcedure
    .input(
      z.object({
        id: z.string().uuid(),
        reason: z.string().min(1, "Void reason is required").max(500),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const buylist = await ctx.prisma.buylist.findFirst({
        where: {
          id: input.id,
          installationId: ctx.installationId,
        },
        include: {
          lines: true,
          payouts: true,
          events: {
            orderBy: { createdAt: "desc" },
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

      if (buylist.status === "CANCELLED") {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "Buylist is already cancelled",
        });
      }

      if (buylist.status !== "PENDING_VERIFICATION" && buylist.status !== "COMPLETED") {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: `Cannot void buylist with status '${buylist.status}'`,
        });
      }

      const previousStatus = buylist.status;
      const userId = getUserId(ctx);
      const now = new Date();

      // Track reversal summary for audit
      const reversalSummary: {
        payoutsReversed: number;
        cashMovementsCreated: number;
        creditTransactionsCreated: number;
        creditShortfall: { customerId: string; expected: number; actual: number } | null;
        stockAdjustments: { attempted: number; successful: number; failed: number } | null;
        costEventsCreated: number;
      } = {
        payoutsReversed: 0,
        cashMovementsCreated: 0,
        creditTransactionsCreated: 0,
        creditShortfall: null,
        stockAdjustments: null,
        costEventsCreated: 0,
      };

      // ── 1. Financial Reversal (both scenarios) ──────────────────────────

      await ctx.prisma.$transaction(async (tx: any) => {
        const completedPayouts = buylist.payouts.filter((p: any) => p.status === "COMPLETED");

        for (const payout of completedPayouts) {
          // Transition payout status to CANCELLED (never delete)
          await tx.buylistPayout.update({
            where: { id: payout.id },
            data: { status: "CANCELLED" },
          });
          reversalSummary.payoutsReversed++;

          // Reverse CASH payout
          if (payout.method === "CASH" && payout.posRegisterSessionId) {
            const payoutAmount = new Decimal(payout.amount.toString());

            // Create positive VOID_REVERSAL movement (cash back to drawer)
            await tx.cashMovement.create({
              data: {
                registerSessionId: payout.posRegisterSessionId,
                movementType: "VOID_REVERSAL",
                amount: payoutAmount, // Positive = cash back into drawer
                currency: payout.currency,
                reason: `Void reversal: buylist ${buylist.buylistNumber}`,
                referenceNumber: payout.id,
                buylistPayoutId: payout.id,
                performedBy: userId ?? "system",
                performedAt: now,
                notes: `Void reason: ${input.reason}`,
              },
            });
            reversalSummary.cashMovementsCreated++;

            // Decrement register session totalCashOut
            await tx.registerSession.update({
              where: { id: payout.posRegisterSessionId },
              data: {
                totalCashOut: { decrement: payoutAmount.toNumber() },
              },
            });

            logger.info("Cash payout reversed via VOID_REVERSAL", {
              buylistNumber: buylist.buylistNumber,
              payoutId: payout.id,
              registerSessionId: payout.posRegisterSessionId,
              amount: payoutAmount.toString(),
            });
          }

          // Reverse STORE_CREDIT payout
          if (payout.method === "STORE_CREDIT" && buylist.saleorUserId) {
            const payoutAmount = new Decimal(payout.amount.toString());

            const credit = await tx.customerCredit.findUnique({
              where: {
                installationId_saleorCustomerId: {
                  installationId: ctx.installationId,
                  saleorCustomerId: buylist.saleorUserId,
                },
              },
            });

            if (credit) {
              const currentBalance = new Decimal(credit.balance.toString());
              // Debit what's available — don't block on shortfall
              const debitAmount = Decimal.min(currentBalance, payoutAmount);
              const newBalance = currentBalance.minus(debitAmount);

              if (debitAmount.lt(payoutAmount)) {
                reversalSummary.creditShortfall = {
                  customerId: buylist.saleorUserId,
                  expected: payoutAmount.toNumber(),
                  actual: debitAmount.toNumber(),
                };
                logger.warn("Credit shortfall during void — customer spent some credit", {
                  buylistNumber: buylist.buylistNumber,
                  customerId: buylist.saleorUserId,
                  expected: payoutAmount.toString(),
                  available: currentBalance.toString(),
                  debited: debitAmount.toString(),
                });
              }

              await tx.customerCredit.update({
                where: { id: credit.id },
                data: { balance: newBalance },
              });

              await tx.creditTransaction.create({
                data: {
                  creditAccountId: credit.id,
                  transactionType: "ADJUSTMENT",
                  amount: debitAmount.negated(), // Negative = debit
                  currency: payout.currency,
                  balanceAfter: newBalance,
                  sourceBuylistId: buylist.id,
                  note: `Void reversal: buylist ${buylist.buylistNumber}. Reason: ${input.reason}`,
                  createdBy: userId,
                },
              });
              reversalSummary.creditTransactionsCreated++;

              logger.info("Store credit reversed via ADJUSTMENT", {
                buylistNumber: buylist.buylistNumber,
                customerId: buylist.saleorUserId,
                debited: debitAmount.toString(),
                newBalance: newBalance.toString(),
                shortfall: reversalSummary.creditShortfall !== null,
              });
            }
          }
        }

        // ── 2. Update buylist status to CANCELLED ───────────────────────

        await tx.buylist.update({
          where: { id: input.id },
          data: { status: "CANCELLED" },
        });
      });

      // ── 3. Stock + Cost Reversal (COMPLETED only — outside DB transaction) ──

      if (previousStatus === "COMPLETED") {
        // Find the cost events created during verifyAndReceive to get actual variant IDs
        const existingCostEvents = await ctx.prisma.costLayerEvent.findMany({
          where: {
            installationId: ctx.installationId,
            eventType: "BUYLIST_RECEIPT",
            sourceBuylistLineId: { in: buylist.lines.map((l: any) => l.id) },
          },
        });

        // Build a map: buylist line ID → cost event (with actual condition-specific variant)
        const costEventByLineId = new Map<string, any>();
        for (const event of existingCostEvents) {
          if (event.sourceBuylistLineId) {
            costEventByLineId.set(event.sourceBuylistLineId, event);
          }
        }

        // Stock adjustments (negative deltas)
        const stockAdjustments: Array<{ variantId: string; warehouseId: string; delta: number }> = [];

        for (const line of buylist.lines) {
          const qtyAccepted = (line as any).qtyAccepted ?? 0;
          if (qtyAccepted <= 0) continue;

          const costEvent = costEventByLineId.get(line.id);
          if (!costEvent) {
            logger.warn("No cost event found for accepted line — skipping stock/cost reversal", {
              lineId: line.id,
              buylistNumber: buylist.buylistNumber,
            });
            continue;
          }

          // Use the actual variant ID from the cost event (condition-specific)
          const actualVariantId = costEvent.saleorVariantId;

          stockAdjustments.push({
            variantId: actualVariantId,
            warehouseId: buylist.saleorWarehouseId,
            delta: -qtyAccepted, // Negative = remove from stock
          });
        }

        // Execute Saleor stock adjustments
        let stockResults: StockUpdateResult[] = [];
        if (stockAdjustments.length > 0) {
          logger.info("Reversing Saleor stock for voided buylist", {
            buylistId: input.id,
            adjustmentCount: stockAdjustments.length,
          });

          const saleorClient = createSaleorClient(ctx.apiClient);
          stockResults = await saleorClient.bulkAdjustStock(stockAdjustments);

          const failures = stockResults.filter((r) => !r.success);
          if (failures.length > 0) {
            logger.error("Some stock reversals failed during void", {
              buylistId: input.id,
              failures: failures.map((f) => ({
                variantId: f.variantId,
                error: f.error,
              })),
            });
            // Don't throw — proceed with cost events and audit. Stock reconciliation will flag.
          }

          reversalSummary.stockAdjustments = {
            attempted: stockAdjustments.length,
            successful: stockResults.filter((r) => r.success).length,
            failed: failures.length,
          };
        }

        // Create cost layer reversal events
        for (const line of buylist.lines) {
          const qtyAccepted = (line as any).qtyAccepted ?? 0;
          if (qtyAccepted <= 0) continue;

          const costEvent = costEventByLineId.get(line.id);
          if (!costEvent) continue;

          const actualVariantId = costEvent.saleorVariantId;

          const wacResult = await computeWacForNewEventOptimized({
            prisma: ctx.prisma,
            installationId: ctx.installationId,
            variantId: actualVariantId,
            warehouseId: buylist.saleorWarehouseId,
            newQtyDelta: -qtyAccepted,
            newUnitCost: new Decimal(line.finalPrice.toString()),
            newLandedCostDelta: new Decimal(0),
          });

          await ctx.prisma.costLayerEvent.create({
            data: {
              installationId: ctx.installationId,
              eventType: "BUYLIST_RECEIPT_REVERSAL",
              saleorVariantId: actualVariantId,
              saleorWarehouseId: buylist.saleorWarehouseId,
              saleorVariantSku: costEvent.saleorVariantSku,
              saleorVariantName: costEvent.saleorVariantName,
              qtyDelta: -qtyAccepted,
              unitCost: line.finalPrice,
              currency: line.currency,
              landedCostDelta: new Decimal(0),
              sourceBuylistLineId: line.id,
              wacAtEvent: wacResult.wacAtEvent,
              qtyOnHandAtEvent: wacResult.qtyOnHandAtEvent,
              totalValueAtEvent: wacResult.totalValueAtEvent,
              previousEventId: wacResult.previousEventId,
              createdBy: userId,
            },
          });
          reversalSummary.costEventsCreated++;
        }
      }

      // ── 4. Audit Event ─────────────────────────────────────────────────

      await ctx.prisma.buylistAuditEvent.create({
        data: {
          buylistId: input.id,
          action: "VOIDED",
          userId,
          metadata: {
            reason: input.reason,
            previousStatus,
            payoutsReversed: reversalSummary.payoutsReversed,
            cashMovementsCreated: reversalSummary.cashMovementsCreated,
            creditTransactionsCreated: reversalSummary.creditTransactionsCreated,
            ...(reversalSummary.creditShortfall && { creditShortfall: reversalSummary.creditShortfall }),
            ...(reversalSummary.stockAdjustments && { stockAdjustments: reversalSummary.stockAdjustments }),
            costEventsCreated: reversalSummary.costEventsCreated,
          },
        },
      });

      logger.info("Buylist voided successfully", {
        buylistId: input.id,
        buylistNumber: buylist.buylistNumber,
        previousStatus,
        reason: input.reason,
        ...reversalSummary,
      });

      // Refetch the updated buylist
      const updated = await ctx.prisma.buylist.findFirst({
        where: { id: input.id },
        include: {
          lines: true,
          payouts: true,
        },
      });

      return {
        buylist: updated,
        reversalSummary,
      };
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
 * Policy with rules type for pricing calculations
 */
type PolicyWithRules = BuylistPricingPolicy & { rules: PrismaPricingRule[] };

/**
 * Calculate line price based on market price, condition, and policy using the rule engine
 * This properly applies pricing rules defined in the policy.
 */
function calculateLinePrice(
  marketPrice: number,
  condition: string,
  policy: PolicyWithRules | null,
  options?: {
    variantId?: string;
    productId?: string;
    categoryId?: string;
  }
): { quotedPrice: number; finalPrice: number } {
  // If no policy, use simple 50% fallback
  if (!policy) {
    const fallbackPrice = Math.round(marketPrice * 0.5 * 100) / 100;
    return { quotedPrice: fallbackPrice, finalPrice: fallbackPrice };
  }

  // Use the rule engine to calculate price with full rule support
  const result = ruleEngine.calculatePrice({
    policy,
    rules: policy.rules ?? [],
    marketPrice,
    condition,
    attributes: {
      variantId: options?.variantId ?? "",
      productId: options?.productId ?? "",
      categoryId: options?.categoryId,
    },
    /*
     * Note: Inventory data not available in this context
     * For inventory-based rules, the pricing.calculatePrice tRPC endpoint should be used
     */
  });

  return {
    quotedPrice: result.finalOffer,
    finalPrice: result.finalOffer,
  };
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
