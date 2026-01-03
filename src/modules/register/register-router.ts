/**
 * Register Router - Integration with POS Register Sessions
 *
 * Provides buylist app access to open POS registers for cash payouts.
 * Cash payouts are recorded as CashMovement entries against the active register.
 */
import { TRPCError } from "@trpc/server";
import { Decimal } from "decimal.js";
import { z } from "zod";

import { createLogger } from "@/lib/logger";
import { protectedClientProcedure } from "@/modules/trpc/protected-client-procedure";
import { router } from "@/modules/trpc/trpc-server";

const logger = createLogger("register-router");

/**
 * Get open register sessions for the current installation
 * Returns registers that are OPEN or SUSPENDED status
 */
const listOpenRegistersSchema = z.object({
  saleorWarehouseId: z.string().optional(), // Filter by warehouse/location
});

/**
 * Record a buylist cash payout against a register session
 */
const recordPayoutSchema = z.object({
  registerSessionId: z.string().uuid(),
  buylistPayoutId: z.string().uuid(),
  buylistNumber: z.string(),
  amount: z.number().positive(),
  currency: z.string().length(3).default("USD"),
  performedBy: z.string(),
  notes: z.string().optional(),
});

export const registerRouter = router({
  /**
   * List open register sessions
   * Used by buylist UI to show available registers for cash payout
   */
  listOpen: protectedClientProcedure
    .input(listOpenRegistersSchema)
    .query(async ({ ctx, input }) => {
      const registers = await ctx.prisma.registerSession.findMany({
        where: {
          installationId: ctx.installationId,
          status: { in: ["OPEN", "SUSPENDED"] },
          ...(input.saleorWarehouseId && { saleorWarehouseId: input.saleorWarehouseId }),
        },
        select: {
          id: true,
          registerCode: true,
          sessionNumber: true,
          saleorWarehouseId: true,
          status: true,
          openedAt: true,
          openedBy: true,
          openingFloat: true,
          currency: true,
          totalSales: true,
          totalReturns: true,
          totalCashIn: true,
          totalCashOut: true,
          transactionCount: true,
          _count: {
            select: {
              cashMovements: true,
              buylistPayouts: true,
            },
          },
        },
        orderBy: { openedAt: "desc" },
      });

      // Calculate current cash for each register
      return registers.map((reg) => ({
        ...reg,
        openingFloat: reg.openingFloat.toNumber(),
        totalSales: reg.totalSales.toNumber(),
        totalReturns: reg.totalReturns.toNumber(),
        totalCashIn: reg.totalCashIn.toNumber(),
        totalCashOut: reg.totalCashOut.toNumber(),
        // Estimated current cash (opening + sales - returns - cashOut + cashIn)
        estimatedCash:
          reg.openingFloat.toNumber() +
          reg.totalSales.toNumber() -
          reg.totalReturns.toNumber() +
          reg.totalCashIn.toNumber() -
          reg.totalCashOut.toNumber(),
        buylistPayoutCount: reg._count.buylistPayouts,
      }));
    }),

  /**
   * Get a single register session by ID with full details
   */
  getById: protectedClientProcedure
    .input(z.object({ id: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const register = await ctx.prisma.registerSession.findFirst({
        where: {
          id: input.id,
          installationId: ctx.installationId,
        },
        include: {
          cashMovements: {
            where: { movementType: "PAYOUT" },
            orderBy: { performedAt: "desc" },
            take: 20,
          },
          buylistPayouts: {
            include: {
              buylist: {
                select: {
                  buylistNumber: true,
                  customerName: true,
                },
              },
            },
            orderBy: { processedAt: "desc" },
            take: 20,
          },
        },
      });

      if (!register) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Register session not found",
        });
      }

      return register;
    }),

  /**
   * Record a cash payout movement against a register
   * Called by createAndPay when payout method is CASH and register is selected
   */
  recordPayout: protectedClientProcedure
    .input(recordPayoutSchema)
    .mutation(async ({ ctx, input }) => {
      // Verify register session exists and is open
      const session = await ctx.prisma.registerSession.findFirst({
        where: {
          id: input.registerSessionId,
          installationId: ctx.installationId,
          status: { in: ["OPEN", "SUSPENDED"] },
        },
      });

      if (!session) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Register session not found or not open",
        });
      }

      // Verify buylist payout exists
      const payout = await ctx.prisma.buylistPayout.findUnique({
        where: { id: input.buylistPayoutId },
        include: { buylist: true },
      });

      if (!payout) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Buylist payout not found",
        });
      }

      // Create cash movement (negative amount = cash out of drawer)
      const cashMovement = await ctx.prisma.cashMovement.create({
        data: {
          registerSessionId: input.registerSessionId,
          movementType: "PAYOUT",
          amount: new Decimal(input.amount).negated(), // Negative for cash out
          currency: input.currency,
          reason: `Buylist payout: ${input.buylistNumber}`,
          referenceNumber: input.buylistPayoutId,
          buylistPayoutId: input.buylistPayoutId,
          performedBy: input.performedBy,
          performedAt: new Date(),
          notes: input.notes ?? null,
        },
      });

      // Update register session totalCashOut
      await ctx.prisma.registerSession.update({
        where: { id: input.registerSessionId },
        data: {
          totalCashOut: {
            increment: input.amount,
          },
        },
      });

      // Update buylist payout with register link
      await ctx.prisma.buylistPayout.update({
        where: { id: input.buylistPayoutId },
        data: {
          posRegisterSessionId: input.registerSessionId,
          posCashMovementId: cashMovement.id,
        },
      });

      logger.info("Recorded buylist cash payout against register", {
        buylistNumber: input.buylistNumber,
        payoutId: input.buylistPayoutId,
        registerSessionId: input.registerSessionId,
        registerCode: session.registerCode,
        amount: input.amount,
        cashMovementId: cashMovement.id,
      });

      return {
        cashMovementId: cashMovement.id,
        registerCode: session.registerCode,
        sessionNumber: session.sessionNumber,
      };
    }),

  /**
   * Get cash summary for a register including buylist payouts
   * Shows how much cash has been paid out for buylists
   */
  getCashSummary: protectedClientProcedure
    .input(z.object({ registerSessionId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const session = await ctx.prisma.registerSession.findFirst({
        where: {
          id: input.registerSessionId,
          installationId: ctx.installationId,
        },
      });

      if (!session) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Register session not found",
        });
      }

      // Get all cash movements for this session
      const movements = await ctx.prisma.cashMovement.findMany({
        where: { registerSessionId: input.registerSessionId },
        orderBy: { performedAt: "asc" },
      });

      // Calculate summary
      let currentCash = session.openingFloat.toNumber();
      let totalSales = 0;
      let totalReturns = 0;
      let totalDrops = 0;
      let totalPayouts = 0;
      let totalPaidIn = 0;
      let buylistPayoutCount = 0;
      let buylistPayoutTotal = 0;

      for (const m of movements) {
        const amt = m.amount.toNumber();
        currentCash += amt;

        switch (m.movementType) {
          case "SALE_CASH":
            totalSales += amt;
            break;
          case "RETURN_CASH":
            totalReturns += Math.abs(amt);
            break;
          case "CASH_DROP":
            totalDrops += Math.abs(amt);
            break;
          case "PAYOUT":
            totalPayouts += Math.abs(amt);
            if (m.buylistPayoutId) {
              buylistPayoutCount++;
              buylistPayoutTotal += Math.abs(amt);
            }
            break;
          case "PAID_IN":
            totalPaidIn += amt;
            break;
        }
      }

      return {
        registerCode: session.registerCode,
        sessionNumber: session.sessionNumber,
        status: session.status,
        openingFloat: session.openingFloat.toNumber(),
        currentCash,
        totalSales,
        totalReturns,
        totalDrops,
        totalPayouts,
        totalPaidIn,
        buylistPayoutCount,
        buylistPayoutTotal,
        movementCount: movements.length,
      };
    }),
});
