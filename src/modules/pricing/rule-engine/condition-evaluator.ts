/**
 * Condition Evaluator
 *
 * Evaluates pricing rule conditions against product data.
 * Supports nested AND/OR groups and various condition types.
 */

import {
  type ComparisonOperator,
  type ConditionType,
  type ConditionValue,
  createTimeContext,
  isConditionGroup,
  type PricingRuleCondition,
  type PricingRuleConditionGroup,
  type RuleEvaluationContext,
  SUPPORTED_FIELDS,
  SUPPORTED_OPERATORS,
} from "./types";

/**
 * Evaluates pricing rule conditions against a context
 */
export class ConditionEvaluator {
  /**
   * Evaluate a condition group (AND/OR) against the context
   */
  evaluate(
    conditionOrGroup: PricingRuleCondition | PricingRuleConditionGroup,
    context: RuleEvaluationContext
  ): boolean {
    if (isConditionGroup(conditionOrGroup)) {
      return this.evaluateGroup(conditionOrGroup, context);
    }
    return this.evaluateCondition(conditionOrGroup, context);
  }

  /**
   * Evaluate a group of conditions with AND/OR logic
   */
  private evaluateGroup(group: PricingRuleConditionGroup, context: RuleEvaluationContext): boolean {
    if (group.conditions.length === 0) {
      // Empty group always matches
      return true;
    }

    if (group.operator === "AND") {
      // All conditions must be true
      return group.conditions.every((condition) => this.evaluate(condition, context));
    } else {
      // At least one condition must be true
      return group.conditions.some((condition) => this.evaluate(condition, context));
    }
  }

  /**
   * Evaluate a single condition
   */
  private evaluateCondition(condition: PricingRuleCondition, context: RuleEvaluationContext): boolean {
    const fieldValue = this.getFieldValue(condition.type, condition.field, context);
    return this.compareValues(fieldValue, condition.operator, condition.value);
  }

  /**
   * Get the value of a field from the evaluation context
   */
  private getFieldValue(
    type: ConditionType,
    field: string,
    context: RuleEvaluationContext
  ): unknown {
    switch (type) {
      case "ATTRIBUTE":
        return this.getAttributeValue(field, context);
      case "MARKET_PRICE":
        return context.marketPrice;
      case "INVENTORY":
        return this.getInventoryValue(field, context);
      case "DATE":
        return this.getDateValue(field, context);
      case "CATEGORY":
        return this.getCategoryValue(field, context);
      default:
        return undefined;
    }
  }

  /**
   * Get attribute value from context, supporting nested paths like "formatLegality.modern"
   */
  private getAttributeValue(field: string, context: RuleEvaluationContext): unknown {
    const { attributes } = context;

    // Handle nested paths like "formatLegality.modern"
    if (field.includes(".")) {
      const parts = field.split(".");
      let value: unknown = attributes;
      for (const part of parts) {
        if (value === null || value === undefined || typeof value !== "object") {
          return undefined;
        }
        value = (value as Record<string, unknown>)[part];
      }
      return value;
    }

    // Direct attribute access
    switch (field) {
      case "setCode":
        return attributes.setCode;
      case "setName":
        return attributes.setName;
      case "rarity":
        return attributes.rarity;
      case "finish":
        return attributes.finish;
      case "cardType":
        return attributes.cardType;
      case "variantId":
        return attributes.variantId;
      case "productId":
        return attributes.productId;
      default:
        // Check generic attributes
        return attributes.attributes?.[field];
    }
  }

  /**
   * Get inventory value from context
   */
  private getInventoryValue(field: string, context: RuleEvaluationContext): unknown {
    const { inventory } = context;
    if (!inventory) {
      return undefined;
    }

    switch (field) {
      case "qtyOnHand":
        return inventory.qtyOnHand;
      default:
        return undefined;
    }
  }

  /**
   * Get date value from context
   */
  private getDateValue(field: string, context: RuleEvaluationContext): unknown {
    const time = context.time ?? createTimeContext();

    switch (field) {
      case "date":
        return time.date;
      case "year":
        return time.year;
      case "month":
        return time.month;
      case "dayOfMonth":
        return time.dayOfMonth;
      case "dayOfWeek":
        return time.dayOfWeek;
      case "hour":
        return time.hour;
      default:
        return undefined;
    }
  }

  /**
   * Get category value from context
   */
  private getCategoryValue(field: string, context: RuleEvaluationContext): unknown {
    const { attributes } = context;

    switch (field) {
      case "categoryId":
        return attributes.categoryId;
      case "categorySlug":
        return attributes.categorySlug;
      default:
        return undefined;
    }
  }

  /**
   * Compare a field value against a condition value using the specified operator
   */
  private compareValues(
    fieldValue: unknown,
    operator: ComparisonOperator,
    conditionValue: ConditionValue
  ): boolean {
    // Handle null/undefined field values
    if (fieldValue === null || fieldValue === undefined) {
      // Only NOT_EQUALS and NOT_IN can match when field is null/undefined
      if (operator === "NOT_EQUALS") {
        return conditionValue !== null && conditionValue !== undefined;
      }
      if (operator === "NOT_IN") {
        return true; // null is not in any list
      }
      return false;
    }

    switch (operator) {
      case "EQUALS":
        return this.isEqual(fieldValue, conditionValue);

      case "NOT_EQUALS":
        return !this.isEqual(fieldValue, conditionValue);

      case "GREATER_THAN":
        return this.compare(fieldValue, conditionValue) > 0;

      case "GREATER_THAN_OR_EQUALS":
        return this.compare(fieldValue, conditionValue) >= 0;

      case "LESS_THAN":
        return this.compare(fieldValue, conditionValue) < 0;

      case "LESS_THAN_OR_EQUALS":
        return this.compare(fieldValue, conditionValue) <= 0;

      case "IN":
        return this.isIn(fieldValue, conditionValue);

      case "NOT_IN":
        return !this.isIn(fieldValue, conditionValue);

      case "CONTAINS":
        return this.contains(fieldValue, conditionValue);

      case "BETWEEN":
        return this.isBetween(fieldValue, conditionValue);

      default:
        return false;
    }
  }

  /**
   * Check equality (case-insensitive for strings)
   */
  private isEqual(fieldValue: unknown, conditionValue: ConditionValue): boolean {
    if (typeof fieldValue === "string" && typeof conditionValue === "string") {
      return fieldValue.toLowerCase() === conditionValue.toLowerCase();
    }
    if (typeof fieldValue === "boolean") {
      // Handle boolean comparisons with string values
      if (conditionValue === "true" || conditionValue === true) {
        return fieldValue === true;
      }
      if (conditionValue === "false" || conditionValue === false) {
        return fieldValue === false;
      }
    }
    return fieldValue === conditionValue;
  }

  /**
   * Compare two values (returns -1, 0, or 1)
   */
  private compare(fieldValue: unknown, conditionValue: ConditionValue): number {
    const a = typeof fieldValue === "string" ? parseFloat(fieldValue) : Number(fieldValue);
    const b = typeof conditionValue === "string" ? parseFloat(conditionValue) : Number(conditionValue);

    if (isNaN(a) || isNaN(b)) {
      // String comparison for non-numeric values
      const strA = String(fieldValue).toLowerCase();
      const strB = String(conditionValue).toLowerCase();
      return strA.localeCompare(strB);
    }

    return a - b;
  }

  /**
   * Check if field value is in a list
   */
  private isIn(fieldValue: unknown, conditionValue: ConditionValue): boolean {
    if (!Array.isArray(conditionValue)) {
      return false;
    }

    const normalizedField =
      typeof fieldValue === "string" ? fieldValue.toLowerCase() : fieldValue;

    return conditionValue.some((v) => {
      const normalizedValue = typeof v === "string" ? v.toLowerCase() : v;
      return normalizedField === normalizedValue;
    });
  }

  /**
   * Check if field value contains a substring (case-insensitive)
   */
  private contains(fieldValue: unknown, conditionValue: ConditionValue): boolean {
    if (typeof fieldValue !== "string" || typeof conditionValue !== "string") {
      return false;
    }
    return fieldValue.toLowerCase().includes(conditionValue.toLowerCase());
  }

  /**
   * Check if field value is between two values (inclusive)
   */
  private isBetween(fieldValue: unknown, conditionValue: ConditionValue): boolean {
    if (!Array.isArray(conditionValue) || conditionValue.length !== 2) {
      return false;
    }

    const [min, max] = conditionValue;

    // Check if values look like dates (YYYY-MM-DD format)
    const isDateLike = (val: unknown): boolean => {
      if (typeof val !== "string") return false;
      return /^\d{4}-\d{2}-\d{2}/.test(val);
    };

    // For date-like strings, use string comparison directly
    if (isDateLike(fieldValue) || isDateLike(min) || isDateLike(max)) {
      const strValue = String(fieldValue);
      const strMin = String(min);
      const strMax = String(max);
      return strValue >= strMin && strValue <= strMax;
    }

    // Try numeric comparison
    const value = typeof fieldValue === "string" ? parseFloat(fieldValue) : Number(fieldValue);
    const minNum = typeof min === "string" ? parseFloat(min) : Number(min);
    const maxNum = typeof max === "string" ? parseFloat(max) : Number(max);

    if (isNaN(value) || isNaN(minNum) || isNaN(maxNum)) {
      // Fall back to string comparison
      const strValue = String(fieldValue);
      const strMin = String(min);
      const strMax = String(max);
      return strValue >= strMin && strValue <= strMax;
    }

    return value >= minNum && value <= maxNum;
  }

  /**
   * Validate a condition structure
   */
  validateCondition(
    condition: PricingRuleCondition | PricingRuleConditionGroup
  ): { valid: boolean; errors: string[] } {
    const errors: string[] = [];

    if (isConditionGroup(condition)) {
      // Validate group
      if (!["AND", "OR"].includes(condition.operator)) {
        errors.push(`Invalid group operator: ${condition.operator}`);
      }

      // Recursively validate children
      for (const child of condition.conditions) {
        const childResult = this.validateCondition(child);
        errors.push(...childResult.errors);
      }
    } else {
      // Validate single condition
      const { type, field, operator, value } = condition;

      // Check type
      if (!SUPPORTED_FIELDS[type]) {
        errors.push(`Invalid condition type: ${type}`);
      } else {
        // Check field
        const supportedFields = SUPPORTED_FIELDS[type];
        // Allow any field that starts with a supported field prefix (for nested paths)
        const isValidField = supportedFields.some(
          (f) => field === f || field.startsWith(f + ".")
        );
        if (!isValidField && !field.startsWith("attributes.")) {
          errors.push(`Invalid field "${field}" for condition type ${type}`);
        }

        // Check operator
        const supportedOperators = SUPPORTED_OPERATORS[type];
        if (!supportedOperators.includes(operator)) {
          errors.push(`Invalid operator "${operator}" for condition type ${type}`);
        }
      }

      // Check value based on operator
      if (operator === "IN" || operator === "NOT_IN") {
        if (!Array.isArray(value)) {
          errors.push(`Operator ${operator} requires an array value`);
        }
      } else if (operator === "BETWEEN") {
        if (!Array.isArray(value) || value.length !== 2) {
          errors.push("Operator BETWEEN requires an array with exactly 2 values");
        }
      }
    }

    return { valid: errors.length === 0, errors };
  }
}

// Export singleton instance
export const conditionEvaluator = new ConditionEvaluator();
