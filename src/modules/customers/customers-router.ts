import { TRPCError } from "@trpc/server";
import { Decimal } from "decimal.js";
import { z } from "zod";

import { extractUserFromToken } from "@/lib/jwt-utils";
import { createLogger } from "@/lib/logger";
import { protectedClientProcedure } from "@/modules/trpc/protected-client-procedure";
import { router } from "@/modules/trpc/trpc-server";

const logger = createLogger("customers-router");

/**
 * Get a user-friendly identifier from context
 */
function getUserId(ctx: { token?: string | null }): string | null {
  return extractUserFromToken(ctx.token);
}

/**
 * Customer search schema
 */
const searchCustomersSchema = z.object({
  query: z.string().min(2).max(255),
  limit: z.number().min(1).max(50).optional().default(10),
});

/**
 * Create customer schema
 */
const createCustomerSchema = z.object({
  email: z.string().email(),
  firstName: z.string().min(1).max(255),
  lastName: z.string().min(1).max(255),
  phone: z.string().max(50).optional(),
  note: z.string().max(1000).optional(),
});

/**
 * Attach customer to buylist schema
 */
const attachCustomerSchema = z.object({
  buylistId: z.string().uuid(),
  customerId: z.string().min(1),
});

/**
 * Saleor GraphQL fragment for customer data
 */
const CUSTOMER_FRAGMENT = `
  fragment CustomerFields on User {
    id
    email
    firstName
    lastName
    isActive
    dateJoined
    metadata {
      key
      value
    }
    defaultShippingAddress {
      id
      firstName
      lastName
      streetAddress1
      streetAddress2
      city
      postalCode
      country {
        code
        country
      }
      phone
    }
    orders(first: 5) {
      totalCount
    }
  }
`;

/**
 * Customer type from Saleor response
 */
interface SaleorCustomer {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  isActive: boolean;
  dateJoined: string;
  metadata: Array<{ key: string; value: string }>;
  defaultShippingAddress?: {
    id: string;
    firstName: string;
    lastName: string;
    streetAddress1: string;
    streetAddress2?: string;
    city: string;
    postalCode: string;
    country: { code: string; country: string };
    phone?: string;
  };
  orders?: {
    totalCount: number;
  };
}

/**
 * Customers Router for Buylist App
 * Integrates with Saleor customer system and manages store credit from buylist payouts
 */
export const customersRouter = router({
  /**
   * Search customers by email, phone, or name
   * Uses Saleor's customers query with search parameter
   */
  search: protectedClientProcedure.input(searchCustomersSchema).query(async ({ ctx, input }) => {
    const query = `
      ${CUSTOMER_FRAGMENT}
      query SearchCustomers($first: Int!, $search: String!) {
        customers(first: $first, search: $search) {
          edges {
            node {
              ...CustomerFields
            }
          }
        }
      }
    `;

    const result = await ctx.apiClient!.query(query, {
      first: input.limit,
      search: input.query,
    });

    if (!result.data?.customers?.edges) {
      return [];
    }

    const customers = result.data.customers.edges.map(
      (edge: { node: SaleorCustomer }) => edge.node
    );

    // Enrich with store credit balances from our DB
    const customerIds = customers.map((c: SaleorCustomer) => c.id);
    const creditBalances = await ctx.prisma.customerCredit.findMany({
      where: {
        installationId: ctx.installationId,
        saleorCustomerId: { in: customerIds },
      },
      select: {
        saleorCustomerId: true,
        balance: true,
        currency: true,
      },
    });

    const creditMap = new Map(
      creditBalances.map((c) => [c.saleorCustomerId, { balance: c.balance.toNumber(), currency: c.currency }])
    );

    // Get buylist history counts
    const buylistCounts = await ctx.prisma.buylist.groupBy({
      by: ["saleorUserId"],
      where: {
        installationId: ctx.installationId,
        saleorUserId: { in: customerIds },
        status: "COMPLETED",
      },
      _count: true,
      _sum: {
        totalFinalAmount: true,
      },
    });

    const buylistMap = new Map(
      buylistCounts.map((b) => [
        b.saleorUserId,
        { count: b._count, totalValue: b._sum.totalFinalAmount?.toNumber() ?? 0 },
      ])
    );

    return customers.map((customer: SaleorCustomer) => ({
      ...customer,
      storeCredit: creditMap.get(customer.id) ?? { balance: 0, currency: "USD" },
      buylistHistory: buylistMap.get(customer.id) ?? { count: 0, totalValue: 0 },
      displayName: `${customer.firstName} ${customer.lastName}`.trim() || customer.email,
      phone: customer.defaultShippingAddress?.phone ?? null,
    }));
  }),

  /**
   * Get customer by ID with full details including buylist history
   */
  getById: protectedClientProcedure
    .input(z.object({ id: z.string().min(1) }))
    .query(async ({ ctx, input }) => {
      const query = `
        ${CUSTOMER_FRAGMENT}
        query GetCustomer($id: ID!) {
          user(id: $id) {
            ...CustomerFields
          }
        }
      `;

      const result = await ctx.apiClient!.query(query, { id: input.id });

      if (!result.data?.user) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Customer not found",
        });
      }

      const customer = result.data.user as SaleorCustomer;

      // Get store credit balance and recent transactions
      const credit = await ctx.prisma.customerCredit.findUnique({
        where: {
          installationId_saleorCustomerId: {
            installationId: ctx.installationId,
            saleorCustomerId: customer.id,
          },
        },
        include: {
          transactions: {
            orderBy: { createdAt: "desc" },
            take: 10,
          },
        },
      });

      // Get buylist history
      const buylists = await ctx.prisma.buylist.findMany({
        where: {
          installationId: ctx.installationId,
          saleorUserId: customer.id,
        },
        orderBy: { createdAt: "desc" },
        take: 10,
        select: {
          id: true,
          buylistNumber: true,
          status: true,
          totalFinalAmount: true,
          currency: true,
          payoutMethod: true,
          createdAt: true,
          paidAt: true,
          _count: {
            select: { lines: true },
          },
        },
      });

      return {
        ...customer,
        displayName: `${customer.firstName} ${customer.lastName}`.trim() || customer.email,
        phone: customer.defaultShippingAddress?.phone ?? null,
        storeCredit: {
          balance: credit?.balance.toNumber() ?? 0,
          currency: credit?.currency ?? "USD",
          recentTransactions: credit?.transactions.map((tx) => ({
            ...tx,
            amount: tx.amount.toNumber(),
            balanceAfter: tx.balanceAfter.toNumber(),
          })) ?? [],
        },
        buylistHistory: buylists.map((bl) => ({
          ...bl,
          totalFinalAmount: bl.totalFinalAmount.toNumber(),
          lineCount: bl._count.lines,
        })),
      };
    }),

  /**
   * Create a new customer in Saleor
   * Used for walk-in customers who want to sign up
   */
  create: protectedClientProcedure.input(createCustomerSchema).mutation(async ({ ctx, input }) => {
    // Check if customer already exists
    const existingCheck = await ctx.apiClient!.query(
      `
      query CheckExistingCustomer($email: String!) {
        customers(first: 1, filter: { search: $email }) {
          edges {
            node {
              id
              email
            }
          }
        }
      }
    `,
      { email: input.email }
    );

    const existingCustomer = existingCheck.data?.customers?.edges?.[0]?.node;
    if (existingCustomer?.email?.toLowerCase() === input.email.toLowerCase()) {
      throw new TRPCError({
        code: "CONFLICT",
        message: `A customer with email ${input.email} already exists`,
      });
    }

    // Create customer in Saleor
    const mutation = `
      mutation CreateCustomer($input: UserCreateInput!) {
        customerCreate(input: $input) {
          user {
            id
            email
            firstName
            lastName
            isActive
            dateJoined
          }
          errors {
            field
            message
            code
          }
        }
      }
    `;

    const result = await ctx.apiClient!.mutation(mutation, {
      input: {
        email: input.email,
        firstName: input.firstName,
        lastName: input.lastName,
        note: input.note,
        isActive: true,
      },
    });

    if (result.data?.customerCreate?.errors?.length > 0) {
      const error = result.data.customerCreate.errors[0];
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: error.message || `Failed to create customer: ${error.field}`,
      });
    }

    const newCustomer = result.data?.customerCreate?.user;

    if (!newCustomer) {
      throw new TRPCError({
        code: "INTERNAL_SERVER_ERROR",
        message: "Failed to create customer",
      });
    }

    // Initialize store credit account with zero balance
    await ctx.prisma.customerCredit.create({
      data: {
        installationId: ctx.installationId,
        saleorCustomerId: newCustomer.id,
        balance: 0,
        currency: "USD",
      },
    });

    logger.info("Customer created", {
      customerId: newCustomer.id,
      email: newCustomer.email,
    });

    return {
      ...newCustomer,
      displayName: `${newCustomer.firstName} ${newCustomer.lastName}`.trim() || newCustomer.email,
      storeCredit: { balance: 0, currency: "USD" },
    };
  }),

  /**
   * Attach a customer to a buylist
   */
  attachToBuylist: protectedClientProcedure
    .input(attachCustomerSchema)
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

      if (buylist.status === "COMPLETED" || buylist.status === "CANCELLED") {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `Cannot modify a ${buylist.status.toLowerCase()} buylist`,
        });
      }

      // Verify customer exists in Saleor
      const customerResult = await ctx.apiClient!.query(
        `
        query GetCustomerBasic($id: ID!) {
          user(id: $id) {
            id
            email
            firstName
            lastName
          }
        }
      `,
        { id: input.customerId }
      );

      if (!customerResult.data?.user) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Customer not found in Saleor",
        });
      }

      const customer = customerResult.data.user;

      // Update buylist with customer info
      const updatedBuylist = await ctx.prisma.buylist.update({
        where: { id: buylist.id },
        data: {
          saleorUserId: customer.id,
          customerName: `${customer.firstName} ${customer.lastName}`.trim() || null,
          customerEmail: customer.email,
        },
        include: {
          lines: true,
        },
      });

      // Create audit event
      await ctx.prisma.buylistAuditEvent.create({
        data: {
          buylistId: buylist.id,
          action: "CUSTOMER_ATTACHED",
          userId: getUserId(ctx),
          metadata: {
            customerId: customer.id,
            customerEmail: customer.email,
          },
        },
      });

      logger.info("Customer attached to buylist", {
        buylistId: buylist.id,
        customerId: customer.id,
      });

      return updatedBuylist;
    }),

  /**
   * Remove customer from buylist (switch to anonymous)
   */
  detachFromBuylist: protectedClientProcedure
    .input(z.object({ buylistId: z.string().uuid() }))
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

      if (buylist.status === "COMPLETED" || buylist.status === "CANCELLED") {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `Cannot modify a ${buylist.status.toLowerCase()} buylist`,
        });
      }

      if (!buylist.saleorUserId) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "No customer attached to this buylist",
        });
      }

      // Check if payout method is store credit - can't detach in that case
      if (buylist.payoutMethod === "STORE_CREDIT") {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Cannot remove customer from a buylist with store credit payout. Change payout method first.",
        });
      }

      const previousCustomerId = buylist.saleorUserId;

      // Clear customer info
      const updatedBuylist = await ctx.prisma.buylist.update({
        where: { id: buylist.id },
        data: {
          saleorUserId: null,
          customerName: null,
          customerEmail: null,
          customerPhone: null,
        },
        include: {
          lines: true,
        },
      });

      // Create audit event
      await ctx.prisma.buylistAuditEvent.create({
        data: {
          buylistId: buylist.id,
          action: "CUSTOMER_DETACHED",
          userId: getUserId(ctx),
          metadata: {
            previousCustomerId,
          },
        },
      });

      return updatedBuylist;
    }),

  /**
   * Get store credit balance for a customer
   */
  getCreditBalance: protectedClientProcedure
    .input(z.object({ customerId: z.string().min(1) }))
    .query(async ({ ctx, input }) => {
      const credit = await ctx.prisma.customerCredit.findUnique({
        where: {
          installationId_saleorCustomerId: {
            installationId: ctx.installationId,
            saleorCustomerId: input.customerId,
          },
        },
      });

      return {
        customerId: input.customerId,
        balance: credit?.balance.toNumber() ?? 0,
        currency: credit?.currency ?? "USD",
        hasAccount: !!credit,
      };
    }),

  /**
   * Get credit transaction history for a customer
   */
  getCreditHistory: protectedClientProcedure
    .input(
      z.object({
        customerId: z.string().min(1),
        limit: z.number().min(1).max(100).optional().default(20),
        offset: z.number().min(0).optional().default(0),
      })
    )
    .query(async ({ ctx, input }) => {
      const credit = await ctx.prisma.customerCredit.findUnique({
        where: {
          installationId_saleorCustomerId: {
            installationId: ctx.installationId,
            saleorCustomerId: input.customerId,
          },
        },
      });

      if (!credit) {
        return {
          customerId: input.customerId,
          balance: 0,
          currency: "USD",
          transactions: [],
          total: 0,
          hasMore: false,
        };
      }

      const [transactions, total] = await Promise.all([
        ctx.prisma.creditTransaction.findMany({
          where: { creditAccountId: credit.id },
          orderBy: { createdAt: "desc" },
          take: input.limit,
          skip: input.offset,
        }),
        ctx.prisma.creditTransaction.count({
          where: { creditAccountId: credit.id },
        }),
      ]);

      return {
        customerId: input.customerId,
        balance: credit.balance.toNumber(),
        currency: credit.currency,
        transactions: transactions.map((tx) => ({
          ...tx,
          amount: tx.amount.toNumber(),
          balanceAfter: tx.balanceAfter.toNumber(),
        })),
        total,
        hasMore: input.offset + transactions.length < total,
      };
    }),

  /**
   * Issue store credit to a customer (from buylist payout)
   * This is called when a buylist is completed with STORE_CREDIT payout method
   */
  issueCredit: protectedClientProcedure
    .input(
      z.object({
        customerId: z.string().min(1),
        amount: z.number().positive(),
        currency: z.string().length(3).default("USD"),
        buylistId: z.string().uuid().optional(),
        note: z.string().max(500).optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      // Get or create credit account
      let credit = await ctx.prisma.customerCredit.findUnique({
        where: {
          installationId_saleorCustomerId: {
            installationId: ctx.installationId,
            saleorCustomerId: input.customerId,
          },
        },
      });

      const previousBalance = credit?.balance.toNumber() ?? 0;
      const newBalance = previousBalance + input.amount;

      if (!credit) {
        credit = await ctx.prisma.customerCredit.create({
          data: {
            installationId: ctx.installationId,
            saleorCustomerId: input.customerId,
            balance: newBalance,
            currency: input.currency,
          },
        });
      } else {
        credit = await ctx.prisma.customerCredit.update({
          where: { id: credit.id },
          data: { balance: newBalance },
        });
      }

      // Record credit transaction
      const transaction = await ctx.prisma.creditTransaction.create({
        data: {
          creditAccountId: credit.id,
          transactionType: "BUYLIST_PAYOUT",
          amount: input.amount, // Positive for credit
          currency: input.currency,
          balanceAfter: newBalance,
          sourceBuylistId: input.buylistId ?? null,
          note: input.note ?? `Store credit from buylist${input.buylistId ? ` #${input.buylistId}` : ""}`,
          createdBy: getUserId(ctx),
        },
      });

      logger.info("Store credit issued", {
        customerId: input.customerId,
        amount: input.amount,
        newBalance,
        buylistId: input.buylistId,
      });

      return {
        credit: {
          ...credit,
          balance: credit.balance.toNumber(),
        },
        transaction: {
          ...transaction,
          amount: transaction.amount.toNumber(),
          balanceAfter: transaction.balanceAfter.toNumber(),
        },
        previousBalance,
        newBalance,
      };
    }),

  /**
   * Adjust store credit (manual adjustment by staff)
   */
  adjustCredit: protectedClientProcedure
    .input(
      z.object({
        customerId: z.string().min(1),
        amount: z.number(), // Can be positive (add) or negative (deduct)
        reason: z.string().min(1).max(500),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const credit = await ctx.prisma.customerCredit.findUnique({
        where: {
          installationId_saleorCustomerId: {
            installationId: ctx.installationId,
            saleorCustomerId: input.customerId,
          },
        },
      });

      if (!credit) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Customer has no store credit account. Issue credit first.",
        });
      }

      const previousBalance = credit.balance.toNumber();
      const newBalance = previousBalance + input.amount;

      if (newBalance < 0) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `Cannot reduce balance below zero. Current balance: $${previousBalance.toFixed(2)}, adjustment: $${input.amount.toFixed(2)}`,
        });
      }

      // Update balance
      const updatedCredit = await ctx.prisma.customerCredit.update({
        where: { id: credit.id },
        data: { balance: newBalance },
      });

      // Record adjustment transaction
      const transaction = await ctx.prisma.creditTransaction.create({
        data: {
          creditAccountId: credit.id,
          transactionType: "ADJUSTMENT",
          amount: input.amount,
          currency: credit.currency,
          balanceAfter: newBalance,
          note: input.reason,
          createdBy: getUserId(ctx),
        },
      });

      logger.info("Store credit adjusted", {
        customerId: input.customerId,
        amount: input.amount,
        previousBalance,
        newBalance,
        reason: input.reason,
      });

      return {
        credit: {
          ...updatedCredit,
          balance: updatedCredit.balance.toNumber(),
        },
        transaction: {
          ...transaction,
          amount: transaction.amount.toNumber(),
          balanceAfter: transaction.balanceAfter.toNumber(),
        },
        previousBalance,
        newBalance,
      };
    }),

  /**
   * Lookup customer by exact email (for quick attach)
   */
  lookupByEmail: protectedClientProcedure
    .input(z.object({ email: z.string().email() }))
    .query(async ({ ctx, input }) => {
      const query = `
        ${CUSTOMER_FRAGMENT}
        query LookupCustomerByEmail($email: String!) {
          customers(first: 1, filter: { search: $email }) {
            edges {
              node {
                ...CustomerFields
              }
            }
          }
        }
      `;

      const result = await ctx.apiClient!.query(query, { email: input.email });

      const customers = result.data?.customers?.edges ?? [];
      const exactMatch = customers.find(
        (edge: { node: SaleorCustomer }) =>
          edge.node.email.toLowerCase() === input.email.toLowerCase()
      );

      if (!exactMatch) {
        return null;
      }

      const customer = exactMatch.node as SaleorCustomer;

      // Get store credit
      const credit = await ctx.prisma.customerCredit.findUnique({
        where: {
          installationId_saleorCustomerId: {
            installationId: ctx.installationId,
            saleorCustomerId: customer.id,
          },
        },
      });

      return {
        ...customer,
        displayName: `${customer.firstName} ${customer.lastName}`.trim() || customer.email,
        phone: customer.defaultShippingAddress?.phone ?? null,
        storeCredit: {
          balance: credit?.balance.toNumber() ?? 0,
          currency: credit?.currency ?? "USD",
        },
      };
    }),
});
