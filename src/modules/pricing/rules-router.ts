/**
 * Pricing Rules Router
 *
 * tRPC endpoints for managing pricing rules attached to policies.
 * Provides CRUD operations and utility functions for rule management.
 */

import type { Prisma } from "@prisma/client";
import { TRPCError } from "@trpc/server";
import { z } from "zod";

import { protectedClientProcedure } from "@/modules/trpc/protected-client-procedure";
import { router } from "@/modules/trpc/trpc-server";
import {
  conditionEvaluator,
  ruleEngine,
  type PricingRuleConditionGroup,
  type ProductAttributes,
} from "./rule-engine";

// ============================================================================
// SCHEMAS
// ============================================================================

/**
 * Schema for a single condition
 */
const conditionSchema = z.object({
  type: z.enum(["ATTRIBUTE", "MARKET_PRICE", "INVENTORY", "DATE", "CATEGORY"]),
  field: z.string().min(1),
  operator: z.enum([
    "EQUALS",
    "NOT_EQUALS",
    "GREATER_THAN",
    "GREATER_THAN_OR_EQUALS",
    "LESS_THAN",
    "LESS_THAN_OR_EQUALS",
    "IN",
    "NOT_IN",
    "CONTAINS",
    "BETWEEN",
  ]),
  value: z.union([
    z.string(),
    z.number(),
    z.boolean(),
    z.array(z.string()),
    z.array(z.number()),
    z.tuple([z.number(), z.number()]),
  ]),
});

/**
 * Schema for a condition group (recursive via lazy)
 */
const conditionGroupSchema: z.ZodType<PricingRuleConditionGroup> = z.lazy(() =>
  z.object({
    operator: z.enum(["AND", "OR"]),
    conditions: z.array(z.union([conditionSchema, conditionGroupSchema])),
  })
);

/**
 * Schema for creating a pricing rule
 */
const createRuleSchema = z.object({
  policyId: z.string().uuid(),
  name: z.string().min(1).max(100),
  description: z.string().max(500).optional().nullable(),
  priority: z.number().int().min(0).max(10000).optional().default(100),
  conditions: conditionGroupSchema,
  actionType: z.enum([
    "PERCENTAGE_MODIFIER",
    "FIXED_MODIFIER",
    "SET_PERCENTAGE",
    "SET_MINIMUM",
    "SET_MAXIMUM",
  ]),
  actionValue: z.number(),
  stackingMode: z.enum(["MULTIPLICATIVE", "ADDITIVE"]).optional().default("MULTIPLICATIVE"),
  startsAt: z.date().optional().nullable(),
  endsAt: z.date().optional().nullable(),
  isActive: z.boolean().optional().default(true),
});

/**
 * Schema for updating a pricing rule
 */
const updateRuleSchema = createRuleSchema.partial().omit({ policyId: true });

/**
 * Schema for listing rules
 */
const listRulesSchema = z.object({
  policyId: z.string().uuid(),
  isActive: z.boolean().optional(),
  search: z.string().optional(),
  limit: z.number().min(1).max(100).optional().default(50),
  offset: z.number().min(0).optional().default(0),
});

// ============================================================================
// ROUTER
// ============================================================================

export const rulesRouter = router({
  /**
   * List rules for a policy
   */
  list: protectedClientProcedure
    .input(listRulesSchema)
    .query(async ({ ctx, input }) => {
      const where = {
        installationId: ctx.installationId,
        policyId: input.policyId,
        ...(input.isActive !== undefined && { isActive: input.isActive }),
        ...(input.search && {
          OR: [
            { name: { contains: input.search, mode: "insensitive" as const } },
            { description: { contains: input.search, mode: "insensitive" as const } },
          ],
        }),
      };

      const [rules, total] = await Promise.all([
        ctx.prisma.pricingRule.findMany({
          where,
          orderBy: { priority: "asc" },
          take: input.limit,
          skip: input.offset,
        }),
        ctx.prisma.pricingRule.count({ where }),
      ]);

      return {
        rules,
        total,
        hasMore: input.offset + rules.length < total,
      };
    }),

  /**
   * Get a single rule by ID
   */
  getById: protectedClientProcedure
    .input(z.object({ id: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const rule = await ctx.prisma.pricingRule.findFirst({
        where: {
          id: input.id,
          installationId: ctx.installationId,
        },
        include: {
          policy: {
            select: {
              id: true,
              name: true,
            },
          },
        },
      });

      if (!rule) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Rule not found",
        });
      }

      return rule;
    }),

  /**
   * Create a new pricing rule
   */
  create: protectedClientProcedure
    .input(createRuleSchema)
    .mutation(async ({ ctx, input }) => {
      // Verify policy exists and belongs to installation
      const policy = await ctx.prisma.buylistPricingPolicy.findFirst({
        where: {
          id: input.policyId,
          installationId: ctx.installationId,
        },
      });

      if (!policy) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Policy not found",
        });
      }

      // Validate conditions
      const validationResult = conditionEvaluator.validateCondition(input.conditions);
      if (!validationResult.valid) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `Invalid conditions: ${validationResult.errors.join(", ")}`,
        });
      }

      // Validate date range if both provided
      if (input.startsAt && input.endsAt && input.startsAt >= input.endsAt) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Start date must be before end date",
        });
      }

      const rule = await ctx.prisma.pricingRule.create({
        data: {
          installationId: ctx.installationId,
          policyId: input.policyId,
          name: input.name,
          description: input.description,
          priority: input.priority,
          conditions: input.conditions as unknown as Prisma.InputJsonValue,
          actionType: input.actionType,
          actionValue: input.actionValue,
          stackingMode: input.stackingMode,
          startsAt: input.startsAt,
          endsAt: input.endsAt,
          isActive: input.isActive,
        },
      });

      return rule;
    }),

  /**
   * Update an existing pricing rule
   */
  update: protectedClientProcedure
    .input(
      z.object({
        id: z.string().uuid(),
        ...updateRuleSchema.shape,
      })
    )
    .mutation(async ({ ctx, input }) => {
      const { id, ...data } = input;

      // Verify rule exists
      const existingRule = await ctx.prisma.pricingRule.findFirst({
        where: {
          id,
          installationId: ctx.installationId,
        },
      });

      if (!existingRule) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Rule not found",
        });
      }

      // Validate conditions if provided
      if (data.conditions) {
        const validationResult = conditionEvaluator.validateCondition(data.conditions);
        if (!validationResult.valid) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: `Invalid conditions: ${validationResult.errors.join(", ")}`,
          });
        }
      }

      // Validate date range
      const startsAt = data.startsAt !== undefined ? data.startsAt : existingRule.startsAt;
      const endsAt = data.endsAt !== undefined ? data.endsAt : existingRule.endsAt;
      if (startsAt && endsAt && startsAt >= endsAt) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Start date must be before end date",
        });
      }

      // Build update data with proper JSON typing
      const { conditions, ...restData } = data;
      const updateData: Prisma.PricingRuleUpdateInput = {
        ...restData,
        ...(conditions && { conditions: conditions as unknown as Prisma.InputJsonValue }),
      };

      const rule = await ctx.prisma.pricingRule.update({
        where: { id },
        data: updateData,
      });

      return rule;
    }),

  /**
   * Delete a pricing rule
   */
  delete: protectedClientProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const rule = await ctx.prisma.pricingRule.findFirst({
        where: {
          id: input.id,
          installationId: ctx.installationId,
        },
      });

      if (!rule) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Rule not found",
        });
      }

      await ctx.prisma.pricingRule.delete({
        where: { id: input.id },
      });

      return { success: true };
    }),

  /**
   * Reorder rules (bulk update priorities)
   */
  reorder: protectedClientProcedure
    .input(
      z.object({
        policyId: z.string().uuid(),
        ruleIds: z.array(z.string().uuid()),
      })
    )
    .mutation(async ({ ctx, input }) => {
      // Verify all rules exist and belong to the policy
      const rules = await ctx.prisma.pricingRule.findMany({
        where: {
          id: { in: input.ruleIds },
          policyId: input.policyId,
          installationId: ctx.installationId,
        },
      });

      if (rules.length !== input.ruleIds.length) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Some rules not found or do not belong to the specified policy",
        });
      }

      // Update priorities based on position in array
      await ctx.prisma.$transaction(
        input.ruleIds.map((id, index) =>
          ctx.prisma.pricingRule.update({
            where: { id },
            data: { priority: (index + 1) * 10 }, // Use 10, 20, 30... for easier reordering
          })
        )
      );

      return { success: true };
    }),

  /**
   * Toggle rule active status
   */
  toggleActive: protectedClientProcedure
    .input(
      z.object({
        id: z.string().uuid(),
        isActive: z.boolean(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const rule = await ctx.prisma.pricingRule.findFirst({
        where: {
          id: input.id,
          installationId: ctx.installationId,
        },
      });

      if (!rule) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Rule not found",
        });
      }

      const updated = await ctx.prisma.pricingRule.update({
        where: { id: input.id },
        data: { isActive: input.isActive },
      });

      return updated;
    }),

  /**
   * Duplicate a rule
   */
  duplicate: protectedClientProcedure
    .input(
      z.object({
        id: z.string().uuid(),
        newName: z.string().min(1).max(100).optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const rule = await ctx.prisma.pricingRule.findFirst({
        where: {
          id: input.id,
          installationId: ctx.installationId,
        },
      });

      if (!rule) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Rule not found",
        });
      }

      const newRule = await ctx.prisma.pricingRule.create({
        data: {
          installationId: ctx.installationId,
          policyId: rule.policyId,
          name: input.newName ?? `${rule.name} (Copy)`,
          description: rule.description,
          priority: rule.priority + 1, // Place after original
          conditions: rule.conditions as object,
          actionType: rule.actionType,
          actionValue: rule.actionValue,
          stackingMode: rule.stackingMode,
          startsAt: rule.startsAt,
          endsAt: rule.endsAt,
          isActive: false, // Start as inactive
        },
      });

      return newRule;
    }),

  /**
   * Validate conditions syntax
   */
  validate: protectedClientProcedure
    .input(z.object({ conditions: conditionGroupSchema }))
    .query(({ input }) => {
      const result = conditionEvaluator.validateCondition(input.conditions);
      return result;
    }),

  /**
   * Preview rule effect on a sample item
   */
  preview: protectedClientProcedure
    .input(
      z.object({
        policyId: z.string().uuid(),
        ruleId: z.string().uuid().optional(),
        marketPrice: z.number().min(0),
        condition: z.enum(["NM", "LP", "MP", "HP", "DMG"]),
        attributes: z.object({
          variantId: z.string().optional(),
          productId: z.string().optional(),
          setCode: z.string().optional(),
          setName: z.string().optional(),
          rarity: z.string().optional(),
          finish: z.string().optional(),
          cardType: z.string().optional(),
          categoryId: z.string().optional(),
          formatLegality: z.record(z.string(), z.boolean()).optional(),
        }).optional(),
        qtyOnHand: z.number().int().min(0).optional(),
      })
    )
    .query(async ({ ctx, input }) => {
      // Get policy with rules
      const policy = await ctx.prisma.buylistPricingPolicy.findFirst({
        where: {
          id: input.policyId,
          installationId: ctx.installationId,
        },
        include: {
          rules: {
            where: { isActive: true },
            orderBy: { priority: "asc" },
          },
        },
      });

      if (!policy) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Policy not found",
        });
      }

      // If a specific rule is being previewed, include it even if inactive
      let rulesToUse = policy.rules;
      if (input.ruleId) {
        const specificRule = await ctx.prisma.pricingRule.findFirst({
          where: {
            id: input.ruleId,
            installationId: ctx.installationId,
          },
        });
        if (specificRule && !rulesToUse.find(r => r.id === specificRule.id)) {
          rulesToUse = [...rulesToUse, specificRule].sort((a, b) => a.priority - b.priority);
        }
      }

      // Build attributes
      const productAttributes: ProductAttributes = {
        variantId: input.attributes?.variantId ?? "",
        productId: input.attributes?.productId ?? "",
        categoryId: input.attributes?.categoryId,
        setCode: input.attributes?.setCode,
        setName: input.attributes?.setName,
        rarity: input.attributes?.rarity,
        finish: input.attributes?.finish,
        cardType: input.attributes?.cardType,
        formatLegality: input.attributes?.formatLegality,
      };

      // Calculate using rule engine
      const result = ruleEngine.calculatePrice({
        policy,
        rules: rulesToUse,
        marketPrice: input.marketPrice,
        condition: input.condition,
        attributes: productAttributes,
        inventory: input.qtyOnHand !== undefined ? { qtyOnHand: input.qtyOnHand } : undefined,
        categoryId: input.attributes?.categoryId,
      });

      // Also show which rules matched
      const { matching, notMatching } = ruleEngine.previewMatchingRules(
        rulesToUse,
        {
          attributes: productAttributes,
          marketPrice: input.marketPrice,
          condition: input.condition,
          inventory: input.qtyOnHand !== undefined ? { qtyOnHand: input.qtyOnHand } : undefined,
          categoryId: input.attributes?.categoryId,
        }
      );

      return {
        calculation: result,
        matchingRules: matching.map(r => ({ id: r.id, name: r.name, priority: r.priority })),
        notMatchingRules: notMatching.map(r => ({ id: r.id, name: r.name, priority: r.priority })),
      };
    }),
});
