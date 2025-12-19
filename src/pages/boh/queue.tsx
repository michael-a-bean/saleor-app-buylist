import { Box, Button, Skeleton, Text } from "@saleor/macaw-ui";
import { useRouter } from "next/router";
import { useState } from "react";

import { trpcClient } from "@/modules/trpc/trpc-client";

type QueueTab = "pending" | "approved" | "payout";

export default function BOHQueuePage() {
  const router = useRouter();
  const [activeTab, setActiveTab] = useState<QueueTab>("pending");

  const statsQuery = trpcClient.boh.stats.useQuery();
  const queueQuery = trpcClient.boh.queue.useQuery(undefined, {
    enabled: activeTab === "pending",
  });
  const approvedQuery = trpcClient.boh.readyToReceive.useQuery(undefined, {
    enabled: activeTab === "approved",
  });
  const payoutQuery = trpcClient.boh.readyForPayout.useQuery(undefined, {
    enabled: activeTab === "payout",
  });

  const tabs: { key: QueueTab; label: string; count?: number }[] = [
    { key: "pending", label: "Pending Review", count: statsQuery.data?.pendingReview },
    { key: "approved", label: "Ready to Receive", count: statsQuery.data?.approved },
    { key: "payout", label: "Awaiting Payout", count: statsQuery.data?.awaitingPayout },
  ];

  const getCurrentData = () => {
    switch (activeTab) {
      case "pending":
        return queueQuery;
      case "approved":
        return approvedQuery;
      case "payout":
        return payoutQuery;
    }
  };

  const currentQuery = getCurrentData();

  return (
    <Box display="flex" flexDirection="column" gap={6}>
      <Box>
        <Text as="h1" size={8} fontWeight="bold">
          BOH Queue
        </Text>
        <Text as="p" color="default2">
          Review, receive, and process buylist payments
        </Text>
      </Box>

      {/* Stats */}
      {statsQuery.data && (
        <Box display="flex" gap={4} flexWrap="wrap">
          <StatCard
            label="Reviewed Today"
            value={statsQuery.data.todayReceived.toString()}
          />
          <StatCard
            label="Today's Value"
            value={`$${Number(statsQuery.data.todayReceivedValue).toFixed(2)}`}
          />
          <StatCard
            label="Cards Received"
            value={statsQuery.data.todayReceivedQty.toString()}
          />
        </Box>
      )}

      {/* Tabs */}
      <Box display="flex" gap={2} borderBottomWidth={1} borderBottomStyle="solid" borderColor="default1">
        {tabs.map((tab) => (
          <Box
            key={tab.key}
            paddingX={4}
            paddingY={3}
            cursor="pointer"
            borderBottomWidth={1}
            borderBottomStyle="solid"
            borderColor={activeTab === tab.key ? "info1" : "transparent"}
            onClick={() => setActiveTab(tab.key)}
          >
            <Text
              fontWeight={activeTab === tab.key ? "bold" : "regular"}
              color={activeTab === tab.key ? "default1" : "default2"}
            >
              {tab.label}
              {tab.count !== undefined && (
                <Box
                  as="span"
                  marginLeft={2}
                  paddingX={2}
                  paddingY={1}
                  borderRadius={4}
                  backgroundColor="default1"
                >
                  {tab.count}
                </Box>
              )}
            </Text>
          </Box>
        ))}
      </Box>

      {/* Queue List */}
      {currentQuery.isLoading ? (
        <Box display="flex" flexDirection="column" gap={2}>
          {[1, 2, 3].map((i) => (
            <Skeleton key={i} style={{ width: "100%", height: 80 }} />
          ))}
        </Box>
      ) : currentQuery.isError ? (
        <Box padding={4} backgroundColor="critical1" borderRadius={4}>
          <Text color="critical1">Error: {currentQuery.error.message}</Text>
        </Box>
      ) : currentQuery.data?.buylists.length === 0 ? (
        <Box padding={8} display="flex" justifyContent="center">
          <Text color="default2">
            {activeTab === "pending" && "No buylists pending review"}
            {activeTab === "approved" && "No buylists ready to receive"}
            {activeTab === "payout" && "No buylists awaiting payout"}
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
          {currentQuery.data?.buylists.map((buylist) => (
            <Box
              key={buylist.id}
              display="flex"
              justifyContent="space-between"
              alignItems="center"
              padding={4}
              borderBottomWidth={1}
              borderBottomStyle="solid"
              borderColor="default1"
              cursor="pointer"
              onClick={() => {
                if (activeTab === "pending") {
                  router.push(`/boh/buylists/${buylist.id}/review`);
                } else if (activeTab === "approved") {
                  router.push(`/boh/buylists/${buylist.id}/receive`);
                } else {
                  router.push(`/buylists/${buylist.id}`);
                }
              }}
            >
              <Box display="flex" flexDirection="column" gap={1}>
                <Text fontWeight="bold">{buylist.buylistNumber}</Text>
                <Text color="default2">
                  {buylist.customerName || buylist.customerEmail || "Walk-in"} - {buylist._count.lines} items
                </Text>
              </Box>
              <Box display="flex" alignItems="center" gap={4}>
                <Box display="flex" flexDirection="column" alignItems="flex-end">
                  <Text fontWeight="bold">
                    ${Number(buylist.totalQuotedAmount).toFixed(2)}
                  </Text>
                  <Text size={2} color="default2">
                    Submitted {buylist.submittedAt ? new Date(buylist.submittedAt).toLocaleDateString() : "N/A"}
                  </Text>
                </Box>
                <Button variant="secondary" size="small">
                  {activeTab === "pending" && "Review"}
                  {activeTab === "approved" && "Receive"}
                  {activeTab === "payout" && "Process"}
                </Button>
              </Box>
            </Box>
          ))}
        </Box>
      )}
    </Box>
  );
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <Box
      padding={4}
      borderRadius={4}
      borderWidth={1}
      borderStyle="solid"
      borderColor="default1"
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
