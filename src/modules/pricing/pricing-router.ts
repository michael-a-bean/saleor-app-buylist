import { TRPCError } from "@trpc/server";
import { Decimal } from "decimal.js";
import { z } from "zod";

import { createInstrumentedGraphqlClient } from "@/lib/graphql-client";
import { saleorApp } from "@/lib/saleor-app";
import { protectedClientProcedure } from "@/modules/trpc/protected-client-procedure";
import { router } from "@/modules/trpc/trpc-server";
import { AttributeCacheService } from "./attribute-cache";
import { attributesRouter } from "./attributes-router";
import { ruleEngine, type ProductAttributes } from "./rule-engine";
import { rulesRouter } from "./rules-router";

// Condition multiplier schema
const conditionMultipliersSchema = z.object({
  NM: z.number().min(0).max(2).optional().default(1.0),
  LP: z.number().min(0).max(2).optional().default(0.9),
  MP: z.number().min(0).max(2).optional().default(0.75),
  HP: z.number().min(0).max(2).optional().default(0.5),
  DMG: z.number().min(0).max(2).optional().default(0.25),
});

// Tiered rule schema
const tieredRuleSchema = z.object({
  minValue: z.number().min(0),
  maxValue: z.number().min(0).nullable(), // null = no upper limit
  percentage: z.number().min(0).max(100),
});

// Pricing policy create schema
const pricingPolicyCreateSchema = z.object({
  name: z.string().min(1, "Name is required").max(100),
  description: z.string().max(500).optional().nullable(),
  isDefault: z.boolean().optional().default(false),
  isActive: z.boolean().optional().default(true),
  policyType: z.enum(["PERCENTAGE", "FIXED_DISCOUNT", "TIERED", "CUSTOM"]),
  basePercentage: z.number().min(0).max(100).optional().nullable(),
  conditionMultipliers: conditionMultipliersSchema.optional().nullable(),
  tieredRules: z.array(tieredRuleSchema).optional().nullable(),
  minimumPrice: z.number().min(0).optional().nullable(),
  maximumPrice: z.number().min(0).optional().nullable(),
  categoryOverrides: z.record(z.string(), z.number()).optional().nullable(),
});

const pricingPolicyUpdateSchema = pricingPolicyCreateSchema.partial();

const searchSchema = z.object({
  query: z.string().optional(),
  isActive: z.boolean().optional(),
  limit: z.number().min(1).max(100).optional().default(50),
  offset: z.number().min(0).optional().default(0),
});

/**
 * Default condition multipliers for TCG-style grading
 */
export const DEFAULT_CONDITION_MULTIPLIERS = {
  NM: 1.0,    // Near Mint: 100% of base offer
  LP: 0.9,    // Lightly Played: 90%
  MP: 0.75,   // Moderately Played: 75%
  HP: 0.5,    // Heavily Played: 50%
  DMG: 0.25,  // Damaged: 25%
};

/**
 * Pricing Policies Router - Manage buylist pricing rules
 */
export const pricingRouter = router({
  /**
   * List all pricing policies with optional filtering
   */
  list: protectedClientProcedure.input(searchSchema.optional()).query(async ({ ctx, input }) => {
    const where = {
      installationId: ctx.installationId,
      ...(input?.isActive !== undefined && { isActive: input.isActive }),
      ...(input?.query && {
        OR: [
          { name: { contains: input.query, mode: "insensitive" as const } },
          { description: { contains: input.query, mode: "insensitive" as const } },
        ],
      }),
    };

    const [policies, total] = await Promise.all([
      ctx.prisma.buylistPricingPolicy.findMany({
        where,
        orderBy: [{ isDefault: "desc" }, { name: "asc" }],
        take: input?.limit ?? 50,
        skip: input?.offset ?? 0,
        include: {
          _count: {
            select: { buylists: true, rules: true },
          },
        },
      }),
      ctx.prisma.buylistPricingPolicy.count({ where }),
    ]);

    return {
      policies,
      total,
      hasMore: (input?.offset ?? 0) + policies.length < total,
    };
  }),

  /**
   * Get a single pricing policy by ID
   */
  getById: protectedClientProcedure
    .input(z.object({ id: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const policy = await ctx.prisma.buylistPricingPolicy.findFirst({
        where: {
          id: input.id,
          installationId: ctx.installationId,
        },
        include: {
          _count: {
            select: { buylists: true, rules: true },
          },
        },
      });

      if (!policy) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Pricing policy not found",
        });
      }

      return policy;
    }),

  /**
   * Get the default pricing policy
   */
  getDefault: protectedClientProcedure.query(async ({ ctx }) => {
    const policy = await ctx.prisma.buylistPricingPolicy.findFirst({
      where: {
        installationId: ctx.installationId,
        isDefault: true,
        isActive: true,
      },
    });

    return policy;
  }),

  /**
   * Create a new pricing policy
   */
  create: protectedClientProcedure.input(pricingPolicyCreateSchema).mutation(async ({ ctx, input }) => {
    // Check for duplicate name
    const existing = await ctx.prisma.buylistPricingPolicy.findFirst({
      where: {
        installationId: ctx.installationId,
        name: input.name,
      },
    });

    if (existing) {
      throw new TRPCError({
        code: "CONFLICT",
        message: `Pricing policy with name "${input.name}" already exists`,
      });
    }

    // Validate policy type specific requirements
    validatePolicyTypeRequirements(input.policyType, input);

    // If this is being set as default, unset any existing default
    if (input.isDefault) {
      await ctx.prisma.buylistPricingPolicy.updateMany({
        where: {
          installationId: ctx.installationId,
          isDefault: true,
        },
        data: { isDefault: false },
      });
    }

    const policy = await ctx.prisma.buylistPricingPolicy.create({
      data: {
        installationId: ctx.installationId,
        name: input.name,
        description: input.description ?? null,
        isDefault: input.isDefault ?? false,
        isActive: input.isActive ?? true,
        policyType: input.policyType,
        basePercentage: input.basePercentage ? new Decimal(input.basePercentage) : null,
        conditionMultipliers: input.conditionMultipliers ?? DEFAULT_CONDITION_MULTIPLIERS,
        tieredRules: input.tieredRules ? JSON.parse(JSON.stringify(input.tieredRules)) : undefined,
        minimumPrice: input.minimumPrice ? new Decimal(input.minimumPrice) : null,
        maximumPrice: input.maximumPrice ? new Decimal(input.maximumPrice) : null,
        categoryOverrides: input.categoryOverrides ? JSON.parse(JSON.stringify(input.categoryOverrides)) : undefined,
      },
    });

    return policy;
  }),

  /**
   * Update an existing pricing policy
   */
  update: protectedClientProcedure
    .input(
      z.object({
        id: z.string().uuid(),
        data: pricingPolicyUpdateSchema,
      })
    )
    .mutation(async ({ ctx, input }) => {
      const existing = await ctx.prisma.buylistPricingPolicy.findFirst({
        where: {
          id: input.id,
          installationId: ctx.installationId,
        },
      });

      if (!existing) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Pricing policy not found",
        });
      }

      // Check for duplicate name if changing
      if (input.data.name && input.data.name !== existing.name) {
        const duplicate = await ctx.prisma.buylistPricingPolicy.findFirst({
          where: {
            installationId: ctx.installationId,
            name: input.data.name,
            id: { not: input.id },
          },
        });

        if (duplicate) {
          throw new TRPCError({
            code: "CONFLICT",
            message: `Pricing policy with name "${input.data.name}" already exists`,
          });
        }
      }

      // Validate policy type specific requirements
      const policyType = input.data.policyType ?? existing.policyType;
      const tieredRules = input.data.tieredRules ?? (existing.tieredRules as Array<{ minValue: number; maxValue: number | null; percentage: number }> | null);
      validatePolicyTypeRequirements(policyType, {
        basePercentage: input.data.basePercentage ?? (existing.basePercentage?.toNumber() ?? null),
        tieredRules,
      });

      // If this is being set as default, unset any existing default
      if (input.data.isDefault && !existing.isDefault) {
        await ctx.prisma.buylistPricingPolicy.updateMany({
          where: {
            installationId: ctx.installationId,
            isDefault: true,
            id: { not: input.id },
          },
          data: { isDefault: false },
        });
      }

      const policy = await ctx.prisma.buylistPricingPolicy.update({
        where: { id: input.id },
        data: {
          ...(input.data.name !== undefined && { name: input.data.name }),
          ...(input.data.description !== undefined && { description: input.data.description }),
          ...(input.data.isDefault !== undefined && { isDefault: input.data.isDefault }),
          ...(input.data.isActive !== undefined && { isActive: input.data.isActive }),
          ...(input.data.policyType !== undefined && { policyType: input.data.policyType }),
          ...(input.data.basePercentage !== undefined && {
            basePercentage: input.data.basePercentage ? new Decimal(input.data.basePercentage) : null,
          }),
          ...(input.data.conditionMultipliers !== undefined && {
            conditionMultipliers: input.data.conditionMultipliers ? JSON.parse(JSON.stringify(input.data.conditionMultipliers)) : undefined,
          }),
          ...(input.data.tieredRules !== undefined && {
            tieredRules: input.data.tieredRules ? JSON.parse(JSON.stringify(input.data.tieredRules)) : undefined,
          }),
          ...(input.data.minimumPrice !== undefined && {
            minimumPrice: input.data.minimumPrice ? new Decimal(input.data.minimumPrice) : null,
          }),
          ...(input.data.maximumPrice !== undefined && {
            maximumPrice: input.data.maximumPrice ? new Decimal(input.data.maximumPrice) : null,
          }),
          ...(input.data.categoryOverrides !== undefined && {
            categoryOverrides: input.data.categoryOverrides ? JSON.parse(JSON.stringify(input.data.categoryOverrides)) : undefined,
          }),
        },
      });

      return policy;
    }),

  /**
   * Delete a pricing policy
   */
  delete: protectedClientProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const existing = await ctx.prisma.buylistPricingPolicy.findFirst({
        where: {
          id: input.id,
          installationId: ctx.installationId,
        },
        include: {
          _count: {
            select: { buylists: true },
          },
        },
      });

      if (!existing) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Pricing policy not found",
        });
      }

      if (existing._count.buylists > 0) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: `Cannot delete policy with ${existing._count.buylists} associated buylist(s). Deactivate it instead.`,
        });
      }

      await ctx.prisma.buylistPricingPolicy.delete({
        where: { id: input.id },
      });

      return { success: true };
    }),

  /**
   * Set a policy as the default
   */
  setDefault: protectedClientProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const existing = await ctx.prisma.buylistPricingPolicy.findFirst({
        where: {
          id: input.id,
          installationId: ctx.installationId,
        },
      });

      if (!existing) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Pricing policy not found",
        });
      }

      if (!existing.isActive) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "Cannot set an inactive policy as default",
        });
      }

      // Unset current default
      await ctx.prisma.buylistPricingPolicy.updateMany({
        where: {
          installationId: ctx.installationId,
          isDefault: true,
        },
        data: { isDefault: false },
      });

      // Set new default
      const policy = await ctx.prisma.buylistPricingPolicy.update({
        where: { id: input.id },
        data: { isDefault: true },
      });

      return policy;
    }),

  /**
   * Calculate buy price for a card based on a policy
   * Supports dynamic pricing rules attached to the policy
   */
  calculatePrice: protectedClientProcedure
    .input(
      z.object({
        policyId: z.string().uuid().optional(),
        marketPrice: z.number().min(0),
        condition: z.enum(["NM", "LP", "MP", "HP", "DMG"]),
        categoryId: z.string().optional(),
        // Optional product attributes for rule evaluation
        variantId: z.string().optional(),
        productId: z.string().optional(),
        attributes: z.object({
          setCode: z.string().optional(),
          setName: z.string().optional(),
          rarity: z.string().optional(),
          finish: z.string().optional(),
          cardType: z.string().optional(),
          formatLegality: z.record(z.string(), z.boolean()).optional(),
        }).optional(),
        // Optional inventory data for rule evaluation
        qtyOnHand: z.number().int().min(0).optional(),
        // Whether to fetch attributes from cache when variantId is provided (default: true)
        useCachedAttributes: z.boolean().default(true),
      })
    )
    .query(async ({ ctx, input }) => {
      // Get policy with rules (use specified or default)
      let policy;
      if (input.policyId) {
        policy = await ctx.prisma.buylistPricingPolicy.findFirst({
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
      } else {
        policy = await ctx.prisma.buylistPricingPolicy.findFirst({
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

      if (!policy) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "No pricing policy found",
        });
      }

      // Build product attributes for rule evaluation
      // First, try to get cached attributes if variantId is provided and useCachedAttributes is true
      let cachedAttrs: Record<string, unknown> = {};
      let cachedQtyOnHand: number | undefined;

      if (input.variantId && input.useCachedAttributes) {
        try {
          const authData = await saleorApp.apl.get(ctx.saleorApiUrl);
          if (authData) {
            const gqlClient = createInstrumentedGraphqlClient({
              saleorApiUrl: authData.saleorApiUrl,
              token: authData.token,
            });
            const cacheService = new AttributeCacheService(
              ctx.prisma,
              gqlClient,
              ctx.installationId
            );
            const result = await cacheService.getAttributes(input.variantId);
            if (result.success && result.cached) {
              cachedAttrs = {
                setCode: result.cached.setCode,
                setName: result.cached.setName,
                rarity: result.cached.rarity,
                finish: result.cached.finish,
                cardType: result.cached.cardType,
                formatLegality: result.cached.formatLegality,
              };
              cachedQtyOnHand = result.cached.qtyOnHand;
            }
          }
        } catch {
          // Cache fetch failed, continue without cached attributes
        }
      }

      // Merge: explicit attributes override cached, cached overrides empty
      const productAttributes: ProductAttributes = {
        variantId: input.variantId ?? "",
        productId: input.productId ?? "",
        categoryId: input.categoryId,
        ...cachedAttrs,
        ...input.attributes, // Explicit attributes override cached
      };

      // Determine inventory data: explicit input > cached > undefined
      const qtyOnHand = input.qtyOnHand ?? cachedQtyOnHand;
      const inventoryData = qtyOnHand !== undefined ? { qtyOnHand } : undefined;

      // Use the rule engine to calculate the price
      const result = ruleEngine.calculatePrice({
        policy,
        rules: policy.rules,
        marketPrice: input.marketPrice,
        condition: input.condition,
        attributes: productAttributes,
        inventory: inventoryData,
        categoryId: input.categoryId,
      });

      return {
        policyId: result.policyId,
        policyName: result.policyName,
        marketPrice: result.marketPrice,
        condition: result.condition,
        baseOffer: Math.round(result.baseOffer * 100) / 100,
        conditionMultiplier: result.conditionMultiplier,
        finalOffer: result.finalOffer,
        // Rule application details
        appliedRules: result.appliedRules,
        constraintsApplied: result.constraintsApplied,
        // Attribute source info
        usedCachedAttributes: Object.keys(cachedAttrs).length > 0,
      };
    }),

  /**
   * Bulk calculate prices for multiple items
   * Supports dynamic pricing rules attached to the policy
   */
  calculatePrices: protectedClientProcedure
    .input(
      z.object({
        policyId: z.string().uuid().optional(),
        items: z.array(
          z.object({
            variantId: z.string(),
            productId: z.string().optional(),
            marketPrice: z.number().min(0),
            condition: z.enum(["NM", "LP", "MP", "HP", "DMG"]),
            categoryId: z.string().optional(),
            // Optional product attributes for rule evaluation
            attributes: z.object({
              setCode: z.string().optional(),
              setName: z.string().optional(),
              rarity: z.string().optional(),
              finish: z.string().optional(),
              cardType: z.string().optional(),
              formatLegality: z.record(z.string(), z.boolean()).optional(),
            }).optional(),
            // Optional inventory data
            qtyOnHand: z.number().int().min(0).optional(),
          })
        ),
        // Whether to fetch attributes from cache (default: true)
        useCachedAttributes: z.boolean().default(true),
      })
    )
    .query(async ({ ctx, input }) => {
      // Get policy with rules
      let policy;
      if (input.policyId) {
        policy = await ctx.prisma.buylistPricingPolicy.findFirst({
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
      } else {
        policy = await ctx.prisma.buylistPricingPolicy.findFirst({
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

      if (!policy) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "No pricing policy found",
        });
      }

      // Batch fetch cached attributes if enabled
      type CachedAttrMap = Map<string, { attrs: Record<string, unknown>; qtyOnHand?: number }>;
      let cachedAttrsMap: CachedAttrMap = new Map();

      if (input.useCachedAttributes) {
        try {
          const authData = await saleorApp.apl.get(ctx.saleorApiUrl);
          if (authData) {
            const gqlClient = createInstrumentedGraphqlClient({
              saleorApiUrl: authData.saleorApiUrl,
              token: authData.token,
            });
            const cacheService = new AttributeCacheService(
              ctx.prisma,
              gqlClient,
              ctx.installationId
            );

            // Get all variant IDs that need cache lookup
            const variantIds = input.items
              .filter((item) => !item.attributes) // Only fetch for items without explicit attrs
              .map((item) => item.variantId);

            if (variantIds.length > 0) {
              const cachedBulk = await cacheService.getCachedBulk(variantIds);
              for (const [variantId, cached] of cachedBulk) {
                cachedAttrsMap.set(variantId, {
                  attrs: {
                    setCode: cached.setCode,
                    setName: cached.setName,
                    rarity: cached.rarity,
                    finish: cached.finish,
                    cardType: cached.cardType,
                    formatLegality: cached.formatLegality,
                  },
                  qtyOnHand: cached.qtyOnHand,
                });
              }
            }
          }
        } catch {
          // Cache fetch failed, continue without cached attributes
        }
      }

      // Calculate prices for each item using the rule engine
      const results = input.items.map((item) => {
        // Get cached attributes if available and no explicit attrs provided
        const cachedData = cachedAttrsMap.get(item.variantId);

        // Build product attributes for rule evaluation
        const productAttributes: ProductAttributes = {
          variantId: item.variantId,
          productId: item.productId ?? "",
          categoryId: item.categoryId,
          ...(cachedData?.attrs ?? {}),
          ...item.attributes, // Explicit attributes override cached
        };

        // Determine inventory: explicit > cached > undefined
        const qtyOnHand = item.qtyOnHand ?? cachedData?.qtyOnHand;
        const inventoryData = qtyOnHand !== undefined ? { qtyOnHand } : undefined;

        // Use the rule engine
        const result = ruleEngine.calculatePrice({
          policy,
          rules: policy.rules,
          marketPrice: item.marketPrice,
          condition: item.condition,
          attributes: productAttributes,
          inventory: inventoryData,
          categoryId: item.categoryId,
        });

        return {
          variantId: item.variantId,
          marketPrice: item.marketPrice,
          condition: item.condition,
          finalOffer: result.finalOffer,
          appliedRules: result.appliedRules,
          usedCachedAttributes: !!cachedData && !item.attributes,
        };
      });

      return {
        policyId: policy.id,
        policyName: policy.name,
        results,
      };
    }),

  /**
   * Pricing rules sub-router
   * Provides endpoints for managing dynamic pricing rules
   */
  rules: rulesRouter,

  /**
   * Product attributes cache sub-router
   * Provides endpoints for caching and querying product attributes from Saleor
   */
  attributes: attributesRouter,
});

/**
 * Validate that required fields are present for each policy type
 */
function validatePolicyTypeRequirements(
  policyType: string,
  input: {
    basePercentage?: number | null;
    tieredRules?: Array<{ minValue: number; maxValue: number | null; percentage: number }> | null;
  }
) {
  switch (policyType) {
    case "PERCENTAGE":
      if (input.basePercentage === null || input.basePercentage === undefined) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "PERCENTAGE policy type requires basePercentage",
        });
      }
      break;

    case "FIXED_DISCOUNT":
      if (input.basePercentage === null || input.basePercentage === undefined) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "FIXED_DISCOUNT policy type requires basePercentage (the discount amount)",
        });
      }
      break;

    case "TIERED":
      if (!input.tieredRules || input.tieredRules.length === 0) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "TIERED policy type requires at least one tiered rule",
        });
      }
      break;

    case "CUSTOM":
      // Custom policies have no specific requirements
      break;
  }
}
