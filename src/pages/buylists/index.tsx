import { Box, Button, Text } from "@saleor/macaw-ui";
import { useRouter } from "next/router";

import { trpcClient } from "@/modules/trpc/trpc-client";
import { DataTable, InlineSpinner, StatBox, StatusBadge, TableSkeleton } from "@/ui/components";

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
        <InlineSpinner label="Loading stats..." />
      ) : statsQuery.data ? (
        <Box display="flex" gap={6} flexWrap="wrap">
          <StatBox
            label="Today"
            value={statsQuery.data.todayCount.toString()}
          />
          <StatBox
            label="Pending Review"
            value={statsQuery.data.statusCounts.PENDING_REVIEW?.toString() ?? "0"}
          />
          <StatBox
            label="Last 30 Days Value"
            value={`$${Number(statsQuery.data.recentTotalValue).toFixed(2)}`}
          />
        </Box>
      ) : null}

      {/* Buylists Table */}
      {buylistsQuery.isLoading ? (
        <TableSkeleton rows={5} />
      ) : buylistsQuery.isError ? (
        <Box padding={4} backgroundColor="critical1" borderRadius={4}>
          <Text color="critical1">
            Error loading buylists: {buylistsQuery.error.message}
          </Text>
        </Box>
      ) : buylistsQuery.data?.buylists.length === 0 ? (
        <Box padding={8} display="flex" justifyContent="center">
          <Text color="default2">No buylists found. Create one to get started.</Text>
        </Box>
      ) : (
        <DataTable
          columns={[
            {
              header: "Buylist #",
              render: (row) => <Text fontWeight="medium">{row.buylistNumber}</Text>,
            },
            {
              header: "Customer",
              render: (row) => (
                <Text>{row.customerName || row.customerEmail || "Walk-in"}</Text>
              ),
            },
            {
              header: "Status",
              render: (row) => <StatusBadge status={row.status} />,
            },
            {
              header: "Items",
              align: "right",
              render: (row) => <Text>{row._count.lines}</Text>,
            },
            {
              header: "Total",
              align: "right",
              render: (row) => (
                <Text>
                  ${Number(row.totalQuotedAmount).toFixed(2)} {row.currency}
                </Text>
              ),
            },
            {
              header: "Date",
              render: (row) => (
                <Text color="default2">
                  {new Date(row.createdAt).toLocaleDateString()}
                </Text>
              ),
            },
          ]}
          data={buylistsQuery.data?.buylists ?? []}
          rowKey={(row) => row.id}
          onRowClick={(row) => router.push(`/buylists/${row.id}`)}
        />
      )}
    </Box>
  );
}
