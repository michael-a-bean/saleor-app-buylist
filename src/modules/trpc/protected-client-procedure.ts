import { verifyJWT } from "@saleor/app-sdk/auth";
import { ObservabilityAttributes } from "@saleor/apps-otel/src/observability-attributes";
import { setTag } from "@sentry/nextjs";
import { TRPCError } from "@trpc/server";

import { createInstrumentedGraphqlClient } from "@/lib/graphql-client";
import { createLogger } from "@/lib/logger";
import { saleorApp } from "@/lib/saleor-app";

import { middleware, procedure } from "./trpc-server";

const logger = createLogger("protectedClientProcedure");

/**
 * Middleware: Attach app token from APL
 */
const attachAppToken = middleware(async ({ ctx, next }) => {
  if (!ctx.saleorApiUrl) {
    logger.debug("ctx.saleorApiUrl not found, throwing");

    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Missing saleorApiUrl in request",
    });
  }

  // APL normalizes URLs internally, but we also normalize here for logging consistency
  const authData = await saleorApp.apl.get(ctx.saleorApiUrl);

  if (!authData) {
    logger.debug("authData not found, throwing 401");

    throw new TRPCError({
      code: "UNAUTHORIZED",
      message: "Missing auth data",
    });
  }

  return next({
    ctx: {
      appToken: authData.token,
      saleorApiUrl: authData.saleorApiUrl,
      appId: authData.appId,
    },
  });
});

/**
 * Middleware: Attach GraphQL client
 */
const attachSharedServices = middleware(async ({ ctx, next }) => {
  // Token is validated in validateClientToken middleware above
  const gqlClient = createInstrumentedGraphqlClient({
    saleorApiUrl: ctx.saleorApiUrl!,
    token: ctx.token!,
  });

  return next({
    ctx: {
      apiClient: gqlClient,
    },
  });
});

/**
 * Middleware: Validate JWT token from frontend
 */
const validateClientToken = middleware(async ({ ctx, next, meta }) => {
  logger.debug("Calling validateClientToken middleware with permissions required", {
    permissions: meta?.requiredClientPermissions,
  });

  if (!ctx.token) {
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Missing token in request. This middleware can be used only in frontend",
    });
  }

  if (!ctx.appId) {
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Missing appId in request. This middleware can be used after auth is attached",
    });
  }

  if (!ctx.saleorApiUrl) {
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message:
        "Missing saleorApiUrl in request. This middleware can be used after auth is attached",
    });
  }

  setTag(ObservabilityAttributes.SALEOR_API_URL, ctx.saleorApiUrl);

  try {
    logger.debug("trying to verify JWT token from frontend", {
      token: ctx.token ? `${ctx.token[0]}...` : undefined,
    });

    await verifyJWT({
      appId: ctx.appId,
      token: ctx.token,
      saleorApiUrl: ctx.saleorApiUrl,
      requiredPermissions: meta?.requiredClientPermissions,
    });
  } catch {
    logger.debug("JWT verification failed, throwing");
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "JWT verification failed",
    });
  }

  return next({
    ctx: {
      saleorApiUrl: ctx.saleorApiUrl,
    },
  });
});

/**
 * Middleware: Attach installation context
 * Resolves the AppInstallation from the database
 */
const attachInstallationContext = middleware(async ({ ctx, next }) => {
  if (!ctx.saleorApiUrl || !ctx.appId) {
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Missing saleorApiUrl or appId",
    });
  }

  const installation = await ctx.prisma.appInstallation.findUnique({
    where: {
      saleorApiUrl_appId: {
        saleorApiUrl: ctx.saleorApiUrl,
        appId: ctx.appId,
      },
    },
  });

  if (!installation) {
    throw new TRPCError({
      code: "NOT_FOUND",
      message: "App installation not found. Please reinstall the app.",
    });
  }

  return next({
    ctx: {
      installation,
      installationId: installation.id,
    },
  });
});

/**
 * Protected procedure for frontend calls
 * Validates JWT, attaches GraphQL client and installation context
 */
export const protectedClientProcedure = procedure
  .use(attachAppToken)
  .use(validateClientToken)
  .use(attachSharedServices)
  .use(attachInstallationContext);
