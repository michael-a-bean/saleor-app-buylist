import { SaleorApp } from "@saleor/app-sdk/saleor-app";

import { NormalizedFileAPL } from "./normalized-apl";

/*
 * For local development and production, we use NormalizedFileAPL
 * This wrapper normalizes URLs so that 'localhost:8000' and 'api:8000'
 * are treated as the same Saleor instance, preventing auth mismatches
 * in Docker environments.
 *
 * The app installation state is persisted in data/.saleor-app-auth.json
 * The data directory is mounted as a Docker volume for persistence
 */
export const apl = new NormalizedFileAPL({
  fileName: "data/.saleor-app-auth.json",
});

export const saleorApp = new SaleorApp({
  apl,
});
