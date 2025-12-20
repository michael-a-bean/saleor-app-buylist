import { Box, Button, Input, Select, Skeleton, Text, Textarea } from "@saleor/macaw-ui";
import { useRouter } from "next/router";
import { useEffect, useState } from "react";

import { trpcClient } from "@/modules/trpc/trpc-client";

const CONDITIONS = [
  { value: "NM", label: "Near Mint (NM)" },
  { value: "LP", label: "Lightly Played (LP)" },
  { value: "MP", label: "Moderately Played (MP)" },
  { value: "HP", label: "Heavily Played (HP)" },
  { value: "DMG", label: "Damaged (DMG)" },
];

const CONDITION_LABELS: Record<string, string> = {
  NM: "Near Mint",
  LP: "Lightly Played",
  MP: "Moderately Played",
  HP: "Heavily Played",
  DMG: "Damaged",
};

interface LineVerification {
  lineId: string;
  condition: string;
  qtyAccepted: number;
  conditionNote: string;
}

export default function BOHVerifyPage() {
  const router = useRouter();
  const { id } = router.query;
  const [error, setError] = useState<string | null>(null);
  const [internalNotes, setInternalNotes] = useState("");
  const [lineUpdates, setLineUpdates] = useState<Record<string, LineVerification>>({});

  const buylistQuery = trpcClient.buylists.getById.useQuery(
    { id: id as string },
    { enabled: !!id }
  );

  const utils = trpcClient.useUtils();

  const verifyMutation = trpcClient.boh.verifyAndReceive.useMutation({
    onSuccess: () => {
      utils.boh.queue.invalidate();
      utils.boh.stats.invalidate();
      router.push("/boh/queue");
    },
    onError: (err) => {
      setError(err.message);
    },
  });

  // Initialize line updates from buylist data
  useEffect(() => {
    if (buylistQuery.data?.lines) {
      const updates: Record<string, LineVerification> = {};
      buylistQuery.data.lines.forEach((line) => {
        updates[line.id] = {
          lineId: line.id,
          condition: line.condition,
          qtyAccepted: line.qty,
          conditionNote: "",
        };
      });
      setLineUpdates(updates);
    }
  }, [buylistQuery.data]);

  if (buylistQuery.isLoading) {
    return (
      <Box display="flex" flexDirection="column" gap={4}>
        <Skeleton style={{ width: 300, height: 40 }} />
        <Skeleton style={{ width: "100%", height: 400 }} />
      </Box>
    );
  }

  if (buylistQuery.isError) {
    return (
      <Box padding={4} backgroundColor="critical1" borderRadius={4}>
        <Text color="critical1">Error: {buylistQuery.error.message}</Text>
      </Box>
    );
  }

  const buylist = buylistQuery.data;
  if (!buylist) return null;

  if (buylist.status !== "PENDING_VERIFICATION") {
    return (
      <Box display="flex" flexDirection="column" gap={4} alignItems="center" padding={8}>
        <Text size={6}>This buylist is not pending verification.</Text>
        <Text color="default2">Status: {buylist.status}</Text>
        <Button onClick={() => router.push("/boh/queue")} variant="secondary">
          Back to Queue
        </Button>
      </Box>
    );
  }

  const updateLine = (lineId: string, updates: Partial<LineVerification>) => {
    setLineUpdates((prev) => ({
      ...prev,
      [lineId]: { ...prev[lineId], ...updates },
    }));
  };

  const handleVerify = () => {
    if (!buylist) return;
    setError(null);

    // Build lines array with updates
    const lines = Object.values(lineUpdates).map((lu) => ({
      lineId: lu.lineId,
      condition: lu.condition as "NM" | "LP" | "MP" | "HP" | "DMG",
      qtyAccepted: lu.qtyAccepted,
      conditionNote: lu.conditionNote || undefined,
    }));

    verifyMutation.mutate({
      buylistId: buylist.id,
      lines,
      internalNotes: internalNotes || undefined,
    });
  };

  // Calculate totals
  const totalQty = Object.values(lineUpdates).reduce((sum, l) => sum + l.qtyAccepted, 0);
  const totalValue = buylist.lines.reduce((sum, l) => {
    const qtyAccepted = lineUpdates[l.id]?.qtyAccepted ?? l.qty;
    return sum + Number(l.finalPrice) * qtyAccepted;
  }, 0);

  // Check if any condition has changed
  const hasConditionChanges = buylist.lines.some(
    (l) => lineUpdates[l.id] && lineUpdates[l.id].condition !== l.condition
  );

  return (
    <Box display="flex" flexDirection="column" gap={6}>
      {/* Header */}
      <Box display="flex" justifyContent="space-between" alignItems="flex-start">
        <Box>
          <Text as="h1" size={8} fontWeight="bold">
            Verify: {buylist.buylistNumber}
          </Text>
          <Text color="default2">
            {buylist.customerName || buylist.customerEmail || "Walk-in"} - Paid{" "}
            {buylist.paidAt ? new Date(buylist.paidAt).toLocaleString() : "N/A"}
          </Text>
        </Box>
        <Button onClick={() => router.push("/boh/queue")} variant="tertiary">
          Back to Queue
        </Button>
      </Box>

      {error && (
        <Box padding={4} backgroundColor="critical1" borderRadius={4}>
          <Text color="critical1">{error}</Text>
        </Box>
      )}

      {/* Payment Info Banner */}
      <Box
        padding={4}
        borderRadius={4}
        backgroundColor="success1"
        display="flex"
        justifyContent="space-between"
        alignItems="center"
      >
        <Box>
          <Text fontWeight="bold">
            Customer was paid ${Number(buylist.totalQuotedAmount).toFixed(2)} {buylist.currency}
          </Text>
          <Text size={2}>
            via {buylist.payoutMethod?.replace("_", " ")}
            {buylist.payoutReference && ` - Ref: ${buylist.payoutReference}`}
          </Text>
        </Box>
      </Box>

      {/* Instructions */}
      <Box
        padding={4}
        borderRadius={4}
        backgroundColor="info1"
      >
        <Text fontWeight="bold" marginBottom={2}>
          Verification Instructions
        </Text>
        <Text>
          1. Verify each card is present and matches the condition listed
        </Text>
        <Text>
          2. Update condition if card is in different condition than recorded
        </Text>
        <Text>
          3. Reduce quantity if any cards are missing
        </Text>
        <Text size={2} color="default2" marginTop={2}>
          Note: Prices cannot be changed - customer has already been paid
        </Text>
      </Box>

      {/* Lines Table */}
      <Box>
        <Text as="h2" size={5} fontWeight="bold" marginBottom={4}>
          Cards to Verify ({buylist.lines.length} items)
        </Text>
        <Box
          borderWidth={1}
          borderStyle="solid"
          borderColor="default1"
          borderRadius={4}
          overflow="hidden"
        >
          {/* Header */}
          <Box
            display="grid"
            __gridTemplateColumns="2fr 130px 80px 90px 200px"
            gap={3}
            padding={4}
            backgroundColor="default1"
            alignItems="center"
          >
            <Text fontWeight="bold">Card</Text>
            <Text fontWeight="bold">Condition</Text>
            <Text fontWeight="bold">Qty</Text>
            <Text fontWeight="bold">Buy Price</Text>
            <Text fontWeight="bold">Note (optional)</Text>
          </Box>

          {buylist.lines.map((line) => {
            const lineUpdate = lineUpdates[line.id];
            const conditionChanged = lineUpdate && lineUpdate.condition !== line.condition;

            return (
              <Box
                key={line.id}
                display="grid"
                __gridTemplateColumns="2fr 130px 80px 90px 200px"
                gap={3}
                padding={4}
                borderTopWidth={1}
                borderTopStyle="solid"
                borderColor="default1"
                alignItems="center"
                backgroundColor={conditionChanged ? "warning1" : "transparent"}
              >
                <Box>
                  <Text fontWeight="medium">
                    {line.saleorVariantName || line.saleorVariantSku}
                  </Text>
                  {conditionChanged && (
                    <Text size={2} color="warning1">
                      Originally: {CONDITION_LABELS[line.condition]}
                    </Text>
                  )}
                </Box>
                <Select
                  value={lineUpdate?.condition ?? line.condition}
                  onChange={(value) => updateLine(line.id, { condition: value as string })}
                  options={CONDITIONS}
                  size="small"
                />
                <Input
                  type="number"
                  min={0}
                  max={line.qty}
                  value={(lineUpdate?.qtyAccepted ?? line.qty).toString()}
                  onChange={(e) =>
                    updateLine(line.id, {
                      qtyAccepted: Math.min(line.qty, Math.max(0, parseInt(e.target.value) || 0)),
                    })
                  }
                  size="small"
                />
                <Text>${Number(line.finalPrice).toFixed(2)}</Text>
                <Input
                  value={lineUpdate?.conditionNote ?? ""}
                  onChange={(e) => updateLine(line.id, { conditionNote: e.target.value })}
                  placeholder="e.g., 'has crease'"
                  size="small"
                />
              </Box>
            );
          })}

          {/* Totals */}
          <Box
            display="grid"
            __gridTemplateColumns="2fr 130px 80px 90px 200px"
            gap={3}
            padding={4}
            backgroundColor="default1"
            alignItems="center"
          >
            <Text fontWeight="bold">Totals</Text>
            <Box />
            <Text fontWeight="bold">{totalQty}</Text>
            <Text fontWeight="bold">${totalValue.toFixed(2)}</Text>
            <Box />
          </Box>
        </Box>
      </Box>

      {/* Condition Change Warning */}
      {hasConditionChanges && (
        <Box
          padding={4}
          borderRadius={4}
          backgroundColor="warning1"
          borderWidth={1}
          borderStyle="solid"
          borderColor="warning1"
        >
          <Text fontWeight="bold">
            Condition Changes Detected
          </Text>
          <Text>
            Some card conditions have been updated. This is noted for records but does not affect
            the amount paid to the customer.
          </Text>
        </Box>
      )}

      {/* Internal Notes */}
      <Box>
        <Text fontWeight="bold" marginBottom={2}>
          Internal Notes (optional)
        </Text>
        <Textarea
          value={internalNotes}
          onChange={(e) => setInternalNotes(e.target.value)}
          placeholder="Add any notes about this verification (e.g., 'missing 2 cards', 'condition discrepancies')"
          rows={3}
        />
      </Box>

      {/* Actions */}
      <Box display="flex" justifyContent="space-between" alignItems="center">
        <Box>
          <Text size={6} fontWeight="bold">
            Cards to receive: {totalQty}
          </Text>
          <Text color="default2">
            Value: ${totalValue.toFixed(2)} {buylist.currency}
          </Text>
        </Box>
        <Box display="flex" gap={4}>
          <Button onClick={() => router.push("/boh/queue")} variant="tertiary">
            Cancel
          </Button>
          <Button
            onClick={handleVerify}
            variant="primary"
            disabled={verifyMutation.isLoading || totalQty === 0}
          >
            {verifyMutation.isLoading ? "Processing..." : "Verify & Add to Inventory"}
          </Button>
        </Box>
      </Box>
    </Box>
  );
}
