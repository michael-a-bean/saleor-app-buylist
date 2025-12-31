/**
 * Pricing Rule Engine
 *
 * Main orchestrator for the pricing rule system.
 * Coordinates rule matching, condition evaluation, and price calculation.
 */

import type { BuylistPricingPolicy, PricingRule as PrismaPricingRule } from "@prisma/client";
import { PricingPolicyType } from "@prisma/client";
import Decimal from "decimal.js";

import { conditionEvaluator } from "./condition-evaluator";
import { ruleMatcher, type RuleMatcherOptions } from "./rule-matcher";
import { ruleStacker } from "./rule-stacker";
import type {
  PriceCalculationResult,
  PricingRule,
  PricingRuleConditionGroup,
  ProductAttributes,
  RuleEvaluationContext,
} from "./types";
import { createTimeContext } from "./types";

/**
 * Default condition multipliers for card conditions
 */
export const DEFAULT_CONDITION_MULTIPLIERS: Record<string, number> = {
  NM: 1.0,
  LP: 0.9,
  MP: 0.75,
  HP: 0.5,
  DMG: 0.25,
};

/**
 * Input for price calculation
 */
export interface CalculatePriceInput {
  /** Policy to use for base calculation */
  policy: BuylistPricingPolicy;
  /** Rules attached to the policy */
  rules: PrismaPricingRule[];
  /** Current market price */
  marketPrice: number;
  /** Card condition (NM, LP, MP, HP, DMG) */
  condition: string;
  /** Product attributes for rule evaluation */
  attributes?: ProductAttributes;
  /** Inventory data for rule evaluation */
  inventory?: { qtyOnHand: number };
  /** Category ID for rule evaluation */
  categoryId?: string;
  /** Override evaluation time (for testing) */
  evaluationTime?: Date;
}

/**
 * Main pricing rule engine
 */
export class RuleEngine {
  /**
   * Calculate the buy price for a product
   */
  calculatePrice(input: CalculatePriceInput): PriceCalculationResult {
    const {
      policy,
      rules,
      marketPrice,
      condition,
      attributes,
      inventory,
      categoryId,
      evaluationTime,
    } = input;

    // Step 1: Calculate base offer from policy
    const baseOffer = this.calculateBaseOffer(policy, marketPrice);

    // Step 2: Apply condition multiplier
    const conditionMultiplier = this.getConditionMultiplier(policy, condition);
    const offerAfterCondition = new Decimal(baseOffer)
      .times(conditionMultiplier)
      .toNumber();

    // Step 3: Build evaluation context
    const context = this.buildEvaluationContext({
      attributes,
      marketPrice,
      condition,
      inventory,
      categoryId,
      evaluationTime,
    });

    // Step 4: Convert Prisma rules to internal format
    const internalRules = this.convertRules(rules);

    // Step 5: Find matching rules
    const matcherOptions: RuleMatcherOptions = {
      evaluationTime,
    };
    const matchingRules = ruleMatcher.findMatchingRules(
      internalRules,
      context,
      matcherOptions
    );

    // Step 6: Apply rules
    const stackerResult = ruleStacker.applyRules({
      baseOffer: offerAfterCondition,
      marketPrice,
      rules: matchingRules,
      constraints: {
        minimumPrice: policy.minimumPrice
          ? new Decimal(policy.minimumPrice.toString()).toNumber()
          : null,
        maximumPrice: policy.maximumPrice
          ? new Decimal(policy.maximumPrice.toString()).toNumber()
          : null,
      },
    });

    return {
      policyId: policy.id,
      policyName: policy.name,
      marketPrice,
      condition,
      baseOffer,
      conditionMultiplier,
      offerAfterCondition,
      appliedRules: stackerResult.appliedRules,
      finalOffer: stackerResult.finalOffer,
      constraintsApplied: stackerResult.constraintsApplied,
    };
  }

  /**
   * Calculate base offer from policy (before condition multiplier and rules)
   */
  private calculateBaseOffer(policy: BuylistPricingPolicy, marketPrice: number): number {
    const basePercentage = policy.basePercentage
      ? new Decimal(policy.basePercentage.toString()).toNumber()
      : 50; // Default to 50%

    switch (policy.policyType) {
      case PricingPolicyType.PERCENTAGE:
        return new Decimal(marketPrice)
          .times(basePercentage)
          .dividedBy(100)
          .toNumber();

      case PricingPolicyType.FIXED_DISCOUNT:
        return Math.max(
          0,
          new Decimal(marketPrice).minus(basePercentage).toNumber()
        );

      case PricingPolicyType.TIERED:
        return this.calculateTieredOffer(policy, marketPrice);

      case PricingPolicyType.CUSTOM:
        // For CUSTOM policies, default to 50% (rules handle the rest)
        return new Decimal(marketPrice).times(0.5).toNumber();

      default:
        return new Decimal(marketPrice).times(0.5).toNumber();
    }
  }

  /**
   * Calculate offer using tiered pricing
   */
  private calculateTieredOffer(policy: BuylistPricingPolicy, marketPrice: number): number {
    const tieredRules = policy.tieredRules as Array<{
      minValue: number;
      maxValue: number;
      percentage: number;
    }> | null;

    if (!tieredRules || tieredRules.length === 0) {
      // Fall back to base percentage
      const basePercentage = policy.basePercentage
        ? new Decimal(policy.basePercentage.toString()).toNumber()
        : 50;
      return new Decimal(marketPrice).times(basePercentage).dividedBy(100).toNumber();
    }

    // Find matching tier
    for (const tier of tieredRules) {
      if (marketPrice >= tier.minValue && marketPrice < tier.maxValue) {
        return new Decimal(marketPrice)
          .times(tier.percentage)
          .dividedBy(100)
          .toNumber();
      }
    }

    // If no tier matches, use the last tier or base percentage
    const lastTier = tieredRules[tieredRules.length - 1];
    if (marketPrice >= lastTier.maxValue) {
      return new Decimal(marketPrice)
        .times(lastTier.percentage)
        .dividedBy(100)
        .toNumber();
    }

    // Fall back to base percentage
    const basePercentage = policy.basePercentage
      ? new Decimal(policy.basePercentage.toString()).toNumber()
      : 50;
    return new Decimal(marketPrice).times(basePercentage).dividedBy(100).toNumber();
  }

  /**
   * Get condition multiplier from policy
   */
  private getConditionMultiplier(policy: BuylistPricingPolicy, condition: string): number {
    const multipliers = (policy.conditionMultipliers as Record<string, number> | null) ??
      DEFAULT_CONDITION_MULTIPLIERS;

    const upperCondition = condition.toUpperCase();
    return multipliers[upperCondition] ?? 1.0;
  }

  /**
   * Build evaluation context for rule matching
   */
  private buildEvaluationContext(params: {
    attributes?: ProductAttributes;
    marketPrice: number;
    condition: string;
    inventory?: { qtyOnHand: number };
    categoryId?: string;
    evaluationTime?: Date;
  }): RuleEvaluationContext {
    const { attributes, marketPrice, condition, inventory, categoryId, evaluationTime } = params;

    return {
      attributes: attributes ?? {
        variantId: "",
        productId: "",
        categoryId,
      },
      marketPrice,
      condition,
      inventory,
      time: createTimeContext(evaluationTime ?? new Date()),
    };
  }

  /**
   * Convert Prisma rules to internal format
   */
  private convertRules(prismaRules: PrismaPricingRule[]): PricingRule[] {
    return prismaRules.map((rule) => ({
      id: rule.id,
      policyId: rule.policyId,
      name: rule.name,
      description: rule.description,
      priority: rule.priority,
      conditions: this.parseConditions(rule.conditions),
      actionType: rule.actionType,
      actionValue: new Decimal(rule.actionValue.toString()).toNumber(),
      stackingMode: rule.stackingMode,
      startsAt: rule.startsAt,
      endsAt: rule.endsAt,
      isActive: rule.isActive,
    }));
  }

  /**
   * Parse conditions from JSON
   */
  private parseConditions(conditions: unknown): PricingRuleConditionGroup {
    if (typeof conditions === "string") {
      try {
        return JSON.parse(conditions) as PricingRuleConditionGroup;
      } catch {
        return { operator: "AND", conditions: [] };
      }
    }
    if (conditions && typeof conditions === "object") {
      return conditions as PricingRuleConditionGroup;
    }
    return { operator: "AND", conditions: [] };
  }

  /**
   * Validate a rule's conditions
   */
  validateConditions(conditions: PricingRuleConditionGroup): { valid: boolean; errors: string[] } {
    return conditionEvaluator.validateCondition(conditions);
  }

  /**
   * Preview what rules would match for a given context
   */
  previewMatchingRules(
    rules: PrismaPricingRule[],
    context: {
      attributes?: ProductAttributes;
      marketPrice: number;
      condition: string;
      inventory?: { qtyOnHand: number };
      categoryId?: string;
    },
    options?: RuleMatcherOptions
  ): { matching: PricingRule[]; notMatching: PricingRule[] } {
    const internalRules = this.convertRules(rules);
    const evalContext = this.buildEvaluationContext(context);

    return ruleMatcher.categorizeRules(internalRules, evalContext, options);
  }
}

// Export singleton instance
export const ruleEngine = new RuleEngine();
