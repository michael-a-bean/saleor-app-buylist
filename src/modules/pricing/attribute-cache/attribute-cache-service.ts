/**
 * Attribute Cache Service
 *
 * Fetches product attributes from Saleor and caches them locally
 * for fast rule evaluation.
 */

import { PrismaClient } from "@prisma/client";
import { Client, gql } from "urql";

import { createLogger } from "@/lib/logger";

import {
  type AttributeSyncOptions,
  type AttributeSyncResult,
  type BulkAttributeSyncResult,
  type CachedProductAttributes,
  DEFAULT_CACHE_TTL_HOURS,
  MTG_ATTRIBUTE_SLUGS,
} from "./types";

const logger = createLogger("attribute-cache-service");

/**
 * GraphQL query to fetch variant with all attributes and stock
 */
const GET_VARIANT_FULL_QUERY = gql`
  query GetVariantFull($id: ID!, $channel: String!) {
    productVariant(id: $id, channel: $channel) {
      id
      sku
      name
      product {
        id
        name
        category {
          id
          slug
        }
        attributes {
          attribute {
            slug
            name
          }
          values {
            name
            slug
            boolean
          }
        }
      }
      stocks {
        warehouse {
          id
        }
        quantity
      }
    }
  }
`;

/**
 * GraphQL query to fetch multiple variants at once
 */
const GET_VARIANTS_BULK_QUERY = gql`
  query GetVariantsBulk($ids: [ID!]!, $channel: String!) {
    productVariants(first: 100, filter: { ids: $ids }, channel: $channel) {
      edges {
        node {
          id
          sku
          name
          product {
            id
            name
            category {
              id
              slug
            }
            attributes {
              attribute {
                slug
                name
              }
              values {
                name
                slug
                boolean
              }
            }
          }
          stocks {
            warehouse {
              id
            }
            quantity
          }
        }
      }
    }
  }
`;

interface SaleorAttribute {
  attribute: {
    slug: string;
    name: string;
  };
  values: Array<{
    name: string;
    slug: string;
    boolean: boolean | null;
  }>;
}

interface SaleorVariantFull {
  id: string;
  sku: string | null;
  name: string;
  product: {
    id: string;
    name: string;
    category: {
      id: string;
      slug: string;
    } | null;
    attributes: SaleorAttribute[];
  };
  stocks: Array<{
    warehouse: { id: string };
    quantity: number;
  }>;
}

interface GetVariantFullResponse {
  productVariant: SaleorVariantFull | null;
}

interface GetVariantsBulkResponse {
  productVariants: {
    edges: Array<{
      node: SaleorVariantFull;
    }>;
  } | null;
}

/**
 * Extract a string attribute value by slug
 */
function getAttributeValue(attributes: SaleorAttribute[], slug: string): string | null {
  const attr = attributes.find((a) => a.attribute.slug === slug);
  return attr?.values[0]?.name ?? null;
}

/**
 * Extract a boolean attribute value by slug
 */
function getBooleanAttributeValue(attributes: SaleorAttribute[], slug: string): boolean | null {
  const attr = attributes.find((a) => a.attribute.slug === slug);
  if (!attr || attr.values.length === 0) return null;
  // Check for explicit boolean value, or treat "true"/"false" strings
  const val = attr.values[0];
  if (val.boolean !== null) return val.boolean;
  if (val.name.toLowerCase() === "true") return true;
  if (val.name.toLowerCase() === "false") return false;
  return null;
}

/**
 * Extract format legality from attributes
 */
function extractFormatLegality(attributes: SaleorAttribute[]): Record<string, boolean> | null {
  const legality: Record<string, boolean> = {};
  let hasAny = false;

  const formats = [
    { slug: MTG_ATTRIBUTE_SLUGS.FORMAT_LEGALITY_STANDARD, key: "standard" },
    { slug: MTG_ATTRIBUTE_SLUGS.FORMAT_LEGALITY_MODERN, key: "modern" },
    { slug: MTG_ATTRIBUTE_SLUGS.FORMAT_LEGALITY_LEGACY, key: "legacy" },
    { slug: MTG_ATTRIBUTE_SLUGS.FORMAT_LEGALITY_VINTAGE, key: "vintage" },
    { slug: MTG_ATTRIBUTE_SLUGS.FORMAT_LEGALITY_COMMANDER, key: "commander" },
    { slug: MTG_ATTRIBUTE_SLUGS.FORMAT_LEGALITY_PIONEER, key: "pioneer" },
    { slug: MTG_ATTRIBUTE_SLUGS.FORMAT_LEGALITY_PAUPER, key: "pauper" },
  ];

  for (const format of formats) {
    const isLegal = getBooleanAttributeValue(attributes, format.slug);
    if (isLegal !== null) {
      legality[format.key] = isLegal;
      hasAny = true;
    }
  }

  return hasAny ? legality : null;
}

/**
 * Parse Saleor variant into cached attributes
 */
function parseVariantAttributes(variant: SaleorVariantFull): Omit<CachedProductAttributes, "lastSyncedAt" | "staleAfter"> {
  const attrs = variant.product.attributes;

  // Calculate total stock across all warehouses
  const totalStock = variant.stocks.reduce((sum, s) => sum + s.quantity, 0);

  return {
    variantId: variant.id,
    productId: variant.product.id,
    setCode: getAttributeValue(attrs, MTG_ATTRIBUTE_SLUGS.SET_CODE),
    setName: getAttributeValue(attrs, MTG_ATTRIBUTE_SLUGS.SET_NAME),
    rarity: getAttributeValue(attrs, MTG_ATTRIBUTE_SLUGS.RARITY),
    finish: getAttributeValue(attrs, MTG_ATTRIBUTE_SLUGS.FINISH),
    cardType: getAttributeValue(attrs, MTG_ATTRIBUTE_SLUGS.TYPE_LINE),
    formatLegality: extractFormatLegality(attrs),
    attributes: null, // Reserved for future generic attributes
    qtyOnHand: totalStock,
  };
}

/**
 * Attribute Cache Service
 */
export class AttributeCacheService {
  private prisma: PrismaClient;
  private gqlClient: Client;
  private installationId: string;
  private channel: string;

  constructor(
    prisma: PrismaClient,
    gqlClient: Client,
    installationId: string,
    channel: string = "webstore"
  ) {
    this.prisma = prisma;
    this.gqlClient = gqlClient;
    this.installationId = installationId;
    this.channel = channel;
  }

  /**
   * Get cached attributes for a variant
   * Returns null if not cached
   */
  async getCached(variantId: string): Promise<CachedProductAttributes | null> {
    const cached = await this.prisma.productAttributeCache.findUnique({
      where: {
        installationId_variantId: {
          installationId: this.installationId,
          variantId,
        },
      },
    });

    if (!cached) return null;

    return {
      variantId: cached.variantId,
      productId: cached.productId,
      setCode: cached.setCode,
      setName: cached.setName,
      rarity: cached.rarity,
      finish: cached.finish,
      cardType: cached.cardType,
      formatLegality: cached.formatLegality as Record<string, boolean> | null,
      attributes: cached.attributes as Record<string, unknown> | null,
      qtyOnHand: cached.qtyOnHand,
      lastSyncedAt: cached.lastSyncedAt,
      staleAfter: cached.staleAfter,
    };
  }

  /**
   * Get cached attributes for multiple variants
   */
  async getCachedBulk(variantIds: string[]): Promise<Map<string, CachedProductAttributes>> {
    if (variantIds.length === 0) {
      return new Map();
    }

    const cached = await this.prisma.productAttributeCache.findMany({
      where: {
        installationId: this.installationId,
        variantId: { in: variantIds },
      },
    });

    const result = new Map<string, CachedProductAttributes>();
    for (const c of cached) {
      result.set(c.variantId, {
        variantId: c.variantId,
        productId: c.productId,
        setCode: c.setCode,
        setName: c.setName,
        rarity: c.rarity,
        finish: c.finish,
        cardType: c.cardType,
        formatLegality: c.formatLegality as Record<string, boolean> | null,
        attributes: c.attributes as Record<string, unknown> | null,
        qtyOnHand: c.qtyOnHand,
        lastSyncedAt: c.lastSyncedAt,
        staleAfter: c.staleAfter,
      });
    }

    return result;
  }

  /**
   * Check if cached data is stale
   */
  isStale(cached: CachedProductAttributes): boolean {
    if (!cached.staleAfter) return false;
    return new Date() > cached.staleAfter;
  }

  /**
   * Fetch fresh attributes from Saleor for a single variant
   */
  async fetchFromSaleor(variantId: string): Promise<Omit<CachedProductAttributes, "lastSyncedAt" | "staleAfter"> | null> {
    logger.debug("Fetching variant from Saleor", { variantId });

    const result = await this.gqlClient
      .query<GetVariantFullResponse>(GET_VARIANT_FULL_QUERY, {
        id: variantId,
        channel: this.channel,
      })
      .toPromise();

    if (result.error) {
      logger.error("Failed to fetch variant from Saleor", {
        variantId,
        error: result.error.message,
      });
      throw new Error(`Failed to fetch variant: ${result.error.message}`);
    }

    if (!result.data?.productVariant) {
      logger.warn("Variant not found in Saleor", { variantId });
      return null;
    }

    return parseVariantAttributes(result.data.productVariant);
  }

  /**
   * Fetch fresh attributes from Saleor for multiple variants
   */
  async fetchFromSaleorBulk(
    variantIds: string[]
  ): Promise<Map<string, Omit<CachedProductAttributes, "lastSyncedAt" | "staleAfter">>> {
    if (variantIds.length === 0) {
      return new Map();
    }

    logger.debug("Fetching variants from Saleor (bulk)", { count: variantIds.length });

    const result = await this.gqlClient
      .query<GetVariantsBulkResponse>(GET_VARIANTS_BULK_QUERY, {
        ids: variantIds,
        channel: this.channel,
      })
      .toPromise();

    if (result.error) {
      logger.error("Failed to fetch variants from Saleor", {
        error: result.error.message,
      });
      throw new Error(`Failed to fetch variants: ${result.error.message}`);
    }

    const variants = result.data?.productVariants?.edges ?? [];
    const parsed = new Map<string, Omit<CachedProductAttributes, "lastSyncedAt" | "staleAfter">>();

    for (const { node } of variants) {
      parsed.set(node.id, parseVariantAttributes(node));
    }

    return parsed;
  }

  /**
   * Update cache for a single variant
   */
  private async updateCache(
    attrs: Omit<CachedProductAttributes, "lastSyncedAt" | "staleAfter">,
    ttlHours: number = DEFAULT_CACHE_TTL_HOURS
  ): Promise<CachedProductAttributes> {
    const now = new Date();
    const staleAfter = new Date(now.getTime() + ttlHours * 60 * 60 * 1000);

    const cached = await this.prisma.productAttributeCache.upsert({
      where: {
        installationId_variantId: {
          installationId: this.installationId,
          variantId: attrs.variantId,
        },
      },
      create: {
        installationId: this.installationId,
        variantId: attrs.variantId,
        productId: attrs.productId,
        setCode: attrs.setCode,
        setName: attrs.setName,
        rarity: attrs.rarity,
        finish: attrs.finish,
        cardType: attrs.cardType,
        formatLegality: attrs.formatLegality as object | undefined,
        attributes: attrs.attributes as object | undefined,
        qtyOnHand: attrs.qtyOnHand,
        lastSyncedAt: now,
        staleAfter,
      },
      update: {
        productId: attrs.productId,
        setCode: attrs.setCode,
        setName: attrs.setName,
        rarity: attrs.rarity,
        finish: attrs.finish,
        cardType: attrs.cardType,
        formatLegality: attrs.formatLegality as object | undefined,
        attributes: attrs.attributes as object | undefined,
        qtyOnHand: attrs.qtyOnHand,
        lastSyncedAt: now,
        staleAfter,
      },
    });

    return {
      variantId: cached.variantId,
      productId: cached.productId,
      setCode: cached.setCode,
      setName: cached.setName,
      rarity: cached.rarity,
      finish: cached.finish,
      cardType: cached.cardType,
      formatLegality: cached.formatLegality as Record<string, boolean> | null,
      attributes: cached.attributes as Record<string, unknown> | null,
      qtyOnHand: cached.qtyOnHand,
      lastSyncedAt: cached.lastSyncedAt,
      staleAfter: cached.staleAfter,
    };
  }

  /**
   * Get attributes with cache-through pattern
   * Returns cached data if fresh, otherwise fetches from Saleor and updates cache
   */
  async getAttributes(
    variantId: string,
    options: AttributeSyncOptions = {}
  ): Promise<AttributeSyncResult> {
    const { force = false, ttlHours = DEFAULT_CACHE_TTL_HOURS } = options;

    // Check cache first
    const cached = await this.getCached(variantId);
    const wasStale = cached ? this.isStale(cached) : false;

    // Return cached if fresh and not forcing refresh
    if (cached && !wasStale && !force) {
      return {
        variantId,
        success: true,
        cached,
        wasStale: false,
        fetchedFromSaleor: false,
      };
    }

    // Fetch from Saleor
    try {
      const fresh = await this.fetchFromSaleor(variantId);
      if (!fresh) {
        return {
          variantId,
          success: false,
          cached: null,
          error: "Variant not found in Saleor",
          wasStale,
          fetchedFromSaleor: true,
        };
      }

      const updated = await this.updateCache(fresh, ttlHours);
      return {
        variantId,
        success: true,
        cached: updated,
        wasStale,
        fetchedFromSaleor: true,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      logger.error("Failed to sync attributes", { variantId, error: message });

      // If we have stale data, return it with a warning
      if (cached) {
        return {
          variantId,
          success: true, // Still success since we have data
          cached,
          error: `Fetch failed, returning stale data: ${message}`,
          wasStale: true,
          fetchedFromSaleor: false,
        };
      }

      return {
        variantId,
        success: false,
        cached: null,
        error: message,
        wasStale,
        fetchedFromSaleor: false,
      };
    }
  }

  /**
   * Sync attributes for multiple variants
   */
  async syncBulk(
    variantIds: string[],
    options: AttributeSyncOptions = {}
  ): Promise<BulkAttributeSyncResult> {
    const { force = false, ttlHours = DEFAULT_CACHE_TTL_HOURS } = options;

    if (variantIds.length === 0) {
      return { total: 0, success: 0, failed: 0, skipped: 0, results: [] };
    }

    // Check cache for all variants
    const cachedMap = await this.getCachedBulk(variantIds);

    // Determine which need fetching
    const needsFetch: string[] = [];
    const results: AttributeSyncResult[] = [];

    for (const variantId of variantIds) {
      const cached = cachedMap.get(variantId);
      const wasStale = cached ? this.isStale(cached) : false;

      if (cached && !wasStale && !force) {
        // Fresh cache, skip
        results.push({
          variantId,
          success: true,
          cached,
          wasStale: false,
          fetchedFromSaleor: false,
        });
      } else {
        needsFetch.push(variantId);
      }
    }

    // Fetch needed variants from Saleor in batches
    const BATCH_SIZE = 100;
    for (let i = 0; i < needsFetch.length; i += BATCH_SIZE) {
      const batch = needsFetch.slice(i, i + BATCH_SIZE);

      try {
        const freshMap = await this.fetchFromSaleorBulk(batch);

        for (const variantId of batch) {
          const fresh = freshMap.get(variantId);
          const cached = cachedMap.get(variantId);
          const wasStale = cached ? this.isStale(cached) : false;

          if (fresh) {
            try {
              const updated = await this.updateCache(fresh, ttlHours);
              results.push({
                variantId,
                success: true,
                cached: updated,
                wasStale,
                fetchedFromSaleor: true,
              });
            } catch (error) {
              const message = error instanceof Error ? error.message : "Unknown error";
              results.push({
                variantId,
                success: false,
                cached: cached ?? null,
                error: `Cache update failed: ${message}`,
                wasStale,
                fetchedFromSaleor: true,
              });
            }
          } else {
            // Variant not found in Saleor
            results.push({
              variantId,
              success: false,
              cached: cached ?? null,
              error: "Variant not found in Saleor",
              wasStale,
              fetchedFromSaleor: true,
            });
          }
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : "Unknown error";
        // Batch fetch failed, return cached for all
        for (const variantId of batch) {
          const cached = cachedMap.get(variantId);
          const wasStale = cached ? this.isStale(cached) : false;
          results.push({
            variantId,
            success: !!cached,
            cached: cached ?? null,
            error: `Batch fetch failed: ${message}`,
            wasStale,
            fetchedFromSaleor: false,
          });
        }
      }
    }

    const skipped = results.filter((r) => r.success && !r.fetchedFromSaleor).length;
    const success = results.filter((r) => r.success).length;
    const failed = results.filter((r) => !r.success).length;

    logger.info("Bulk sync complete", {
      total: variantIds.length,
      success,
      failed,
      skipped,
    });

    return {
      total: variantIds.length,
      success,
      failed,
      skipped,
      results,
    };
  }

  /**
   * Invalidate cached attributes for a variant
   */
  async invalidate(variantId: string): Promise<void> {
    await this.prisma.productAttributeCache.deleteMany({
      where: {
        installationId: this.installationId,
        variantId,
      },
    });
  }

  /**
   * Invalidate all cached attributes
   */
  async invalidateAll(): Promise<number> {
    const result = await this.prisma.productAttributeCache.deleteMany({
      where: {
        installationId: this.installationId,
      },
    });
    return result.count;
  }

  /**
   * Search cached attributes by criteria
   */
  async searchCached(options: {
    setCode?: string;
    rarity?: string;
    finish?: string;
    minQtyOnHand?: number;
    maxQtyOnHand?: number;
    limit?: number;
    offset?: number;
  }): Promise<CachedProductAttributes[]> {
    const { setCode, rarity, finish, minQtyOnHand, maxQtyOnHand, limit = 100, offset = 0 } = options;

    const where: Record<string, unknown> = {
      installationId: this.installationId,
    };

    if (setCode) {
      where.setCode = setCode.toUpperCase();
    }
    if (rarity) {
      where.rarity = rarity.toLowerCase();
    }
    if (finish) {
      where.finish = finish.toLowerCase();
    }
    if (minQtyOnHand !== undefined) {
      where.qtyOnHand = { ...(where.qtyOnHand as object || {}), gte: minQtyOnHand };
    }
    if (maxQtyOnHand !== undefined) {
      where.qtyOnHand = { ...(where.qtyOnHand as object || {}), lte: maxQtyOnHand };
    }

    const cached = await this.prisma.productAttributeCache.findMany({
      where,
      take: limit,
      skip: offset,
      orderBy: { lastSyncedAt: "desc" },
    });

    return cached.map((c) => ({
      variantId: c.variantId,
      productId: c.productId,
      setCode: c.setCode,
      setName: c.setName,
      rarity: c.rarity,
      finish: c.finish,
      cardType: c.cardType,
      formatLegality: c.formatLegality as Record<string, boolean> | null,
      attributes: c.attributes as Record<string, unknown> | null,
      qtyOnHand: c.qtyOnHand,
      lastSyncedAt: c.lastSyncedAt,
      staleAfter: c.staleAfter,
    }));
  }

  /**
   * Get cache statistics
   */
  async getStats(): Promise<{
    total: number;
    stale: number;
    fresh: number;
    avgAge: number;
  }> {
    const now = new Date();

    const [total, staleCount] = await Promise.all([
      this.prisma.productAttributeCache.count({
        where: { installationId: this.installationId },
      }),
      this.prisma.productAttributeCache.count({
        where: {
          installationId: this.installationId,
          staleAfter: { lt: now },
        },
      }),
    ]);

    // Get average age
    const avgAgeResult = await this.prisma.$queryRaw<[{ avgAge: number }]>`
      SELECT EXTRACT(EPOCH FROM AVG(NOW() - "lastSyncedAt")) as "avgAge"
      FROM "ProductAttributeCache"
      WHERE "installationId" = ${this.installationId}
    `;
    const avgAge = avgAgeResult[0]?.avgAge ?? 0;

    return {
      total,
      stale: staleCount,
      fresh: total - staleCount,
      avgAge: Math.round(avgAge), // seconds
    };
  }
}
