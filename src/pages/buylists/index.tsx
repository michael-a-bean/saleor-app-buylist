import { Box, Button, Skeleton, Text } from "@saleor/macaw-ui";
import { useRouter } from "next/router";

import { trpcClient } from "@/modules/trpc/trpc-client";

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

export default function BuylistsPage() {
  const router = useRouter();
  const buylistsQuery = trpcClient.buylists.list.useQuery({
    limit: 50,
  });
  const statsQuery = trpcClient.buylists.stats.useQuery();

  return (
    <Box display="flex" flexDirection="column" gap={6}>
      <Box display="flex" justifyContent="space-between" alignItems="center">
        <Box>
          <Text as="h1" size={8} fontWeight="bold">
            Buylists
          </Text>
          <Text as="p" color="default2">
            Customer card buyback transactions
          </Text>
        </Box>
        <Button onClick={() => router.push("/buylists/new")} variant="primary">
          New Buylist
        </Button>
      </Box>

      {/* Stats Row */}
      {statsQuery.isLoading ? (
        <Box display="flex" gap={4}>
          <Skeleton style={{ width: 120, height: 60 }} />
          <Skeleton style={{ width: 120, height: 60 }} />
          <Skeleton style={{ width: 120, height: 60 }} />
        </Box>
      ) : statsQuery.data ? (
        <Box display="flex" gap={4} flexWrap="wrap">
          <StatCard
            label="Today"
            value={statsQuery.data.todayCount.toString()}
          />
          <StatCard
            label="Pending Review"
            value={statsQuery.data.statusCounts.PENDING_REVIEW?.toString() ?? "0"}
          />
          <StatCard
            label="Last 30 Days Value"
            value={`$${Number(statsQuery.data.recentTotalValue).toFixed(2)}`}
          />
        </Box>
      ) : null}

      {/* Buylists Table */}
      {buylistsQuery.isLoading ? (
        <Box display="flex" flexDirection="column" gap={2}>
          {[1, 2, 3, 4, 5].map((i) => (
            <Skeleton key={i} style={{ width: "100%", height: 60 }} />
          ))}
        </Box>
      ) : buylistsQuery.isError ? (
        <Box padding={4} backgroundColor="critical1" borderRadius={4}>
          <Text color="critical1">
            Error loading buylists: {buylistsQuery.error.message}
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
          {/* Table Header */}
          <Box
            display="grid"
            __gridTemplateColumns="1fr 1fr 1fr 1fr 1fr 120px"
            gap={4}
            padding={4}
            backgroundColor="default1"
            borderBottomWidth={1}
            borderBottomStyle="solid"
            borderColor="default1"
          >
            <Text fontWeight="bold">Buylist #</Text>
            <Text fontWeight="bold">Customer</Text>
            <Text fontWeight="bold">Status</Text>
            <Text fontWeight="bold">Items</Text>
            <Text fontWeight="bold">Total</Text>
            <Text fontWeight="bold">Date</Text>
          </Box>

          {/* Table Body */}
          {buylistsQuery.data?.buylists.length === 0 ? (
            <Box padding={8} display="flex" justifyContent="center">
              <Text color="default2">No buylists found. Create one to get started.</Text>
            </Box>
          ) : (
            buylistsQuery.data?.buylists.map((buylist) => (
              <Box
                key={buylist.id}
                display="grid"
                __gridTemplateColumns="1fr 1fr 1fr 1fr 1fr 120px"
                gap={4}
                padding={4}
                borderBottomWidth={1}
                borderBottomStyle="solid"
                borderColor="default1"
                cursor="pointer"
                onClick={() => router.push(`/buylists/${buylist.id}`)}
              >
                <Text fontWeight="medium">{buylist.buylistNumber}</Text>
                <Text>{buylist.customerName || buylist.customerEmail || "Walk-in"}</Text>
                <Box>
                  <Box
                    as="span"
                    paddingX={2}
                    paddingY={1}
                    borderRadius={2}
                    backgroundColor={STATUS_COLORS[buylist.status] as unknown as undefined}
                  >
                    <Text size={2}>{buylist.status}</Text>
                  </Box>
                </Box>
                <Text>{buylist._count.lines} items</Text>
                <Text>
                  ${Number(buylist.totalQuotedAmount).toFixed(2)} {buylist.currency}
                </Text>
                <Text color="default2">
                  {new Date(buylist.createdAt).toLocaleDateString()}
                </Text>
              </Box>
            ))
          )}
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
      __minWidth="120px"
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
