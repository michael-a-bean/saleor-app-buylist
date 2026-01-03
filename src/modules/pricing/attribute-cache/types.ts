/**
 * Attribute Cache Types
 *
 * Types for caching product attributes from Saleor for faster rule evaluation.
 */

/**
 * Cached attributes for a product variant
 */
export interface CachedProductAttributes {
  variantId: string;
  productId: string;

  // MTG-specific attributes
  setCode: string | null;
  setName: string | null;
  rarity: string | null;
  finish: string | null;
  cardType: string | null;
  formatLegality: Record<string, boolean> | null;

  // Generic extensible attributes
  attributes: Record<string, unknown> | null;

  // Inventory
  qtyOnHand: number;

  // Cache metadata
  lastSyncedAt: Date;
  staleAfter: Date | null;
}

/**
 * Options for syncing attributes
 */
export interface AttributeSyncOptions {
  /** Force refresh even if cache is fresh */
  force?: boolean;

  /** Custom TTL in hours (default: 24) */
  ttlHours?: number;
}

/**
 * Result of a sync operation
 */
export interface AttributeSyncResult {
  variantId: string;
  success: boolean;
  cached: CachedProductAttributes | null;
  error?: string;
  wasStale: boolean;
  fetchedFromSaleor: boolean;
}

/**
 * Bulk sync result
 */
export interface BulkAttributeSyncResult {
  total: number;
  success: number;
  failed: number;
  skipped: number; // Already fresh
  results: AttributeSyncResult[];
}

/**
 * Saleor attribute slugs for MTG cards
 */
export const MTG_ATTRIBUTE_SLUGS = {
  SET_CODE: "mtg-set-code",
  SET_NAME: "mtg-set-name",
  RARITY: "rarity",
  FINISH: "mtg-finish",
  TYPE_LINE: "type_line",
  FORMAT_LEGALITY_STANDARD: "legal-standard",
  FORMAT_LEGALITY_MODERN: "legal-modern",
  FORMAT_LEGALITY_LEGACY: "legal-legacy",
  FORMAT_LEGALITY_VINTAGE: "legal-vintage",
  FORMAT_LEGALITY_COMMANDER: "legal-commander",
  FORMAT_LEGALITY_PIONEER: "legal-pioneer",
  FORMAT_LEGALITY_PAUPER: "legal-pauper",
} as const;

/**
 * Default cache TTL in hours
 */
export const DEFAULT_CACHE_TTL_HOURS = 24;
