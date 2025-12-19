import { createManifestHandler } from "@saleor/app-sdk/handlers/next-app-router";
import { AppManifest } from "@saleor/app-sdk/types";
import { withSpanAttributesAppRouter } from "@saleor/apps-otel/src/with-span-attributes";
import { compose } from "@saleor/apps-shared/compose";

import { env } from "@/lib/env";
import { withLoggerContext } from "@/lib/logger-context";
import packageJson from "@/package.json";

const handler = createManifestHandler({
  async manifestFactory({ appBaseUrl }) {
    const iframeBaseUrl = env.APP_IFRAME_BASE_URL ?? appBaseUrl;
    const apiBaseUrl = env.APP_API_BASE_URL ?? appBaseUrl;

    const manifest: AppManifest = {
      about:
        "Buylist app for Saleor - manage customer card buybacks with pricing rules, quote generation, and inventory integration.",
      appUrl: iframeBaseUrl,
      author: "Saleor Commerce",
      brand: {
        logo: {
          default: `${iframeBaseUrl}/logo.png`,
        },
      },
      dataPrivacyUrl: "https://saleor.io/legal/privacy/",
      extensions: [],
      homepageUrl: "https://github.com/saleor/apps",
      id: env.MANIFEST_APP_ID,
      name: env.APP_NAME,
      /*
       * Required permissions:
       * - MANAGE_PRODUCTS: Query products/variants, read prices/stock, update stock on receive
       * - MANAGE_ORDERS: Future: Link buylists to customer orders
       */
      permissions: ["MANAGE_PRODUCTS", "MANAGE_ORDERS"],
      requiredSaleorVersion: ">=3.21 <4",
      supportUrl: "https://saleor.io/discord",
      tokenTargetUrl: `${apiBaseUrl}/api/register`,
      version: packageJson.version,
      webhooks: [],
    };

    return manifest;
  },
});

export const GET = compose(withLoggerContext, withSpanAttributesAppRouter)(handler);
