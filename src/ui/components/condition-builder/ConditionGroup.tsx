/**
 * ConditionGroup Component
 *
 * Renders an AND/OR group of conditions with support for nested groups.
 */

import { Box, Button, Select, Text } from "@saleor/macaw-ui";
import { useCallback } from "react";

import type {
  PricingRuleCondition,
  PricingRuleConditionGroup,
} from "@/modules/pricing/rule-engine";

import { ConditionRow } from "./ConditionRow";
import { createEmptyCondition, createEmptyGroup, isConditionGroup } from "./types";

interface ConditionGroupProps {
  group: PricingRuleConditionGroup;
  onChange: (group: PricingRuleConditionGroup) => void;
  onRemove?: () => void;
  depth?: number;
  canRemove?: boolean;
}

const MAX_DEPTH = 3; // Prevent overly complex nesting

export function ConditionGroup({
  group,
  onChange,
  onRemove,
  depth = 0,
  canRemove = false,
}: ConditionGroupProps) {
  // Handle operator change (AND/OR toggle)
  const handleOperatorChange = useCallback(
    (newOperator: string) => {
      onChange({
        ...group,
        operator: newOperator as "AND" | "OR",
      });
    },
    [group, onChange]
  );

  // Handle condition change at index
  const handleConditionChange = useCallback(
    (
      index: number,
      newCondition: PricingRuleCondition | PricingRuleConditionGroup
    ) => {
      const newConditions = [...group.conditions];
      newConditions[index] = newCondition;
      onChange({
        ...group,
        conditions: newConditions,
      });
    },
    [group, onChange]
  );

  // Handle removing a condition at index
  const handleRemoveCondition = useCallback(
    (index: number) => {
      const newConditions = group.conditions.filter((_, i) => i !== index);

      // If no conditions left, add an empty one
      if (newConditions.length === 0) {
        newConditions.push(createEmptyCondition());
      }

      onChange({
        ...group,
        conditions: newConditions,
      });
    },
    [group, onChange]
  );

  // Add a new condition
  const handleAddCondition = useCallback(() => {
    onChange({
      ...group,
      conditions: [...group.conditions, createEmptyCondition()],
    });
  }, [group, onChange]);

  // Add a nested group
  const handleAddGroup = useCallback(() => {
    // Toggle operator for nested group
    const nestedOperator = group.operator === "AND" ? "OR" : "AND";
    onChange({
      ...group,
      conditions: [...group.conditions, createEmptyGroup(nestedOperator)],
    });
  }, [group, onChange]);

  // Background color based on depth
  const bgColor = depth % 2 === 0 ? "default1" : "default2";

  return (
    <Box
      borderWidth={1}
      borderStyle="solid"
      borderColor="default1"
      borderRadius={4}
      padding={3}
      backgroundColor={bgColor}
    >
      {/* Group header */}
      <Box display="flex" justifyContent="space-between" alignItems="center" marginBottom={3}>
        <Box display="flex" alignItems="center" gap={2}>
          <Text size={2} fontWeight="bold">
            Match
          </Text>
          <Select
            value={group.operator}
            onChange={(val) => handleOperatorChange(val as string)}
            options={[
              { value: "AND", label: "ALL of the following (AND)" },
              { value: "OR", label: "ANY of the following (OR)" },
            ]}
            size="small"
            style={{ minWidth: 200 }}
          />
        </Box>
        {canRemove && onRemove && (
          <Button onClick={onRemove} variant="tertiary" size="small">
            Remove Group
          </Button>
        )}
      </Box>

      {/* Conditions list */}
      <Box display="flex" flexDirection="column" gap={2}>
        {group.conditions.map((condition, index) => (
          <Box key={index}>
            {/* Connector label */}
            {index > 0 && (
              <Box display="flex" justifyContent="center" paddingY={1}>
                <Box
                  paddingX={2}
                  paddingY={1}
                  borderRadius={2}
                  backgroundColor={group.operator === "AND" ? "info1" : "accent1"}
                >
                  <Text size={1} fontWeight="bold">
                    {group.operator}
                  </Text>
                </Box>
              </Box>
            )}

            {/* Render condition or nested group */}
            {isConditionGroup(condition) ? (
              <ConditionGroup
                group={condition}
                onChange={(newGroup) => handleConditionChange(index, newGroup)}
                onRemove={() => handleRemoveCondition(index)}
                depth={depth + 1}
                canRemove={group.conditions.length > 1}
              />
            ) : (
              <ConditionRow
                condition={condition}
                onChange={(newCondition) => handleConditionChange(index, newCondition)}
                onRemove={() => handleRemoveCondition(index)}
                canRemove={group.conditions.length > 1}
              />
            )}
          </Box>
        ))}
      </Box>

      {/* Add buttons */}
      <Box display="flex" gap={2} marginTop={3}>
        <Button onClick={handleAddCondition} variant="secondary" size="small">
          + Add Condition
        </Button>
        {depth < MAX_DEPTH && (
          <Button onClick={handleAddGroup} variant="tertiary" size="small">
            + Add Group
          </Button>
        )}
      </Box>
    </Box>
  );
}
