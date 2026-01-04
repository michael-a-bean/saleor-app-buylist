/**
 * Rule Engine Tests
 *
 * Comprehensive tests for the main pricing rule engine orchestrator.
 * Tests the complete flow from policy + rules to final calculated price.
 */
import {
  PricingPolicyType,
  PricingRuleActionType,
  RuleStackingMode,
} from "@prisma/client";
import type { BuylistPricingPolicy, PricingRule as PrismaPricingRule } from "@prisma/client";
import { Decimal } from "decimal.js";
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

import { RuleEngine, DEFAULT_CONDITION_MULTIPLIERS } from "./rule-engine";
import type { ProductAttributes } from "./types";

describe("RuleEngine", () => {
  const engine = new RuleEngine();

  // Helper to create a mock policy
  const createPolicy = (
    overrides: Partial<BuylistPricingPolicy> = {}
  ): BuylistPricingPolicy => ({
    id: "policy-1",
    installationId: "install-1",
    name: "Standard Policy",
    description: null,
    policyType: PricingPolicyType.PERCENTAGE,
    basePercentage: new Decimal(50),
    conditionMultipliers: DEFAULT_CONDITION_MULTIPLIERS,
    tieredRules: null,
    minimumPrice: null,
    maximumPrice: null,
    isDefault: true,
    isActive: true,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  });

  // Helper to create a mock Prisma rule
  const createPrismaRule = (
    overrides: Partial<PrismaPricingRule> = {}
  ): PrismaPricingRule => ({
    id: `rule-${Math.random().toString(36).slice(2, 8)}`,
    policyId: "policy-1",
    name: "Test Rule",
    description: null,
    priority: 100,
    conditions: { operator: "AND", conditions: [] },
    actionType: PricingRuleActionType.PERCENTAGE_MODIFIER,
    actionValue: new Decimal(10),
    stackingMode: RuleStackingMode.MULTIPLICATIVE,
    startsAt: null,
    endsAt: null,
    isActive: true,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  });

  // Default product attributes
  const createAttributes = (
    overrides: Partial<ProductAttributes> = {}
  ): ProductAttributes => ({
    variantId: "variant-123",
    productId: "product-456",
    setCode: "MH3",
    setName: "Modern Horizons 3",
    rarity: "mythic",
    finish: "foil",
    cardType: "Creature",
    ...overrides,
  });

  describe("Base Offer Calculation", () => {
    describe("PERCENTAGE policy type", () => {
      it("should calculate base offer as percentage of market price", () => {
        const policy = createPolicy({
          policyType: PricingPolicyType.PERCENTAGE,
          basePercentage: new Decimal(50),
        });

        const result = engine.calculatePrice({
          policy,
          rules: [],
          marketPrice: 100,
          condition: "NM",
        });

        // 50% of $100 = $50 base offer
        // NM condition = 1.0 multiplier
        expect(result.baseOffer).toBe(50);
        expect(result.offerAfterCondition).toBe(50);
      });

      it("should use 50% as default when basePercentage is not set", () => {
        const policy = createPolicy({
          policyType: PricingPolicyType.PERCENTAGE,
          basePercentage: null as unknown as Decimal,
        });

        const result = engine.calculatePrice({
          policy,
          rules: [],
          marketPrice: 100,
          condition: "NM",
        });

        expect(result.baseOffer).toBe(50);
      });
    });

    describe("FIXED_DISCOUNT policy type", () => {
      it("should subtract fixed amount from market price", () => {
        const policy = createPolicy({
          policyType: PricingPolicyType.FIXED_DISCOUNT,
          basePercentage: new Decimal(10), // $10 discount
        });

        const result = engine.calculatePrice({
          policy,
          rules: [],
          marketPrice: 100,
          condition: "NM",
        });

        // $100 - $10 = $90 base offer
        expect(result.baseOffer).toBe(90);
      });

      it("should not go below zero", () => {
        const policy = createPolicy({
          policyType: PricingPolicyType.FIXED_DISCOUNT,
          basePercentage: new Decimal(50), // $50 discount
        });

        const result = engine.calculatePrice({
          policy,
          rules: [],
          marketPrice: 30,
          condition: "NM",
        });

        // $30 - $50 = $0 (floored)
        expect(result.baseOffer).toBe(0);
      });
    });

    describe("TIERED policy type", () => {
      it("should select correct tier based on market price", () => {
        const policy = createPolicy({
          policyType: PricingPolicyType.TIERED,
          tieredRules: [
            { minValue: 0, maxValue: 10, percentage: 40 },
            { minValue: 10, maxValue: 50, percentage: 50 },
            { minValue: 50, maxValue: 100, percentage: 60 },
          ],
        });

        // $5 card - should use 40% tier
        const result1 = engine.calculatePrice({
          policy,
          rules: [],
          marketPrice: 5,
          condition: "NM",
        });
        expect(result1.baseOffer).toBe(2); // 40% of $5

        // $30 card - should use 50% tier
        const result2 = engine.calculatePrice({
          policy,
          rules: [],
          marketPrice: 30,
          condition: "NM",
        });
        expect(result2.baseOffer).toBe(15); // 50% of $30

        // $75 card - should use 60% tier
        const result3 = engine.calculatePrice({
          policy,
          rules: [],
          marketPrice: 75,
          condition: "NM",
        });
        expect(result3.baseOffer).toBe(45); // 60% of $75
      });

      it("should use last tier for prices exceeding all tiers", () => {
        const policy = createPolicy({
          policyType: PricingPolicyType.TIERED,
          tieredRules: [
            { minValue: 0, maxValue: 50, percentage: 50 },
            { minValue: 50, maxValue: 100, percentage: 60 },
          ],
        });

        const result = engine.calculatePrice({
          policy,
          rules: [],
          marketPrice: 200,
          condition: "NM",
        });

        // Should use 60% (last tier)
        expect(result.baseOffer).toBe(120);
      });

      it("should fall back to basePercentage when no tiers defined", () => {
        const policy = createPolicy({
          policyType: PricingPolicyType.TIERED,
          basePercentage: new Decimal(45),
          tieredRules: null,
        });

        const result = engine.calculatePrice({
          policy,
          rules: [],
          marketPrice: 100,
          condition: "NM",
        });

        expect(result.baseOffer).toBe(45);
      });
    });

    describe("CUSTOM policy type", () => {
      it("should default to 50% for CUSTOM policies", () => {
        const policy = createPolicy({
          policyType: PricingPolicyType.CUSTOM,
        });

        const result = engine.calculatePrice({
          policy,
          rules: [],
          marketPrice: 100,
          condition: "NM",
        });

        expect(result.baseOffer).toBe(50);
      });
    });
  });

  describe("Condition Multipliers", () => {
    it("should apply NM multiplier (100%)", () => {
      const policy = createPolicy({
        basePercentage: new Decimal(50),
      });

      const result = engine.calculatePrice({
        policy,
        rules: [],
        marketPrice: 100,
        condition: "NM",
      });

      expect(result.conditionMultiplier).toBe(1.0);
      expect(result.offerAfterCondition).toBe(50); // $50 × 1.0
    });

    it("should apply LP multiplier (90%)", () => {
      const policy = createPolicy({
        basePercentage: new Decimal(50),
      });

      const result = engine.calculatePrice({
        policy,
        rules: [],
        marketPrice: 100,
        condition: "LP",
      });

      expect(result.conditionMultiplier).toBe(0.9);
      expect(result.offerAfterCondition).toBe(45); // $50 × 0.9
    });

    it("should apply MP multiplier (75%)", () => {
      const policy = createPolicy({
        basePercentage: new Decimal(50),
      });

      const result = engine.calculatePrice({
        policy,
        rules: [],
        marketPrice: 100,
        condition: "MP",
      });

      expect(result.conditionMultiplier).toBe(0.75);
      expect(result.offerAfterCondition).toBe(37.5); // $50 × 0.75
    });

    it("should apply HP multiplier (50%)", () => {
      const policy = createPolicy({
        basePercentage: new Decimal(50),
      });

      const result = engine.calculatePrice({
        policy,
        rules: [],
        marketPrice: 100,
        condition: "HP",
      });

      expect(result.conditionMultiplier).toBe(0.5);
      expect(result.offerAfterCondition).toBe(25); // $50 × 0.5
    });

    it("should apply DMG multiplier (25%)", () => {
      const policy = createPolicy({
        basePercentage: new Decimal(50),
      });

      const result = engine.calculatePrice({
        policy,
        rules: [],
        marketPrice: 100,
        condition: "DMG",
      });

      expect(result.conditionMultiplier).toBe(0.25);
      expect(result.offerAfterCondition).toBe(12.5); // $50 × 0.25
    });

    it("should use custom condition multipliers from policy", () => {
      const policy = createPolicy({
        basePercentage: new Decimal(50),
        conditionMultipliers: {
          NM: 1.0,
          LP: 0.85, // Custom LP multiplier
          MP: 0.70,
          HP: 0.45,
          DMG: 0.20,
        },
      });

      const result = engine.calculatePrice({
        policy,
        rules: [],
        marketPrice: 100,
        condition: "LP",
      });

      expect(result.conditionMultiplier).toBe(0.85);
      expect(result.offerAfterCondition).toBe(42.5); // $50 × 0.85
    });

    it("should handle case-insensitive condition names", () => {
      const policy = createPolicy({
        basePercentage: new Decimal(50),
      });

      const result = engine.calculatePrice({
        policy,
        rules: [],
        marketPrice: 100,
        condition: "nm", // lowercase
      });

      expect(result.conditionMultiplier).toBe(1.0);
    });

    it("should default to 1.0 for unknown conditions", () => {
      const policy = createPolicy({
        basePercentage: new Decimal(50),
      });

      const result = engine.calculatePrice({
        policy,
        rules: [],
        marketPrice: 100,
        condition: "UNKNOWN",
      });

      expect(result.conditionMultiplier).toBe(1.0);
    });
  });

  describe("Rule Application", () => {
    it("should apply matching rules in priority order", () => {
      const policy = createPolicy({
        basePercentage: new Decimal(50),
      });

      const rules = [
        createPrismaRule({
          id: "rule-2",
          name: "Second Rule",
          priority: 200,
          actionType: PricingRuleActionType.PERCENTAGE_MODIFIER,
          actionValue: new Decimal(5),
        }),
        createPrismaRule({
          id: "rule-1",
          name: "First Rule",
          priority: 100,
          actionType: PricingRuleActionType.PERCENTAGE_MODIFIER,
          actionValue: new Decimal(10),
        }),
      ];

      const result = engine.calculatePrice({
        policy,
        rules,
        marketPrice: 100,
        condition: "NM",
        attributes: createAttributes(),
      });

      // Base: 50% of $100 = $50
      // Rule 1 (+10%): $50 × 1.10 = $55
      // Rule 2 (+5%): $55 × 1.05 = $57.75
      expect(result.appliedRules).toHaveLength(2);
      expect(result.appliedRules[0].ruleName).toBe("First Rule");
      expect(result.appliedRules[1].ruleName).toBe("Second Rule");
      expect(result.finalOffer).toBe(57.75);
    });

    it("should skip inactive rules", () => {
      const policy = createPolicy({
        basePercentage: new Decimal(50),
      });

      const rules = [
        createPrismaRule({
          id: "active-rule",
          isActive: true,
          actionValue: new Decimal(10),
        }),
        createPrismaRule({
          id: "inactive-rule",
          isActive: false,
          actionValue: new Decimal(20),
        }),
      ];

      const result = engine.calculatePrice({
        policy,
        rules,
        marketPrice: 100,
        condition: "NM",
      });

      expect(result.appliedRules).toHaveLength(1);
      expect(result.appliedRules[0].ruleId).toBe("active-rule");
    });

    it("should skip rules outside their time window", () => {
      const policy = createPolicy({
        basePercentage: new Decimal(50),
      });

      const rules = [
        createPrismaRule({
          id: "current-rule",
          startsAt: new Date("2024-07-01"),
          endsAt: new Date("2024-07-31"),
          actionValue: new Decimal(10),
        }),
        createPrismaRule({
          id: "future-rule",
          startsAt: new Date("2024-08-01"),
          actionValue: new Decimal(20),
        }),
      ];

      const result = engine.calculatePrice({
        policy,
        rules,
        marketPrice: 100,
        condition: "NM",
        evaluationTime: new Date("2024-07-15"),
      });

      expect(result.appliedRules).toHaveLength(1);
      expect(result.appliedRules[0].ruleId).toBe("current-rule");
    });

    it("should skip rules whose conditions don't match", () => {
      const policy = createPolicy({
        basePercentage: new Decimal(50),
      });

      const rules = [
        createPrismaRule({
          id: "matching-rule",
          conditions: {
            operator: "AND",
            conditions: [
              { type: "ATTRIBUTE", field: "setCode", operator: "EQUALS", value: "MH3" },
            ],
          },
          actionValue: new Decimal(10),
        }),
        createPrismaRule({
          id: "non-matching-rule",
          conditions: {
            operator: "AND",
            conditions: [
              { type: "ATTRIBUTE", field: "setCode", operator: "EQUALS", value: "LTR" },
            ],
          },
          actionValue: new Decimal(20),
        }),
      ];

      const result = engine.calculatePrice({
        policy,
        rules,
        marketPrice: 100,
        condition: "NM",
        attributes: createAttributes({ setCode: "MH3" }),
      });

      expect(result.appliedRules).toHaveLength(1);
      expect(result.appliedRules[0].ruleId).toBe("matching-rule");
    });
  });

  describe("All Action Types", () => {
    const basePolicy = createPolicy({
      basePercentage: new Decimal(50),
    });

    it("should apply PERCENTAGE_MODIFIER correctly", () => {
      const rules = [
        createPrismaRule({
          actionType: PricingRuleActionType.PERCENTAGE_MODIFIER,
          actionValue: new Decimal(20), // +20%
          stackingMode: RuleStackingMode.MULTIPLICATIVE,
        }),
      ];

      const result = engine.calculatePrice({
        policy: basePolicy,
        rules,
        marketPrice: 100,
        condition: "NM",
      });

      // $50 × 1.20 = $60
      expect(result.finalOffer).toBe(60);
    });

    it("should apply FIXED_MODIFIER correctly", () => {
      const rules = [
        createPrismaRule({
          actionType: PricingRuleActionType.FIXED_MODIFIER,
          actionValue: new Decimal(5), // +$5
        }),
      ];

      const result = engine.calculatePrice({
        policy: basePolicy,
        rules,
        marketPrice: 100,
        condition: "NM",
      });

      // $50 + $5 = $55
      expect(result.finalOffer).toBe(55);
    });

    it("should apply SET_PERCENTAGE correctly", () => {
      const rules = [
        createPrismaRule({
          actionType: PricingRuleActionType.SET_PERCENTAGE,
          actionValue: new Decimal(70), // Set to 70% of market
        }),
      ];

      const result = engine.calculatePrice({
        policy: basePolicy,
        rules,
        marketPrice: 100,
        condition: "NM",
      });

      // Override to 70% of $100 = $70
      expect(result.finalOffer).toBe(70);
    });

    it("should apply SET_MINIMUM correctly", () => {
      const rules = [
        createPrismaRule({
          actionType: PricingRuleActionType.SET_MINIMUM,
          actionValue: new Decimal(75), // Min $75
        }),
      ];

      const result = engine.calculatePrice({
        policy: basePolicy,
        rules,
        marketPrice: 100,
        condition: "NM",
      });

      // $50 < $75, so set to $75
      expect(result.finalOffer).toBe(75);
    });

    it("should apply SET_MAXIMUM correctly", () => {
      const rules = [
        createPrismaRule({
          actionType: PricingRuleActionType.SET_MAXIMUM,
          actionValue: new Decimal(40), // Max $40
        }),
      ];

      const result = engine.calculatePrice({
        policy: basePolicy,
        rules,
        marketPrice: 100,
        condition: "NM",
      });

      // $50 > $40, so cap at $40
      expect(result.finalOffer).toBe(40);
    });
  });

  describe("Policy Constraints", () => {
    it("should apply policy minimum price", () => {
      const policy = createPolicy({
        basePercentage: new Decimal(50),
        minimumPrice: new Decimal(10),
      });

      const result = engine.calculatePrice({
        policy,
        rules: [],
        marketPrice: 15, // 50% = $7.50, below minimum
        condition: "NM",
      });

      expect(result.finalOffer).toBe(10);
      expect(result.constraintsApplied.minimumApplied).toBe(true);
    });

    it("should apply policy maximum price", () => {
      const policy = createPolicy({
        basePercentage: new Decimal(50),
        maximumPrice: new Decimal(100),
      });

      const result = engine.calculatePrice({
        policy,
        rules: [],
        marketPrice: 300, // 50% = $150, above maximum
        condition: "NM",
      });

      expect(result.finalOffer).toBe(100);
      expect(result.constraintsApplied.maximumApplied).toBe(true);
    });

    it("should apply constraints after rules", () => {
      const policy = createPolicy({
        basePercentage: new Decimal(50),
        maximumPrice: new Decimal(60),
      });

      const rules = [
        createPrismaRule({
          actionType: PricingRuleActionType.PERCENTAGE_MODIFIER,
          actionValue: new Decimal(50), // +50%
        }),
      ];

      const result = engine.calculatePrice({
        policy,
        rules,
        marketPrice: 100, // Base: $50, after rule: $75, capped at $60
        condition: "NM",
      });

      expect(result.finalOffer).toBe(60);
      expect(result.constraintsApplied.maximumApplied).toBe(true);
    });
  });

  describe("Complex Scenarios", () => {
    it("should handle complete buylist calculation flow", () => {
      const policy = createPolicy({
        policyType: PricingPolicyType.TIERED,
        tieredRules: [
          { minValue: 0, maxValue: 10, percentage: 40 },
          { minValue: 10, maxValue: 50, percentage: 50 },
          { minValue: 50, maxValue: 999, percentage: 60 },
        ],
        conditionMultipliers: {
          NM: 1.0,
          LP: 0.85,
          MP: 0.70,
          HP: 0.50,
          DMG: 0.25,
        },
        minimumPrice: new Decimal(0.10),
      });

      const rules = [
        // MH3 Premium: +15%
        createPrismaRule({
          id: "mh3-premium",
          name: "MH3 Premium",
          priority: 100,
          conditions: {
            operator: "AND",
            conditions: [
              { type: "ATTRIBUTE", field: "setCode", operator: "EQUALS", value: "MH3" },
            ],
          },
          actionType: PricingRuleActionType.PERCENTAGE_MODIFIER,
          actionValue: new Decimal(15),
        }),
        // Mythic Bonus: +10%
        createPrismaRule({
          id: "mythic-bonus",
          name: "Mythic Bonus",
          priority: 200,
          conditions: {
            operator: "AND",
            conditions: [
              { type: "ATTRIBUTE", field: "rarity", operator: "EQUALS", value: "mythic" },
            ],
          },
          actionType: PricingRuleActionType.PERCENTAGE_MODIFIER,
          actionValue: new Decimal(10),
        }),
        // Foil Premium: +$2
        createPrismaRule({
          id: "foil-premium",
          name: "Foil Premium",
          priority: 300,
          conditions: {
            operator: "AND",
            conditions: [
              { type: "ATTRIBUTE", field: "finish", operator: "EQUALS", value: "foil" },
            ],
          },
          actionType: PricingRuleActionType.FIXED_MODIFIER,
          actionValue: new Decimal(2),
        }),
      ];

      const result = engine.calculatePrice({
        policy,
        rules,
        marketPrice: 75, // Uses 60% tier
        condition: "LP",
        attributes: createAttributes({
          setCode: "MH3",
          rarity: "mythic",
          finish: "foil",
        }),
      });

      // Step by step:
      // 1. Base: 60% of $75 = $45
      // 2. LP condition: $45 × 0.85 = $38.25
      // 3. MH3 Premium (+15%): $38.25 × 1.15 = $43.9875
      // 4. Mythic Bonus (+10%): $43.9875 × 1.10 = $48.38625
      // 5. Foil Premium (+$2): $48.38625 + $2 = $50.38625
      // 6. Rounded: $50.39

      expect(result.policyId).toBe(policy.id);
      expect(result.marketPrice).toBe(75);
      expect(result.condition).toBe("LP");
      expect(result.baseOffer).toBe(45);
      expect(result.conditionMultiplier).toBe(0.85);
      expect(result.appliedRules).toHaveLength(3);
      expect(result.finalOffer).toBeCloseTo(50.39, 2);
    });

    it("should handle inventory-based rules", () => {
      const policy = createPolicy({
        basePercentage: new Decimal(50),
      });

      const rules = [
        // Low stock premium: +20% when qty < 5
        createPrismaRule({
          id: "low-stock-premium",
          name: "Low Stock Premium",
          conditions: {
            operator: "AND",
            conditions: [
              { type: "INVENTORY", field: "qtyOnHand", operator: "LESS_THAN", value: 5 },
            ],
          },
          actionType: PricingRuleActionType.PERCENTAGE_MODIFIER,
          actionValue: new Decimal(20),
        }),
        // High stock penalty: -10% when qty > 20
        createPrismaRule({
          id: "high-stock-penalty",
          name: "High Stock Penalty",
          conditions: {
            operator: "AND",
            conditions: [
              { type: "INVENTORY", field: "qtyOnHand", operator: "GREATER_THAN", value: 20 },
            ],
          },
          actionType: PricingRuleActionType.PERCENTAGE_MODIFIER,
          actionValue: new Decimal(-10),
        }),
      ];

      // Low stock scenario
      const lowStockResult = engine.calculatePrice({
        policy,
        rules,
        marketPrice: 100,
        condition: "NM",
        inventory: { qtyOnHand: 2 },
      });

      expect(lowStockResult.appliedRules).toHaveLength(1);
      expect(lowStockResult.appliedRules[0].ruleId).toBe("low-stock-premium");
      expect(lowStockResult.finalOffer).toBe(60); // $50 × 1.20

      // High stock scenario
      const highStockResult = engine.calculatePrice({
        policy,
        rules,
        marketPrice: 100,
        condition: "NM",
        inventory: { qtyOnHand: 50 },
      });

      expect(highStockResult.appliedRules).toHaveLength(1);
      expect(highStockResult.appliedRules[0].ruleId).toBe("high-stock-penalty");
      expect(highStockResult.finalOffer).toBe(45); // $50 × 0.90

      // Normal stock scenario (no rules match)
      const normalStockResult = engine.calculatePrice({
        policy,
        rules,
        marketPrice: 100,
        condition: "NM",
        inventory: { qtyOnHand: 10 },
      });

      expect(normalStockResult.appliedRules).toHaveLength(0);
      expect(normalStockResult.finalOffer).toBe(50);
    });

    it("should handle price-based rules", () => {
      const policy = createPolicy({
        basePercentage: new Decimal(50),
      });

      const rules = [
        // High value card bonus: +10% when market > $50
        createPrismaRule({
          id: "high-value-bonus",
          name: "High Value Bonus",
          conditions: {
            operator: "AND",
            conditions: [
              { type: "MARKET_PRICE", field: "marketPrice", operator: "GREATER_THAN", value: 50 },
            ],
          },
          actionType: PricingRuleActionType.PERCENTAGE_MODIFIER,
          actionValue: new Decimal(10),
        }),
        // Bulk card floor: min $0.25 for cards under $1
        createPrismaRule({
          id: "bulk-floor",
          name: "Bulk Floor",
          conditions: {
            operator: "AND",
            conditions: [
              { type: "MARKET_PRICE", field: "marketPrice", operator: "LESS_THAN", value: 1 },
            ],
          },
          actionType: PricingRuleActionType.SET_MINIMUM,
          actionValue: new Decimal(0.10),
        }),
      ];

      // High value card
      const highValueResult = engine.calculatePrice({
        policy,
        rules,
        marketPrice: 100,
        condition: "NM",
      });

      expect(highValueResult.appliedRules).toHaveLength(1);
      expect(highValueResult.finalOffer).toBe(55); // $50 × 1.10

      // Bulk card
      const bulkResult = engine.calculatePrice({
        policy,
        rules,
        marketPrice: 0.50, // 50% = $0.25
        condition: "NM",
      });

      expect(bulkResult.appliedRules).toHaveLength(1);
      expect(bulkResult.finalOffer).toBe(0.25); // $0.25 base, meets minimum
    });
  });

  describe("Result Structure", () => {
    it("should return complete calculation result", () => {
      const policy = createPolicy({
        basePercentage: new Decimal(50),
      });

      const rules = [
        createPrismaRule({
          id: "test-rule",
          name: "Test Rule",
          actionType: PricingRuleActionType.PERCENTAGE_MODIFIER,
          actionValue: new Decimal(10),
        }),
      ];

      const result = engine.calculatePrice({
        policy,
        rules,
        marketPrice: 100,
        condition: "LP",
        attributes: createAttributes(),
      });

      expect(result).toMatchObject({
        policyId: policy.id,
        policyName: policy.name,
        marketPrice: 100,
        condition: "LP",
        baseOffer: 50,
        conditionMultiplier: 0.9,
        offerAfterCondition: 45,
      });

      expect(result.appliedRules).toHaveLength(1);
      expect(result.appliedRules[0]).toMatchObject({
        ruleId: "test-rule",
        ruleName: "Test Rule",
        actionType: PricingRuleActionType.PERCENTAGE_MODIFIER,
        modifier: 10,
        stackingMode: RuleStackingMode.MULTIPLICATIVE,
      });

      expect(result.constraintsApplied).toMatchObject({
        minimumApplied: false,
        maximumApplied: false,
      });
    });
  });

  describe("validateConditions", () => {
    it("should validate correct conditions", () => {
      const conditions = {
        operator: "AND" as const,
        conditions: [
          { type: "ATTRIBUTE" as const, field: "setCode", operator: "EQUALS" as const, value: "MH3" },
        ],
      };

      const result = engine.validateConditions(conditions);

      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it("should catch validation errors", () => {
      const conditions = {
        operator: "AND" as const,
        conditions: [
          { type: "ATTRIBUTE" as const, field: "setCode", operator: "BETWEEN" as const, value: ["A", "Z"] },
        ],
      };

      const result = engine.validateConditions(conditions);

      expect(result.valid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
    });
  });

  describe("previewMatchingRules", () => {
    it("should categorize rules into matching and non-matching", () => {
      const rules = [
        createPrismaRule({
          id: "matching-rule",
          conditions: {
            operator: "AND",
            conditions: [
              { type: "ATTRIBUTE", field: "setCode", operator: "EQUALS", value: "MH3" },
            ],
          },
        }),
        createPrismaRule({
          id: "non-matching-rule",
          conditions: {
            operator: "AND",
            conditions: [
              { type: "ATTRIBUTE", field: "setCode", operator: "EQUALS", value: "LTR" },
            ],
          },
        }),
      ];

      const result = engine.previewMatchingRules(rules, {
        attributes: createAttributes({ setCode: "MH3" }),
        marketPrice: 50,
        condition: "NM",
      });

      expect(result.matching).toHaveLength(1);
      expect(result.matching[0].id).toBe("matching-rule");
      expect(result.notMatching).toHaveLength(1);
      expect(result.notMatching[0].id).toBe("non-matching-rule");
    });
  });

  describe("Edge Cases", () => {
    it("should handle zero market price", () => {
      const policy = createPolicy({
        basePercentage: new Decimal(50),
      });

      const result = engine.calculatePrice({
        policy,
        rules: [],
        marketPrice: 0,
        condition: "NM",
      });

      expect(result.baseOffer).toBe(0);
      expect(result.finalOffer).toBe(0);
    });

    it("should handle very small market prices", () => {
      const policy = createPolicy({
        basePercentage: new Decimal(50),
        minimumPrice: new Decimal(0.01),
      });

      const result = engine.calculatePrice({
        policy,
        rules: [],
        marketPrice: 0.01,
        condition: "NM",
      });

      // 50% of $0.01 = $0.005, should be floored to minimum
      expect(result.finalOffer).toBe(0.01);
    });

    it("should handle very large market prices", () => {
      const policy = createPolicy({
        basePercentage: new Decimal(50),
      });

      const result = engine.calculatePrice({
        policy,
        rules: [],
        marketPrice: 10000,
        condition: "NM",
      });

      expect(result.baseOffer).toBe(5000);
      expect(result.finalOffer).toBe(5000);
    });

    it("should handle no rules gracefully", () => {
      const policy = createPolicy({
        basePercentage: new Decimal(50),
      });

      const result = engine.calculatePrice({
        policy,
        rules: [],
        marketPrice: 100,
        condition: "NM",
      });

      expect(result.appliedRules).toHaveLength(0);
      expect(result.finalOffer).toBe(50);
    });

    it("should handle rules with JSON string conditions", () => {
      const policy = createPolicy({
        basePercentage: new Decimal(50),
      });

      const rule = createPrismaRule({
        conditions: JSON.stringify({
          operator: "AND",
          conditions: [],
        }) as unknown as Record<string, unknown>,
      });

      const result = engine.calculatePrice({
        policy,
        rules: [rule],
        marketPrice: 100,
        condition: "NM",
      });

      expect(result.appliedRules).toHaveLength(1);
    });
  });
});
