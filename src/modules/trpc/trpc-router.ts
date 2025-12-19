import { bohRouter } from "@/modules/boh";
import { buylistsRouter } from "@/modules/buylists";
import { pricingRouter } from "@/modules/pricing";

import { protectedClientProcedure } from "./protected-client-procedure";
import { router } from "./trpc-server";

/**
 * Health check router - verify app installation
 */
const healthRouter = router({
  check: protectedClientProcedure.query(async ({ ctx }) => {
    return {
      status: "ok" as const,
      installationId: ctx.installationId,
      saleorApiUrl: ctx.saleorApiUrl,
    };
  }),
});

/**
 * Main tRPC router for Buylist app
 *
 * Sub-routers:
 * - health: App health check
 * - pricing: Pricing policies and price calculations
 * - buylists: FOH buylist management
 * - boh: Back-of-house review and receiving
 */
export const trpcRouter = router({
  health: healthRouter,
  pricing: pricingRouter,
  buylists: buylistsRouter,
  boh: bohRouter,
});

export type TrpcRouter = typeof trpcRouter;
