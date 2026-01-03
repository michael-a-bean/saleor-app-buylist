/**
 * Create New Pricing Rule Page
 */

import { Box, Button, Input, Select, Text, Textarea } from "@saleor/macaw-ui";
import Link from "next/link";
import { useRouter } from "next/router";
import { useState } from "react";

import type { PricingRuleConditionGroup } from "@/modules/pricing/rule-engine";
import { trpcClient } from "@/modules/trpc/trpc-client";
import { ConditionBuilder, createEmptyGroup } from "@/ui/components/condition-builder";

const ACTION_TYPES = [
  { value: "PERCENTAGE_MODIFIER", label: "Percentage Modifier (+/- %)" },
  { value: "FIXED_MODIFIER", label: "Fixed Amount Modifier (+/- $)" },
  { value: "SET_PERCENTAGE", label: "Set to Percentage (%)" },
  { value: "SET_MINIMUM", label: "Set Minimum ($)" },
  { value: "SET_MAXIMUM", label: "Set Maximum ($)" },
];

const STACKING_MODES = [
  { value: "MULTIPLICATIVE", label: "Multiplicative (compounds with previous)" },
  { value: "ADDITIVE", label: "Additive (adds to base)" },
];

interface RuleForm {
  name: string;
  description: string;
  priority: number;
  conditions: PricingRuleConditionGroup;
  actionType: string;
  actionValue: number;
  stackingMode: string;
  startsAt: string;
  endsAt: string;
  isActive: boolean;
}

const DEFAULT_FORM: RuleForm = {
  name: "",
  description: "",
  priority: 100,
  conditions: createEmptyGroup(),
  actionType: "PERCENTAGE_MODIFIER",
  actionValue: 0,
  stackingMode: "MULTIPLICATIVE",
  startsAt: "",
  endsAt: "",
  isActive: true,
};

export default function NewRulePage() {
  const router = useRouter();
  const { policyId } = router.query;
  const [form, setForm] = useState<RuleForm>(DEFAULT_FORM);
  const [error, setError] = useState<string | null>(null);

  const createMutation = trpcClient.pricing.rules.create.useMutation({
    onSuccess: () => {
      router.push(`/pricing/rules?policyId=${policyId}`);
    },
    onError: (err) => setError(err.message),
  });

  const handleSubmit = () => {
    setError(null);

    if (!form.name.trim()) {
      setError("Rule name is required");
      return;
    }

    createMutation.mutate({
      policyId: policyId as string,
      name: form.name,
      description: form.description || undefined,
      priority: form.priority,
      conditions: form.conditions,
      actionType: form.actionType as "PERCENTAGE_MODIFIER" | "FIXED_MODIFIER" | "SET_PERCENTAGE" | "SET_MINIMUM" | "SET_MAXIMUM",
      actionValue: form.actionValue,
      stackingMode: form.stackingMode as "MULTIPLICATIVE" | "ADDITIVE",
      startsAt: form.startsAt ? new Date(form.startsAt) : undefined,
      endsAt: form.endsAt ? new Date(form.endsAt) : undefined,
      isActive: form.isActive,
    });
  };

  if (!policyId) {
    return (
      <Box padding={8} display="flex" justifyContent="center">
        <Text>Loading...</Text>
      </Box>
    );
  }

  return (
    <Box display="flex" flexDirection="column" gap={6}>
      {/* Header */}
      <Box>
        <Box display="flex" alignItems="center" gap={2} marginBottom={1}>
          <Link href={`/pricing/rules?policyId=${policyId}`}>
            <Text color="info1" size={2}>
              ← Back to Rules
            </Text>
          </Link>
        </Box>
        <Text as="h1" size={8} fontWeight="bold">
          Create Pricing Rule
        </Text>
      </Box>

      {error && (
        <Box padding={4} backgroundColor="critical1" borderRadius={4}>
          <Text color="critical1">{error}</Text>
        </Box>
      )}

      {/* Form */}
      <Box
        padding={6}
        borderRadius={4}
        borderWidth={1}
        borderStyle="solid"
        borderColor="default1"
        display="flex"
        flexDirection="column"
        gap={6}
      >
        {/* Basic Info */}
        <Box display="flex" flexDirection="column" gap={4}>
          <Text size={5} fontWeight="bold">
            Basic Information
          </Text>

          <Box display="grid" __gridTemplateColumns="1fr 1fr" gap={4}>
            <Input
              label="Rule Name"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              placeholder="e.g., MH3 Bonus"
              required
            />
            <Input
              label="Priority"
              type="number"
              value={form.priority.toString()}
              onChange={(e) => setForm({ ...form, priority: parseInt(e.target.value) || 0 })}
              helperText="Lower numbers are evaluated first"
            />
          </Box>

          <Textarea
            label="Description (optional)"
            value={form.description}
            onChange={(e) => setForm({ ...form, description: e.target.value })}
            placeholder="Describe what this rule does..."
          />
        </Box>

        {/* Conditions */}
        <Box display="flex" flexDirection="column" gap={4}>
          <Text size={5} fontWeight="bold">
            Conditions
          </Text>
          <Text size={2} color="default2">
            Define when this rule should apply
          </Text>

          <ConditionBuilder
            value={form.conditions}
            onChange={(conditions) => setForm({ ...form, conditions })}
            label=""
          />
        </Box>

        {/* Action */}
        <Box display="flex" flexDirection="column" gap={4}>
          <Text size={5} fontWeight="bold">
            Action
          </Text>
          <Text size={2} color="default2">
            What happens when conditions match
          </Text>

          <Box display="grid" __gridTemplateColumns="1fr 1fr 1fr" gap={4}>
            <Select
              label="Action Type"
              value={form.actionType}
              onChange={(value) => setForm({ ...form, actionType: value as string })}
              options={ACTION_TYPES}
            />
            <Input
              label="Value"
              type="number"
              step="0.01"
              value={form.actionValue.toString()}
              onChange={(e) => setForm({ ...form, actionValue: parseFloat(e.target.value) || 0 })}
              helperText={
                form.actionType.includes("PERCENTAGE")
                  ? "e.g., 10 for +10%"
                  : "e.g., 0.50 for $0.50"
              }
            />
            <Select
              label="Stacking Mode"
              value={form.stackingMode}
              onChange={(value) => setForm({ ...form, stackingMode: value as string })}
              options={STACKING_MODES}
            />
          </Box>
        </Box>

        {/* Time Window */}
        <Box display="flex" flexDirection="column" gap={4}>
          <Text size={5} fontWeight="bold">
            Time Window (Optional)
          </Text>
          <Text size={2} color="default2">
            Limit when this rule is active
          </Text>

          <Box display="grid" __gridTemplateColumns="1fr 1fr" gap={4}>
            <Input
              label="Starts At"
              type="datetime-local"
              value={form.startsAt}
              onChange={(e) => setForm({ ...form, startsAt: e.target.value })}
            />
            <Input
              label="Ends At"
              type="datetime-local"
              value={form.endsAt}
              onChange={(e) => setForm({ ...form, endsAt: e.target.value })}
            />
          </Box>
        </Box>

        {/* Active checkbox */}
        <Box display="flex" alignItems="center" gap={2}>
          <input
            type="checkbox"
            id="isActive"
            checked={form.isActive}
            onChange={(e) => setForm({ ...form, isActive: e.target.checked })}
          />
          <label htmlFor="isActive">
            <Text>Rule is active</Text>
          </label>
        </Box>

        {/* Submit */}
        <Box display="flex" justifyContent="flex-end" gap={2}>
          <Link href={`/pricing/rules?policyId=${policyId}`}>
            <Button variant="tertiary">Cancel</Button>
          </Link>
          <Button
            onClick={handleSubmit}
            variant="primary"
            disabled={!form.name || createMutation.isLoading}
          >
            {createMutation.isLoading ? "Creating..." : "Create Rule"}
          </Button>
        </Box>
      </Box>
    </Box>
  );
}
