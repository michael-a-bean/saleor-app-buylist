import { Box, Button, Text } from "@saleor/macaw-ui";
import { useRouter } from "next/router";

import { trpcClient } from "@/modules/trpc/trpc-client";

export default function IndexPage() {
  const router = useRouter();
  const healthQuery = trpcClient.health.check.useQuery();

  return (
    <Box display="flex" flexDirection="column" gap={6}>
      <Box>
        <Text as="h1" size={8} fontWeight="bold">
          Buylist
        </Text>
        <Text as="p" color="default2">
          Customer card buyback management
        </Text>
      </Box>

      {healthQuery.isLoading && (
        <Text color="default2">Checking connection...</Text>
      )}

      {healthQuery.isError && (
        <Box
          padding={4}
          borderRadius={4}
          backgroundColor="critical1"
        >
          <Text color="critical1">
            Error connecting to app: {healthQuery.error.message}
          </Text>
        </Box>
      )}

      {healthQuery.isSuccess && (
        <Box
          padding={4}
          borderRadius={4}
          backgroundColor="success1"
        >
          <Text color="success1">
            Connected to Saleor instance
          </Text>
        </Box>
      )}

      <Box display="flex" gap={4} flexWrap="wrap">
        <Box
          padding={6}
          borderRadius={4}
          borderWidth={1}
          borderStyle="solid"
          borderColor="default1"
          display="flex"
          flexDirection="column"
          gap={4}
          __minWidth="280px"
        >
          <Text as="h2" size={6} fontWeight="bold">
            Front of House
          </Text>
          <Text color="default2">
            Create buylists, grade cards, generate quotes, and record payouts.
          </Text>
          <Button
            onClick={() => router.push("/buylists")}
            variant="primary"
          >
            View Buylists
          </Button>
        </Box>

        <Box
          padding={6}
          borderRadius={4}
          borderWidth={1}
          borderStyle="solid"
          borderColor="default1"
          display="flex"
          flexDirection="column"
          gap={4}
          __minWidth="280px"
        >
          <Text as="h2" size={6} fontWeight="bold">
            Back of House
          </Text>
          <Text color="default2">
            Review pending buylists, adjust quantities, and receive into inventory.
          </Text>
          <Button
            onClick={() => router.push("/boh/queue")}
            variant="secondary"
          >
            BOH Queue
          </Button>
        </Box>

        <Box
          padding={6}
          borderRadius={4}
          borderWidth={1}
          borderStyle="solid"
          borderColor="default1"
          display="flex"
          flexDirection="column"
          gap={4}
          __minWidth="280px"
        >
          <Text as="h2" size={6} fontWeight="bold">
            Pricing
          </Text>
          <Text color="default2">
            Configure pricing policies and view price history.
          </Text>
          <Button
            onClick={() => router.push("/pricing/policies")}
            variant="tertiary"
          >
            Manage Policies
          </Button>
        </Box>
      </Box>
    </Box>
  );
}
