/**
 * Rule Matcher
 *
 * Finds rules that match a given evaluation context.
 * Handles time-based activation and priority ordering.
 */

import { conditionEvaluator } from "./condition-evaluator";
import type {
  PricingRule,
  PricingRuleConditionGroup,
  RuleEvaluationContext,
} from "./types";
import { createTimeContext } from "./types";

/**
 * Options for rule matching
 */
export interface RuleMatcherOptions {
  /** Include inactive rules (for testing/preview) */
  includeInactive?: boolean;
  /** Override current time (for testing) */
  evaluationTime?: Date;
}

/**
 * Finds and filters pricing rules that match a context
 */
export class RuleMatcher {
  /**
   * Find all rules that match the given context
   * Returns rules sorted by priority (ascending - lower numbers first)
   */
  findMatchingRules(
    rules: PricingRule[],
    context: RuleEvaluationContext,
    options: RuleMatcherOptions = {}
  ): PricingRule[] {
    const { includeInactive = false, evaluationTime } = options;
    const now = evaluationTime ?? new Date();

    // Ensure context has time information
    const contextWithTime: RuleEvaluationContext = {
      ...context,
      time: context.time ?? createTimeContext(now),
    };

    // Filter rules
    const matchingRules = rules.filter((rule) => {
      // Check if rule is active
      if (!includeInactive && !rule.isActive) {
        return false;
      }

      // Check time-based activation
      if (!this.isRuleActiveAtTime(rule, now)) {
        return false;
      }

      // Evaluate conditions
      return this.evaluateRuleConditions(rule, contextWithTime);
    });

    // Sort by priority (ascending - lower numbers first)
    return matchingRules.sort((a, b) => a.priority - b.priority);
  }

  /**
   * Check if a rule is active at the given time
   */
  isRuleActiveAtTime(rule: PricingRule, time: Date): boolean {
    const { startsAt, endsAt } = rule;

    // If no time constraints, rule is always active
    if (!startsAt && !endsAt) {
      return true;
    }

    // Check start time
    if (startsAt && time < startsAt) {
      return false;
    }

    // Check end time
    if (endsAt && time > endsAt) {
      return false;
    }

    return true;
  }

  /**
   * Evaluate a rule's conditions against the context
   */
  evaluateRuleConditions(rule: PricingRule, context: RuleEvaluationContext): boolean {
    const conditions = rule.conditions;

    // Empty conditions always match
    if (!conditions || !conditions.conditions || conditions.conditions.length === 0) {
      return true;
    }

    return conditionEvaluator.evaluate(conditions, context);
  }

  /**
   * Parse conditions from JSON (handles both string and object)
   */
  parseConditions(conditions: unknown): PricingRuleConditionGroup {
    if (typeof conditions === "string") {
      return JSON.parse(conditions) as PricingRuleConditionGroup;
    }
    return conditions as PricingRuleConditionGroup;
  }

  /**
   * Check if a single rule matches (for preview/testing)
   */
  doesRuleMatch(
    rule: PricingRule,
    context: RuleEvaluationContext,
    options: RuleMatcherOptions = {}
  ): boolean {
    const matchingRules = this.findMatchingRules([rule], context, options);
    return matchingRules.length > 0;
  }

  /**
   * Get rules grouped by whether they match
   */
  categorizeRules(
    rules: PricingRule[],
    context: RuleEvaluationContext,
    options: RuleMatcherOptions = {}
  ): { matching: PricingRule[]; notMatching: PricingRule[] } {
    const matching: PricingRule[] = [];
    const notMatching: PricingRule[] = [];

    const { includeInactive = false, evaluationTime } = options;
    const now = evaluationTime ?? new Date();

    const contextWithTime: RuleEvaluationContext = {
      ...context,
      time: context.time ?? createTimeContext(now),
    };

    for (const rule of rules) {
      // Skip inactive rules unless explicitly included
      if (!includeInactive && !rule.isActive) {
        notMatching.push(rule);
        continue;
      }

      // Check time-based activation
      if (!this.isRuleActiveAtTime(rule, now)) {
        notMatching.push(rule);
        continue;
      }

      // Evaluate conditions
      if (this.evaluateRuleConditions(rule, contextWithTime)) {
        matching.push(rule);
      } else {
        notMatching.push(rule);
      }
    }

    // Sort matching by priority
    matching.sort((a, b) => a.priority - b.priority);

    return { matching, notMatching };
  }
}

// Export singleton instance
export const ruleMatcher = new RuleMatcher();
