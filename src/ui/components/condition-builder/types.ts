/**
 * UI types for the condition builder
 */

import type { PricingRuleCondition, PricingRuleConditionGroup } from "@/modules/pricing/rule-engine";

/**
 * Field definition for condition builder
 */
export interface ConditionFieldDefinition {
  value: string;
  label: string;
  type: "ATTRIBUTE" | "MARKET_PRICE" | "INVENTORY" | "DATE" | "CATEGORY";
  /** Value type for the input */
  valueType: "string" | "number" | "boolean" | "select" | "multiselect";
  /** Options for select/multiselect fields */
  options?: Array<{ value: string; label: string }>;
  /** Placeholder text */
  placeholder?: string;
}

/**
 * Operator definition
 */
export interface OperatorDefinition {
  value: string;
  label: string;
  /** Whether this operator requires two values (for BETWEEN) */
  isBetween?: boolean;
  /** Whether this operator requires an array value */
  isArray?: boolean;
}

/**
 * Available fields for conditions
 */
export const CONDITION_FIELDS: ConditionFieldDefinition[] = [
  // Attribute fields
  {
    value: "setCode",
    label: "Set Code",
    type: "ATTRIBUTE",
    valueType: "string",
    placeholder: "e.g., MH3, LTR, ONE",
  },
  {
    value: "setName",
    label: "Set Name",
    type: "ATTRIBUTE",
    valueType: "string",
    placeholder: "e.g., Modern Horizons 3",
  },
  {
    value: "rarity",
    label: "Rarity",
    type: "ATTRIBUTE",
    valueType: "select",
    options: [
      { value: "common", label: "Common" },
      { value: "uncommon", label: "Uncommon" },
      { value: "rare", label: "Rare" },
      { value: "mythic", label: "Mythic" },
    ],
  },
  {
    value: "finish",
    label: "Finish",
    type: "ATTRIBUTE",
    valueType: "select",
    options: [
      { value: "nonfoil", label: "Non-Foil" },
      { value: "foil", label: "Foil" },
      { value: "etched", label: "Etched" },
    ],
  },
  {
    value: "cardType",
    label: "Card Type",
    type: "ATTRIBUTE",
    valueType: "string",
    placeholder: "e.g., Creature, Instant, Land",
  },
  // Market price fields
  {
    value: "marketPrice",
    label: "Market Price",
    type: "MARKET_PRICE",
    valueType: "number",
    placeholder: "e.g., 10.00",
  },
  // Inventory fields
  {
    value: "qtyOnHand",
    label: "Quantity on Hand",
    type: "INVENTORY",
    valueType: "number",
    placeholder: "e.g., 5",
  },
  // Date fields
  {
    value: "month",
    label: "Month",
    type: "DATE",
    valueType: "select",
    options: [
      { value: "1", label: "January" },
      { value: "2", label: "February" },
      { value: "3", label: "March" },
      { value: "4", label: "April" },
      { value: "5", label: "May" },
      { value: "6", label: "June" },
      { value: "7", label: "July" },
      { value: "8", label: "August" },
      { value: "9", label: "September" },
      { value: "10", label: "October" },
      { value: "11", label: "November" },
      { value: "12", label: "December" },
    ],
  },
  {
    value: "dayOfWeek",
    label: "Day of Week",
    type: "DATE",
    valueType: "select",
    options: [
      { value: "0", label: "Sunday" },
      { value: "1", label: "Monday" },
      { value: "2", label: "Tuesday" },
      { value: "3", label: "Wednesday" },
      { value: "4", label: "Thursday" },
      { value: "5", label: "Friday" },
      { value: "6", label: "Saturday" },
    ],
  },
  {
    value: "hour",
    label: "Hour (0-23)",
    type: "DATE",
    valueType: "number",
    placeholder: "e.g., 14 for 2pm",
  },
];

/**
 * Operators by condition type
 */
export const OPERATORS_BY_TYPE: Record<string, OperatorDefinition[]> = {
  ATTRIBUTE: [
    { value: "EQUALS", label: "equals" },
    { value: "NOT_EQUALS", label: "does not equal" },
    { value: "IN", label: "is one of", isArray: true },
    { value: "NOT_IN", label: "is not one of", isArray: true },
    { value: "CONTAINS", label: "contains" },
  ],
  MARKET_PRICE: [
    { value: "EQUALS", label: "equals" },
    { value: "NOT_EQUALS", label: "does not equal" },
    { value: "GREATER_THAN", label: "is greater than" },
    { value: "GREATER_THAN_OR_EQUALS", label: "is at least" },
    { value: "LESS_THAN", label: "is less than" },
    { value: "LESS_THAN_OR_EQUALS", label: "is at most" },
    { value: "BETWEEN", label: "is between", isBetween: true },
  ],
  INVENTORY: [
    { value: "EQUALS", label: "equals" },
    { value: "NOT_EQUALS", label: "does not equal" },
    { value: "GREATER_THAN", label: "is greater than" },
    { value: "GREATER_THAN_OR_EQUALS", label: "is at least" },
    { value: "LESS_THAN", label: "is less than" },
    { value: "LESS_THAN_OR_EQUALS", label: "is at most" },
    { value: "BETWEEN", label: "is between", isBetween: true },
  ],
  DATE: [
    { value: "EQUALS", label: "equals" },
    { value: "NOT_EQUALS", label: "does not equal" },
    { value: "IN", label: "is one of", isArray: true },
    { value: "GREATER_THAN", label: "is after" },
    { value: "LESS_THAN", label: "is before" },
    { value: "BETWEEN", label: "is between", isBetween: true },
  ],
  CATEGORY: [
    { value: "EQUALS", label: "equals" },
    { value: "NOT_EQUALS", label: "does not equal" },
    { value: "IN", label: "is one of", isArray: true },
    { value: "NOT_IN", label: "is not one of", isArray: true },
  ],
};

/**
 * Get field definition by value
 */
export function getFieldDefinition(fieldValue: string): ConditionFieldDefinition | undefined {
  return CONDITION_FIELDS.find((f) => f.value === fieldValue);
}

/**
 * Get operators for a field
 */
export function getOperatorsForField(fieldValue: string): OperatorDefinition[] {
  const field = getFieldDefinition(fieldValue);
  if (!field) return [];
  return OPERATORS_BY_TYPE[field.type] ?? [];
}

/**
 * Type guard for condition group
 */
export function isConditionGroup(
  item: PricingRuleCondition | PricingRuleConditionGroup
): item is PricingRuleConditionGroup {
  return "operator" in item && ("AND" === item.operator || "OR" === item.operator);
}

/**
 * Create an empty condition
 */
export function createEmptyCondition(): PricingRuleCondition {
  return {
    type: "ATTRIBUTE",
    field: "setCode",
    operator: "EQUALS",
    value: "",
  };
}

/**
 * Create an empty condition group
 */
export function createEmptyGroup(operator: "AND" | "OR" = "AND"): PricingRuleConditionGroup {
  return {
    operator,
    conditions: [createEmptyCondition()],
  };
}
