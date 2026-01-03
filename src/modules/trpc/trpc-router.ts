import { bohRouter } from "@/modules/boh";
import { buylistsRouter } from "@/modules/buylists";
import { customersRouter } from "@/modules/customers";
import { pricingRouter } from "@/modules/pricing";
import { registerRouter } from "@/modules/register";

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
 * - customers: Customer search, create, and store credit management
 * - register: POS register integration for cash payouts
 */
export const trpcRouter = router({
  health: healthRouter,
  pricing: pricingRouter,
  buylists: buylistsRouter,
  boh: bohRouter,
  customers: customersRouter,
  register: registerRouter,
});

export type TrpcRouter = typeof trpcRouter;
