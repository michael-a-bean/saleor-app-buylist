import { Box, Button, Input, Select, Text } from "@saleor/macaw-ui";
import { useRouter } from "next/router";
import { useCallback, useEffect, useRef, useState } from "react";

import { trpcClient } from "@/modules/trpc/trpc-client";

const CONDITIONS = [
  { value: "NM", label: "Near Mint (NM)" },
  { value: "LP", label: "Lightly Played (LP)" },
  { value: "MP", label: "Moderately Played (MP)" },
  { value: "HP", label: "Heavily Played (HP)" },
  { value: "DMG", label: "Damaged (DMG)" },
];

const PAYOUT_METHODS = [
  { value: "CASH", label: "Cash" },
  { value: "STORE_CREDIT", label: "Store Credit" },
  { value: "CHECK", label: "Check" },
  { value: "BANK_TRANSFER", label: "Bank Transfer" },
  { value: "PAYPAL", label: "PayPal" },
  { value: "OTHER", label: "Other" },
];

interface LineItem {
  id: string;
  variantId: string;
  variantSku: string;
  variantName: string;
  displayName: string;
  qty: number;
  condition: string;
  marketPrice: number;
  buyPrice: number;
}

interface CardSearchResult {
  variantId: string;
  variantSku: string | null;
  variantName: string;
  productName: string;
  thumbnailUrl: string | null;
  setCode: string | null;
  setName: string | null;
  collectorNumber: string | null;
  displayName: string;
  marketPrice: number;
  currency: string;
}

export default function NewBuylistPage() {
  const router = useRouter();
  const [customerName, setCustomerName] = useState("");
  const [customerEmail, setCustomerEmail] = useState("");
  const [customerPhone, setCustomerPhone] = useState("");
  const [notes, setNotes] = useState("");
  const [lines, setLines] = useState<LineItem[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedWarehouseId, setSelectedWarehouseId] = useState<string>("");
  const [payoutMethod, setPayoutMethod] = useState<string>("CASH");
  const [payoutReference, setPayoutReference] = useState("");
  const [selectedRegisterId, setSelectedRegisterId] = useState<string>("");

  // Card search state
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<CardSearchResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [showResults, setShowResults] = useState(false);
  const [selectedCard, setSelectedCard] = useState<CardSearchResult | null>(null);
  const searchRef = useRef<HTMLDivElement>(null);

  // New line form state
  const [newQty, setNewQty] = useState(1);
  const [newCondition, setNewCondition] = useState("NM");

  // Fetch warehouses
  const warehousesQuery = trpcClient.buylists.listWarehouses.useQuery();

  // Fetch default pricing policy for buy price calculation
  const defaultPolicyQuery = trpcClient.pricing.getDefault.useQuery();

  // Fetch open registers for cash payouts
  const openRegistersQuery = trpcClient.register.listOpen.useQuery(
    { saleorWarehouseId: selectedWarehouseId || undefined },
    { enabled: payoutMethod === "CASH" }
  );

  // Search cards query
  const searchCardsQuery = trpcClient.buylists.searchCards.useQuery(
    { query: searchQuery, limit: 15 },
    {
      enabled: searchQuery.length >= 2,
      staleTime: 30000,
    }
  );

  // Update search results when query changes
  useEffect(() => {
    if (searchCardsQuery.data) {
      setSearchResults(searchCardsQuery.data);
      setIsSearching(false);
    }
    if (searchCardsQuery.isLoading) {
      setIsSearching(true);
    }
  }, [searchCardsQuery.data, searchCardsQuery.isLoading]);

  // Set default warehouse when loaded
  useEffect(() => {
    if (warehousesQuery.data && warehousesQuery.data.length > 0 && !selectedWarehouseId) {
      setSelectedWarehouseId(warehousesQuery.data[0].id);
    }
  }, [warehousesQuery.data, selectedWarehouseId]);

  // Auto-select register if only one is open
  useEffect(() => {
    if (payoutMethod === "CASH" && openRegistersQuery.data) {
      if (openRegistersQuery.data.length === 1 && !selectedRegisterId) {
        setSelectedRegisterId(openRegistersQuery.data[0].id);
      }
    } else {
      // Clear register selection when not CASH
      setSelectedRegisterId("");
    }
  }, [payoutMethod, openRegistersQuery.data, selectedRegisterId]);

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (searchRef.current && !searchRef.current.contains(event.target as Node)) {
        setShowResults(false);
      }
    };

    document.addEventListener("mousedown", handleClickOutside);

    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const createAndPayMutation = trpcClient.buylists.createAndPay.useMutation({
    onSuccess: (data) => {
      router.push(`/buylists/${data.id}`);
    },
    onError: (err) => {
      setError(err.message);
      setIsSubmitting(false);
    },
  });

  const handleSearchChange = useCallback((value: string) => {
    setSearchQuery(value);
    setShowResults(value.length >= 2);
    setSelectedCard(null);
  }, []);

  const handleSelectCard = useCallback((card: CardSearchResult) => {
    setSelectedCard(card);
    setSearchQuery(card.displayName);
    setShowResults(false);
  }, []);

  // Calculate buy price based on policy and condition
  const calculateBuyPrice = useCallback(
    (marketPrice: number, condition: string): number => {
      const policy = defaultPolicyQuery.data;
      if (!policy) {
        // Fallback to 50% if no policy
        return Math.round(marketPrice * 0.5 * 100) / 100;
      }

      // Get condition multiplier
      const multipliers = (policy.conditionMultipliers as Record<string, number>) ?? {
        NM: 1.0,
        LP: 0.9,
        MP: 0.75,
        HP: 0.5,
        DMG: 0.25,
      };
      const conditionMultiplier = multipliers[condition] ?? 1.0;

      // Helper to parse Decimal values (they come as strings from tRPC)
      const parseDecimal = (value: unknown): number | null => {
        if (value === null || value === undefined) return null;
        if (typeof value === "number") return value;
        if (typeof value === "string") return parseFloat(value);
        if (typeof value === "object" && value !== null && "toNumber" in value) {
          return (value as { toNumber: () => number }).toNumber();
        }
        return null;
      };

      const basePercentage = parseDecimal(policy.basePercentage);
      const minimumPrice = parseDecimal(policy.minimumPrice);
      const maximumPrice = parseDecimal(policy.maximumPrice);

      // Calculate base offer based on policy type
      let baseOffer: number;
      switch (policy.policyType) {
        case "PERCENTAGE":
          baseOffer = marketPrice * ((basePercentage ?? 50) / 100);
          break;
        case "FIXED_DISCOUNT":
          baseOffer = Math.max(0, marketPrice - (basePercentage ?? 0));
          break;
        case "TIERED": {
          const rules = policy.tieredRules as Array<{
            minValue: number;
            maxValue: number | null;
            percentage: number;
          }> | null;
          const tier = rules?.find(
            (r) => marketPrice >= r.minValue && (r.maxValue === null || marketPrice < r.maxValue)
          );
          baseOffer = marketPrice * ((tier?.percentage ?? 50) / 100);
          break;
        }
        default:
          baseOffer = marketPrice * 0.5;
      }

      // Apply condition multiplier
      let finalOffer = baseOffer * conditionMultiplier;

      // Apply min/max constraints
      if (minimumPrice !== null && finalOffer < minimumPrice) {
        finalOffer = minimumPrice;
      }
      if (maximumPrice !== null && finalOffer > maximumPrice) {
        finalOffer = maximumPrice;
      }

      return Math.round(finalOffer * 100) / 100;
    },
    [defaultPolicyQuery.data]
  );

  const addLine = () => {
    if (!selectedCard) {
      setError("Please search and select a card");
      return;
    }

    const buyPrice = calculateBuyPrice(selectedCard.marketPrice, newCondition);

    const newLine: LineItem = {
      id: `temp-${Date.now()}`,
      variantId: selectedCard.variantId,
      variantSku: selectedCard.variantSku ?? "",
      variantName: selectedCard.variantName,
      displayName: selectedCard.displayName,
      qty: newQty,
      condition: newCondition,
      marketPrice: selectedCard.marketPrice,
      buyPrice,
    };

    setLines([...lines, newLine]);

    // Reset form
    setSearchQuery("");
    setSelectedCard(null);
    setSearchResults([]);
    setNewQty(1);
    setNewCondition("NM");
    setError(null);
  };

  const removeLine = (id: string) => {
    setLines(lines.filter((l) => l.id !== id));
  };

  const updateLineQty = (id: string, qty: number) => {
    setLines(lines.map((l) => (l.id === id ? { ...l, qty: Math.max(1, qty) } : l)));
  };

  const updateLineBuyPrice = (id: string, buyPrice: number) => {
    setLines(lines.map((l) => (l.id === id ? { ...l, buyPrice: Math.max(0, buyPrice) } : l)));
  };

  const handleSubmit = () => {
    if (lines.length === 0) {
      setError("Please add at least one item");
      return;
    }

    if (!selectedWarehouseId) {
      setError("Please select a warehouse");
      return;
    }

    if (!payoutMethod) {
      setError("Please select a payout method");
      return;
    }

    // Warn if CASH payout without register (but allow it)
    if (payoutMethod === "CASH" && !selectedRegisterId && openRegistersQuery.data && openRegistersQuery.data.length > 0) {
      const confirmNoRegister = window.confirm(
        "No register selected. Cash payout will not be recorded against a register. Continue anyway?"
      );
      if (!confirmNoRegister) {
        return;
      }
    }

    setIsSubmitting(true);
    setError(null);

    createAndPayMutation.mutate({
      saleorWarehouseId: selectedWarehouseId,
      customerName: customerName || undefined,
      customerEmail: customerEmail || undefined,
      customerPhone: customerPhone || undefined,
      notes: notes || undefined,
      currency: "USD",
      payoutMethod: payoutMethod as "CASH" | "STORE_CREDIT" | "CHECK" | "BANK_TRANSFER" | "PAYPAL" | "OTHER",
      payoutReference: payoutReference || undefined,
      posRegisterSessionId: payoutMethod === "CASH" && selectedRegisterId ? selectedRegisterId : undefined,
      lines: lines.map((l) => ({
        saleorVariantId: l.variantId,
        saleorVariantSku: l.variantSku,
        saleorVariantName: l.displayName,
        qty: l.qty,
        condition: l.condition as "NM" | "LP" | "MP" | "HP" | "DMG",
        marketPrice: l.marketPrice,
        buyPrice: l.buyPrice,
      })),
    });
  };

  return (
    <Box display="flex" flexDirection="column" gap={6}>
      <Box display="flex" justifyContent="space-between" alignItems="center">
        <Box>
          <Text as="h1" size={8} fontWeight="bold">
            Buy Cards from Customer
          </Text>
          <Text as="p" color="default2">
            Add cards, set prices, and pay customer. Cards will queue for BOH verification.
          </Text>
        </Box>
        <Button onClick={() => router.push("/buylists")} variant="tertiary">
          Cancel
        </Button>
      </Box>

      {error && (
        <Box padding={4} backgroundColor="critical1" borderRadius={4}>
          <Text color="critical1">{error}</Text>
        </Box>
      )}

      {/* Customer Info */}
      <Box
        padding={6}
        borderRadius={4}
        borderWidth={1}
        borderStyle="solid"
        borderColor="default1"
      >
        <Text as="h2" size={6} fontWeight="bold" marginBottom={4}>
          Customer Information
        </Text>
        <Box display="grid" __gridTemplateColumns="1fr 1fr 1fr" gap={4}>
          <Input
            label="Name"
            value={customerName}
            onChange={(e) => setCustomerName(e.target.value)}
          />
          <Input
            label="Email"
            type="email"
            value={customerEmail}
            onChange={(e) => setCustomerEmail(e.target.value)}
          />
          <Input
            label="Phone"
            value={customerPhone}
            onChange={(e) => setCustomerPhone(e.target.value)}
          />
        </Box>
        <Box marginTop={4} display="grid" __gridTemplateColumns="1fr 1fr" gap={4}>
          <Input
            label="Notes"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
          />
          <Select
            label="Warehouse"
            value={selectedWarehouseId}
            onChange={(value) => setSelectedWarehouseId(value as string)}
            options={
              warehousesQuery.data?.map((w) => ({
                value: w.id,
                label: w.name,
              })) ?? []
            }
          />
        </Box>
      </Box>

      {/* Add Items */}
      <Box
        padding={6}
        borderRadius={4}
        borderWidth={1}
        borderStyle="solid"
        borderColor="default1"
      >
        <Text as="h2" size={6} fontWeight="bold" marginBottom={4}>
          Add Items
        </Text>
        <Text as="p" color="default2" marginBottom={4}>
          Search by card name or set number (e.g., &quot;Black Lotus&quot; or &quot;2ED-233&quot;)
        </Text>

        <Box display="grid" __gridTemplateColumns="3fr 80px 150px 80px" gap={4} alignItems="end">
          {/* Card Search */}
          <Box ref={searchRef} position="relative">
            <Input
              label="Search Card"
              value={searchQuery}
              onChange={(e) => handleSearchChange(e.target.value)}
              onFocus={() => searchQuery.length >= 2 && setShowResults(true)}
              size="small"
            />

            {/* Search Results Dropdown */}
            {showResults && (
              <Box
                position="absolute"
                __top="100%"
                __left={0}
                __right={0}
                __zIndex={100}
                backgroundColor="default1"
                borderWidth={1}
                borderStyle="solid"
                borderColor="default1"
                borderRadius={4}
                __maxHeight="300px"
                __overflowY="auto"
                boxShadow="defaultFocused"
              >
                {isSearching ? (
                  <Box padding={4}>
                    <Text color="default2">Searching...</Text>
                  </Box>
                ) : searchResults.length === 0 ? (
                  <Box padding={4}>
                    <Text color="default2">No cards found</Text>
                  </Box>
                ) : (
                  searchResults.map((card) => (
                    <Box
                      key={card.variantId}
                      padding={3}
                      cursor="pointer"
                      borderBottomWidth={1}
                      borderBottomStyle="solid"
                      borderColor="default1"
                      onClick={() => handleSelectCard(card)}
                      style={{ transition: "background-color 0.15s" }}
                      className="search-result-item"
                    >
                      <Box display="flex" justifyContent="space-between" alignItems="center">
                        <Box>
                          <Text fontWeight="medium">{card.displayName}</Text>
                          {card.setName && (
                            <Text size={2} color="default2">
                              {card.setName}
                            </Text>
                          )}
                        </Box>
                        <Text fontWeight="bold" color="success1">
                          ${card.marketPrice.toFixed(2)}
                        </Text>
                      </Box>
                    </Box>
                  ))
                )}
              </Box>
            )}
          </Box>

          <Input
            label="Qty"
            type="number"
            min={1}
            value={newQty.toString()}
            onChange={(e) => setNewQty(parseInt(e.target.value) || 1)}
            size="small"
          />

          <Select
            label="Condition"
            value={newCondition}
            onChange={(value) => setNewCondition(value as string)}
            size="small"
            options={CONDITIONS}
          />

          <Button
            onClick={addLine}
            variant="secondary"
            size="small"
            disabled={!selectedCard}
          >
            Add
          </Button>
        </Box>

        {selectedCard && (
          <Box marginTop={4} padding={3} backgroundColor="info1" borderRadius={4}>
            <Text>
              Selected: <Text fontWeight="bold">{selectedCard.displayName}</Text> - Market Price:{" "}
              <Text fontWeight="bold">${selectedCard.marketPrice.toFixed(2)}</Text>
            </Text>
          </Box>
        )}
      </Box>

      {/* Lines Table */}
      {lines.length > 0 && (
        <Box
          borderWidth={1}
          borderStyle="solid"
          borderColor="default1"
          borderRadius={4}
          overflow="hidden"
        >
          <Box
            display="grid"
            __gridTemplateColumns="2.5fr 70px 100px 90px 90px 70px"
            gap={3}
            padding={4}
            backgroundColor="default1"
            alignItems="center"
          >
            <Text fontWeight="bold">Card</Text>
            <Text fontWeight="bold">Qty</Text>
            <Text fontWeight="bold">Condition</Text>
            <Text fontWeight="bold">Market $</Text>
            <Text fontWeight="bold">Buy $</Text>
            <Box />
          </Box>

          {lines.map((line) => (
            <Box
              key={line.id}
              display="grid"
              __gridTemplateColumns="2.5fr 70px 100px 90px 90px 70px"
              gap={3}
              padding={4}
              borderTopWidth={1}
              borderTopStyle="solid"
              borderColor="default1"
              alignItems="center"
            >
              <Text>{line.displayName}</Text>
              <Input
                type="number"
                min={1}
                value={line.qty.toString()}
                onChange={(e) => updateLineQty(line.id, parseInt(e.target.value) || 1)}
                size="small"
              />
              <Text>{line.condition}</Text>
              <Text>${line.marketPrice.toFixed(2)}</Text>
              <Input
                type="number"
                min={0}
                step={0.01}
                value={line.buyPrice.toFixed(2)}
                onChange={(e) => updateLineBuyPrice(line.id, parseFloat(e.target.value) || 0)}
                size="small"
              />
              <Button
                onClick={() => removeLine(line.id)}
                variant="tertiary"
                size="small"
              >
                Remove
              </Button>
            </Box>
          ))}

          <Box
            display="flex"
            justifyContent="flex-end"
            gap={6}
            padding={4}
            backgroundColor="default1"
          >
            <Text>
              Market Total: $
              {lines.reduce((sum, l) => sum + l.marketPrice * l.qty, 0).toFixed(2)}
            </Text>
            <Text fontWeight="bold" color="success1">
              Buy Total: $
              {lines.reduce((sum, l) => sum + l.buyPrice * l.qty, 0).toFixed(2)}
            </Text>
          </Box>
        </Box>
      )}

      {/* Payment Section - only show when items are added */}
      {lines.length > 0 && (
        <Box
          padding={6}
          borderRadius={4}
          borderWidth={1}
          borderStyle="solid"
          borderColor="default1"
          backgroundColor="success1"
        >
          <Text as="h2" size={6} fontWeight="bold" marginBottom={4}>
            Payment
          </Text>
          <Box display="grid" __gridTemplateColumns="1fr 1fr 1fr" gap={4} alignItems="end">
            <Box>
              <Text as="p" size={5} fontWeight="bold" marginBottom={2}>
                Total to Pay Customer
              </Text>
              <Text as="p" size={8} fontWeight="bold" color="success1">
                ${lines.reduce((sum, l) => sum + l.buyPrice * l.qty, 0).toFixed(2)}
              </Text>
            </Box>
            <Select
              label="Payout Method"
              value={payoutMethod}
              onChange={(value) => setPayoutMethod(value as string)}
              options={PAYOUT_METHODS}
            />
            <Input
              label="Reference (optional)"
              value={payoutReference}
              onChange={(e) => setPayoutReference(e.target.value)}
              placeholder="Check #, transaction ID, etc."
            />
          </Box>

          {/* Register Selection for Cash Payouts */}
          {payoutMethod === "CASH" && (
            <Box marginTop={4}>
              {openRegistersQuery.isLoading ? (
                <Text color="default2">Loading registers...</Text>
              ) : openRegistersQuery.data && openRegistersQuery.data.length > 0 ? (
                <Box display="grid" __gridTemplateColumns="1fr 1fr" gap={4} alignItems="end">
                  <Select
                    label="Pay from Register"
                    value={selectedRegisterId}
                    onChange={(value) => setSelectedRegisterId(value as string)}
                    options={openRegistersQuery.data.map((reg) => ({
                      value: reg.id,
                      label: `${reg.registerCode} (${reg.status}) - $${reg.estimatedCash.toFixed(2)} in drawer`,
                    }))}
                  />
                  {selectedRegisterId && openRegistersQuery.data.find((r) => r.id === selectedRegisterId) && (
                    <Box>
                      <Text size={2} color="default2">
                        Current drawer: ${openRegistersQuery.data.find((r) => r.id === selectedRegisterId)?.estimatedCash.toFixed(2)}
                      </Text>
                      <Text size={2} color="default2">
                        After payout: ${(
                          (openRegistersQuery.data.find((r) => r.id === selectedRegisterId)?.estimatedCash ?? 0) -
                          lines.reduce((sum, l) => sum + l.buyPrice * l.qty, 0)
                        ).toFixed(2)}
                      </Text>
                    </Box>
                  )}
                </Box>
              ) : (
                <Box padding={3} backgroundColor="warning1" borderRadius={4}>
                  <Text color="warning1">
                    No open registers found. Cash payout will not be tracked against a register.
                    Open a register in the POS app to track cash payouts.
                  </Text>
                </Box>
              )}
            </Box>
          )}
        </Box>
      )}

      {/* Actions */}
      <Box display="flex" justifyContent="flex-end" gap={4}>
        <Button onClick={() => router.push("/buylists")} variant="tertiary">
          Cancel
        </Button>
        <Button
          onClick={handleSubmit}
          variant="primary"
          disabled={isSubmitting || lines.length === 0}
        >
          {isSubmitting ? "Processing..." : "Complete & Pay Customer"}
        </Button>
      </Box>
    </Box>
  );
}
