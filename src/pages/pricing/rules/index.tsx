/**
 * Pricing Rules List Page
 *
 * Lists all pricing rules for a policy with drag-drop reordering.
 */

import { Box, Button, Skeleton, Text } from "@saleor/macaw-ui";
import Link from "next/link";
import { useRouter } from "next/router";
import { useCallback, useState } from "react";

import { trpcClient } from "@/modules/trpc/trpc-client";

const ACTION_TYPE_LABELS: Record<string, string> = {
  PERCENTAGE_MODIFIER: "% modifier",
  FIXED_MODIFIER: "$ modifier",
  SET_PERCENTAGE: "set to %",
  SET_MINIMUM: "minimum",
  SET_MAXIMUM: "maximum",
};

function formatActionValue(actionType: string, actionValue: number): string {
  switch (actionType) {
    case "PERCENTAGE_MODIFIER":
      return actionValue >= 0 ? `+${actionValue}%` : `${actionValue}%`;
    case "FIXED_MODIFIER":
      return actionValue >= 0 ? `+$${actionValue}` : `-$${Math.abs(actionValue)}`;
    case "SET_PERCENTAGE":
      return `${actionValue}%`;
    case "SET_MINIMUM":
    case "SET_MAXIMUM":
      return `$${actionValue}`;
    default:
      return String(actionValue);
  }
}

export default function RulesListPage() {
  const router = useRouter();
  const { policyId } = router.query;
  const [error, setError] = useState<string | null>(null);

  // Get policy info
  const policyQuery = trpcClient.pricing.getById.useQuery(
    { id: policyId as string },
    { enabled: !!policyId }
  );

  // Get rules for this policy
  const rulesQuery = trpcClient.pricing.rules.list.useQuery(
    { policyId: policyId as string },
    { enabled: !!policyId }
  );

  const utils = trpcClient.useUtils();

  // Toggle rule active status
  const toggleMutation = trpcClient.pricing.rules.toggleActive.useMutation({
    onSuccess: () => {
      utils.pricing.rules.list.invalidate({ policyId: policyId as string });
    },
    onError: (err) => setError(err.message),
  });

  // Delete rule
  const deleteMutation = trpcClient.pricing.rules.delete.useMutation({
    onSuccess: () => {
      utils.pricing.rules.list.invalidate({ policyId: policyId as string });
    },
    onError: (err) => setError(err.message),
  });

  // Reorder rules
  const reorderMutation = trpcClient.pricing.rules.reorder.useMutation({
    onSuccess: () => {
      utils.pricing.rules.list.invalidate({ policyId: policyId as string });
    },
    onError: (err) => setError(err.message),
  });

  // Handle move up/down (simple reordering without full drag-drop)
  const handleMoveUp = useCallback(
    (index: number) => {
      if (index <= 0) return;
      const rules = rulesQuery.data?.rules ?? [];
      const newOrder = [...rules.map((r) => r.id)];
      [newOrder[index - 1], newOrder[index]] = [newOrder[index], newOrder[index - 1]];
      reorderMutation.mutate({
        policyId: policyId as string,
        ruleIds: newOrder,
      });
    },
    [policyId, rulesQuery.data?.rules, reorderMutation]
  );

  const handleMoveDown = useCallback(
    (index: number) => {
      const rules = rulesQuery.data?.rules ?? [];
      if (index >= rules.length - 1) return;
      const newOrder = [...rules.map((r) => r.id)];
      [newOrder[index], newOrder[index + 1]] = [newOrder[index + 1], newOrder[index]];
      reorderMutation.mutate({
        policyId: policyId as string,
        ruleIds: newOrder,
      });
    },
    [policyId, rulesQuery.data?.rules, reorderMutation]
  );

  // Count conditions in a rule
  const countConditions = useCallback((conditions: unknown): number => {
    if (!conditions || typeof conditions !== "object") return 0;
    const group = conditions as { conditions?: unknown[] };
    if (!group.conditions) return 0;
    let total = 0;
    for (const cond of group.conditions) {
      if (cond && typeof cond === "object" && "operator" in cond) {
        total += countConditions(cond);
      } else {
        total += 1;
      }
    }
    return total;
  }, []);

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
      <Box display="flex" justifyContent="space-between" alignItems="center">
        <Box>
          <Box display="flex" alignItems="center" gap={2} marginBottom={1}>
            <Link href="/pricing/policies">
              <Text color="info1" size={2}>
                ← Back to Policies
              </Text>
            </Link>
          </Box>
          <Text as="h1" size={8} fontWeight="bold">
            Pricing Rules
          </Text>
          {policyQuery.data && (
            <Text as="p" color="default2">
              Rules for &quot;{policyQuery.data.name}&quot;
            </Text>
          )}
        </Box>
        <Box display="flex" gap={2}>
          <Link href={`/pricing/rules/test?policyId=${policyId}`}>
            <Button variant="secondary">Test Rules</Button>
          </Link>
          <Link href={`/pricing/rules/new?policyId=${policyId}`}>
            <Button variant="primary">New Rule</Button>
          </Link>
        </Box>
      </Box>

      {error && (
        <Box padding={4} backgroundColor="critical1" borderRadius={4}>
          <Text color="critical1">{error}</Text>
        </Box>
      )}

      {/* Info box */}
      <Box
        padding={4}
        borderRadius={4}
        backgroundColor="info1"
        borderWidth={1}
        borderStyle="solid"
        borderColor="info1"
      >
        <Text>
          <strong>How Rules Work:</strong> Rules are evaluated in order (lower priority first).
          When a rule&apos;s conditions match, its action is applied. Rules can stack to create
          complex pricing adjustments.
        </Text>
      </Box>

      {/* Rules List */}
      {rulesQuery.isLoading ? (
        <Box display="flex" flexDirection="column" gap={2}>
          {[1, 2, 3].map((i) => (
            <Skeleton key={i} style={{ width: "100%", height: 100 }} />
          ))}
        </Box>
      ) : rulesQuery.isError ? (
        <Box padding={4} backgroundColor="critical1" borderRadius={4}>
          <Text color="critical1">Error: {rulesQuery.error.message}</Text>
        </Box>
      ) : rulesQuery.data?.rules.length === 0 ? (
        <Box padding={8} display="flex" flexDirection="column" alignItems="center" gap={4}>
          <Text color="default2">No pricing rules configured for this policy.</Text>
          <Link href={`/pricing/rules/new?policyId=${policyId}`}>
            <Button variant="primary">Create First Rule</Button>
          </Link>
        </Box>
      ) : (
        <Box
          borderWidth={1}
          borderStyle="solid"
          borderColor="default1"
          borderRadius={4}
          overflow="hidden"
        >
          {rulesQuery.data?.rules.map((rule, index) => (
            <Box
              key={rule.id}
              display="flex"
              justifyContent="space-between"
              alignItems="center"
              padding={4}
              borderBottomWidth={index < (rulesQuery.data?.rules.length ?? 0) - 1 ? 1 : 0}
              borderBottomStyle="solid"
              borderColor="default1"
              backgroundColor={!rule.isActive ? "default1" : undefined}
            >
              {/* Left: Priority & Move buttons */}
              <Box display="flex" alignItems="center" gap={4}>
                <Box display="flex" flexDirection="column" gap={1}>
                  <Button
                    onClick={() => handleMoveUp(index)}
                    variant="tertiary"
                    size="small"
                    disabled={index === 0 || reorderMutation.isLoading}
                  >
                    ▲
                  </Button>
                  <Button
                    onClick={() => handleMoveDown(index)}
                    variant="tertiary"
                    size="small"
                    disabled={
                      index === (rulesQuery.data?.rules.length ?? 0) - 1 ||
                      reorderMutation.isLoading
                    }
                  >
                    ▼
                  </Button>
                </Box>

                {/* Priority badge */}
                <Box
                  paddingX={2}
                  paddingY={1}
                  borderRadius={4}
                  backgroundColor="default2"
                  display="flex"
                  justifyContent="center"
                  style={{ minWidth: "40px" }}
                >
                  <Text size={2} fontWeight="bold">
                    #{rule.priority}
                  </Text>
                </Box>

                {/* Rule info */}
                <Box display="flex" flexDirection="column" gap={1}>
                  <Box display="flex" alignItems="center" gap={2}>
                    <Text fontWeight="bold">{rule.name}</Text>
                    {!rule.isActive && (
                      <Box
                        paddingX={2}
                        paddingY={1}
                        borderRadius={2}
                        backgroundColor="default2"
                      >
                        <Text size={1}>INACTIVE</Text>
                      </Box>
                    )}
                    {rule.startsAt || rule.endsAt ? (
                      <Box
                        paddingX={2}
                        paddingY={1}
                        borderRadius={2}
                        backgroundColor="accent1"
                      >
                        <Text size={1}>TIME-LIMITED</Text>
                      </Box>
                    ) : null}
                  </Box>
                  <Text color="default2" size={2}>
                    {formatActionValue(rule.actionType, Number(rule.actionValue))}{" "}
                    ({rule.stackingMode.toLowerCase()})
                    {rule.description && ` - ${rule.description}`}
                  </Text>
                  <Text size={1} color="default2">
                    {countConditions(rule.conditions)} condition(s)
                  </Text>
                </Box>
              </Box>

              {/* Right: Actions */}
              <Box display="flex" gap={2}>
                <Button
                  onClick={() =>
                    toggleMutation.mutate({
                      id: rule.id,
                      isActive: !rule.isActive,
                    })
                  }
                  variant="tertiary"
                  size="small"
                  disabled={toggleMutation.isLoading}
                >
                  {rule.isActive ? "Disable" : "Enable"}
                </Button>
                <Link href={`/pricing/rules/${rule.id}/edit?policyId=${policyId}`}>
                  <Button variant="secondary" size="small">
                    Edit
                  </Button>
                </Link>
                <Button
                  onClick={() => {
                    if (confirm("Delete this rule?")) {
                      deleteMutation.mutate({ id: rule.id });
                    }
                  }}
                  variant="tertiary"
                  size="small"
                  disabled={deleteMutation.isLoading}
                >
                  Delete
                </Button>
              </Box>
            </Box>
          ))}
        </Box>
      )}
    </Box>
  );
}
