import { PricingRuleActionType, RuleStackingMode } from "@prisma/client";
import { describe, expect, it } from "vitest";

import { RuleStacker } from "./rule-stacker";
import type { PricingRule } from "./types";

describe("RuleStacker", () => {
  const stacker = new RuleStacker();

  // Helper to create a rule
  const createRule = (
    overrides: Partial<PricingRule> & Pick<PricingRule, "actionType" | "actionValue">
  ): PricingRule => ({
    id: "rule-1",
    policyId: "policy-1",
    name: "Test Rule",
    description: null,
    priority: 100,
    conditions: { operator: "AND", conditions: [] },
    stackingMode: RuleStackingMode.MULTIPLICATIVE,
    startsAt: null,
    endsAt: null,
    isActive: true,
    ...overrides,
  });

  describe("PERCENTAGE_MODIFIER with MULTIPLICATIVE stacking", () => {
    it("applies +10% multiplicative modifier", () => {
      const result = stacker.applyRules({
        baseOffer: 30,
        marketPrice: 50,
        rules: [
          createRule({
            actionType: PricingRuleActionType.PERCENTAGE_MODIFIER,
            actionValue: 10,
            stackingMode: RuleStackingMode.MULTIPLICATIVE,
          }),
        ],
      });

      // $30 × 1.10 = $33
      expect(result.finalOffer).toBe(33);
      expect(result.appliedRules).toHaveLength(1);
      expect(result.appliedRules[0].offerBefore).toBe(30);
      expect(result.appliedRules[0].offerAfter).toBe(33);
    });

    it("stacks multiple multiplicative modifiers", () => {
      const result = stacker.applyRules({
        baseOffer: 30,
        marketPrice: 50,
        rules: [
          createRule({
            id: "rule-1",
            name: "MH3 Bonus",
            actionType: PricingRuleActionType.PERCENTAGE_MODIFIER,
            actionValue: 10,
            stackingMode: RuleStackingMode.MULTIPLICATIVE,
          }),
          createRule({
            id: "rule-2",
            name: "Mythic Premium",
            actionType: PricingRuleActionType.PERCENTAGE_MODIFIER,
            actionValue: 5,
            stackingMode: RuleStackingMode.MULTIPLICATIVE,
          }),
        ],
      });

      // $30 × 1.10 = $33
      // $33 × 1.05 = $34.65
      expect(result.finalOffer).toBe(34.65);
      expect(result.appliedRules).toHaveLength(2);
      expect(result.appliedRules[0].offerAfter).toBe(33);
      expect(result.appliedRules[1].offerAfter).toBeCloseTo(34.65, 2);
    });

    it("applies negative percentage modifier", () => {
      const result = stacker.applyRules({
        baseOffer: 30,
        marketPrice: 50,
        rules: [
          createRule({
            actionType: PricingRuleActionType.PERCENTAGE_MODIFIER,
            actionValue: -10,
            stackingMode: RuleStackingMode.MULTIPLICATIVE,
          }),
        ],
      });

      // $30 × 0.90 = $27
      expect(result.finalOffer).toBe(27);
    });
  });

  describe("PERCENTAGE_MODIFIER with ADDITIVE stacking", () => {
    it("applies +10% additive modifier based on baseOffer", () => {
      const result = stacker.applyRules({
        baseOffer: 30,
        marketPrice: 50,
        rules: [
          createRule({
            actionType: PricingRuleActionType.PERCENTAGE_MODIFIER,
            actionValue: 10,
            stackingMode: RuleStackingMode.ADDITIVE,
          }),
        ],
      });

      // $30 + ($30 × 0.10) = $30 + $3 = $33
      expect(result.finalOffer).toBe(33);
    });

    it("additive modifiers don't compound on each other", () => {
      const result = stacker.applyRules({
        baseOffer: 30,
        marketPrice: 50,
        rules: [
          createRule({
            id: "rule-1",
            actionType: PricingRuleActionType.PERCENTAGE_MODIFIER,
            actionValue: 10,
            stackingMode: RuleStackingMode.ADDITIVE,
          }),
          createRule({
            id: "rule-2",
            actionType: PricingRuleActionType.PERCENTAGE_MODIFIER,
            actionValue: 5,
            stackingMode: RuleStackingMode.ADDITIVE,
          }),
        ],
      });

      // $30 + ($30 × 0.10) = $33
      // $33 + ($30 × 0.05) = $33 + $1.50 = $34.50
      // Note: Both use baseOffer ($30), not the current offer
      expect(result.finalOffer).toBe(34.5);
    });
  });

  describe("Mixed stacking modes", () => {
    it("applies multiplicative then additive rules", () => {
      const result = stacker.applyRules({
        baseOffer: 30,
        marketPrice: 50,
        rules: [
          createRule({
            id: "rule-1",
            name: "Multiplicative First",
            actionType: PricingRuleActionType.PERCENTAGE_MODIFIER,
            actionValue: 10,
            stackingMode: RuleStackingMode.MULTIPLICATIVE,
          }),
          createRule({
            id: "rule-2",
            name: "Additive Second",
            actionType: PricingRuleActionType.PERCENTAGE_MODIFIER,
            actionValue: 5,
            stackingMode: RuleStackingMode.ADDITIVE,
          }),
        ],
      });

      // $30 × 1.10 = $33 (multiplicative)
      // $33 + ($30 × 0.05) = $33 + $1.50 = $34.50 (additive)
      expect(result.finalOffer).toBe(34.5);
    });
  });

  describe("FIXED_MODIFIER", () => {
    it("adds fixed amount", () => {
      const result = stacker.applyRules({
        baseOffer: 30,
        marketPrice: 50,
        rules: [
          createRule({
            actionType: PricingRuleActionType.FIXED_MODIFIER,
            actionValue: 2.5,
          }),
        ],
      });

      // $30 + $2.50 = $32.50
      expect(result.finalOffer).toBe(32.5);
    });

    it("subtracts fixed amount with negative value", () => {
      const result = stacker.applyRules({
        baseOffer: 30,
        marketPrice: 50,
        rules: [
          createRule({
            actionType: PricingRuleActionType.FIXED_MODIFIER,
            actionValue: -5,
          }),
        ],
      });

      // $30 - $5 = $25
      expect(result.finalOffer).toBe(25);
    });
  });

  describe("SET_PERCENTAGE", () => {
    it("sets offer to specific percentage of market price", () => {
      const result = stacker.applyRules({
        baseOffer: 30,
        marketPrice: 50,
        rules: [
          createRule({
            actionType: PricingRuleActionType.SET_PERCENTAGE,
            actionValue: 70,
          }),
        ],
      });

      // $50 × 0.70 = $35 (overrides base offer)
      expect(result.finalOffer).toBe(35);
    });
  });

  describe("SET_MINIMUM", () => {
    it("enforces minimum price when offer is below", () => {
      const result = stacker.applyRules({
        baseOffer: 5,
        marketPrice: 50,
        rules: [
          createRule({
            actionType: PricingRuleActionType.SET_MINIMUM,
            actionValue: 10,
          }),
        ],
      });

      expect(result.finalOffer).toBe(10);
    });

    it("does not change offer when above minimum", () => {
      const result = stacker.applyRules({
        baseOffer: 30,
        marketPrice: 50,
        rules: [
          createRule({
            actionType: PricingRuleActionType.SET_MINIMUM,
            actionValue: 10,
          }),
        ],
      });

      expect(result.finalOffer).toBe(30);
    });
  });

  describe("SET_MAXIMUM", () => {
    it("enforces maximum price when offer is above", () => {
      const result = stacker.applyRules({
        baseOffer: 100,
        marketPrice: 150,
        rules: [
          createRule({
            actionType: PricingRuleActionType.SET_MAXIMUM,
            actionValue: 50,
          }),
        ],
      });

      expect(result.finalOffer).toBe(50);
    });

    it("does not change offer when below maximum", () => {
      const result = stacker.applyRules({
        baseOffer: 30,
        marketPrice: 50,
        rules: [
          createRule({
            actionType: PricingRuleActionType.SET_MAXIMUM,
            actionValue: 100,
          }),
        ],
      });

      expect(result.finalOffer).toBe(30);
    });
  });

  describe("Policy constraints", () => {
    it("applies policy minimum constraint", () => {
      const result = stacker.applyRules({
        baseOffer: 5,
        marketPrice: 50,
        rules: [],
        constraints: {
          minimumPrice: 10,
        },
      });

      expect(result.finalOffer).toBe(10);
      expect(result.constraintsApplied.minimumApplied).toBe(true);
      expect(result.constraintsApplied.originalBeforeConstraints).toBe(5);
    });

    it("applies policy maximum constraint", () => {
      const result = stacker.applyRules({
        baseOffer: 100,
        marketPrice: 150,
        rules: [],
        constraints: {
          maximumPrice: 50,
        },
      });

      expect(result.finalOffer).toBe(50);
      expect(result.constraintsApplied.maximumApplied).toBe(true);
    });

    it("applies both min and max constraints", () => {
      const result = stacker.applyRules({
        baseOffer: 5,
        marketPrice: 50,
        rules: [],
        constraints: {
          minimumPrice: 10,
          maximumPrice: 5, // Max is less than min - unusual but tests both
        },
      });

      // Minimum applied first, then maximum
      expect(result.constraintsApplied.minimumApplied).toBe(true);
      expect(result.constraintsApplied.maximumApplied).toBe(true);
    });

    it("constraints are applied after rules", () => {
      const result = stacker.applyRules({
        baseOffer: 30,
        marketPrice: 50,
        rules: [
          createRule({
            actionType: PricingRuleActionType.PERCENTAGE_MODIFIER,
            actionValue: 50, // +50%
          }),
        ],
        constraints: {
          maximumPrice: 40,
        },
      });

      // $30 × 1.50 = $45, then capped at $40
      expect(result.finalOffer).toBe(40);
      expect(result.constraintsApplied.maximumApplied).toBe(true);
    });
  });

  describe("Rounding", () => {
    it("rounds final offer to 2 decimal places", () => {
      const result = stacker.applyRules({
        baseOffer: 33.333,
        marketPrice: 50,
        rules: [
          createRule({
            actionType: PricingRuleActionType.PERCENTAGE_MODIFIER,
            actionValue: 7,
          }),
        ],
      });

      // $33.333 × 1.07 = $35.66631
      expect(result.finalOffer).toBe(35.67);
    });
  });

  describe("No rules", () => {
    it("returns base offer when no rules", () => {
      const result = stacker.applyRules({
        baseOffer: 30,
        marketPrice: 50,
        rules: [],
      });

      expect(result.finalOffer).toBe(30);
      expect(result.appliedRules).toHaveLength(0);
    });
  });

  describe("previewRule", () => {
    it("previews rule effect without applying", () => {
      const preview = stacker.previewRule(
        30, // currentOffer
        30, // baseOffer
        50, // marketPrice
        PricingRuleActionType.PERCENTAGE_MODIFIER,
        10, // +10%
        RuleStackingMode.MULTIPLICATIVE
      );

      expect(preview.newOffer).toBe(33);
      expect(preview.change).toBe(3);
      expect(preview.changePercent).toBe(10);
    });
  });
});
