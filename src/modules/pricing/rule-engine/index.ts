/**
 * Pricing Rule Engine
 *
 * Exports for the pricing rule engine system.
 */

// Types
export * from "./types";

// Condition evaluator
export { ConditionEvaluator, conditionEvaluator } from "./condition-evaluator";

// Rule matcher
export { RuleMatcher, ruleMatcher, type RuleMatcherOptions } from "./rule-matcher";

// Rule stacker
export {
  RuleStacker,
  ruleStacker,
  type RuleStackerInput,
  type RuleStackerOutput,
} from "./rule-stacker";

// Main engine
export {
  type CalculatePriceInput,
  DEFAULT_CONDITION_MULTIPLIERS,
  RuleEngine,
  ruleEngine,
} from "./rule-engine";
