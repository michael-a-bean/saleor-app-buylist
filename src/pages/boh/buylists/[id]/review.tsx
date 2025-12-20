import { Box, Button, Input, Skeleton, Text } from "@saleor/macaw-ui";
import { useRouter } from "next/router";
import { useEffect, useState } from "react";

import { trpcClient } from "@/modules/trpc/trpc-client";

const CONDITION_LABELS: Record<string, string> = {
  NM: "Near Mint",
  LP: "Lightly Played",
  MP: "Moderately Played",
  HP: "Heavily Played",
  DMG: "Damaged",
};

interface LineReview {
  lineId: string;
  qtyAccepted: number;
  finalPrice?: number;
  conditionNote?: string;
}

export default function BOHReviewPage() {
  const router = useRouter();
  const { id } = router.query;

  const [lineReviews, setLineReviews] = useState<Record<string, LineReview>>({});
  const [internalNotes, setInternalNotes] = useState("");
  const [error, setError] = useState<string | null>(null);

  const buylistQuery = trpcClient.buylists.getById.useQuery(
    { id: id as string },
    { enabled: !!id }
  );

  const utils = trpcClient.useUtils();

  const reviewMutation = trpcClient.boh.review.useMutation({
    onSuccess: () => {
      utils.buylists.getById.invalidate({ id: id as string });
    },
    onError: (err) => {
      setError(err.message);
    },
  });

  const approveMutation = trpcClient.boh.approve.useMutation({
    onSuccess: () => {
      // Invalidate queue caches before navigating
      utils.boh.queue.invalidate();
      utils.boh.stats.invalidate();
      utils.boh.readyToReceive.invalidate();
      router.push("/boh/queue");
    },
    onError: (err) => {
      setError(err.message);
    },
  });

  const rejectMutation = trpcClient.boh.reject.useMutation({
    onSuccess: () => {
      // Invalidate queue caches before navigating
      utils.boh.queue.invalidate();
      utils.boh.stats.invalidate();
      router.push("/boh/queue");
    },
    onError: (err) => {
      setError(err.message);
    },
  });

  // Initialize line reviews when data loads
  useEffect(() => {
    if (buylistQuery.data?.lines) {
      const initial: Record<string, LineReview> = {};
      buylistQuery.data.lines.forEach((line) => {
        initial[line.id] = {
          lineId: line.id,
          qtyAccepted: line.qtyAccepted ?? line.qty,
          finalPrice: Number(line.finalPrice),
          conditionNote: line.conditionNote || "",
        };
      });
      setLineReviews(initial);
      setInternalNotes(buylistQuery.data.internalNotes || "");
    }
  }, [buylistQuery.data]);

  const updateLineReview = (lineId: string, field: keyof LineReview, value: LineReview[keyof LineReview]) => {
    setLineReviews((prev) => ({
      ...prev,
      [lineId]: {
        ...prev[lineId],
        [field]: value,
      },
    }));
  };

  const handleSaveReview = () => {
    if (!buylistQuery.data) return;

    setError(null);
    reviewMutation.mutate({
      buylistId: buylistQuery.data.id,
      lines: Object.values(lineReviews),
      internalNotes,
    });
  };

  const handleApprove = async () => {
    if (!buylistQuery.data) return;
    setError(null);

    // First save the review to set qtyAccepted values
    try {
      await reviewMutation.mutateAsync({
        buylistId: buylistQuery.data.id,
        lines: Object.values(lineReviews),
        internalNotes,
      });
      // Then approve
      approveMutation.mutate({ buylistId: buylistQuery.data.id });
    } catch {
      // Error already handled by onError callback
    }
  };

  const handleReject = () => {
    const reason = prompt("Please enter rejection reason:");
    if (!reason) return;
    if (!buylistQuery.data) return;
    rejectMutation.mutate({ buylistId: buylistQuery.data.id, reason });
  };

  // Calculate totals
  const calculateTotals = () => {
    if (!buylistQuery.data) return { totalQty: 0, totalValue: 0 };

    let totalQty = 0;
    let totalValue = 0;

    buylistQuery.data.lines.forEach((line) => {
      const review = lineReviews[line.id];
      const qty = review?.qtyAccepted ?? line.qty;
      const price = review?.finalPrice ?? Number(line.finalPrice);
      totalQty += qty;
      totalValue += qty * price;
    });

    return { totalQty, totalValue };
  };

  const { totalQty, totalValue } = calculateTotals();

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

  if (buylist.status !== "PENDING_REVIEW") {
    return (
      <Box display="flex" flexDirection="column" gap={4} alignItems="center" padding={8}>
        <Text size={6}>This buylist is not pending review.</Text>
        <Button onClick={() => router.push("/boh/queue")} variant="secondary">
          Back to Queue
        </Button>
      </Box>
    );
  }

  return (
    <Box display="flex" flexDirection="column" gap={6}>
      {/* Header */}
      <Box display="flex" justifyContent="space-between" alignItems="flex-start">
        <Box>
          <Text as="h1" size={8} fontWeight="bold">
            Review: {buylist.buylistNumber}
          </Text>
          <Text color="default2">
            {buylist.customerName || buylist.customerEmail || "Walk-in"} - Submitted{" "}
            {new Date(buylist.submittedAt!).toLocaleString()}
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
      <Box display="flex" gap={4}>
        <Box
          padding={4}
          borderRadius={4}
          borderWidth={1}
          borderStyle="solid"
          borderColor="default1"
        >
          <Text size={2} color="default2">Original Quote</Text>
          <Text size={6} fontWeight="bold">
            ${Number(buylist.totalQuotedAmount).toFixed(2)}
          </Text>
        </Box>
        <Box
          padding={4}
          borderRadius={4}
          borderWidth={1}
          borderStyle="solid"
          borderColor="info1"
          backgroundColor="info1"
        >
          <Text size={2}>Reviewed Total</Text>
          <Text size={6} fontWeight="bold">
            ${totalValue.toFixed(2)}
          </Text>
        </Box>
        <Box
          padding={4}
          borderRadius={4}
          borderWidth={1}
          borderStyle="solid"
          borderColor="default1"
        >
          <Text size={2} color="default2">Items Accepted</Text>
          <Text size={6} fontWeight="bold">
            {totalQty}
          </Text>
        </Box>
      </Box>

      {/* Lines Review */}
      <Box
        borderWidth={1}
        borderStyle="solid"
        borderColor="default1"
        borderRadius={4}
        overflow="hidden"
      >
        <Box
          display="grid"
          __gridTemplateColumns="2fr 100px 80px 100px 150px"
          gap={4}
          padding={4}
          backgroundColor="default1"
        >
          <Text fontWeight="bold">Card</Text>
          <Text fontWeight="bold">Condition</Text>
          <Text fontWeight="bold">Qty</Text>
          <Text fontWeight="bold">Price</Text>
          <Text fontWeight="bold">Note</Text>
        </Box>

        {buylist.lines.map((line) => {
          const review = lineReviews[line.id] || {
            qtyAccepted: line.qty,
            finalPrice: Number(line.finalPrice),
          };

          return (
            <Box
              key={line.id}
              display="grid"
              __gridTemplateColumns="2fr 100px 80px 100px 150px"
              gap={4}
              padding={4}
              alignItems="center"
              borderTopWidth={1}
              borderTopStyle="solid"
              borderColor="default1"
            >
              <Box>
                <Text fontWeight="medium">{line.saleorVariantName || line.saleorVariantSku}</Text>
                <Text size={2} color="default2">
                  Original: {line.qty}x @ ${Number(line.quotedPrice).toFixed(2)}
                </Text>
              </Box>
              <Text>{CONDITION_LABELS[line.condition] || line.condition}</Text>
              <Input
                type="number"
                min={0}
                max={line.qty}
                value={review.qtyAccepted.toString()}
                onChange={(e) =>
                  updateLineReview(line.id, "qtyAccepted", parseInt(e.target.value) || 0)
                }
                size="small"
              />
              <Input
                type="number"
                min={0}
                step={0.01}
                value={review.finalPrice?.toString() || ""}
                onChange={(e) =>
                  updateLineReview(line.id, "finalPrice", parseFloat(e.target.value) || 0)
                }
                size="small"
              />
              <Input
                value={review.conditionNote || ""}
                onChange={(e) => updateLineReview(line.id, "conditionNote", e.target.value)}
                placeholder="Note..."
                size="small"
              />
            </Box>
          );
        })}
      </Box>

      {/* Internal Notes */}
      <Box>
        <Text fontWeight="bold" marginBottom={2}>
          Internal Notes
        </Text>
        <Input
          value={internalNotes}
          onChange={(e) => setInternalNotes(e.target.value)}
          placeholder="Notes visible only to staff..."
        />
      </Box>

      {/* Actions */}
      <Box display="flex" justifyContent="space-between">
        <Button
          onClick={handleReject}
          variant="tertiary"
          disabled={rejectMutation.isLoading}
        >
          Reject Buylist
        </Button>
        <Box display="flex" gap={2}>
          <Button
            onClick={handleSaveReview}
            variant="secondary"
            disabled={reviewMutation.isLoading}
          >
            {reviewMutation.isLoading ? "Saving..." : "Save Review"}
          </Button>
          <Button
            onClick={handleApprove}
            variant="primary"
            disabled={approveMutation.isLoading || Object.keys(lineReviews).length === 0}
          >
            {approveMutation.isLoading ? "Approving..." : "Approve & Continue"}
          </Button>
        </Box>
      </Box>
    </Box>
  );
}
