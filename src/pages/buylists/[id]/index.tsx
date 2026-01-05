import { Box, Button, Skeleton, Text } from "@saleor/macaw-ui";
import { useRouter } from "next/router";
import { useEffect, useState } from "react";

import { trpcClient } from "@/modules/trpc/trpc-client";
import { useToast } from "@/ui/components/Toast";

const STATUS_COLORS: Record<string, string> = {
  DRAFT: "default2",
  QUOTED: "info1",
  SUBMITTED: "warning1",
  PENDING_REVIEW: "warning1",
  APPROVED: "success1",
  RECEIVED: "success1",
  PAID: "success1",
  REJECTED: "critical1",
  CANCELLED: "default2",
};

const CONDITION_LABELS: Record<string, string> = {
  NM: "Near Mint",
  LP: "Lightly Played",
  MP: "Moderately Played",
  HP: "Heavily Played",
  DMG: "Damaged",
};

export default function BuylistDetailPage() {
  const router = useRouter();
  const { id, created } = router.query;
  const { showSuccess, showError } = useToast();
  const [showCreatedBanner, setShowCreatedBanner] = useState(false);

  // Detect if this is a newly created buylist
  useEffect(() => {
    if (created === "true") {
      setShowCreatedBanner(true);
      // Clean up URL without triggering navigation
      const url = new URL(window.location.href);
      url.searchParams.delete("created");
      window.history.replaceState({}, "", url.toString());
    }
  }, [created]);

  const buylistQuery = trpcClient.buylists.getById.useQuery(
    { id: id as string },
    { enabled: !!id }
  );

  const utils = trpcClient.useUtils();

  const cancelMutation = trpcClient.buylists.cancel.useMutation({
    onSuccess: () => {
      showSuccess("Buylist has been cancelled.");
      utils.buylists.getById.invalidate({ id: id as string });
    },
    onError: (err) => {
      showError(`Failed to cancel buylist: ${err.message}`);
    },
  });

  if (buylistQuery.isLoading) {
    return (
      <Box display="flex" flexDirection="column" gap={4}>
        <Skeleton style={{ width: 300, height: 40 }} />
        <Skeleton style={{ width: "100%", height: 200 }} />
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

  return (
    <Box display="flex" flexDirection="column" gap={6}>
      {/* Success Banner for newly created buylist */}
      {showCreatedBanner && buylist.status === "PENDING_VERIFICATION" && (
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
              Buylist created successfully!
            </Text>
            <Text size={2}>
              Customer has been paid. This buylist is now ready for back-of-house verification.
            </Text>
          </Box>
          <Box display="flex" gap={2}>
            <Button
              onClick={() => setShowCreatedBanner(false)}
              variant="tertiary"
              size="small"
            >
              Dismiss
            </Button>
            <Button
              onClick={() => router.push(`/boh/buylists/${buylist.id}/verify`)}
              variant="secondary"
              size="small"
            >
              Verify Now
            </Button>
          </Box>
        </Box>
      )}

      {/* Header */}
      <Box display="flex" justifyContent="space-between" alignItems="flex-start">
        <Box>
          <Box display="flex" alignItems="center" gap={4}>
            <Text as="h1" size={8} fontWeight="bold">
              {buylist.buylistNumber}
            </Text>
            <Box
              paddingX={3}
              paddingY={1}
              borderRadius={4}
              backgroundColor={STATUS_COLORS[buylist.status] as unknown as undefined}
            >
              <Text fontWeight="medium">{buylist.status}</Text>
            </Box>
          </Box>
          <Text color="default2">
            Created {new Date(buylist.createdAt).toLocaleString()}
          </Text>
        </Box>
        <Box display="flex" gap={2}>
          <Button onClick={() => router.push("/buylists")} variant="tertiary">
            Back to List
          </Button>
          {buylist.status === "PENDING_VERIFICATION" && (
            <>
              <Button
                onClick={() => router.push(`/boh/buylists/${buylist.id}/verify`)}
                variant="secondary"
              >
                Verify Now
              </Button>
              <Button
                onClick={() => cancelMutation.mutate({ id: buylist.id })}
                variant="tertiary"
                disabled={cancelMutation.isLoading}
              >
                Cancel
              </Button>
            </>
          )}
        </Box>
      </Box>

      {/* Customer Info & Summary */}
      <Box display="grid" __gridTemplateColumns="1fr 1fr" gap={6}>
        <Box
          padding={6}
          borderRadius={4}
          borderWidth={1}
          borderStyle="solid"
          borderColor="default1"
        >
          <Text as="h2" size={5} fontWeight="bold" marginBottom={4}>
            Customer
          </Text>
          <Box display="flex" flexDirection="column" gap={2}>
            <InfoRow label="Name" value={buylist.customerName || "Walk-in"} />
            <InfoRow label="Email" value={buylist.customerEmail || "-"} />
            <InfoRow label="Phone" value={buylist.customerPhone || "-"} />
          </Box>
          {buylist.notes && (
            <Box marginTop={4}>
              <Text size={2} color="default2">Notes</Text>
              <Text>{buylist.notes}</Text>
            </Box>
          )}
        </Box>

        <Box
          padding={6}
          borderRadius={4}
          borderWidth={1}
          borderStyle="solid"
          borderColor="default1"
        >
          <Text as="h2" size={5} fontWeight="bold" marginBottom={4}>
            Summary
          </Text>
          <Box display="flex" flexDirection="column" gap={2}>
            <InfoRow
              label="Total Items"
              value={buylist.lines.reduce((sum, l) => sum + l.qty, 0).toString()}
            />
            <InfoRow
              label="Quoted Amount"
              value={`$${Number(buylist.totalQuotedAmount).toFixed(2)}`}
            />
            <InfoRow
              label="Final Amount"
              value={`$${Number(buylist.totalFinalAmount).toFixed(2)}`}
            />
            <InfoRow
              label="Pricing Policy"
              value={buylist.pricingPolicy?.name || "Default"}
            />
          </Box>
        </Box>
      </Box>

      {/* Lines Table */}
      <Box>
        <Text as="h2" size={5} fontWeight="bold" marginBottom={4}>
          Line Items
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
            __gridTemplateColumns="60px 2fr 80px 120px 100px 100px 100px"
            gap={4}
            padding={4}
            backgroundColor="default1"
          >
            <Text fontWeight="bold">#</Text>
            <Text fontWeight="bold">Card</Text>
            <Text fontWeight="bold">Qty</Text>
            <Text fontWeight="bold">Condition</Text>
            <Text fontWeight="bold">Market</Text>
            <Text fontWeight="bold">Quoted</Text>
            <Text fontWeight="bold">Final</Text>
          </Box>

          {buylist.lines.map((line) => (
            <Box
              key={line.id}
              display="grid"
              __gridTemplateColumns="60px 2fr 80px 120px 100px 100px 100px"
              gap={4}
              padding={4}
              borderTopWidth={1}
              borderTopStyle="solid"
              borderColor="default1"
            >
              <Text color="default2">{line.lineNumber}</Text>
              <Box>
                <Text fontWeight="medium">{line.saleorVariantName || line.saleorVariantSku}</Text>
                {line.saleorVariantSku && (
                  <Text size={2} color="default2">{line.saleorVariantSku}</Text>
                )}
              </Box>
              <Text>{line.qty}</Text>
              <Text>{CONDITION_LABELS[line.condition] || line.condition}</Text>
              <Text>${Number(line.marketPrice).toFixed(2)}</Text>
              <Text>${Number(line.quotedPrice).toFixed(2)}</Text>
              <Text fontWeight="medium">${Number(line.finalPrice).toFixed(2)}</Text>
            </Box>
          ))}

          <Box
            display="grid"
            __gridTemplateColumns="60px 2fr 80px 120px 100px 100px 100px"
            gap={4}
            padding={4}
            backgroundColor="default1"
          >
            <Box />
            <Text fontWeight="bold">Totals</Text>
            <Text fontWeight="bold">
              {buylist.lines.reduce((sum, l) => sum + l.qty, 0)}
            </Text>
            <Box />
            <Text fontWeight="bold">
              ${buylist.lines.reduce((sum, l) => sum + Number(l.marketPrice) * l.qty, 0).toFixed(2)}
            </Text>
            <Text fontWeight="bold">
              ${Number(buylist.totalQuotedAmount).toFixed(2)}
            </Text>
            <Text fontWeight="bold">
              ${Number(buylist.totalFinalAmount).toFixed(2)}
            </Text>
          </Box>
        </Box>
      </Box>

      {/* Audit Events */}
      {buylist.events.length > 0 && (
        <Box>
          <Text as="h2" size={5} fontWeight="bold" marginBottom={4}>
            Activity Log
          </Text>
          <Box
            borderWidth={1}
            borderStyle="solid"
            borderColor="default1"
            borderRadius={4}
            overflow="hidden"
          >
            {buylist.events.map((event) => (
              <Box
                key={event.id}
                display="flex"
                justifyContent="space-between"
                padding={4}
                borderBottomWidth={1}
                borderBottomStyle="solid"
                borderColor="default1"
              >
                <Box display="flex" gap={2}>
                  <Text fontWeight="medium">{event.action}</Text>
                  {event.userId && (
                    <Text color="default2">by {event.userId}</Text>
                  )}
                </Box>
                <Text color="default2">
                  {new Date(event.createdAt).toLocaleString()}
                </Text>
              </Box>
            ))}
          </Box>
        </Box>
      )}
    </Box>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <Box display="flex" justifyContent="space-between">
      <Text color="default2">{label}</Text>
      <Text>{value}</Text>
    </Box>
  );
}
