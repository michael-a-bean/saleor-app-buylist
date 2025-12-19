import { Box, Button, Skeleton, Text } from "@saleor/macaw-ui";
import { useRouter } from "next/router";
import { useState } from "react";

import { trpcClient } from "@/modules/trpc/trpc-client";

const CONDITION_LABELS: Record<string, string> = {
  NM: "Near Mint",
  LP: "Lightly Played",
  MP: "Moderately Played",
  HP: "Heavily Played",
  DMG: "Damaged",
};

export default function BOHReceivePage() {
  const router = useRouter();
  const { id } = router.query;
  const [error, setError] = useState<string | null>(null);

  const buylistQuery = trpcClient.buylists.getById.useQuery(
    { id: id as string },
    { enabled: !!id }
  );

  const receiveMutation = trpcClient.boh.receive.useMutation({
    onSuccess: () => {
      router.push("/boh/queue");
    },
    onError: (err) => {
      setError(err.message);
    },
  });

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

  if (buylist.status !== "APPROVED") {
    return (
      <Box display="flex" flexDirection="column" gap={4} alignItems="center" padding={8}>
        <Text size={6}>This buylist is not approved for receiving.</Text>
        <Button onClick={() => router.push("/boh/queue")} variant="secondary">
          Back to Queue
        </Button>
      </Box>
    );
  }

  const handleReceive = () => {
    if (!buylist) return;
    setError(null);
    receiveMutation.mutate({ buylistId: buylist.id });
  };

  // Calculate totals from accepted quantities
  const totalQty = buylist.lines.reduce((sum, l) => sum + (l.qtyAccepted ?? 0), 0);
  const totalValue = buylist.lines.reduce(
    (sum, l) => sum + Number(l.finalPrice) * (l.qtyAccepted ?? 0),
    0
  );

  return (
    <Box display="flex" flexDirection="column" gap={6}>
      {/* Header */}
      <Box display="flex" justifyContent="space-between" alignItems="flex-start">
        <Box>
          <Text as="h1" size={8} fontWeight="bold">
            Receive: {buylist.buylistNumber}
          </Text>
          <Text color="default2">
            {buylist.customerName || buylist.customerEmail || "Walk-in"} - Approved{" "}
            {new Date(buylist.reviewedAt!).toLocaleString()}
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

      {/* Summary */}
      <Box
        padding={6}
        borderRadius={4}
        backgroundColor="success1"
        display="flex"
        justifyContent="space-between"
        alignItems="center"
      >
        <Box>
          <Text as="h2" size={6} fontWeight="bold">
            Ready to Receive
          </Text>
          <Text>
            {totalQty} cards for ${totalValue.toFixed(2)} {buylist.currency}
          </Text>
        </Box>
        <Button
          onClick={handleReceive}
          variant="primary"
          disabled={receiveMutation.isLoading}
        >
          {receiveMutation.isLoading ? "Receiving..." : "Confirm Receive"}
        </Button>
      </Box>

      {/* Info Box */}
      <Box
        padding={4}
        borderRadius={4}
        backgroundColor="info1"
        borderWidth={1}
        borderStyle="solid"
        borderColor="info1"
      >
        <Text>
          Receiving this buylist will:
        </Text>
        <Box as="ul" marginLeft={4} marginTop={2}>
          <li><Text>Create cost layer events for inventory tracking</Text></li>
          <li><Text>Update stock quantities in Saleor</Text></li>
          <li><Text>Move buylist to &quot;Received&quot; status</Text></li>
        </Box>
      </Box>

      {/* Lines Summary */}
      <Box>
        <Text as="h2" size={5} fontWeight="bold" marginBottom={4}>
          Items to Receive
        </Text>
        <Box
          borderWidth={1}
          borderStyle="solid"
          borderColor="default1"
          borderRadius={4}
          overflow="hidden"
        >
          <Box
            display="grid"
            __gridTemplateColumns="2fr 120px 100px 100px 120px"
            gap={4}
            padding={4}
            backgroundColor="default1"
          >
            <Text fontWeight="bold">Card</Text>
            <Text fontWeight="bold">Condition</Text>
            <Text fontWeight="bold">Qty Accepted</Text>
            <Text fontWeight="bold">Unit Cost</Text>
            <Text fontWeight="bold">Line Total</Text>
          </Box>

          {buylist.lines.map((line) => {
            const qtyAccepted = line.qtyAccepted ?? 0;
            const lineTotal = qtyAccepted * Number(line.finalPrice);

            return (
              <Box
                key={line.id}
                display="grid"
                __gridTemplateColumns="2fr 120px 100px 100px 120px"
                gap={4}
                padding={4}
                borderTopWidth={1}
                borderTopStyle="solid"
                borderColor="default1"
                style={{ opacity: qtyAccepted === 0 ? 0.5 : 1 }}
              >
                <Box>
                  <Text fontWeight="medium">
                    {line.saleorVariantName || line.saleorVariantSku}
                  </Text>
                  {line.conditionNote && (
                    <Text size={2} color="default2">
                      Note: {line.conditionNote}
                    </Text>
                  )}
                </Box>
                <Text>{CONDITION_LABELS[line.condition] || line.condition}</Text>
                <Text>
                  {qtyAccepted}
                  {qtyAccepted !== line.qty && (
                    <Text as="span" color="default2"> (of {line.qty})</Text>
                  )}
                </Text>
                <Text>${Number(line.finalPrice).toFixed(2)}</Text>
                <Text fontWeight="medium">${lineTotal.toFixed(2)}</Text>
              </Box>
            );
          })}

          <Box
            display="grid"
            __gridTemplateColumns="2fr 120px 100px 100px 120px"
            gap={4}
            padding={4}
            backgroundColor="default1"
          >
            <Text fontWeight="bold">Totals</Text>
            <Box />
            <Text fontWeight="bold">{totalQty}</Text>
            <Box />
            <Text fontWeight="bold">${totalValue.toFixed(2)}</Text>
          </Box>
        </Box>
      </Box>

      {/* Internal Notes */}
      {buylist.internalNotes && (
        <Box
          padding={4}
          borderRadius={4}
          borderWidth={1}
          borderStyle="solid"
          borderColor="warning1"
          backgroundColor="warning1"
        >
          <Text fontWeight="bold" marginBottom={2}>
            Internal Notes
          </Text>
          <Text>{buylist.internalNotes}</Text>
        </Box>
      )}

      {/* Actions */}
      <Box display="flex" justifyContent="flex-end" gap={2}>
        <Button onClick={() => router.push("/boh/queue")} variant="tertiary">
          Cancel
        </Button>
        <Button
          onClick={handleReceive}
          variant="primary"
          disabled={receiveMutation.isLoading || totalQty === 0}
        >
          {receiveMutation.isLoading ? "Receiving..." : "Confirm Receive"}
        </Button>
      </Box>
    </Box>
  );
}
