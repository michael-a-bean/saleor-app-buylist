import { APL } from "@saleor/app-sdk/APL";
import { RedisAPL } from "@saleor/app-sdk/APL/redis";
import { SaleorApp } from "@saleor/app-sdk/saleor-app";
import { createClient } from "redis";

import { env } from "./env";
import { createLogger } from "./logger";
import { NormalizedFileAPL } from "./normalized-apl";

const logger = createLogger("saleor-app");

/*
 * APL (Auth Persistence Layer) Configuration
 *
 * The APL stores authentication data (tokens) received during app installation.
 * This data must persist across container restarts.
 *
 * Supported backends:
 * - "file": Local file storage (data/.saleor-app-auth.json)
 *           Good for local development. Uses NormalizedFileAPL to handle
 *           Docker URL aliasing (localhost vs api hostname).
 *
 * - "redis": Redis-based storage
 *            Required for cloud deployments (ECS/Fargate) where containers
 *            are ephemeral. Uses ElastiCache in staging/production.
 *
 * Set via APL environment variable (default: "file")
 */
export let apl: APL;

switch (env.APL) {
  case "redis": {
    const redisUrl = env.REDIS_URL;

    if (!redisUrl) {
      throw new Error("APL=redis requires REDIS_URL environment variable");
    }

    logger.info("Using Redis APL", { redisUrl: redisUrl.replace(/\/\/.*@/, "//<redacted>@") });

    const client = createClient({
      url: redisUrl,
    });

    // Connect to Redis (RedisAPL will auto-connect if needed, but we log for visibility)
    client.on("error", (err) => {
      logger.error("Redis APL connection error", { error: err.message });
    });

    apl = new RedisAPL({
      client,
      hashCollectionKey: "saleor_app_auth_buylist",
    });
    break;
  }

  default: {
    logger.info("Using File APL", { fileName: "data/.saleor-app-auth.json" });
    apl = new NormalizedFileAPL({
      fileName: "data/.saleor-app-auth.json",
    });
    break;
  }
}

export const saleorApp = new SaleorApp({
  apl,
});
