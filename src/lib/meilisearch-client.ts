import { env } from "./env";
import { createLogger } from "./logger";

const logger = createLogger("meilisearch-client");

const MEILISEARCH_URL = env.MEILISEARCH_URL ?? "";
const MEILISEARCH_API_KEY = env.MEILISEARCH_API_KEY;

export interface MeilisearchVariant {
  id: string;
  original_id: string;
  sku: string | null;
  condition: string;
  finish: string;
  stock: number;
  price: number | null;
}

export interface MeilisearchHit {
  id: string;
  original_id: string;
  name: string;
  slug: string;
  thumbnail: string | null;
  set_name: string;
  set_code: string;
  collector_number: string;
  rarity: string;
  min_price: number | null;
  total_stock: number;
  in_stock: boolean;
  conditions_available: string[];
  finishes_available: string[];
  variants: MeilisearchVariant[];
}

interface MeilisearchSearchResponse {
  hits: MeilisearchHit[];
  query: string;
  processingTimeMs: number;
  limit: number;
  offset: number;
  estimatedTotalHits: number;
}

function getMeilisearchHeaders(): Record<string, string> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (MEILISEARCH_API_KEY) {
    headers["Authorization"] = `Bearer ${MEILISEARCH_API_KEY}`;
  }
  return headers;
}

/**
 * Check if Meilisearch is configured (URL is set).
 */
export function isMeilisearchConfigured(): boolean {
  return MEILISEARCH_URL.length > 0;
}

/**
 * Search products in the Meilisearch index.
 *
 * @param query - Search text (card name, collector number, etc.)
 * @param options.limit - Max results to return (default 20)
 * @param options.setCode - Filter results to a specific set code
 * @param options.collectorNumber - Filter results to a specific collector number
 * @param options.channel - Saleor channel for index name (default "webstore")
 */
export async function searchProducts(
  query: string,
  options: {
    limit?: number;
    setCode?: string;
    collectorNumber?: string;
    channel?: string;
  } = {},
): Promise<MeilisearchHit[]> {
  const { limit = 20, setCode, collectorNumber, channel = "webstore" } = options;
  const indexName = `${channel}-products`;

  const escapeFilter = (v: string) => v.replace(/["\\]/g, "\\$&");

  const filterParts: string[] = [];
  if (setCode) {
    filterParts.push(`set_code = "${escapeFilter(setCode.toUpperCase())}"`);
  }
  if (collectorNumber) {
    filterParts.push(`collector_number = "${escapeFilter(collectorNumber)}"`);
  }

  const searchParams: Record<string, unknown> = {
    q: query,
    limit,
    attributesToRetrieve: [
      "id",
      "original_id",
      "name",
      "slug",
      "thumbnail",
      "set_name",
      "set_code",
      "collector_number",
      "rarity",
      "min_price",
      "total_stock",
      "in_stock",
      "conditions_available",
      "finishes_available",
      "variants",
    ],
  };

  if (filterParts.length > 0) {
    searchParams.filter = filterParts.join(" AND ");
  }

  const url = `${MEILISEARCH_URL}/indexes/${indexName}/search`;

  logger.debug("Searching Meilisearch", { url, query, setCode, collectorNumber, limit });

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 3000);

  let response: Response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: getMeilisearchHeaders(),
      body: JSON.stringify(searchParams),
      signal: controller.signal,
    });
  } catch (error) {
    throw new Error(
      `Meilisearch request failed: ${error instanceof Error ? error.message : String(error)}`,
    );
  } finally {
    clearTimeout(timeout);
  }

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Meilisearch search failed (${response.status}): ${errorText}`);
  }

  const data = (await response.json()) as MeilisearchSearchResponse;

  logger.debug("Meilisearch results", {
    hits: data.hits.length,
    processingTimeMs: data.processingTimeMs,
    estimatedTotalHits: data.estimatedTotalHits,
  });

  return data.hits;
}
