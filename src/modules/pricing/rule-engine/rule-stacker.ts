/**
 * Rule Stacker
 *
 * Applies matching rules to a base offer price.
 * Supports both multiplicative and additive stacking modes.
 */

import { PricingRuleActionType, RuleStackingMode } from "@prisma/client";
import Decimal from "decimal.js";

import type { PricingRule, RuleApplicationResult } from "./types";

/**
 * Input for applying rules
 */
export interface RuleStackerInput {
  /** Base offer before rules (after condition multiplier) */
  baseOffer: number;
  /** Original market price (used for additive percentage calculations) */
  marketPrice: number;
  /** Ordered list of matching rules */
  rules: PricingRule[];
  /** Policy min/max constraints */
  constraints?: {
    minimumPrice?: number | null;
    maximumPrice?: number | null;
  };
}

/**
 * Output from applying rules
 */
export interface RuleStackerOutput {
  /** Final offer after all rules */
  finalOffer: number;
  /** Details of each rule application */
  appliedRules: RuleApplicationResult[];
  /** Constraint application info */
  constraintsApplied: {
    minimumApplied: boolean;
    maximumApplied: boolean;
    originalBeforeConstraints?: number;
  };
}

/**
 * Applies stacked pricing rules to a base offer
 */
export class RuleStacker {
  /**
   * Apply all matching rules to the base offer
   */
  applyRules(input: RuleStackerInput): RuleStackerOutput {
    const { baseOffer, marketPrice, rules, constraints } = input;
    const appliedRules: RuleApplicationResult[] = [];

    // Use Decimal.js for precise calculations
    let currentOffer = new Decimal(baseOffer);
    const baseOfferDecimal = new Decimal(baseOffer);
    const marketPriceDecimal = new Decimal(marketPrice);

    // Apply each rule in order
    for (const rule of rules) {
      const offerBefore = currentOffer.toNumber();
      const actionValue = new Decimal(
        typeof rule.actionValue === "number"
          ? rule.actionValue
          : rule.actionValue.toString()
      );

      currentOffer = this.applyRule(
        currentOffer,
        baseOfferDecimal,
        marketPriceDecimal,
        rule.actionType,
        actionValue,
        rule.stackingMode
      );

      appliedRules.push({
        ruleId: rule.id,
        ruleName: rule.name,
        actionType: rule.actionType,
        modifier: actionValue.toNumber(),
        stackingMode: rule.stackingMode,
        offerBefore,
        offerAfter: currentOffer.toNumber(),
      });
    }

    // Apply constraints
    const constraintsResult = this.applyConstraints(currentOffer.toNumber(), constraints);

    return {
      finalOffer: constraintsResult.finalOffer,
      appliedRules,
      constraintsApplied: constraintsResult.constraintsApplied,
    };
  }

  /**
   * Apply a single rule to the current offer
   */
  private applyRule(
    currentOffer: Decimal,
    baseOffer: Decimal,
    marketPrice: Decimal,
    actionType: PricingRuleActionType,
    actionValue: Decimal,
    stackingMode: RuleStackingMode
  ): Decimal {
    switch (actionType) {
      case PricingRuleActionType.PERCENTAGE_MODIFIER:
        return this.applyPercentageModifier(
          currentOffer,
          baseOffer,
          actionValue,
          stackingMode
        );

      case PricingRuleActionType.FIXED_MODIFIER:
        return this.applyFixedModifier(currentOffer, actionValue);

      case PricingRuleActionType.SET_PERCENTAGE:
        return this.setPercentage(marketPrice, actionValue);

      case PricingRuleActionType.SET_MINIMUM:
        return Decimal.max(currentOffer, actionValue);

      case PricingRuleActionType.SET_MAXIMUM:
        return Decimal.min(currentOffer, actionValue);

      default:
        return currentOffer;
    }
  }

  /**
   * Apply a percentage modifier based on stacking mode
   *
   * MULTIPLICATIVE: offer = offer × (1 + modifier/100)
   *   Example: +10% on $30 = $30 × 1.10 = $33
   *
   * ADDITIVE: offer = offer + (baseOffer × modifier/100)
   *   Example: +10% on $30 (base $30) = $30 + ($30 × 0.10) = $33
   *   If applied after another rule: +10% on $33 (base $30) = $33 + ($30 × 0.10) = $36
   */
  private applyPercentageModifier(
    currentOffer: Decimal,
    baseOffer: Decimal,
    modifier: Decimal,
    stackingMode: RuleStackingMode
  ): Decimal {
    if (stackingMode === RuleStackingMode.MULTIPLICATIVE) {
      // Multiplicative: compound on current offer
      const multiplier = new Decimal(1).plus(modifier.dividedBy(100));
      return currentOffer.times(multiplier);
    } else {
      // Additive: add percentage of base offer
      const addition = baseOffer.times(modifier.dividedBy(100));
      return currentOffer.plus(addition);
    }
  }

  /**
   * Apply a fixed amount modifier (always additive)
   */
  private applyFixedModifier(currentOffer: Decimal, modifier: Decimal): Decimal {
    return currentOffer.plus(modifier);
  }

  /**
   * Set offer to a specific percentage of market price
   */
  private setPercentage(marketPrice: Decimal, percentage: Decimal): Decimal {
    return marketPrice.times(percentage.dividedBy(100));
  }

  /**
   * Apply min/max constraints
   */
  private applyConstraints(
    offer: number,
    constraints?: { minimumPrice?: number | null; maximumPrice?: number | null }
  ): { finalOffer: number; constraintsApplied: RuleStackerOutput["constraintsApplied"] } {
    let finalOffer = offer;
    let minimumApplied = false;
    let maximumApplied = false;
    let originalBeforeConstraints: number | undefined;

    if (constraints?.minimumPrice != null && finalOffer < constraints.minimumPrice) {
      originalBeforeConstraints = finalOffer;
      finalOffer = constraints.minimumPrice;
      minimumApplied = true;
    }

    if (constraints?.maximumPrice != null && finalOffer > constraints.maximumPrice) {
      if (originalBeforeConstraints === undefined) {
        originalBeforeConstraints = finalOffer;
      }
      finalOffer = constraints.maximumPrice;
      maximumApplied = true;
    }

    // Round to 2 decimal places
    finalOffer = Math.round(finalOffer * 100) / 100;

    return {
      finalOffer,
      constraintsApplied: {
        minimumApplied,
        maximumApplied,
        originalBeforeConstraints,
      },
    };
  }

  /**
   * Calculate what a rule would do to an offer (for preview)
   */
  previewRule(
    currentOffer: number,
    baseOffer: number,
    marketPrice: number,
    actionType: PricingRuleActionType,
    actionValue: number,
    stackingMode: RuleStackingMode
  ): { newOffer: number; change: number; changePercent: number } {
    const newOffer = this.applyRule(
      new Decimal(currentOffer),
      new Decimal(baseOffer),
      new Decimal(marketPrice),
      actionType,
      new Decimal(actionValue),
      stackingMode
    ).toNumber();

    const change = newOffer - currentOffer;
    const changePercent = currentOffer > 0 ? (change / currentOffer) * 100 : 0;

    return {
      newOffer: Math.round(newOffer * 100) / 100,
      change: Math.round(change * 100) / 100,
      changePercent: Math.round(changePercent * 100) / 100,
    };
  }
}

// Export singleton instance
export const ruleStacker = new RuleStacker();
