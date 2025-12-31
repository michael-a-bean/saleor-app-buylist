import { describe, expect, it } from "vitest";

import { ConditionEvaluator } from "./condition-evaluator";
import type {
  PricingRuleCondition,
  PricingRuleConditionGroup,
  RuleEvaluationContext,
} from "./types";
import { createTimeContext } from "./types";

describe("ConditionEvaluator", () => {
  const evaluator = new ConditionEvaluator();

  // Default test context
  const createContext = (
    overrides: Partial<RuleEvaluationContext> = {}
  ): RuleEvaluationContext => ({
    attributes: {
      variantId: "variant-123",
      productId: "product-456",
      setCode: "MH3",
      setName: "Modern Horizons 3",
      rarity: "mythic",
      finish: "foil",
      cardType: "Creature",
      formatLegality: {
        modern: true,
        legacy: true,
        standard: false,
      },
    },
    marketPrice: 50,
    condition: "NM",
    inventory: { qtyOnHand: 10 },
    time: createTimeContext(new Date("2024-07-15T14:30:00Z")),
    ...overrides,
  });

  describe("ATTRIBUTE conditions", () => {
    it("evaluates EQUALS for string attribute", () => {
      const condition: PricingRuleCondition = {
        type: "ATTRIBUTE",
        field: "setCode",
        operator: "EQUALS",
        value: "MH3",
      };

      expect(evaluator.evaluate(condition, createContext())).toBe(true);
      expect(
        evaluator.evaluate(condition, createContext({
          attributes: { ...createContext().attributes, setCode: "LTR" },
        }))
      ).toBe(false);
    });

    it("evaluates EQUALS case-insensitively", () => {
      const condition: PricingRuleCondition = {
        type: "ATTRIBUTE",
        field: "rarity",
        operator: "EQUALS",
        value: "MYTHIC", // uppercase
      };

      expect(evaluator.evaluate(condition, createContext())).toBe(true);
    });

    it("evaluates NOT_EQUALS", () => {
      const condition: PricingRuleCondition = {
        type: "ATTRIBUTE",
        field: "finish",
        operator: "NOT_EQUALS",
        value: "nonfoil",
      };

      expect(evaluator.evaluate(condition, createContext())).toBe(true);
    });

    it("evaluates IN operator", () => {
      const condition: PricingRuleCondition = {
        type: "ATTRIBUTE",
        field: "setCode",
        operator: "IN",
        value: ["MH3", "LTR", "ONE"],
      };

      expect(evaluator.evaluate(condition, createContext())).toBe(true);
      expect(
        evaluator.evaluate(condition, createContext({
          attributes: { ...createContext().attributes, setCode: "WOE" },
        }))
      ).toBe(false);
    });

    it("evaluates NOT_IN operator", () => {
      const condition: PricingRuleCondition = {
        type: "ATTRIBUTE",
        field: "rarity",
        operator: "NOT_IN",
        value: ["common", "uncommon"],
      };

      expect(evaluator.evaluate(condition, createContext())).toBe(true);
    });

    it("evaluates CONTAINS operator", () => {
      const condition: PricingRuleCondition = {
        type: "ATTRIBUTE",
        field: "setName",
        operator: "CONTAINS",
        value: "Horizons",
      };

      expect(evaluator.evaluate(condition, createContext())).toBe(true);
    });

    it("evaluates nested path for formatLegality", () => {
      const condition: PricingRuleCondition = {
        type: "ATTRIBUTE",
        field: "formatLegality.modern",
        operator: "EQUALS",
        value: true,
      };

      expect(evaluator.evaluate(condition, createContext())).toBe(true);

      const standardCondition: PricingRuleCondition = {
        type: "ATTRIBUTE",
        field: "formatLegality.standard",
        operator: "EQUALS",
        value: true,
      };

      expect(evaluator.evaluate(standardCondition, createContext())).toBe(false);
    });

    it("handles null attribute values", () => {
      const condition: PricingRuleCondition = {
        type: "ATTRIBUTE",
        field: "setCode",
        operator: "EQUALS",
        value: "MH3",
      };

      expect(
        evaluator.evaluate(condition, createContext({
          attributes: { ...createContext().attributes, setCode: null },
        }))
      ).toBe(false);
    });
  });

  describe("MARKET_PRICE conditions", () => {
    it("evaluates EQUALS", () => {
      const condition: PricingRuleCondition = {
        type: "MARKET_PRICE",
        field: "marketPrice",
        operator: "EQUALS",
        value: 50,
      };

      expect(evaluator.evaluate(condition, createContext())).toBe(true);
    });

    it("evaluates GREATER_THAN", () => {
      const condition: PricingRuleCondition = {
        type: "MARKET_PRICE",
        field: "marketPrice",
        operator: "GREATER_THAN",
        value: 20,
      };

      expect(evaluator.evaluate(condition, createContext())).toBe(true);
      expect(evaluator.evaluate(condition, createContext({ marketPrice: 10 }))).toBe(false);
    });

    it("evaluates LESS_THAN_OR_EQUALS", () => {
      const condition: PricingRuleCondition = {
        type: "MARKET_PRICE",
        field: "marketPrice",
        operator: "LESS_THAN_OR_EQUALS",
        value: 50,
      };

      expect(evaluator.evaluate(condition, createContext())).toBe(true);
      expect(evaluator.evaluate(condition, createContext({ marketPrice: 51 }))).toBe(false);
    });

    it("evaluates BETWEEN", () => {
      const condition: PricingRuleCondition = {
        type: "MARKET_PRICE",
        field: "marketPrice",
        operator: "BETWEEN",
        value: [20, 100],
      };

      expect(evaluator.evaluate(condition, createContext())).toBe(true);
      expect(evaluator.evaluate(condition, createContext({ marketPrice: 10 }))).toBe(false);
      expect(evaluator.evaluate(condition, createContext({ marketPrice: 150 }))).toBe(false);
    });
  });

  describe("INVENTORY conditions", () => {
    it("evaluates qtyOnHand GREATER_THAN", () => {
      const condition: PricingRuleCondition = {
        type: "INVENTORY",
        field: "qtyOnHand",
        operator: "GREATER_THAN",
        value: 5,
      };

      expect(evaluator.evaluate(condition, createContext())).toBe(true);
      expect(evaluator.evaluate(condition, createContext({ inventory: { qtyOnHand: 3 } }))).toBe(false);
    });

    it("evaluates qtyOnHand EQUALS zero (out of stock)", () => {
      const condition: PricingRuleCondition = {
        type: "INVENTORY",
        field: "qtyOnHand",
        operator: "EQUALS",
        value: 0,
      };

      expect(evaluator.evaluate(condition, createContext({ inventory: { qtyOnHand: 0 } }))).toBe(true);
      expect(evaluator.evaluate(condition, createContext())).toBe(false);
    });

    it("returns false when no inventory data", () => {
      const condition: PricingRuleCondition = {
        type: "INVENTORY",
        field: "qtyOnHand",
        operator: "GREATER_THAN",
        value: 0,
      };

      expect(evaluator.evaluate(condition, createContext({ inventory: undefined }))).toBe(false);
    });
  });

  describe("DATE conditions", () => {
    it("evaluates month IN (summer promo)", () => {
      const condition: PricingRuleCondition = {
        type: "DATE",
        field: "month",
        operator: "IN",
        value: [6, 7, 8], // June, July, August
      };

      // Context is July 15
      expect(evaluator.evaluate(condition, createContext())).toBe(true);

      // January
      expect(
        evaluator.evaluate(condition, createContext({
          time: createTimeContext(new Date("2024-01-15")),
        }))
      ).toBe(false);
    });

    it("evaluates dayOfWeek for weekday vs weekend", () => {
      const weekdayCondition: PricingRuleCondition = {
        type: "DATE",
        field: "dayOfWeek",
        operator: "IN",
        value: [1, 2, 3, 4, 5], // Mon-Fri
      };

      // July 15, 2024 is Monday (dayOfWeek = 1)
      expect(evaluator.evaluate(weekdayCondition, createContext())).toBe(true);

      // July 14, 2024 is Sunday (dayOfWeek = 0)
      expect(
        evaluator.evaluate(weekdayCondition, createContext({
          time: createTimeContext(new Date("2024-07-14")),
        }))
      ).toBe(false);
    });

    it("evaluates date BETWEEN for date range", () => {
      const condition: PricingRuleCondition = {
        type: "DATE",
        field: "date",
        operator: "BETWEEN",
        value: ["2024-06-01", "2024-08-31"],
      };

      // July 15 is within the range
      expect(evaluator.evaluate(condition, createContext())).toBe(true);

      // May 15 is before the range - use explicit UTC date to avoid timezone issues
      expect(
        evaluator.evaluate(condition, createContext({
          time: createTimeContext(new Date("2024-05-15T12:00:00Z")),
        }))
      ).toBe(false);

      // September 15 is after the range
      expect(
        evaluator.evaluate(condition, createContext({
          time: createTimeContext(new Date("2024-09-15T12:00:00Z")),
        }))
      ).toBe(false);
    });
  });

  describe("Condition groups (AND/OR)", () => {
    it("evaluates AND group - all must match", () => {
      const group: PricingRuleConditionGroup = {
        operator: "AND",
        conditions: [
          { type: "ATTRIBUTE", field: "setCode", operator: "EQUALS", value: "MH3" },
          { type: "ATTRIBUTE", field: "rarity", operator: "EQUALS", value: "mythic" },
          { type: "MARKET_PRICE", field: "marketPrice", operator: "GREATER_THAN", value: 20 },
        ],
      };

      expect(evaluator.evaluate(group, createContext())).toBe(true);

      // Change one condition to fail
      expect(
        evaluator.evaluate(group, createContext({
          attributes: { ...createContext().attributes, rarity: "common" },
        }))
      ).toBe(false);
    });

    it("evaluates OR group - any must match", () => {
      const group: PricingRuleConditionGroup = {
        operator: "OR",
        conditions: [
          { type: "ATTRIBUTE", field: "setCode", operator: "EQUALS", value: "MH3" },
          { type: "ATTRIBUTE", field: "setCode", operator: "EQUALS", value: "LTR" },
          { type: "ATTRIBUTE", field: "setCode", operator: "EQUALS", value: "ONE" },
        ],
      };

      expect(evaluator.evaluate(group, createContext())).toBe(true);
      expect(
        evaluator.evaluate(group, createContext({
          attributes: { ...createContext().attributes, setCode: "LTR" },
        }))
      ).toBe(true);
      expect(
        evaluator.evaluate(group, createContext({
          attributes: { ...createContext().attributes, setCode: "WOE" },
        }))
      ).toBe(false);
    });

    it("evaluates nested groups", () => {
      // (set = MH3 OR set = LTR) AND rarity = mythic AND price > 20
      const group: PricingRuleConditionGroup = {
        operator: "AND",
        conditions: [
          {
            operator: "OR",
            conditions: [
              { type: "ATTRIBUTE", field: "setCode", operator: "EQUALS", value: "MH3" },
              { type: "ATTRIBUTE", field: "setCode", operator: "EQUALS", value: "LTR" },
            ],
          },
          { type: "ATTRIBUTE", field: "rarity", operator: "EQUALS", value: "mythic" },
          { type: "MARKET_PRICE", field: "marketPrice", operator: "GREATER_THAN", value: 20 },
        ],
      };

      expect(evaluator.evaluate(group, createContext())).toBe(true);

      // Different set that's not in the OR group
      expect(
        evaluator.evaluate(group, createContext({
          attributes: { ...createContext().attributes, setCode: "WOE" },
        }))
      ).toBe(false);

      // In the OR group but wrong rarity
      expect(
        evaluator.evaluate(group, createContext({
          attributes: { ...createContext().attributes, setCode: "LTR", rarity: "common" },
        }))
      ).toBe(false);
    });

    it("empty condition group always matches", () => {
      const group: PricingRuleConditionGroup = {
        operator: "AND",
        conditions: [],
      };

      expect(evaluator.evaluate(group, createContext())).toBe(true);
    });
  });

  describe("validateCondition", () => {
    it("validates valid condition", () => {
      const condition: PricingRuleCondition = {
        type: "ATTRIBUTE",
        field: "setCode",
        operator: "EQUALS",
        value: "MH3",
      };

      const result = evaluator.validateCondition(condition);
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it("validates valid nested group", () => {
      const group: PricingRuleConditionGroup = {
        operator: "AND",
        conditions: [
          { type: "ATTRIBUTE", field: "setCode", operator: "EQUALS", value: "MH3" },
          {
            operator: "OR",
            conditions: [
              { type: "MARKET_PRICE", field: "marketPrice", operator: "GREATER_THAN", value: 10 },
              { type: "INVENTORY", field: "qtyOnHand", operator: "LESS_THAN", value: 5 },
            ],
          },
        ],
      };

      const result = evaluator.validateCondition(group);
      expect(result.valid).toBe(true);
    });

    it("rejects invalid condition type", () => {
      const condition = {
        type: "INVALID_TYPE" as "ATTRIBUTE",
        field: "setCode",
        operator: "EQUALS" as const,
        value: "MH3",
      };

      const result = evaluator.validateCondition(condition);
      expect(result.valid).toBe(false);
      expect(result.errors).toContain("Invalid condition type: INVALID_TYPE");
    });

    it("rejects invalid operator for condition type", () => {
      const condition: PricingRuleCondition = {
        type: "ATTRIBUTE",
        field: "setCode",
        operator: "BETWEEN", // BETWEEN is not valid for ATTRIBUTE
        value: ["A", "Z"],
      };

      const result = evaluator.validateCondition(condition);
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.includes("Invalid operator"))).toBe(true);
    });

    it("rejects IN operator without array value", () => {
      const condition: PricingRuleCondition = {
        type: "ATTRIBUTE",
        field: "setCode",
        operator: "IN",
        value: "MH3", // Should be array
      };

      const result = evaluator.validateCondition(condition);
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.includes("array"))).toBe(true);
    });

    it("rejects BETWEEN without 2-element array", () => {
      const condition: PricingRuleCondition = {
        type: "MARKET_PRICE",
        field: "marketPrice",
        operator: "BETWEEN",
        value: [10], // Should have 2 elements
      };

      const result = evaluator.validateCondition(condition);
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.includes("2 values"))).toBe(true);
    });
  });
});
