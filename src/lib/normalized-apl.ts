import { AuthData } from "@saleor/app-sdk/APL";
import { FileAPL } from "@saleor/app-sdk/APL/file";

import { createLogger } from "./logger";

const logger = createLogger("NormalizedAPL");

/**
 * URL aliases that should be treated as the same Saleor instance.
 * This handles Docker networking where:
 * - 'api:8000' is used inside Docker containers
 * - 'localhost:8000' is used from the browser
 */
const URL_ALIASES: [string, string][] = [
  ["localhost:8000", "api:8000"],
  ["127.0.0.1:8000", "api:8000"],
];

/**
 * Normalize a Saleor API URL to its canonical form.
 * This ensures consistent storage and lookup regardless of which alias is used.
 */
export const normalizeSaleorApiUrl = (url: string): string => {
  let normalized = url;

  for (const [alias, canonical] of URL_ALIASES) {
    if (normalized.includes(alias)) {
      normalized = normalized.replace(alias, canonical);
      logger.debug("Normalized Saleor API URL", {
        original: url,
        normalized,
      });
      break;
    }
  }

  return normalized;
};

/**
 * FileAPL subclass that normalizes URLs before storage and lookup.
 * This prevents auth mismatches when the same Saleor instance is accessed
 * via different hostnames (e.g., Docker internal vs localhost).
 */
export class NormalizedFileAPL extends FileAPL {
  async get(saleorApiUrl: string): Promise<AuthData | undefined> {
    const normalizedUrl = normalizeSaleorApiUrl(saleorApiUrl);

    return super.get(normalizedUrl);
  }

  async set(authData: AuthData): Promise<void> {
    const normalizedAuthData: AuthData = {
      ...authData,
      saleorApiUrl: normalizeSaleorApiUrl(authData.saleorApiUrl),
    };

    logger.info("Storing auth data with normalized URL", {
      originalUrl: authData.saleorApiUrl,
      normalizedUrl: normalizedAuthData.saleorApiUrl,
      appId: authData.appId,
    });

    return super.set(normalizedAuthData);
  }

  async delete(saleorApiUrl: string): Promise<void> {
    const normalizedUrl = normalizeSaleorApiUrl(saleorApiUrl);

    return super.delete(normalizedUrl);
  }
}
