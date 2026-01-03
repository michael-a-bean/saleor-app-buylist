/**
 * ConditionBuilder Component
 *
 * Main component for building pricing rule conditions.
 * Provides a visual editor for creating AND/OR condition trees.
 */

import { Box, Text } from "@saleor/macaw-ui";

import type { PricingRuleConditionGroup } from "@/modules/pricing/rule-engine";

import { ConditionGroup } from "./ConditionGroup";
import { createEmptyGroup } from "./types";

interface ConditionBuilderProps {
  /** Current conditions */
  value: PricingRuleConditionGroup;
  /** Called when conditions change */
  onChange: (conditions: PricingRuleConditionGroup) => void;
  /** Optional label */
  label?: string;
  /** Optional help text */
  helpText?: string;
}

export function ConditionBuilder({
  value,
  onChange,
  label = "Conditions",
  helpText,
}: ConditionBuilderProps) {
  // Ensure we have a valid condition group
  const conditions = value?.conditions?.length > 0 ? value : createEmptyGroup();

  return (
    <Box display="flex" flexDirection="column" gap={2}>
      {/* Label */}
      {label && (
        <Box display="flex" flexDirection="column" gap={1}>
          <Text fontWeight="bold">{label}</Text>
          {helpText && (
            <Text size={2} color="default2">
              {helpText}
            </Text>
          )}
        </Box>
      )}

      {/* Condition editor */}
      <ConditionGroup group={conditions} onChange={onChange} />

      {/* Info box */}
      <Box
        padding={3}
        borderRadius={2}
        backgroundColor="info1"
        marginTop={2}
      >
        <Text size={2}>
          <strong>Tip:</strong> Use AND to require all conditions to match. Use OR to match any
          condition. You can nest groups for complex logic like &quot;(A AND B) OR (C AND D)&quot;.
        </Text>
      </Box>
    </Box>
  );
}

export default ConditionBuilder;
