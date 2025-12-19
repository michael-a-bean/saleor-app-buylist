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

interface LineItem {
  id: string;
  variantId: string;
  variantSku: string;
  variantName: string;
  displayName: string;
  qty: number;
  condition: string;
  marketPrice: number;
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

  const createMutation = trpcClient.buylists.create.useMutation({
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

  const addLine = () => {
    if (!selectedCard) {
      setError("Please search and select a card");
      return;
    }

    const newLine: LineItem = {
      id: `temp-${Date.now()}`,
      variantId: selectedCard.variantId,
      variantSku: selectedCard.variantSku ?? "",
      variantName: selectedCard.variantName,
      displayName: selectedCard.displayName,
      qty: newQty,
      condition: newCondition,
      marketPrice: selectedCard.marketPrice,
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

  const handleSubmit = () => {
    if (lines.length === 0) {
      setError("Please add at least one item");
      return;
    }

    if (!selectedWarehouseId) {
      setError("Please select a warehouse");
      return;
    }

    setIsSubmitting(true);
    setError(null);

    createMutation.mutate({
      saleorWarehouseId: selectedWarehouseId,
      customerName: customerName || undefined,
      customerEmail: customerEmail || undefined,
      customerPhone: customerPhone || undefined,
      notes: notes || undefined,
      currency: "USD",
      lines: lines.map((l) => ({
        saleorVariantId: l.variantId,
        saleorVariantSku: l.variantSku,
        saleorVariantName: l.displayName,
        qty: l.qty,
        condition: l.condition as "NM" | "LP" | "MP" | "HP" | "DMG",
        marketPrice: l.marketPrice,
      })),
    });
  };

  return (
    <Box display="flex" flexDirection="column" gap={6}>
      <Box display="flex" justifyContent="space-between" alignItems="center">
        <Box>
          <Text as="h1" size={8} fontWeight="bold">
            New Buylist
          </Text>
          <Text as="p" color="default2">
            Create a new card buyback transaction
          </Text>
        </Box>
        <Button onClick={() => router.back()} variant="tertiary">
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
            __gridTemplateColumns="3fr 80px 120px 100px 60px"
            gap={4}
            padding={4}
            backgroundColor="default1"
          >
            <Text fontWeight="bold">Card</Text>
            <Text fontWeight="bold">Qty</Text>
            <Text fontWeight="bold">Condition</Text>
            <Text fontWeight="bold">Market $</Text>
            <Box />
          </Box>

          {lines.map((line) => (
            <Box
              key={line.id}
              display="grid"
              __gridTemplateColumns="3fr 80px 120px 100px 60px"
              gap={4}
              padding={4}
              borderTopWidth={1}
              borderTopStyle="solid"
              borderColor="default1"
            >
              <Text>{line.displayName}</Text>
              <Text>{line.qty}</Text>
              <Text>{line.condition}</Text>
              <Text>${line.marketPrice.toFixed(2)}</Text>
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
            padding={4}
            backgroundColor="default1"
          >
            <Text fontWeight="bold">
              Total Market Value: $
              {lines.reduce((sum, l) => sum + l.marketPrice * l.qty, 0).toFixed(2)}
            </Text>
          </Box>
        </Box>
      )}

      {/* Actions */}
      <Box display="flex" justifyContent="flex-end" gap={4}>
        <Button onClick={() => router.back()} variant="tertiary">
          Cancel
        </Button>
        <Button
          onClick={handleSubmit}
          variant="primary"
          disabled={isSubmitting || lines.length === 0}
        >
          {isSubmitting ? "Creating..." : "Create Buylist"}
        </Button>
      </Box>
    </Box>
  );
}
