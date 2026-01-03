import { Box, Button, Input, Select, Skeleton, Text } from "@saleor/macaw-ui";
import Link from "next/link";
import { useRef, useState } from "react";

import { trpcClient } from "@/modules/trpc/trpc-client";

const POLICY_TYPES = [
  { value: "PERCENTAGE", label: "Percentage of Market Price" },
  { value: "FIXED_DISCOUNT", label: "Fixed Discount" },
  { value: "TIERED", label: "Tiered Pricing" },
  { value: "CUSTOM", label: "Custom Rules" },
];

interface PolicyForm {
  name: string;
  description: string;
  policyType: string;
  basePercentage: number;
  isDefault: boolean;
  isActive: boolean;
}

const DEFAULT_FORM: PolicyForm = {
  name: "",
  description: "",
  policyType: "PERCENTAGE",
  basePercentage: 50,
  isDefault: false,
  isActive: true,
};

export default function PricingPoliciesPage() {
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<PolicyForm>(DEFAULT_FORM);
  const [error, setError] = useState<string | null>(null);
  const formRef = useRef<HTMLDivElement>(null);

  const policiesQuery = trpcClient.pricing.list.useQuery();
  const utils = trpcClient.useUtils();

  const createMutation = trpcClient.pricing.create.useMutation({
    onSuccess: () => {
      utils.pricing.list.invalidate();
      setShowForm(false);
      setForm(DEFAULT_FORM);
      setError(null);
    },
    onError: (err) => setError(err.message),
  });

  const updateMutation = trpcClient.pricing.update.useMutation({
    onSuccess: () => {
      utils.pricing.list.invalidate();
      setEditingId(null);
      setShowForm(false);
      setForm(DEFAULT_FORM);
      setError(null);
    },
    onError: (err) => setError(err.message),
  });

  const deleteMutation = trpcClient.pricing.delete.useMutation({
    onSuccess: () => {
      utils.pricing.list.invalidate();
    },
    onError: (err) => setError(err.message),
  });

  const setDefaultMutation = trpcClient.pricing.setDefault.useMutation({
    onSuccess: () => {
      utils.pricing.list.invalidate();
    },
    onError: (err) => setError(err.message),
  });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const handleEdit = (policy: any) => {
    setEditingId(policy.id);
    // basePercentage comes as string/number from API (serialized Decimal), not a Decimal object
    const basePercentage = policy.basePercentage != null
      ? Number(policy.basePercentage)
      : 50;
    setForm({
      name: policy.name,
      description: policy.description || "",
      policyType: policy.policyType,
      basePercentage,
      isDefault: policy.isDefault,
      isActive: policy.isActive,
    });
    setShowForm(true);
    // Scroll to form after state update
    setTimeout(() => {
      formRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 100);
  };

  const handleSubmit = () => {
    setError(null);

    const data = {
      name: form.name,
      description: form.description || undefined,
      policyType: form.policyType as "PERCENTAGE" | "FIXED_DISCOUNT" | "TIERED" | "CUSTOM",
      basePercentage: form.basePercentage,
      isDefault: form.isDefault,
      isActive: form.isActive,
    };

    if (editingId) {
      updateMutation.mutate({ id: editingId, data });
    } else {
      createMutation.mutate(data);
    }
  };

  const handleCancel = () => {
    setShowForm(false);
    setEditingId(null);
    setForm(DEFAULT_FORM);
    setError(null);
  };

  return (
    <Box display="flex" flexDirection="column" gap={6}>
      <Box display="flex" justifyContent="space-between" alignItems="center">
        <Box>
          <Text as="h1" size={8} fontWeight="bold">
            Pricing Policies
          </Text>
          <Text as="p" color="default2">
            Configure how buylist prices are calculated
          </Text>
        </Box>
        {!showForm && (
          <Button onClick={() => setShowForm(true)} variant="primary">
            New Policy
          </Button>
        )}
      </Box>

      {error && (
        <Box padding={4} backgroundColor="critical1" borderRadius={4}>
          <Text color="critical1">{error}</Text>
        </Box>
      )}

      {/* Create/Edit Form */}
      {showForm && (
        <Box
          ref={formRef}
          padding={6}
          borderRadius={4}
          borderWidth={1}
          borderStyle="solid"
          borderColor="default1"
        >
          <Text as="h2" size={5} fontWeight="bold" marginBottom={4}>
            {editingId ? "Edit Policy" : "New Policy"}
          </Text>

          <Box display="flex" flexDirection="column" gap={4}>
            <Box display="grid" __gridTemplateColumns="1fr 1fr" gap={4}>
              <Input
                label="Policy Name"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                required
              />
              <Select
                label="Policy Type"
                value={form.policyType}
                onChange={(value) => setForm({ ...form, policyType: value as string })}
                options={POLICY_TYPES}
              />
            </Box>

            <Input
              label="Description"
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
            />

            {(form.policyType === "PERCENTAGE" || form.policyType === "FIXED_DISCOUNT") && (
              <Input
                label={
                  form.policyType === "PERCENTAGE"
                    ? "Base Percentage (% of market price)"
                    : "Fixed Discount Amount ($)"
                }
                type="number"
                min={0}
                max={form.policyType === "PERCENTAGE" ? 100 : undefined}
                step={form.policyType === "PERCENTAGE" ? 1 : 0.01}
                value={form.basePercentage.toString()}
                onChange={(e) =>
                  setForm({ ...form, basePercentage: parseFloat(e.target.value) || 0 })
                }
              />
            )}

            <Box display="flex" gap={4}>
              <Box display="flex" alignItems="center" gap={2}>
                <input
                  type="checkbox"
                  id="isActive"
                  checked={form.isActive}
                  onChange={(e) => setForm({ ...form, isActive: e.target.checked })}
                />
                <label htmlFor="isActive">
                  <Text>Active</Text>
                </label>
              </Box>
              <Box display="flex" alignItems="center" gap={2}>
                <input
                  type="checkbox"
                  id="isDefault"
                  checked={form.isDefault}
                  onChange={(e) => setForm({ ...form, isDefault: e.target.checked })}
                />
                <label htmlFor="isDefault">
                  <Text>Set as Default</Text>
                </label>
              </Box>
            </Box>

            <Box display="flex" justifyContent="flex-end" gap={2}>
              <Button onClick={handleCancel} variant="tertiary">
                Cancel
              </Button>
              <Button
                onClick={handleSubmit}
                variant="primary"
                disabled={
                  !form.name ||
                  createMutation.isLoading ||
                  updateMutation.isLoading
                }
              >
                {createMutation.isLoading || updateMutation.isLoading
                  ? "Saving..."
                  : editingId
                  ? "Update Policy"
                  : "Create Policy"}
              </Button>
            </Box>
          </Box>
        </Box>
      )}

      {/* Policies List */}
      {policiesQuery.isLoading ? (
        <Box display="flex" flexDirection="column" gap={2}>
          {[1, 2, 3].map((i) => (
            <Skeleton key={i} style={{ width: "100%", height: 80 }} />
          ))}
        </Box>
      ) : policiesQuery.isError ? (
        <Box padding={4} backgroundColor="critical1" borderRadius={4}>
          <Text color="critical1">Error: {policiesQuery.error.message}</Text>
        </Box>
      ) : policiesQuery.data?.policies.length === 0 ? (
        <Box padding={8} display="flex" justifyContent="center">
          <Text color="default2">No pricing policies configured. Create one to get started.</Text>
        </Box>
      ) : (
        <Box
          borderWidth={1}
          borderStyle="solid"
          borderColor="default1"
          borderRadius={4}
          overflow="hidden"
        >
          {policiesQuery.data?.policies.map((policy) => (
            <Box
              key={policy.id}
              display="flex"
              justifyContent="space-between"
              alignItems="center"
              padding={4}
              borderBottomWidth={1}
              borderBottomStyle="solid"
              borderColor="default1"
            >
              <Box display="flex" flexDirection="column" gap={1}>
                <Box display="flex" alignItems="center" gap={2}>
                  <Text fontWeight="bold">{policy.name}</Text>
                  {policy.isDefault && (
                    <Box
                      paddingX={2}
                      paddingY={1}
                      borderRadius={2}
                      backgroundColor="success1"
                    >
                      <Text size={1}>DEFAULT</Text>
                    </Box>
                  )}
                  {!policy.isActive && (
                    <Box
                      paddingX={2}
                      paddingY={1}
                      borderRadius={2}
                      backgroundColor="default2"
                    >
                      <Text size={1}>INACTIVE</Text>
                    </Box>
                  )}
                </Box>
                <Text color="default2" size={2}>
                  {policy.policyType === "PERCENTAGE" && `${policy.basePercentage}% of market price`}
                  {policy.policyType === "FIXED_DISCOUNT" && `$${policy.basePercentage} off market price`}
                  {policy.policyType === "TIERED" && "Tiered pricing rules"}
                  {policy.policyType === "CUSTOM" && "Custom pricing rules"}
                  {policy.description && ` - ${policy.description}`}
                </Text>
                <Text size={1} color="default2">
                  Used by {policy._count.buylists} buylist(s)
                  {" | "}
                  {policy._count.rules ?? 0} rule(s)
                </Text>
              </Box>
              <Box display="flex" gap={2}>
                <Link href={`/pricing/rules?policyId=${policy.id}`}>
                  <Button variant="secondary" size="small">
                    Manage Rules
                  </Button>
                </Link>
                {!policy.isDefault && policy.isActive && (
                  <Button
                    onClick={() => setDefaultMutation.mutate({ id: policy.id })}
                    variant="tertiary"
                    size="small"
                    disabled={setDefaultMutation.isLoading}
                  >
                    Set Default
                  </Button>
                )}
                <Button
                  onClick={() => handleEdit(policy)}
                  variant="secondary"
                  size="small"
                >
                  Edit
                </Button>
                {policy._count.buylists === 0 && (
                  <Button
                    onClick={() => {
                      if (confirm("Delete this policy?")) {
                        deleteMutation.mutate({ id: policy.id });
                      }
                    }}
                    variant="tertiary"
                    size="small"
                    disabled={deleteMutation.isLoading}
                  >
                    Delete
                  </Button>
                )}
              </Box>
            </Box>
          ))}
        </Box>
      )}

      {/* Info Box */}
      <Box
        padding={4}
        borderRadius={4}
        backgroundColor="info1"
        borderWidth={1}
        borderStyle="solid"
        borderColor="info1"
      >
        <Text fontWeight="bold" marginBottom={2}>
          How Pricing Works
        </Text>
        <Box as="ul" marginLeft={4}>
          <li>
            <Text size={2}>
              <strong>Percentage:</strong> Offer X% of the card&apos;s market price (e.g., 50% of $10 = $5 offer)
            </Text>
          </li>
          <li>
            <Text size={2}>
              <strong>Fixed Discount:</strong> Subtract a fixed amount from market price (e.g., $10 - $2 = $8 offer)
            </Text>
          </li>
          <li>
            <Text size={2}>
              <strong>Tiered:</strong> Different percentages based on card value (e.g., 40% for cards under $1, 55% for $1-$10)
            </Text>
          </li>
          <li>
            <Text size={2}>
              Condition multipliers are applied after base calculation (NM=100%, LP=90%, MP=75%, HP=50%, DMG=25%)
            </Text>
          </li>
        </Box>
      </Box>
    </Box>
  );
}
