import { createAppRegisterHandler } from "@saleor/app-sdk/handlers/next-app-router";
import { withSpanAttributesAppRouter } from "@saleor/apps-otel/src/with-span-attributes";
import { compose } from "@saleor/apps-shared/compose";
import { NextRequest } from "next/server";

import { env } from "@/lib/env";
import { createLogger } from "@/lib/logger";
import { withLoggerContext } from "@/lib/logger-context";
import { normalizeSaleorApiUrl } from "@/lib/normalized-apl";
import { prisma } from "@/lib/prisma";
import { saleorApp } from "@/lib/saleor-app";

const logger = createLogger("createAppRegisterHandler");

const allowedUrlsPattern = env.ALLOWED_DOMAIN_PATTERN;

const handler = createAppRegisterHandler({
  apl: saleorApp.apl,
  allowedSaleorUrls: [
    (url) => {
      if (allowedUrlsPattern) {
        const regex = new RegExp(allowedUrlsPattern);
        const checkResult = regex.test(url);

        if (!checkResult) {
          logger.warn("Blocked installation attempt from disallowed Saleor instance", {
            saleorApiUrl: url,
          });
        }

        return checkResult;
      }

      return true;
    },
  ],
  onAplSetFailed: async (_req, context) => {
    logger.error("Failed to set APL", {
      saleorApiUrl: context.authData.saleorApiUrl,
      error: context.error,
    });
  },
  onAuthAplSaved: async (_req, context) => {
    logger.info("App installation registered successfully", {
      saleorApiUrl: context.authData.saleorApiUrl,
      appId: context.authData.appId,
    });

    /*
     * Create or update the app installation record in the shared database.
     * This uses the same AppInstallation table as inventory-ops.
     */
    try {
      await prisma.appInstallation.upsert({
        where: {
          saleorApiUrl_appId: {
            saleorApiUrl: context.authData.saleorApiUrl,
            appId: context.authData.appId,
          },
        },
        update: {
          // Update installedAt timestamp on re-installation
          installedAt: new Date(),
        },
        create: {
          saleorApiUrl: context.authData.saleorApiUrl,
          appId: context.authData.appId,
        },
      });

      logger.info("App installation record created/updated in database", {
        saleorApiUrl: context.authData.saleorApiUrl,
        appId: context.authData.appId,
      });
    } catch (error) {
      logger.error("Failed to create app installation record", {
        saleorApiUrl: context.authData.saleorApiUrl,
        appId: context.authData.appId,
        errorMessage: error instanceof Error ? error.message : String(error),
      });
      // Don't throw - APL is already saved, this is a secondary operation
    }
  },
});

/*
 * Middleware to normalize Saleor API URLs in request headers.
 * Uses the centralized normalization function to ensure consistent URL handling.
 */
const normalizeRequestUrl = (request: NextRequest): NextRequest => {
  const saleorApiUrl = request.headers.get("saleor-api-url");

  if (saleorApiUrl) {
    const normalizedUrl = normalizeSaleorApiUrl(saleorApiUrl);

    if (normalizedUrl !== saleorApiUrl) {
      logger.info("Normalizing saleor-api-url in request header", {
        originalUrl: saleorApiUrl,
        normalizedUrl,
      });

      // Create new headers with the normalized URL
      const newHeaders = new Headers(request.headers);

      newHeaders.set("saleor-api-url", normalizedUrl);

      return new NextRequest(request.url, {
        method: request.method,
        headers: newHeaders,
        body: request.body,
        duplex: "half",
      });
    }
  }

  return request;
};

const wrappedHandler = async (request: NextRequest) => {
  const modifiedRequest = normalizeRequestUrl(request);

  return handler(modifiedRequest);
};

export const POST = compose(withLoggerContext, withSpanAttributesAppRouter)(wrappedHandler);
