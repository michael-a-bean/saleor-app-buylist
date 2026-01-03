/**
 * Pricing Rule Engine Types
 *
 * Defines the type system for the flexible pricing rule engine that supports:
 * - Attribute-based conditions (set, rarity, finish, etc.)
 * - Market price conditions
 * - Inventory conditions
 * - Time-based conditions
 * - Complex AND/OR condition logic
 * - Configurable rule stacking (multiplicative or additive)
 */

import type { PricingRuleActionType, RuleStackingMode } from "@prisma/client";
import type { Decimal } from "decimal.js";

// ============================================================================
// CONDITION TYPES
// ============================================================================

/**
 * Types of conditions that can be evaluated
 */
export type ConditionType =
  | "ATTRIBUTE" // Product/variant attributes (setCode, rarity, finish, etc.)
  | "MARKET_PRICE" // Current market price
  | "INVENTORY" // Stock levels (qtyOnHand)
  | "DATE" // Time-based conditions
  | "CATEGORY"; // Product category

/**
 * Comparison operators for conditions
 */
export type ComparisonOperator =
  | "EQUALS"
  | "NOT_EQUALS"
  | "GREATER_THAN"
  | "GREATER_THAN_OR_EQUALS"
  | "LESS_THAN"
  | "LESS_THAN_OR_EQUALS"
  | "IN" // Value in list
  | "NOT_IN" // Value not in list
  | "CONTAINS" // String contains (case-insensitive)
  | "BETWEEN"; // Range (inclusive)

/**
 * A single condition to evaluate
 */
export interface PricingRuleCondition {
  type: ConditionType;
  field: string;
  operator: ComparisonOperator;
  value: ConditionValue;
}

/**
 * Possible values for conditions
 */
export type ConditionValue = string | number | boolean | string[] | number[] | [number, number];

/**
 * A group of conditions with AND/OR logic
 * Can contain both individual conditions and nested groups
 */
export interface PricingRuleConditionGroup {
  operator: "AND" | "OR";
  conditions: Array<PricingRuleCondition | PricingRuleConditionGroup>;
}

/**
 * Type guard to check if a condition is a group
 */
export function isConditionGroup(
  condition: PricingRuleCondition | PricingRuleConditionGroup
): condition is PricingRuleConditionGroup {
  return "operator" in condition && ("AND" === condition.operator || "OR" === condition.operator);
}

// ============================================================================
// EVALUATION CONTEXT
// ============================================================================

/**
 * Product attributes available for rule evaluation
 */
export interface ProductAttributes {
  variantId: string;
  productId: string;

  // MTG-specific attributes
  setCode?: string | null;
  setName?: string | null;
  rarity?: string | null;
  finish?: string | null;
  cardType?: string | null;
  formatLegality?: Record<string, boolean> | null;

  // Generic extensible attributes
  attributes?: Record<string, unknown> | null;

  // Category
  categoryId?: string | null;
  categorySlug?: string | null;
}

/**
 * Inventory data for rule evaluation
 */
export interface InventoryData {
  qtyOnHand: number;
  // Future expansion:
  // avgDailySales?: number;
  // daysOfStock?: number;
  // priceTrend?: 'UP' | 'DOWN' | 'STABLE';
}

/**
 * Time context for date-based conditions
 */
export interface TimeContext {
  now: Date;
  date: string; // YYYY-MM-DD
  year: number;
  month: number; // 1-12
  dayOfMonth: number; // 1-31
  dayOfWeek: number; // 0-6 (Sunday=0)
  hour: number; // 0-23
  minute: number;
}

/**
 * Complete context for evaluating pricing rules
 */
export interface RuleEvaluationContext {
  // Product attributes (from cache or Saleor)
  attributes: ProductAttributes;

  // Current market price
  marketPrice: number;

  // Card condition (NM, LP, MP, HP, DMG)
  condition: string;

  // Inventory data (optional, for inventory-based rules)
  inventory?: InventoryData;

  // Time context (defaults to current time)
  time?: TimeContext;
}

// ============================================================================
// RULE TYPES
// ============================================================================

/**
 * A pricing rule with its conditions and action
 */
export interface PricingRule {
  id: string;
  policyId: string;
  name: string;
  description?: string | null;

  priority: number;
  conditions: PricingRuleConditionGroup;

  actionType: PricingRuleActionType;
  actionValue: number | Decimal;
  stackingMode: RuleStackingMode;

  startsAt?: Date | null;
  endsAt?: Date | null;
  isActive: boolean;
}

/**
 * Result of applying a single rule
 */
export interface RuleApplicationResult {
  ruleId: string;
  ruleName: string;
  actionType: PricingRuleActionType;
  modifier: number;
  stackingMode: RuleStackingMode;
  offerBefore: number;
  offerAfter: number;
}

// ============================================================================
// RULE ENGINE OUTPUT
// ============================================================================

/**
 * Complete result of price calculation with rule breakdown
 */
export interface PriceCalculationResult {
  // Policy info
  policyId: string;
  policyName: string;

  // Input values
  marketPrice: number;
  condition: string;

  // Base calculation (before rules)
  baseOffer: number;
  conditionMultiplier: number;
  offerAfterCondition: number;

  // Rules applied (in order)
  appliedRules: RuleApplicationResult[];

  // Final offer (after all rules and constraints)
  finalOffer: number;

  // Whether min/max constraints were applied
  constraintsApplied: {
    minimumApplied: boolean;
    maximumApplied: boolean;
    originalBeforeConstraints?: number;
  };
}

// ============================================================================
// VALIDATION
// ============================================================================

/**
 * Result of validating a condition structure
 */
export interface ConditionValidationResult {
  valid: boolean;
  errors: string[];
}

/**
 * Supported fields for each condition type
 */
export const SUPPORTED_FIELDS: Record<ConditionType, string[]> = {
  ATTRIBUTE: [
    "setCode",
    "setName",
    "rarity",
    "finish",
    "cardType",
    "formatLegality.standard",
    "formatLegality.modern",
    "formatLegality.legacy",
    "formatLegality.vintage",
    "formatLegality.commander",
    "formatLegality.pioneer",
    "formatLegality.pauper",
  ],
  MARKET_PRICE: ["marketPrice"],
  INVENTORY: ["qtyOnHand"],
  DATE: ["date", "year", "month", "dayOfMonth", "dayOfWeek", "hour"],
  CATEGORY: ["categoryId", "categorySlug"],
};

/**
 * Supported operators for each condition type
 */
export const SUPPORTED_OPERATORS: Record<ConditionType, ComparisonOperator[]> = {
  ATTRIBUTE: ["EQUALS", "NOT_EQUALS", "IN", "NOT_IN", "CONTAINS"],
  MARKET_PRICE: [
    "EQUALS",
    "NOT_EQUALS",
    "GREATER_THAN",
    "GREATER_THAN_OR_EQUALS",
    "LESS_THAN",
    "LESS_THAN_OR_EQUALS",
    "BETWEEN",
  ],
  INVENTORY: [
    "EQUALS",
    "NOT_EQUALS",
    "GREATER_THAN",
    "GREATER_THAN_OR_EQUALS",
    "LESS_THAN",
    "LESS_THAN_OR_EQUALS",
    "BETWEEN",
  ],
  DATE: [
    "EQUALS",
    "NOT_EQUALS",
    "GREATER_THAN",
    "GREATER_THAN_OR_EQUALS",
    "LESS_THAN",
    "LESS_THAN_OR_EQUALS",
    "IN",
    "BETWEEN",
  ],
  CATEGORY: ["EQUALS", "NOT_EQUALS", "IN", "NOT_IN"],
};

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Options for creating a time context
 */
export interface TimeContextOptions {
  /**
   * IANA timezone name (e.g., "America/New_York", "Europe/London")
   * If not provided, uses local system timezone
   */
  timezone?: string;
}

/**
 * Create a time context from a Date object
 *
 * @param date - The date to create context from (default: now)
 * @param options - Options including timezone
 *
 * Timezone handling:
 * - If timezone is provided, the date/time fields reflect that timezone
 * - If not provided, uses local system timezone
 * - The `now` field always contains the original Date object (UTC)
 */
export function createTimeContext(
  date: Date = new Date(),
  options: TimeContextOptions = {}
): TimeContext {
  const { timezone } = options;

  // Get date parts in the specified timezone or local
  let year: number;
  let month: number;
  let dayOfMonth: number;
  let dayOfWeek: number;
  let hour: number;
  let minute: number;
  let dateStr: string;

  if (timezone) {
    try {
      // Use Intl.DateTimeFormat to get timezone-aware parts
      const formatter = new Intl.DateTimeFormat("en-US", {
        timeZone: timezone,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        weekday: "short",
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
      });

      const parts = formatter.formatToParts(date);
      const partMap = new Map(parts.map((p) => [p.type, p.value]));

      year = parseInt(partMap.get("year") ?? "0", 10);
      month = parseInt(partMap.get("month") ?? "0", 10);
      dayOfMonth = parseInt(partMap.get("day") ?? "0", 10);
      hour = parseInt(partMap.get("hour") ?? "0", 10);
      minute = parseInt(partMap.get("minute") ?? "0", 10);

      // Map weekday abbreviation to number
      const weekdayMap: Record<string, number> = {
        Sun: 0,
        Mon: 1,
        Tue: 2,
        Wed: 3,
        Thu: 4,
        Fri: 5,
        Sat: 6,
      };
      dayOfWeek = weekdayMap[partMap.get("weekday") ?? "Sun"] ?? 0;

      // Format date string as YYYY-MM-DD
      dateStr = `${year}-${String(month).padStart(2, "0")}-${String(dayOfMonth).padStart(2, "0")}`;
    } catch {
      // Fallback to local time if timezone is invalid
      return createTimeContext(date);
    }
  } else {
    // Local timezone
    year = date.getFullYear();
    month = date.getMonth() + 1;
    dayOfMonth = date.getDate();
    dayOfWeek = date.getDay();
    hour = date.getHours();
    minute = date.getMinutes();
    dateStr = date.toISOString().split("T")[0];
  }

  return {
    now: date,
    date: dateStr,
    year,
    month,
    dayOfMonth,
    dayOfWeek,
    hour,
    minute,
  };
}

/**
 * Default empty condition group
 */
export const EMPTY_CONDITION_GROUP: PricingRuleConditionGroup = {
  operator: "AND",
  conditions: [],
};
