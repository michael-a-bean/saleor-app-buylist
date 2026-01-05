import { PrismaClient } from "@prisma/client";
import { Decimal } from "decimal.js";
import { Client, gql } from "urql";

import { createLogger } from "./logger";

const logger = createLogger("saleor-client");

// GraphQL Queries
const WAREHOUSES_QUERY = gql`
  query Warehouses($first: Int!) {
    warehouses(first: $first) {
      edges {
        node {
          id
          name
          slug
        }
      }
    }
  }
`;

const SEARCH_VARIANTS_QUERY = gql`
  query SearchVariants($first: Int!, $search: String, $channel: String!) {
    productVariants(first: $first, filter: { search: $search }, channel: $channel) {
      edges {
        node {
          id
          sku
          name
          product {
            id
            name
            thumbnail {
              url
            }
            attributes {
              attribute {
                slug
              }
              values {
                name
              }
            }
          }
          pricing {
            price {
              gross {
                amount
                currency
              }
            }
          }
        }
      }
    }
  }
`;

const GET_VARIANT_BY_ID_QUERY = gql`
  query GetVariantById($id: ID!, $channel: String!) {
    productVariant(id: $id, channel: $channel) {
      id
      sku
      name
      product {
        id
        name
        thumbnail {
          url
        }
        attributes {
          attribute {
            slug
          }
          values {
            name
          }
        }
      }
      pricing {
        price {
          gross {
            amount
            currency
          }
        }
      }
    }
  }
`;

const GET_VARIANT_BY_SKU_QUERY = gql`
  query GetVariantBySku($sku: String!, $channel: String!) {
    productVariants(first: 1, filter: { sku: $sku }, channel: $channel) {
      edges {
        node {
          id
          sku
          name
        }
      }
    }
  }
`;

interface GetVariantBySkuResponse {
  productVariants: {
    edges: Array<{
      node: {
        id: string;
        sku: string | null;
        name: string;
      };
    }>;
  } | null;
}

// Stock Queries
const GET_VARIANT_STOCKS_QUERY = gql`
  query GetVariantStocks($variantId: ID!, $channel: String!) {
    productVariant(id: $variantId, channel: $channel) {
      id
      sku
      stocks {
        id
        warehouse {
          id
          name
        }
        quantity
      }
    }
  }
`;

// Stock Mutation - Creates stock if it doesn't exist, updates if it does
const PRODUCT_VARIANT_STOCKS_UPDATE_MUTATION = gql`
  mutation ProductVariantStocksUpdate($variantId: ID!, $stocks: [StockInput!]!) {
    productVariantStocksUpdate(variantId: $variantId, stocks: $stocks) {
      productVariant {
        id
        sku
        stocks {
          id
          quantity
          warehouse {
            id
            name
          }
        }
      }
      errors {
        field
        message
        code
      }
    }
  }
`;

// Type definitions
export interface SaleorWarehouse {
  id: string;
  name: string;
  slug: string;
}

export interface SaleorProductAttribute {
  attribute: {
    slug: string;
  };
  values: Array<{
    name: string;
  }>;
}

export interface SaleorVariant {
  id: string;
  sku: string | null;
  name: string;
  product: {
    id: string;
    name: string;
    thumbnail: {
      url: string;
    } | null;
    attributes: SaleorProductAttribute[];
  };
  pricing: {
    price: {
      gross: {
        amount: number;
        currency: string;
      };
    } | null;
  } | null;
}

export interface CardSearchResult {
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

// Response types
interface WarehousesResponse {
  warehouses: {
    edges: Array<{
      node: SaleorWarehouse;
    }>;
  } | null;
}

interface SearchVariantsResponse {
  productVariants: {
    edges: Array<{
      node: SaleorVariant;
    }>;
  } | null;
}

interface GetVariantResponse {
  productVariant: SaleorVariant | null;
}

interface VariantWithStocks {
  id: string;
  sku: string | null;
  stocks: Array<{
    id: string;
    warehouse: {
      id: string;
      name: string;
    };
    quantity: number;
  }>;
}

interface GetVariantStocksResponse {
  productVariant: VariantWithStocks | null;
}

interface ProductVariantStocksUpdateResponse {
  productVariantStocksUpdate: {
    productVariant: {
      id: string;
      sku: string | null;
      stocks: Array<{
        id: string;
        quantity: number;
        warehouse: {
          id: string;
          name: string;
        };
      }>;
    } | null;
    errors: Array<{
      field: string | null;
      message: string;
      code: string;
    }>;
  } | null;
}

export interface StockUpdateResult {
  success: boolean;
  variantId: string;
  warehouseId: string;
  previousQuantity: number;
  newQuantity: number;
  error?: string;
}

/**
 * Extract MTG attributes from product attributes
 */
function extractMtgAttributes(attributes: SaleorProductAttribute[]): {
  setCode: string | null;
  setName: string | null;
  collectorNumber: string | null;
} {
  let setCode: string | null = null;
  let setName: string | null = null;
  let collectorNumber: string | null = null;

  for (const attr of attributes) {
    const slug = attr.attribute.slug;
    const value = attr.values[0]?.name ?? null;

    if (slug === "mtg-set-code") {
      setCode = value;
    } else if (slug === "mtg-set-name") {
      setName = value;
    } else if (slug === "mtg-collector-number") {
      collectorNumber = value;
    }
  }

  return { setCode, setName, collectorNumber };
}

/**
 * Convert SaleorVariant to CardSearchResult
 */
function variantToCardResult(variant: SaleorVariant): CardSearchResult {
  const { setCode, setName, collectorNumber } = extractMtgAttributes(
    variant.product.attributes
  );

  const setNumber = setCode && collectorNumber ? `${setCode.toUpperCase()}-${collectorNumber}` : null;
  const displayName = setNumber
    ? `${variant.product.name} (${setNumber})`
    : variant.product.name;

  return {
    variantId: variant.id,
    variantSku: variant.sku,
    variantName: variant.name,
    productName: variant.product.name,
    thumbnailUrl: variant.product.thumbnail?.url ?? null,
    setCode,
    setName,
    collectorNumber,
    displayName,
    marketPrice: variant.pricing?.price?.gross.amount ?? 0,
    currency: variant.pricing?.price?.gross.currency ?? "USD",
  };
}

/**
 * Dedupe card results by unique card identity (product + set + collector number)
 * Returns one result per unique card, preferring NM variants for pricing
 */
function dedupeCardResults(results: CardSearchResult[]): CardSearchResult[] {
  const cardMap = new Map<string, CardSearchResult>();

  for (const result of results) {
    // Create a unique key for each card printing
    const key = `${result.productName}|${result.setCode ?? ""}|${result.collectorNumber ?? ""}`;

    const existing = cardMap.get(key);

    if (!existing) {
      cardMap.set(key, result);
    } else {
      /*
       * Prefer NM variant for the best market price reference.
       * Check if current result is NM (variant name often contains condition).
       */
      const isCurrentNm = result.variantName.toUpperCase().includes("NM") ||
                          result.variantName.toUpperCase().includes("NEAR MINT");
      const isExistingNm = existing.variantName.toUpperCase().includes("NM") ||
                           existing.variantName.toUpperCase().includes("NEAR MINT");

      if (isCurrentNm && !isExistingNm) {
        cardMap.set(key, result);
      } else if (!isCurrentNm && !isExistingNm && result.marketPrice > existing.marketPrice) {
        // If neither is NM, prefer higher price (likely NM equivalent)
        cardMap.set(key, result);
      }
    }
  }

  return Array.from(cardMap.values());
}

/**
 * Saleor API client helper functions for buylist app
 */
export class SaleorClient {
  private client: Client;
  private channel: string;

  constructor(client: Client, channel: string = "webstore") {
    this.client = client;
    this.channel = channel;
  }

  /**
   * List all warehouses
   */
  async listWarehouses(first: number = 100): Promise<SaleorWarehouse[]> {
    logger.debug("Fetching warehouses", { first });

    const result = await this.client
      .query<WarehousesResponse>(WAREHOUSES_QUERY, { first })
      .toPromise();

    if (result.error) {
      logger.error("Failed to fetch warehouses", { error: result.error.message });
      throw new Error(`Failed to fetch warehouses: ${result.error.message}`);
    }

    return result.data?.warehouses?.edges.map((e) => e.node) ?? [];
  }

  /**
   * Search for cards by name or set number
   * Set number format: "SET-123" or "123-SET" (e.g., "NEO-123" or "123-NEO")
   */
  async searchCards(query: string, first: number = 20): Promise<CardSearchResult[]> {
    logger.debug("Searching cards", { query, first });

    // Check if query looks like a set number (e.g., "NEO-123" or "123-NEO")
    const setNumberMatch = query.match(/^([A-Za-z0-9]+)-([A-Za-z0-9]+)$/);
    let searchQuery = query;

    if (setNumberMatch) {
      // Could be "SET-123" or "123-SET", try to determine which
      const [, part1, part2] = setNumberMatch;
      const isFirstNumeric = /^\d+[A-Za-z]*$/.test(part1);

      // If first part is numeric, format is "123-SET", else "SET-123"
      const setCode = isFirstNumeric ? part2 : part1;
      const collectorNum = isFirstNumeric ? part1 : part2;

      /*
       * For set number search, we'll search for the collector number
       * and filter results by set code
       */
      searchQuery = collectorNum;
      logger.debug("Detected set number format", { setCode, collectorNum });
    }

    const result = await this.client
      .query<SearchVariantsResponse>(SEARCH_VARIANTS_QUERY, {
        first: first * 2, // Fetch more to allow filtering
        search: searchQuery,
        channel: this.channel,
      })
      .toPromise();

    if (result.error) {
      logger.error("Failed to search cards", { error: result.error.message });
      throw new Error(`Failed to search cards: ${result.error.message}`);
    }

    let variants = result.data?.productVariants?.edges.map((e) => e.node) ?? [];

    // If set number search, filter by set code
    if (setNumberMatch) {
      const [, part1, part2] = setNumberMatch;
      const isFirstNumeric = /^\d+[A-Za-z]*$/.test(part1);
      const setCode = (isFirstNumeric ? part2 : part1).toLowerCase();
      const collectorNum = isFirstNumeric ? part1 : part2;

      variants = variants.filter((v) => {
        const attrs = extractMtgAttributes(v.product.attributes);

        return (
          attrs.setCode?.toLowerCase() === setCode &&
          attrs.collectorNumber === collectorNum
        );
      });
    }

    const results = variants.map(variantToCardResult);

    // Dedupe to show one result per unique card (condition is selected separately)
    const dedupedResults = dedupeCardResults(results).slice(0, first);

    logger.debug("Found cards", { count: dedupedResults.length, beforeDedupe: results.length });

    return dedupedResults;
  }

  /**
   * Get a single variant by ID
   */
  async getVariantById(id: string): Promise<CardSearchResult | null> {
    logger.debug("Getting variant by ID", { id });

    const result = await this.client
      .query<GetVariantResponse>(GET_VARIANT_BY_ID_QUERY, {
        id,
        channel: this.channel,
      })
      .toPromise();

    if (result.error) {
      logger.error("Failed to get variant", { error: result.error.message });
      throw new Error(`Failed to get variant: ${result.error.message}`);
    }

    if (!result.data?.productVariant) {
      return null;
    }

    return variantToCardResult(result.data.productVariant);
  }

  /**
   * Get a variant by SKU
   */
  async getVariantBySku(sku: string): Promise<{ id: string; sku: string | null; name: string } | null> {
    logger.debug("Getting variant by SKU", { sku });

    const result = await this.client
      .query<GetVariantBySkuResponse>(GET_VARIANT_BY_SKU_QUERY, {
        sku,
        channel: this.channel,
      })
      .toPromise();

    if (result.error) {
      logger.error("Failed to get variant by SKU", { error: result.error.message });
      throw new Error(`Failed to get variant by SKU: ${result.error.message}`);
    }

    const variant = result.data?.productVariants?.edges[0]?.node;
    return variant ?? null;
  }

  /**
   * Get the condition-specific variant ID for a given base variant and condition.
   *
   * MTG variants follow SKU pattern: {baseId}-{condition}
   * e.g., "abc123-NM", "abc123-LP", "abc123-MP", "abc123-HP", "abc123-DMG"
   *
   * @param baseVariantSku - The SKU of any variant for this card (usually NM)
   * @param condition - The target condition (NM, LP, MP, HP, DMG)
   * @returns The variant ID for the condition-specific variant, or null if not found
   */
  async getConditionVariantId(
    baseVariantSku: string,
    condition: "NM" | "LP" | "MP" | "HP" | "DMG"
  ): Promise<string | null> {
    // Extract base SKU by removing any existing condition suffix
    const conditionSuffixes = ["-NM", "-LP", "-MP", "-HP", "-DMG"];
    let baseSku = baseVariantSku;
    for (const suffix of conditionSuffixes) {
      if (baseSku.toUpperCase().endsWith(suffix)) {
        baseSku = baseSku.slice(0, -suffix.length);
        break;
      }
    }

    // Build target SKU with condition
    const targetSku = `${baseSku}-${condition}`;
    logger.debug("Looking up condition variant", { baseVariantSku, baseSku, targetSku, condition });

    const variant = await this.getVariantBySku(targetSku);
    if (variant) {
      logger.debug("Found condition variant", { targetSku, variantId: variant.id });
      return variant.id;
    }

    logger.warn("Condition variant not found", { targetSku, condition });
    return null;
  }

  /**
   * Get current stock quantity for a variant in a specific warehouse
   */
  async getStock(variantId: string, warehouseId: string): Promise<number> {
    logger.debug("Getting stock", { variantId, warehouseId });

    const result = await this.client
      .query<GetVariantStocksResponse>(GET_VARIANT_STOCKS_QUERY, {
        variantId,
        channel: this.channel,
      })
      .toPromise();

    if (result.error) {
      logger.error("Failed to get stock", { error: result.error.message });
      throw new Error(`Failed to get stock: ${result.error.message}`);
    }

    const stocks = result.data?.productVariant?.stocks ?? [];
    const stock = stocks.find((s) => s.warehouse.id === warehouseId);

    return stock?.quantity ?? 0;
  }

  /**
   * Update stock for a single variant in a warehouse
   * Sets the absolute quantity value
   */
  async updateStock(
    variantId: string,
    warehouseId: string,
    quantity: number
  ): Promise<{ success: boolean; newQuantity: number; error?: string }> {
    logger.info("Updating stock", { variantId, warehouseId, quantity });

    const result = await this.client
      .mutation<ProductVariantStocksUpdateResponse>(PRODUCT_VARIANT_STOCKS_UPDATE_MUTATION, {
        variantId,
        stocks: [{ warehouse: warehouseId, quantity }],
      })
      .toPromise();

    if (result.error) {
      logger.error("Failed to update stock", { error: result.error.message });
      return { success: false, newQuantity: 0, error: result.error.message };
    }

    const response = result.data?.productVariantStocksUpdate;

    if (!response) {
      return { success: false, newQuantity: 0, error: "No response from mutation" };
    }

    if (response.errors && response.errors.length > 0) {
      const errorMsg = response.errors.map((e) => e.message).join(", ");
      logger.error("Stock update errors", { errors: response.errors });
      return { success: false, newQuantity: 0, error: errorMsg };
    }

    const updatedStock = response.productVariant?.stocks.find(
      (s) => s.warehouse.id === warehouseId
    );
    const newQuantity = updatedStock?.quantity ?? quantity;

    logger.info("Stock updated successfully", { variantId, warehouseId, newQuantity });

    return { success: true, newQuantity };
  }

  /**
   * Adjust stock by adding a delta (positive or negative)
   * Fetches current stock, calculates new quantity, then updates
   */
  async adjustStock(
    variantId: string,
    warehouseId: string,
    delta: number
  ): Promise<StockUpdateResult> {
    logger.info("Adjusting stock", { variantId, warehouseId, delta });

    const previousQuantity = await this.getStock(variantId, warehouseId);
    const newQuantity = previousQuantity + delta;

    if (newQuantity < 0) {
      logger.warn("Stock adjustment would result in negative quantity", {
        variantId,
        warehouseId,
        previousQuantity,
        delta,
        newQuantity,
      });
    }

    const result = await this.updateStock(variantId, warehouseId, newQuantity);

    return {
      success: result.success,
      variantId,
      warehouseId,
      previousQuantity,
      newQuantity: result.success ? result.newQuantity : previousQuantity,
      error: result.error,
    };
  }

  /**
   * Bulk adjust stock for multiple variants
   * Returns results for each adjustment
   */
  async bulkAdjustStock(
    adjustments: Array<{ variantId: string; warehouseId: string; delta: number }>
  ): Promise<StockUpdateResult[]> {
    logger.info("Bulk adjusting stock", { count: adjustments.length });

    const results: StockUpdateResult[] = [];

    for (const adj of adjustments) {
      const result = await this.adjustStock(adj.variantId, adj.warehouseId, adj.delta);
      results.push(result);

      // If any adjustment fails, log but continue with others
      if (!result.success) {
        logger.warn("Stock adjustment failed", {
          variantId: adj.variantId,
          error: result.error,
        });
      }
    }

    const successCount = results.filter((r) => r.success).length;
    logger.info("Bulk stock adjustment complete", {
      total: adjustments.length,
      success: successCount,
      failed: adjustments.length - successCount,
    });

    return results;
  }
}

/**
 * Create a SaleorClient instance from an authenticated GraphQL client
 */
export function createSaleorClient(client: Client, channel?: string): SaleorClient {
  return new SaleorClient(client, channel);
}

/**
 * Price Snapshot Service
 *
 * Fetches and caches market prices from SellPriceSnapshot table.
 * Falls back to Saleor prices if no snapshot exists.
 */
export class PriceSnapshotService {
  private prisma: PrismaClient;
  private installationId: string;
  private channelId: string;

  constructor(prisma: PrismaClient, installationId: string, channelId: string) {
    this.prisma = prisma;
    this.installationId = installationId;
    this.channelId = channelId;
  }

  /**
   * Get the latest market price for a variant from snapshots
   * Returns null if no snapshot exists (caller should use Saleor price)
   */
  async getLatestPrice(variantId: string): Promise<{ price: number; source: string } | null> {
    const snapshot = await this.prisma.sellPriceSnapshot.findFirst({
      where: {
        installationId: this.installationId,
        saleorVariantId: variantId,
        saleorChannelId: this.channelId,
      },
      orderBy: { snapshotAt: "desc" },
    });

    if (!snapshot) {
      return null;
    }

    return {
      price: snapshot.currentPrice.toNumber(),
      source: snapshot.source,
    };
  }

  /**
   * Get latest prices for multiple variants
   * Returns a map of variantId -> price data
   */
  async getLatestPrices(
    variantIds: string[]
  ): Promise<Map<string, { price: number; source: string }>> {
    if (variantIds.length === 0) {
      return new Map();
    }

    // Get latest snapshot for each variant using a subquery approach
    const snapshots = await this.prisma.$queryRaw<
      Array<{
        saleorVariantId: string;
        currentPrice: Decimal;
        source: string;
      }>
    >`
      SELECT DISTINCT ON ("saleorVariantId")
        "saleorVariantId",
        "currentPrice",
        "source"
      FROM "SellPriceSnapshot"
      WHERE "installationId" = ${this.installationId}
        AND "saleorChannelId" = ${this.channelId}
        AND "saleorVariantId" = ANY(${variantIds})
      ORDER BY "saleorVariantId", "snapshotAt" DESC
    `;

    const priceMap = new Map<string, { price: number; source: string }>();

    for (const snapshot of snapshots) {
      priceMap.set(snapshot.saleorVariantId, {
        price: Number(snapshot.currentPrice),
        source: snapshot.source,
      });
    }

    return priceMap;
  }

  /**
   * Create a price snapshot for a variant
   * Called when fetching from Saleor to bootstrap snapshot data
   */
  async createSnapshot(options: {
    variantId: string;
    price: number;
    currency: string;
    sourceUrl?: string;
  }): Promise<void> {
    await this.prisma.sellPriceSnapshot.create({
      data: {
        installationId: this.installationId,
        saleorVariantId: options.variantId,
        saleorChannelId: this.channelId,
        currentPrice: new Decimal(options.price),
        currency: options.currency,
        source: "saleor",
        sourceUrl: options.sourceUrl,
      },
    });

    logger.debug("Created price snapshot", { variantId: options.variantId, price: options.price });
  }
}

/**
 * Enhanced SaleorClient that uses price snapshots
 */
export class EnhancedSaleorClient extends SaleorClient {
  private priceService: PriceSnapshotService | null = null;

  /**
   * Attach a price snapshot service for enhanced pricing
   */
  withPriceSnapshots(
    prisma: PrismaClient,
    installationId: string,
    channelId: string
  ): EnhancedSaleorClient {
    this.priceService = new PriceSnapshotService(prisma, installationId, channelId);
    return this;
  }

  /**
   * Search cards with enhanced pricing from snapshots
   */
  override async searchCards(query: string, first: number = 20): Promise<CardSearchResult[]> {
    const results = await super.searchCards(query, first);

    if (!this.priceService || results.length === 0) {
      return results;
    }

    // Fetch snapshot prices for all results
    const variantIds = results.map((r) => r.variantId);
    const snapshotPrices = await this.priceService.getLatestPrices(variantIds);

    // Enhance results with snapshot prices where available
    return results.map((result) => {
      const snapshotPrice = snapshotPrices.get(result.variantId);

      if (snapshotPrice) {
        return {
          ...result,
          marketPrice: snapshotPrice.price,
          // Keep original currency from Saleor
        };
      }

      // No snapshot - create one for future use (async, don't await)
      if (result.marketPrice > 0) {
        this.priceService
          ?.createSnapshot({ variantId: result.variantId, price: result.marketPrice, currency: result.currency })
          .catch((err) => logger.warn("Failed to create snapshot", { error: err.message }));
      }

      return result;
    });
  }

  /**
   * Get variant by ID with enhanced pricing
   */
  override async getVariantById(id: string): Promise<CardSearchResult | null> {
    const result = await super.getVariantById(id);

    if (!result || !this.priceService) {
      return result;
    }

    // Check for snapshot price
    const snapshotPrice = await this.priceService.getLatestPrice(id);

    if (snapshotPrice) {
      return {
        ...result,
        marketPrice: snapshotPrice.price,
      };
    }

    // Create snapshot for future use
    if (result.marketPrice > 0) {
      await this.priceService
        .createSnapshot({ variantId: result.variantId, price: result.marketPrice, currency: result.currency })
        .catch((err) => logger.warn("Failed to create snapshot", { error: err.message }));
    }

    return result;
  }
}

/**
 * Create an enhanced SaleorClient with price snapshot support
 */
export function createEnhancedSaleorClient(
  client: Client,
  options: { prisma: PrismaClient; installationId: string; channel?: string }
): EnhancedSaleorClient {
  const channel = options.channel ?? "webstore";

  return new EnhancedSaleorClient(client, channel).withPriceSnapshots(
    options.prisma,
    options.installationId,
    channel
  );
}
