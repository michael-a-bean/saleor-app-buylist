/**
 * Rule Matcher Tests
 *
 * Tests for rule matching, time-based activation, and priority ordering.
 */
import { PricingRuleActionType, RuleStackingMode } from "@prisma/client";
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

import { RuleMatcher } from "./rule-matcher";
import type { PricingRule, RuleEvaluationContext } from "./types";
import { createTimeContext } from "./types";

describe("RuleMatcher", () => {
  const matcher = new RuleMatcher();

  // Helper to create a rule
  const createRule = (overrides: Partial<PricingRule> = {}): PricingRule => ({
    id: `rule-${Math.random().toString(36).slice(2, 8)}`,
    policyId: "policy-1",
    name: "Test Rule",
    description: null,
    priority: 100,
    conditions: { operator: "AND", conditions: [] },
    actionType: PricingRuleActionType.PERCENTAGE_MODIFIER,
    actionValue: 10,
    stackingMode: RuleStackingMode.MULTIPLICATIVE,
    startsAt: null,
    endsAt: null,
    isActive: true,
    ...overrides,
  });

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
    },
    marketPrice: 50,
    condition: "NM",
    inventory: { qtyOnHand: 10 },
    time: createTimeContext(new Date("2024-07-15T14:30:00Z")),
    ...overrides,
  });

  describe("isRuleActiveAtTime", () => {
    describe("No time constraints", () => {
      it("should return true when rule has no startsAt or endsAt", () => {
        const rule = createRule({ startsAt: null, endsAt: null });
        const now = new Date("2024-07-15T14:30:00Z");

        expect(matcher.isRuleActiveAtTime(rule, now)).toBe(true);
      });
    });

    describe("startsAt constraint (inclusive)", () => {
      it("should return false before startsAt", () => {
        const rule = createRule({
          startsAt: new Date("2024-07-15T12:00:00Z"),
          endsAt: null,
        });
        const beforeStart = new Date("2024-07-15T11:59:59Z");

        expect(matcher.isRuleActiveAtTime(rule, beforeStart)).toBe(false);
      });

      it("should return true exactly at startsAt", () => {
        const startsAt = new Date("2024-07-15T12:00:00Z");
        const rule = createRule({ startsAt, endsAt: null });

        expect(matcher.isRuleActiveAtTime(rule, startsAt)).toBe(true);
      });

      it("should return true after startsAt", () => {
        const rule = createRule({
          startsAt: new Date("2024-07-15T12:00:00Z"),
          endsAt: null,
        });
        const afterStart = new Date("2024-07-15T12:00:01Z");

        expect(matcher.isRuleActiveAtTime(rule, afterStart)).toBe(true);
      });
    });

    describe("endsAt constraint (exclusive)", () => {
      it("should return true before endsAt", () => {
        const rule = createRule({
          startsAt: null,
          endsAt: new Date("2024-07-15T18:00:00Z"),
        });
        const beforeEnd = new Date("2024-07-15T17:59:59Z");

        expect(matcher.isRuleActiveAtTime(rule, beforeEnd)).toBe(true);
      });

      it("should return false exactly at endsAt", () => {
        const endsAt = new Date("2024-07-15T18:00:00Z");
        const rule = createRule({ startsAt: null, endsAt });

        expect(matcher.isRuleActiveAtTime(rule, endsAt)).toBe(false);
      });

      it("should return false after endsAt", () => {
        const rule = createRule({
          startsAt: null,
          endsAt: new Date("2024-07-15T18:00:00Z"),
        });
        const afterEnd = new Date("2024-07-15T18:00:01Z");

        expect(matcher.isRuleActiveAtTime(rule, afterEnd)).toBe(false);
      });
    });

    describe("Both startsAt and endsAt (half-open interval [startsAt, endsAt))", () => {
      const rule = createRule({
        startsAt: new Date("2024-07-15T09:00:00Z"),
        endsAt: new Date("2024-07-15T17:00:00Z"),
      });

      it("should return false before window", () => {
        expect(matcher.isRuleActiveAtTime(rule, new Date("2024-07-15T08:59:59Z"))).toBe(false);
      });

      it("should return true at start of window", () => {
        expect(matcher.isRuleActiveAtTime(rule, new Date("2024-07-15T09:00:00Z"))).toBe(true);
      });

      it("should return true during window", () => {
        expect(matcher.isRuleActiveAtTime(rule, new Date("2024-07-15T12:00:00Z"))).toBe(true);
      });

      it("should return false at end of window", () => {
        expect(matcher.isRuleActiveAtTime(rule, new Date("2024-07-15T17:00:00Z"))).toBe(false);
      });

      it("should return false after window", () => {
        expect(matcher.isRuleActiveAtTime(rule, new Date("2024-07-15T17:00:01Z"))).toBe(false);
      });
    });

    describe("Multi-day windows", () => {
      it("should handle rules that span multiple days", () => {
        const rule = createRule({
          startsAt: new Date("2024-07-01T00:00:00Z"),
          endsAt: new Date("2024-07-31T23:59:59Z"),
        });

        expect(matcher.isRuleActiveAtTime(rule, new Date("2024-06-30T23:59:59Z"))).toBe(false);
        expect(matcher.isRuleActiveAtTime(rule, new Date("2024-07-15T12:00:00Z"))).toBe(true);
        expect(matcher.isRuleActiveAtTime(rule, new Date("2024-07-31T23:59:59Z"))).toBe(false);
      });

      it("should handle rules that span multiple months", () => {
        const rule = createRule({
          startsAt: new Date("2024-01-01T00:00:00Z"),
          endsAt: new Date("2024-12-31T23:59:59Z"),
        });

        expect(matcher.isRuleActiveAtTime(rule, new Date("2023-12-31T23:59:59Z"))).toBe(false);
        expect(matcher.isRuleActiveAtTime(rule, new Date("2024-06-15T12:00:00Z"))).toBe(true);
        expect(matcher.isRuleActiveAtTime(rule, new Date("2024-12-31T23:59:59Z"))).toBe(false);
      });
    });
  });

  describe("findMatchingRules", () => {
    describe("Active/Inactive filtering", () => {
      it("should exclude inactive rules by default", () => {
        const rules = [
          createRule({ id: "active-1", isActive: true }),
          createRule({ id: "inactive-1", isActive: false }),
          createRule({ id: "active-2", isActive: true }),
        ];

        const result = matcher.findMatchingRules(rules, createContext());

        expect(result).toHaveLength(2);
        expect(result.map((r) => r.id)).toEqual(["active-1", "active-2"]);
      });

      it("should include inactive rules when includeInactive is true", () => {
        const rules = [
          createRule({ id: "active-1", isActive: true }),
          createRule({ id: "inactive-1", isActive: false }),
        ];

        const result = matcher.findMatchingRules(rules, createContext(), {
          includeInactive: true,
        });

        expect(result).toHaveLength(2);
        expect(result.map((r) => r.id)).toContain("inactive-1");
      });
    });

    describe("Time-based filtering", () => {
      it("should exclude rules not yet started", () => {
        const rules = [
          createRule({
            id: "future-rule",
            startsAt: new Date("2024-08-01T00:00:00Z"),
          }),
          createRule({ id: "no-time-constraint" }),
        ];

        const result = matcher.findMatchingRules(rules, createContext(), {
          evaluationTime: new Date("2024-07-15T12:00:00Z"),
        });

        expect(result).toHaveLength(1);
        expect(result[0].id).toBe("no-time-constraint");
      });

      it("should exclude rules that have ended", () => {
        const rules = [
          createRule({
            id: "expired-rule",
            endsAt: new Date("2024-07-01T00:00:00Z"),
          }),
          createRule({ id: "no-time-constraint" }),
        ];

        const result = matcher.findMatchingRules(rules, createContext(), {
          evaluationTime: new Date("2024-07-15T12:00:00Z"),
        });

        expect(result).toHaveLength(1);
        expect(result[0].id).toBe("no-time-constraint");
      });

      it("should include rules within their time window", () => {
        const rules = [
          createRule({
            id: "active-window",
            startsAt: new Date("2024-07-01T00:00:00Z"),
            endsAt: new Date("2024-07-31T23:59:59Z"),
          }),
        ];

        const result = matcher.findMatchingRules(rules, createContext(), {
          evaluationTime: new Date("2024-07-15T12:00:00Z"),
        });

        expect(result).toHaveLength(1);
      });
    });

    describe("Condition-based filtering", () => {
      it("should exclude rules whose conditions don't match", () => {
        const rules = [
          createRule({
            id: "set-match",
            conditions: {
              operator: "AND",
              conditions: [
                { type: "ATTRIBUTE", field: "setCode", operator: "EQUALS", value: "MH3" },
              ],
            },
          }),
          createRule({
            id: "set-no-match",
            conditions: {
              operator: "AND",
              conditions: [
                { type: "ATTRIBUTE", field: "setCode", operator: "EQUALS", value: "LTR" },
              ],
            },
          }),
        ];

        const result = matcher.findMatchingRules(rules, createContext());

        expect(result).toHaveLength(1);
        expect(result[0].id).toBe("set-match");
      });

      it("should include rules with empty conditions (match all)", () => {
        const rules = [
          createRule({
            id: "catch-all",
            conditions: { operator: "AND", conditions: [] },
          }),
        ];

        const result = matcher.findMatchingRules(rules, createContext());

        expect(result).toHaveLength(1);
      });
    });

    describe("Priority sorting", () => {
      it("should sort rules by priority ascending (lower numbers first)", () => {
        const rules = [
          createRule({ id: "low-priority", priority: 200 }),
          createRule({ id: "high-priority", priority: 50 }),
          createRule({ id: "medium-priority", priority: 100 }),
        ];

        const result = matcher.findMatchingRules(rules, createContext());

        expect(result.map((r) => r.id)).toEqual([
          "high-priority",
          "medium-priority",
          "low-priority",
        ]);
      });

      it("should maintain stable order for equal priorities", () => {
        const rules = [
          createRule({ id: "first", priority: 100 }),
          createRule({ id: "second", priority: 100 }),
          createRule({ id: "third", priority: 100 }),
        ];

        const result = matcher.findMatchingRules(rules, createContext());

        // JavaScript's sort is stable, so original order should be preserved
        expect(result.map((r) => r.id)).toEqual(["first", "second", "third"]);
      });

      it("should sort matched rules only (after filtering)", () => {
        const rules = [
          createRule({
            id: "low-priority-matching",
            priority: 200,
            conditions: {
              operator: "AND",
              conditions: [
                { type: "ATTRIBUTE", field: "setCode", operator: "EQUALS", value: "MH3" },
              ],
            },
          }),
          createRule({
            id: "high-priority-non-matching",
            priority: 10,
            conditions: {
              operator: "AND",
              conditions: [
                { type: "ATTRIBUTE", field: "setCode", operator: "EQUALS", value: "LTR" },
              ],
            },
          }),
          createRule({
            id: "medium-priority-matching",
            priority: 100,
            conditions: {
              operator: "AND",
              conditions: [
                { type: "ATTRIBUTE", field: "setCode", operator: "EQUALS", value: "MH3" },
              ],
            },
          }),
        ];

        const result = matcher.findMatchingRules(rules, createContext());

        expect(result).toHaveLength(2);
        expect(result.map((r) => r.id)).toEqual([
          "medium-priority-matching",
          "low-priority-matching",
        ]);
      });
    });

    describe("Complex scenarios", () => {
      it("should handle multiple filter criteria simultaneously", () => {
        const now = new Date("2024-07-15T14:30:00Z");
        const rules = [
          // Active, in time window, conditions match
          createRule({
            id: "should-match",
            isActive: true,
            startsAt: new Date("2024-07-01T00:00:00Z"),
            endsAt: new Date("2024-07-31T23:59:59Z"),
            conditions: {
              operator: "AND",
              conditions: [
                { type: "ATTRIBUTE", field: "setCode", operator: "EQUALS", value: "MH3" },
              ],
            },
          }),
          // Inactive
          createRule({
            id: "inactive",
            isActive: false,
            conditions: {
              operator: "AND",
              conditions: [
                { type: "ATTRIBUTE", field: "setCode", operator: "EQUALS", value: "MH3" },
              ],
            },
          }),
          // Wrong time window
          createRule({
            id: "wrong-time",
            isActive: true,
            startsAt: new Date("2024-08-01T00:00:00Z"),
            conditions: {
              operator: "AND",
              conditions: [
                { type: "ATTRIBUTE", field: "setCode", operator: "EQUALS", value: "MH3" },
              ],
            },
          }),
          // Conditions don't match
          createRule({
            id: "wrong-conditions",
            isActive: true,
            conditions: {
              operator: "AND",
              conditions: [
                { type: "ATTRIBUTE", field: "setCode", operator: "EQUALS", value: "LTR" },
              ],
            },
          }),
        ];

        const result = matcher.findMatchingRules(rules, createContext(), {
          evaluationTime: now,
        });

        expect(result).toHaveLength(1);
        expect(result[0].id).toBe("should-match");
      });
    });
  });

  describe("doesRuleMatch", () => {
    it("should return true for matching rule", () => {
      const rule = createRule({
        conditions: {
          operator: "AND",
          conditions: [
            { type: "ATTRIBUTE", field: "setCode", operator: "EQUALS", value: "MH3" },
          ],
        },
      });

      expect(matcher.doesRuleMatch(rule, createContext())).toBe(true);
    });

    it("should return false for non-matching rule", () => {
      const rule = createRule({
        conditions: {
          operator: "AND",
          conditions: [
            { type: "ATTRIBUTE", field: "setCode", operator: "EQUALS", value: "LTR" },
          ],
        },
      });

      expect(matcher.doesRuleMatch(rule, createContext())).toBe(false);
    });

    it("should respect time constraints", () => {
      const rule = createRule({
        startsAt: new Date("2024-08-01T00:00:00Z"),
      });

      expect(
        matcher.doesRuleMatch(rule, createContext(), {
          evaluationTime: new Date("2024-07-15T12:00:00Z"),
        })
      ).toBe(false);
    });
  });

  describe("categorizeRules", () => {
    it("should separate matching and non-matching rules", () => {
      const rules = [
        createRule({
          id: "matching-1",
          conditions: {
            operator: "AND",
            conditions: [
              { type: "ATTRIBUTE", field: "setCode", operator: "EQUALS", value: "MH3" },
            ],
          },
        }),
        createRule({
          id: "non-matching",
          conditions: {
            operator: "AND",
            conditions: [
              { type: "ATTRIBUTE", field: "setCode", operator: "EQUALS", value: "LTR" },
            ],
          },
        }),
        createRule({
          id: "matching-2",
          conditions: {
            operator: "AND",
            conditions: [
              { type: "ATTRIBUTE", field: "rarity", operator: "EQUALS", value: "mythic" },
            ],
          },
        }),
      ];

      const result = matcher.categorizeRules(rules, createContext());

      expect(result.matching).toHaveLength(2);
      expect(result.notMatching).toHaveLength(1);
      expect(result.matching.map((r) => r.id)).toContain("matching-1");
      expect(result.matching.map((r) => r.id)).toContain("matching-2");
      expect(result.notMatching[0].id).toBe("non-matching");
    });

    it("should sort matching rules by priority", () => {
      const rules = [
        createRule({ id: "low", priority: 300 }),
        createRule({ id: "high", priority: 50 }),
        createRule({ id: "medium", priority: 150 }),
      ];

      const result = matcher.categorizeRules(rules, createContext());

      expect(result.matching.map((r) => r.id)).toEqual(["high", "medium", "low"]);
    });

    it("should include inactive rules in notMatching by default", () => {
      const rules = [
        createRule({ id: "active", isActive: true }),
        createRule({ id: "inactive", isActive: false }),
      ];

      const result = matcher.categorizeRules(rules, createContext());

      expect(result.matching).toHaveLength(1);
      expect(result.notMatching).toHaveLength(1);
      expect(result.notMatching[0].id).toBe("inactive");
    });

    it("should evaluate inactive rules when includeInactive is true", () => {
      const rules = [
        createRule({
          id: "inactive-matching",
          isActive: false,
          conditions: {
            operator: "AND",
            conditions: [
              { type: "ATTRIBUTE", field: "setCode", operator: "EQUALS", value: "MH3" },
            ],
          },
        }),
      ];

      const result = matcher.categorizeRules(rules, createContext(), {
        includeInactive: true,
      });

      expect(result.matching).toHaveLength(1);
      expect(result.matching[0].id).toBe("inactive-matching");
    });
  });

  describe("parseConditions", () => {
    it("should parse JSON string conditions", () => {
      const jsonConditions = JSON.stringify({
        operator: "AND",
        conditions: [
          { type: "ATTRIBUTE", field: "setCode", operator: "EQUALS", value: "MH3" },
        ],
      });

      const result = matcher.parseConditions(jsonConditions);

      expect(result.operator).toBe("AND");
      expect(result.conditions).toHaveLength(1);
    });

    it("should return object conditions as-is", () => {
      const conditions = {
        operator: "OR" as const,
        conditions: [
          { type: "ATTRIBUTE" as const, field: "setCode", operator: "EQUALS" as const, value: "MH3" },
        ],
      };

      const result = matcher.parseConditions(conditions);

      expect(result).toEqual(conditions);
    });
  });

  describe("Edge cases", () => {
    it("should handle empty rules array", () => {
      const result = matcher.findMatchingRules([], createContext());

      expect(result).toEqual([]);
    });

    it("should handle context with minimal attributes", () => {
      const minimalContext: RuleEvaluationContext = {
        attributes: {
          variantId: "v1",
          productId: "p1",
        },
        marketPrice: 10,
        condition: "NM",
      };

      const rules = [
        createRule({
          conditions: { operator: "AND", conditions: [] },
        }),
      ];

      const result = matcher.findMatchingRules(rules, minimalContext);

      expect(result).toHaveLength(1);
    });

    it("should handle rules with null conditions", () => {
      const rule = {
        ...createRule(),
        conditions: null as unknown as PricingRule["conditions"],
      };

      // The evaluateRuleConditions should handle null gracefully
      const result = matcher.evaluateRuleConditions(rule, createContext());
      expect(result).toBe(true); // null/empty conditions match everything
    });
  });
});
