import { useDashboardNotification } from "@saleor/apps-shared/use-dashboard-notification";
import { Box, Button, Modal, Text, Textarea } from "@saleor/macaw-ui";
import { useRouter } from "next/router";
import { useEffect, useState } from "react";

import { trpcClient } from "@/modules/trpc/trpc-client";
import { DataTable, InlineSpinner, StatBox, TableSkeleton } from "@/ui/components";

export default function BOHQueuePage() {
  const router = useRouter();
  const { verified } = router.query;
  const { notifySuccess, notifyError } = useDashboardNotification();
  const [recentlyVerified, setRecentlyVerified] = useState<string | null>(null);
  const [voidTarget, setVoidTarget] = useState<{ id: string; number: string } | null>(null);
  const [voidReason, setVoidReason] = useState("");
  const utils = trpcClient.useUtils();

  const voidMutation = trpcClient.buylists.void.useMutation({
    onSuccess: () => {
      notifySuccess("Voided", "Buylist has been voided. Financial records reversed.");
      setVoidTarget(null);
      setVoidReason("");
      utils.boh.queue.invalidate();
      utils.boh.stats.invalidate();
    },
    onError: (err) => {
      notifyError("Error", `Failed to void buylist: ${err.message}`);
    },
  });

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
        <Text as="h1" size={10} fontWeight="bold">
          BOH Verification Queue
        </Text>
        <Text as="p" color="default2">
          Verify cards received from customers and add to inventory
        </Text>
      </Box>

      {/* Stats */}
      {statsQuery.isLoading ? (
        <InlineSpinner label="Loading stats..." />
      ) : statsQuery.data ? (
        <Box display="flex" gap={6} flexWrap="wrap">
          <StatBox
            label="Pending Verification"
            value={statsQuery.data.pendingVerification.toString()}
            color="info1"
          />
          <StatBox
            label="Verified Today"
            value={statsQuery.data.todayVerified.toString()}
          />
          <StatBox
            label="Today's Value"
            value={`$${Number(statsQuery.data.todayVerifiedValue).toFixed(2)}`}
          />
          <StatBox
            label="Cards Received"
            value={statsQuery.data.todayVerifiedQty.toString()}
          />
        </Box>
      ) : null}

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
        <TableSkeleton rows={3} />
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
        <DataTable
          columns={[
            {
              header: "Buylist",
              render: (row) => (
                <Box display="flex" flexDirection="column" gap={1}>
                  <Text fontWeight="bold">{row.buylistNumber}</Text>
                  <Text color="default2" size={2}>
                    {row.customerName || row.customerEmail || "Walk-in Customer"}
                  </Text>
                </Box>
              ),
            },
            {
              header: "Items",
              align: "right",
              render: (row) => <Text>{row._count.lines} cards</Text>,
            },
            {
              header: "Total Paid",
              align: "right",
              render: (row) => (
                <Text fontWeight="bold" color="success1">
                  ${Number(row.totalQuotedAmount).toFixed(2)}
                </Text>
              ),
            },
            {
              header: "Paid At",
              render: (row) => (
                <Text color="default2" size={2}>
                  {row.paidAt
                    ? new Date(row.paidAt).toLocaleString(undefined, {
                        month: "short",
                        day: "numeric",
                        hour: "numeric",
                        minute: "2-digit",
                      })
                    : "N/A"}
                </Text>
              ),
            },
            {
              header: "",
              align: "right",
              render: (row) => (
                <Box display="flex" gap={2} justifyContent="flex-end">
                  <Button
                    variant="tertiary"
                    size="small"
                    onClick={(e) => {
                      e.stopPropagation();
                      setVoidTarget({ id: row.id, number: row.buylistNumber });
                    }}
                  >
                    Void
                  </Button>
                  <Button
                    variant="primary"
                    size="small"
                    onClick={(e) => {
                      e.stopPropagation();
                      router.push(`/boh/buylists/${row.id}/verify`);
                    }}
                  >
                    Verify
                  </Button>
                </Box>
              ),
            },
          ]}
          data={queueQuery.data?.buylists ?? []}
          rowKey={(row) => row.id}
          onRowClick={(row) => router.push(`/boh/buylists/${row.id}/verify`)}
        />
      )}

      {/* Void Confirmation Modal */}
      <Modal open={!!voidTarget} onChange={(o: boolean) => !o && setVoidTarget(null)}>
        <Modal.Content>
          <Box padding={6} __maxWidth="480px">
            <Text as="h2" size={6} fontWeight="bold" marginBottom={4}>
              Void {voidTarget?.number}
            </Text>
            <Text marginBottom={2}>
              This will reverse all financial records including payout for this buylist.
            </Text>
            <Text size={2} color="critical1" marginBottom={4}>
              This action cannot be undone.
            </Text>
            <Text fontWeight="medium" marginBottom={2}>
              Reason (required)
            </Text>
            <Textarea
              value={voidReason}
              onChange={(e) => setVoidReason(e.target.value)}
              placeholder="e.g., Customer returned, duplicate entry, cards not received"
              rows={3}
            />
            <Box display="flex" gap={3} justifyContent="flex-end" marginTop={4}>
              <Button
                variant="secondary"
                onClick={() => {
                  setVoidTarget(null);
                  setVoidReason("");
                }}
              >
                Cancel
              </Button>
              <Button
                variant="primary"
                disabled={!voidReason.trim() || voidMutation.isLoading}
                onClick={() => {
                  if (voidTarget) {
                    voidMutation.mutate({ id: voidTarget.id, reason: voidReason.trim() });
                  }
                }}
              >
                {voidMutation.isLoading ? "Voiding..." : "Void Buylist"}
              </Button>
            </Box>
          </Box>
        </Modal.Content>
      </Modal>
    </Box>
  );
}
