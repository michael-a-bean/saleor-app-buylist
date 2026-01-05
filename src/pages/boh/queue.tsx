import { Box, Button, Skeleton, Text } from "@saleor/macaw-ui";
import { useRouter } from "next/router";
import { useEffect, useState } from "react";

import { trpcClient } from "@/modules/trpc/trpc-client";

export default function BOHQueuePage() {
  const router = useRouter();
  const { verified } = router.query;
  const [recentlyVerified, setRecentlyVerified] = useState<string | null>(null);

  // Detect if we just verified a buylist
  useEffect(() => {
    if (typeof verified === "string" && verified) {
      setRecentlyVerified(verified);
      // Clean up URL without triggering navigation
      const url = new URL(window.location.href);
      url.searchParams.delete("verified");
      window.history.replaceState({}, "", url.toString());
      // Auto-dismiss after 8 seconds
      const timer = setTimeout(() => setRecentlyVerified(null), 8000);
      return () => clearTimeout(timer);
    }
  }, [verified]);

  const statsQuery = trpcClient.boh.stats.useQuery(undefined, {
    refetchOnWindowFocus: true,
    staleTime: 0,
  });

  const queueQuery = trpcClient.boh.queue.useQuery(undefined, {
    refetchOnWindowFocus: true,
    staleTime: 0,
  });

  return (
    <Box display="flex" flexDirection="column" gap={6}>
      {/* Success Banner for recently verified buylist */}
      {recentlyVerified && (
        <Box
          padding={4}
          borderRadius={4}
          backgroundColor="success1"
          display="flex"
          justifyContent="space-between"
          alignItems="center"
        >
          <Box display="flex" alignItems="center" gap={2}>
            <Text fontWeight="bold" size={5}>
              ✓
            </Text>
            <Box>
              <Text fontWeight="bold">
                {recentlyVerified} verified successfully!
              </Text>
              <Text size={2}>
                Cards have been added to inventory.
              </Text>
            </Box>
          </Box>
          <Button
            onClick={() => setRecentlyVerified(null)}
            variant="tertiary"
            size="small"
          >
            Dismiss
          </Button>
        </Box>
      )}

      <Box>
        <Text as="h1" size={8} fontWeight="bold">
          BOH Verification Queue
        </Text>
        <Text as="p" color="default2">
          Verify cards received from customers and add to inventory
        </Text>
      </Box>

      {/* Stats */}
      {statsQuery.data && (
        <Box display="flex" gap={4} flexWrap="wrap">
          <StatCard
            label="Pending Verification"
            value={statsQuery.data.pendingVerification.toString()}
            highlight
          />
          <StatCard
            label="Verified Today"
            value={statsQuery.data.todayVerified.toString()}
          />
          <StatCard
            label="Today's Value"
            value={`$${Number(statsQuery.data.todayVerifiedValue).toFixed(2)}`}
          />
          <StatCard
            label="Cards Received"
            value={statsQuery.data.todayVerifiedQty.toString()}
          />
        </Box>
      )}

      {/* Queue Header */}
      <Box
        padding={4}
        backgroundColor="info1"
        borderRadius={4}
      >
        <Text>
          Cards in this queue have already been paid for at the counter.
          Verify each card is present and update condition if needed, then click &quot;Verify & Receive&quot; to add to inventory.
        </Text>
      </Box>

      {/* Queue List */}
      {queueQuery.isLoading ? (
        <Box display="flex" flexDirection="column" gap={2}>
          {[1, 2, 3].map((i) => (
            <Skeleton key={i} style={{ width: "100%", height: 80 }} />
          ))}
        </Box>
      ) : queueQuery.isError ? (
        <Box padding={4} backgroundColor="critical1" borderRadius={4}>
          <Text color="critical1">Error: {queueQuery.error.message}</Text>
        </Box>
      ) : queueQuery.data?.buylists.length === 0 ? (
        <Box padding={8} display="flex" justifyContent="center" flexDirection="column" alignItems="center" gap={2}>
          <Text size={6} color="default2">
            No buylists pending verification
          </Text>
          <Text color="default2">
            New buylists will appear here after customers are paid at the counter
          </Text>
        </Box>
      ) : (
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
            __gridTemplateColumns="1fr 100px 100px 150px 120px"
            gap={3}
            padding={4}
            backgroundColor="default1"
            alignItems="center"
          >
            <Text fontWeight="bold">Buylist</Text>
            <Text fontWeight="bold">Items</Text>
            <Text fontWeight="bold">Total Paid</Text>
            <Text fontWeight="bold">Paid At</Text>
            <Box />
          </Box>

          {queueQuery.data?.buylists.map((buylist) => (
            <Box
              key={buylist.id}
              display="grid"
              __gridTemplateColumns="1fr 100px 100px 150px 120px"
              gap={3}
              padding={4}
              borderTopWidth={1}
              borderTopStyle="solid"
              borderColor="default1"
              alignItems="center"
              cursor="pointer"
              onClick={() => router.push(`/boh/buylists/${buylist.id}/verify`)}
            >
              <Box display="flex" flexDirection="column" gap={1}>
                <Text fontWeight="bold">{buylist.buylistNumber}</Text>
                <Text color="default2" size={2}>
                  {buylist.customerName || buylist.customerEmail || "Walk-in Customer"}
                </Text>
              </Box>
              <Text>{buylist._count.lines} cards</Text>
              <Text fontWeight="bold" color="success1">
                ${Number(buylist.totalQuotedAmount).toFixed(2)}
              </Text>
              <Text color="default2" size={2}>
                {buylist.paidAt
                  ? new Date(buylist.paidAt).toLocaleString(undefined, {
                      month: "short",
                      day: "numeric",
                      hour: "numeric",
                      minute: "2-digit",
                    })
                  : "N/A"}
              </Text>
              <Button
                variant="primary"
                size="small"
                onClick={(e) => {
                  e.stopPropagation();
                  router.push(`/boh/buylists/${buylist.id}/verify`);
                }}
              >
                Verify
              </Button>
            </Box>
          ))}
        </Box>
      )}
    </Box>
  );
}

function StatCard({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <Box
      padding={4}
      borderRadius={4}
      borderWidth={1}
      borderStyle="solid"
      borderColor={highlight ? "info1" : "default1"}
      backgroundColor={highlight ? "info1" : "transparent"}
      __minWidth="140px"
    >
      <Text size={2} color="default2">
        {label}
      </Text>
      <Text size={6} fontWeight="bold">
        {value}
      </Text>
    </Box>
  );
}
