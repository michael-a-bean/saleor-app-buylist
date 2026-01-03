import { Box, Button, Input, Text } from "@saleor/macaw-ui";
import { useCallback, useEffect, useRef, useState } from "react";

import { trpcClient } from "@/modules/trpc/trpc-client";

interface SelectedCustomer {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  displayName: string;
  phone: string | null;
  storeCredit: {
    balance: number;
    currency: string;
  };
  buylistHistory: {
    count: number;
    totalValue: number;
  };
}

interface BuylistCustomerSearchProps {
  selectedCustomer: SelectedCustomer | null;
  onSelectCustomer: (customer: SelectedCustomer | null) => void;
  onCustomerFieldsChange: (fields: {
    saleorUserId: string | null;
    customerName: string;
    customerEmail: string;
    customerPhone: string;
  }) => void;
  /** Show warning when required (e.g., for STORE_CREDIT payout) */
  required?: boolean;
  /** Message to show when required */
  requiredMessage?: string;
}

interface SearchResult {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  displayName: string;
  phone: string | null;
  storeCredit: {
    balance: number;
    currency: string;
  };
  buylistHistory: {
    count: number;
    totalValue: number;
  };
}

export const BuylistCustomerSearch: React.FC<BuylistCustomerSearchProps> = ({
  selectedCustomer,
  onSelectCustomer,
  onCustomerFieldsChange,
  required = false,
  requiredMessage,
}) => {
  const [isSearching, setIsSearching] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [showResults, setShowResults] = useState(false);
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [showManualEntry, setShowManualEntry] = useState(false);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const resultsRef = useRef<HTMLDivElement>(null);

  // Manual entry state (for walk-in customers without Saleor account)
  const [manualCustomer, setManualCustomer] = useState({
    name: "",
    email: "",
    phone: "",
  });

  // New customer form state
  const [newCustomer, setNewCustomer] = useState({
    email: "",
    firstName: "",
    lastName: "",
    phone: "",
  });

  // Search query with debounce
  const {
    data: searchResults,
    isLoading: searchLoading,
    refetch: doSearch,
  } = trpcClient.customers.search.useQuery(
    { query: searchQuery, limit: 8 },
    { enabled: false }
  );

  // Create customer mutation
  const createCustomer = trpcClient.customers.create.useMutation({
    onSuccess: (data) => {
      const customer: SelectedCustomer = {
        id: data.id,
        email: data.email,
        firstName: data.firstName,
        lastName: data.lastName,
        displayName: `${data.firstName} ${data.lastName}`.trim(),
        phone: newCustomer.phone || null,
        storeCredit: { balance: 0, currency: "USD" },
        buylistHistory: { count: 0, totalValue: 0 },
      };
      onSelectCustomer(customer);
      onCustomerFieldsChange({
        saleorUserId: data.id,
        customerName: customer.displayName,
        customerEmail: data.email,
        customerPhone: newCustomer.phone || "",
      });
      setShowCreateForm(false);
      setNewCustomer({ email: "", firstName: "", lastName: "", phone: "" });
      setIsSearching(false);
    },
  });

  // Handle search with debounce
  useEffect(() => {
    if (searchQuery.length >= 2) {
      const timer = setTimeout(() => {
        doSearch();
        setShowResults(true);
      }, 300);
      return () => clearTimeout(timer);
    } else {
      setShowResults(false);
    }
  }, [searchQuery, doSearch]);

  // Close results when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (
        resultsRef.current &&
        !resultsRef.current.contains(event.target as Node) &&
        searchInputRef.current &&
        !searchInputRef.current.contains(event.target as Node)
      ) {
        setShowResults(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const handleSelectCustomer = useCallback(
    (customer: SearchResult) => {
      onSelectCustomer(customer);
      onCustomerFieldsChange({
        saleorUserId: customer.id,
        customerName: customer.displayName,
        customerEmail: customer.email,
        customerPhone: customer.phone || "",
      });
      setIsSearching(false);
      setSearchQuery("");
      setShowResults(false);
    },
    [onSelectCustomer, onCustomerFieldsChange]
  );

  const handleClearCustomer = useCallback(() => {
    onSelectCustomer(null);
    onCustomerFieldsChange({
      saleorUserId: null,
      customerName: "",
      customerEmail: "",
      customerPhone: "",
    });
  }, [onSelectCustomer, onCustomerFieldsChange]);

  const handleManualEntry = useCallback(() => {
    onSelectCustomer(null);
    onCustomerFieldsChange({
      saleorUserId: null,
      customerName: manualCustomer.name,
      customerEmail: manualCustomer.email,
      customerPhone: manualCustomer.phone,
    });
    setShowManualEntry(false);
    setIsSearching(false);
  }, [manualCustomer, onSelectCustomer, onCustomerFieldsChange]);

  const handleCreateCustomer = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();
      if (!newCustomer.email || !newCustomer.firstName || !newCustomer.lastName) {
        return;
      }
      // Note: phone is stored locally on buylist, not in Saleor (per Saleor core pattern)
      createCustomer.mutate({
        email: newCustomer.email,
        firstName: newCustomer.firstName,
        lastName: newCustomer.lastName,
      });
    },
    [newCustomer, createCustomer]
  );

  // If a customer is selected, show their info
  if (selectedCustomer) {
    return (
      <Box
        padding={4}
        borderRadius={4}
        borderWidth={1}
        borderStyle="solid"
        borderColor="default1"
        backgroundColor="success1"
      >
        <Box display="flex" justifyContent="space-between" alignItems="flex-start" marginBottom={2}>
          <Text size={3} fontWeight="bold">
            Customer
          </Text>
          <Button variant="tertiary" size="small" onClick={handleClearCustomer}>
            Change
          </Button>
        </Box>

        <Text size={4} fontWeight="bold">
          {selectedCustomer.displayName}
        </Text>
        <Text size={2} color="default2">
          {selectedCustomer.email}
        </Text>
        {selectedCustomer.phone && (
          <Text size={2} color="default2">
            {selectedCustomer.phone}
          </Text>
        )}

        <Box marginTop={3} display="flex" gap={4}>
          {selectedCustomer.storeCredit.balance > 0 && (
            <Box>
              <Text size={2} color="default2">Store Credit</Text>
              <Text size={3} fontWeight="bold" color="success1">
                ${selectedCustomer.storeCredit.balance.toFixed(2)}
              </Text>
            </Box>
          )}
          {selectedCustomer.buylistHistory.count > 0 && (
            <Box>
              <Text size={2} color="default2">Past Buylists</Text>
              <Text size={3} fontWeight="bold">
                {selectedCustomer.buylistHistory.count} (${selectedCustomer.buylistHistory.totalValue.toFixed(2)})
              </Text>
            </Box>
          )}
        </Box>
      </Box>
    );
  }

  // Show manual entry form
  if (showManualEntry) {
    return (
      <Box
        padding={4}
        borderRadius={4}
        borderWidth={1}
        borderStyle="solid"
        borderColor="default1"
      >
        <Box display="flex" justifyContent="space-between" alignItems="center" marginBottom={3}>
          <Text size={3} fontWeight="bold">
            Walk-in Customer (No Account)
          </Text>
          <Button variant="tertiary" size="small" onClick={() => setShowManualEntry(false)}>
            Cancel
          </Button>
        </Box>

        <Box display="flex" flexDirection="column" gap={3}>
          <Input
            label="Name"
            value={manualCustomer.name}
            onChange={(e) => setManualCustomer({ ...manualCustomer, name: e.target.value })}
            size="small"
          />
          <Box display="flex" gap={3}>
            <Box __flex="1">
              <Input
                label="Email (optional)"
                type="email"
                value={manualCustomer.email}
                onChange={(e) => setManualCustomer({ ...manualCustomer, email: e.target.value })}
                size="small"
              />
            </Box>
            <Box __flex="1">
              <Input
                label="Phone (optional)"
                value={manualCustomer.phone}
                onChange={(e) => setManualCustomer({ ...manualCustomer, phone: e.target.value })}
                size="small"
              />
            </Box>
          </Box>
          <Button variant="secondary" onClick={handleManualEntry}>
            Use This Info
          </Button>
          <Text size={2} color="warning1">
            Note: Walk-in customers cannot receive store credit payouts.
          </Text>
        </Box>
      </Box>
    );
  }

  // Show create customer form
  if (showCreateForm) {
    return (
      <Box
        padding={4}
        borderRadius={4}
        borderWidth={1}
        borderStyle="solid"
        borderColor="default1"
      >
        <Box display="flex" justifyContent="space-between" alignItems="center" marginBottom={3}>
          <Text size={3} fontWeight="bold">
            Create New Customer
          </Text>
          <Button variant="tertiary" size="small" onClick={() => setShowCreateForm(false)}>
            Cancel
          </Button>
        </Box>

        <form onSubmit={handleCreateCustomer}>
          <Box display="flex" flexDirection="column" gap={3}>
            <Input
              label="Email"
              type="email"
              value={newCustomer.email}
              onChange={(e) => setNewCustomer({ ...newCustomer, email: e.target.value })}
              required
              size="small"
            />
            <Box display="flex" gap={3}>
              <Box __flex="1">
                <Input
                  label="First Name"
                  value={newCustomer.firstName}
                  onChange={(e) => setNewCustomer({ ...newCustomer, firstName: e.target.value })}
                  required
                  size="small"
                />
              </Box>
              <Box __flex="1">
                <Input
                  label="Last Name"
                  value={newCustomer.lastName}
                  onChange={(e) => setNewCustomer({ ...newCustomer, lastName: e.target.value })}
                  required
                  size="small"
                />
              </Box>
            </Box>
            <Input
              label="Phone (optional)"
              value={newCustomer.phone}
              onChange={(e) => setNewCustomer({ ...newCustomer, phone: e.target.value })}
              size="small"
            />
            <Button
              type="submit"
              variant="primary"
              disabled={createCustomer.isLoading || !newCustomer.email || !newCustomer.firstName}
            >
              {createCustomer.isLoading ? "Creating..." : "Create Customer"}
            </Button>
            {createCustomer.error && (
              <Text size={2} color="critical1">
                {createCustomer.error.message}
              </Text>
            )}
          </Box>
        </form>
      </Box>
    );
  }

  // Show search toggle
  if (!isSearching) {
    return (
      <Box
        padding={4}
        borderRadius={4}
        borderWidth={1}
        borderStyle="solid"
        borderColor={required ? "critical1" : "default1"}
        __cursor="pointer"
        onClick={() => {
          setIsSearching(true);
          setTimeout(() => searchInputRef.current?.focus(), 100);
        }}
      >
        <Box display="flex" alignItems="center" gap={2}>
          <Text size={3} color="default2">
            + Search or Add Customer
          </Text>
        </Box>
        {required && requiredMessage && (
          <Text size={2} color="critical1" marginTop={2}>
            {requiredMessage}
          </Text>
        )}
      </Box>
    );
  }

  // Search UI
  return (
    <Box
      padding={4}
      borderRadius={4}
      borderWidth={1}
      borderStyle="solid"
      borderColor="default1"
      position="relative"
    >
      <Box display="flex" justifyContent="space-between" alignItems="center" marginBottom={3}>
        <Text size={3} fontWeight="bold">
          Find Customer
        </Text>
        <Button variant="tertiary" size="small" onClick={() => setIsSearching(false)}>
          Cancel
        </Button>
      </Box>

      <Input
        ref={searchInputRef}
        value={searchQuery}
        onChange={(e) => setSearchQuery(e.target.value)}
        placeholder="Search by email, phone, or name..."
        size="small"
      />

      {/* Search Results Dropdown */}
      {showResults && (
        <Box
          ref={resultsRef}
          position="absolute"
          __left="0"
          __right="0"
          __top="100%"
          __zIndex="100"
          backgroundColor="default1"
          borderRadius={4}
          borderWidth={1}
          borderStyle="solid"
          borderColor="default1"
          __boxShadow="0 4px 12px rgba(0,0,0,0.15)"
          marginTop={1}
          __maxHeight="350px"
          overflow="auto"
        >
          {searchLoading ? (
            <Box padding={3}>
              <Text size={2} color="default2">Searching...</Text>
            </Box>
          ) : searchResults && searchResults.length > 0 ? (
            <>
              {searchResults.map((customer: SearchResult) => (
                <Box
                  key={customer.id}
                  padding={3}
                  __cursor="pointer"
                  onClick={() => handleSelectCustomer(customer)}
                  borderBottomWidth={1}
                  borderBottomStyle="solid"
                  borderColor="default1"
                >
                  <Box display="flex" justifyContent="space-between" alignItems="flex-start">
                    <Box>
                      <Text size={3} fontWeight="bold">
                        {customer.displayName}
                      </Text>
                      <Text size={2} color="default2">
                        {customer.email}
                      </Text>
                      {customer.phone && (
                        <Text size={2} color="default2">
                          {customer.phone}
                        </Text>
                      )}
                    </Box>
                    <Box __textAlign="right">
                      {customer.storeCredit.balance > 0 && (
                        <Text size={2} color="success1">
                          ${customer.storeCredit.balance.toFixed(2)} credit
                        </Text>
                      )}
                      {customer.buylistHistory.count > 0 && (
                        <Text size={2} color="default2">
                          {customer.buylistHistory.count} buylists
                        </Text>
                      )}
                    </Box>
                  </Box>
                </Box>
              ))}
            </>
          ) : (
            <Box padding={3}>
              <Text size={2} color="default2">No customers found</Text>
            </Box>
          )}

          {/* Action buttons */}
          <Box borderTopWidth={1} borderTopStyle="solid" borderColor="default1">
            <Box
              padding={3}
              __cursor="pointer"
              onClick={() => {
                setShowResults(false);
                setShowCreateForm(true);
                setNewCustomer({
                  ...newCustomer,
                  email: searchQuery.includes("@") ? searchQuery : "",
                });
              }}
            >
              <Text size={2} color="info1" fontWeight="bold">
                + Create New Customer Account
              </Text>
            </Box>
            <Box
              padding={3}
              __cursor="pointer"
              onClick={() => {
                setShowResults(false);
                setShowManualEntry(true);
                setManualCustomer({ ...manualCustomer, name: searchQuery });
              }}
              borderTopWidth={1}
              borderTopStyle="solid"
              borderColor="default1"
            >
              <Text size={2} color="default2">
                Enter as Walk-in (no account)
              </Text>
            </Box>
          </Box>
        </Box>
      )}
    </Box>
  );
};
