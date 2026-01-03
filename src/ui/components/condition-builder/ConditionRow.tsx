/**
 * ConditionRow Component
 *
 * Renders a single condition with field, operator, and value inputs.
 */

import { Box, Button, Input, Select, Text } from "@saleor/macaw-ui";
import { useCallback, useMemo } from "react";

import type { PricingRuleCondition } from "@/modules/pricing/rule-engine";

import {
  CONDITION_FIELDS,
  getFieldDefinition,
  getOperatorsForField,
} from "./types";

interface ConditionRowProps {
  condition: PricingRuleCondition;
  onChange: (condition: PricingRuleCondition) => void;
  onRemove: () => void;
  canRemove: boolean;
}

export function ConditionRow({
  condition,
  onChange,
  onRemove,
  canRemove,
}: ConditionRowProps) {
  const fieldDef = useMemo(() => getFieldDefinition(condition.field), [condition.field]);
  const operators = useMemo(() => getOperatorsForField(condition.field), [condition.field]);
  const selectedOperator = useMemo(
    () => operators.find((o) => o.value === condition.operator),
    [operators, condition.operator]
  );

  // Build field options
  const fieldOptions = useMemo(
    () =>
      CONDITION_FIELDS.map((f) => ({
        value: f.value,
        label: f.label,
      })),
    []
  );

  // Build operator options
  const operatorOptions = useMemo(
    () =>
      operators.map((o) => ({
        value: o.value,
        label: o.label,
      })),
    [operators]
  );

  // Handle field change
  const handleFieldChange = useCallback(
    (newField: string) => {
      const newFieldDef = getFieldDefinition(newField);
      const newOperators = getOperatorsForField(newField);
      const newOperator = newOperators[0]?.value ?? "EQUALS";

      onChange({
        type: newFieldDef?.type ?? "ATTRIBUTE",
        field: newField,
        operator: newOperator as PricingRuleCondition["operator"],
        value: "",
      });
    },
    [onChange]
  );

  // Handle operator change
  const handleOperatorChange = useCallback(
    (newOperator: string) => {
      const opDef = operators.find((o) => o.value === newOperator);

      // Reset value when operator type changes
      let newValue: PricingRuleCondition["value"] = "";
      if (opDef?.isBetween) {
        newValue = [0, 0];
      } else if (opDef?.isArray) {
        newValue = [];
      }

      onChange({
        ...condition,
        operator: newOperator as PricingRuleCondition["operator"],
        value: newValue,
      });
    },
    [condition, operators, onChange]
  );

  // Handle value change
  const handleValueChange = useCallback(
    (newValue: string | number | string[] | [number, number]) => {
      onChange({
        ...condition,
        value: newValue,
      });
    },
    [condition, onChange]
  );

  // Render value input based on field and operator
  const renderValueInput = () => {
    // Between operator - two inputs
    if (selectedOperator?.isBetween) {
      const betweenValue = (condition.value as [number, number]) ?? [0, 0];
      return (
        <Box display="flex" gap={2} alignItems="center">
          <Input
            type="number"
            value={betweenValue[0]?.toString() ?? ""}
            onChange={(e) =>
              handleValueChange([
                parseFloat(e.target.value) || 0,
                betweenValue[1] ?? 0,
              ])
            }
            style={{ width: 100 }}
          />
          <Text>and</Text>
          <Input
            type="number"
            value={betweenValue[1]?.toString() ?? ""}
            onChange={(e) =>
              handleValueChange([
                betweenValue[0] ?? 0,
                parseFloat(e.target.value) || 0,
              ])
            }
            style={{ width: 100 }}
          />
        </Box>
      );
    }

    // Array operator - comma-separated input or multi-select
    if (selectedOperator?.isArray) {
      const arrayValue = Array.isArray(condition.value) ? condition.value : [];

      // Convert to string array for consistent handling
      const stringArrayValue = arrayValue.map(String);

      // If field has options, use them
      if (fieldDef?.options) {
        return (
          <Box display="flex" flexWrap="wrap" gap={1}>
            {fieldDef.options.map((opt) => {
              const isSelected = stringArrayValue.includes(opt.value);
              return (
                <Box
                  key={opt.value}
                  as="button"
                  type="button"
                  onClick={() => {
                    if (isSelected) {
                      const filtered = stringArrayValue.filter((v) => v !== opt.value);
                      handleValueChange(filtered as string[]);
                    } else {
                      handleValueChange([...stringArrayValue, opt.value] as string[]);
                    }
                  }}
                  paddingX={2}
                  paddingY={1}
                  borderRadius={2}
                  backgroundColor={isSelected ? "info1" : "default1"}
                  borderWidth={1}
                  borderStyle="solid"
                  borderColor={isSelected ? "info1" : "default1"}
                  cursor="pointer"
                >
                  <Text size={1}>{opt.label}</Text>
                </Box>
              );
            })}
          </Box>
        );
      }

      // Comma-separated input for text values
      return (
        <Input
          value={stringArrayValue.join(", ")}
          onChange={(e) => {
            const values = e.target.value
              .split(",")
              .map((v) => v.trim())
              .filter(Boolean);
            handleValueChange(values as string[]);
          }}
          placeholder="Comma-separated values"
          style={{ minWidth: 200 }}
        />
      );
    }

    // Select field with options
    if (fieldDef?.valueType === "select" && fieldDef.options) {
      return (
        <Select
          value={condition.value as string}
          onChange={(val) => handleValueChange(val as string)}
          options={fieldDef.options}
          style={{ minWidth: 150 }}
        />
      );
    }

    // Number input
    if (fieldDef?.valueType === "number") {
      return (
        <Input
          type="number"
          value={condition.value?.toString() ?? ""}
          onChange={(e) => handleValueChange(parseFloat(e.target.value) || 0)}
          placeholder={fieldDef.placeholder}
          style={{ minWidth: 120 }}
        />
      );
    }

    // Default: text input
    return (
      <Input
        value={condition.value?.toString() ?? ""}
        onChange={(e) => handleValueChange(e.target.value)}
        placeholder={fieldDef?.placeholder ?? "Enter value"}
        style={{ minWidth: 150 }}
      />
    );
  };

  return (
    <Box
      display="flex"
      alignItems="center"
      gap={2}
      padding={2}
      backgroundColor="default1"
      borderRadius={2}
    >
      {/* Field selector */}
      <Select
        value={condition.field}
        onChange={(val) => handleFieldChange(val as string)}
        options={fieldOptions}
        style={{ minWidth: 150 }}
      />

      {/* Operator selector */}
      <Select
        value={condition.operator}
        onChange={(val) => handleOperatorChange(val as string)}
        options={operatorOptions}
        style={{ minWidth: 150 }}
      />

      {/* Value input */}
      {renderValueInput()}

      {/* Remove button */}
      {canRemove && (
        <Button
          onClick={onRemove}
          variant="tertiary"
          size="small"
          icon={<Text>×</Text>}
        />
      )}
    </Box>
  );
}
