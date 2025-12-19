import { createEnv } from "@t3-oss/env-nextjs";
import { z } from "zod";
import { fromError } from "zod-validation-error";

import { BaseError } from "@/lib/errors";

const booleanSchema = z
  .string()
  .refine((s) => s === "true" || s === "false")
  .transform((s) => s === "true");

// Check if we're in a build environment (CI, Docker build, etc.)
const isBuilding = process.env.SKIP_ENV_VALIDATION === "true" ||
  process.env.CI === "true" ||
  process.env.DOCKER_BUILD === "true" ||
  // Next.js sets this during build
  process.env.NEXT_PHASE === "phase-production-build";

export const env = createEnv({
  client: {
    NEXT_PUBLIC_SENTRY_DSN: z.string().optional(),
  },
  server: {
    // Database - connects to inventory-ops database (shared)
    DATABASE_URL: isBuilding ? z.string().optional() : z.string().url(),

    // App configuration
    ALLOWED_DOMAIN_PATTERN: z.string().optional(),
    APL: z.enum(["saleor-cloud", "file"]).optional().default("file"),
    APP_API_BASE_URL: z.string().optional(),
    APP_IFRAME_BASE_URL: z.string().optional(),
    APP_LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace"]).default("info"),
    MANIFEST_APP_ID: z.string().optional().default("saleor.app.buylist"),
    APP_NAME: z.string().optional().default("Buylist"),

    // Security - optional during build
    SECRET_KEY: isBuilding ? z.string().optional() : z.string().min(32),

    // Observability
    OTEL_ACCESS_TOKEN: z.string().optional(),
    OTEL_ENABLED: booleanSchema.optional().default("false"),
    OTEL_SERVICE_NAME: z.string().optional().default("saleor-app-buylist"),

    // Server
    PORT: z.coerce.number().optional().default(3003),
    REPOSITORY_URL: z.string().optional(),

    // Vercel
    VERCEL_ENV: z.string().optional(),
    VERCEL_GIT_COMMIT_SHA: z.string().optional(),

    // Business logic defaults
    DEFAULT_CURRENCY: z.string().length(3).optional().default("USD"),
    DEFAULT_CHANNEL_SLUG: z.string().optional().default("webstore"),

    // Price providers
    SCRYFALL_API_BASE_URL: z.string().url().optional().default("https://api.scryfall.com"),
    SCRYFALL_RATE_LIMIT_MS: z.coerce.number().optional().default(100),
    TCGPLAYER_API_KEY: z.string().optional(),
    TCGPLAYER_API_SECRET: z.string().optional(),
    PRICE_PROVIDER: z.enum(["scryfall", "tcgplayer"]).optional().default("scryfall"),

    // Price sync job
    PRICE_SYNC_API_KEY: z.string().optional(),
  },
  shared: {
    NODE_ENV: z.enum(["development", "production", "test"]).optional().default("development"),
    ENV: z.enum(["local", "development", "staging", "production"]).optional().default("local"),
  },
  runtimeEnv: {
    // Database
    DATABASE_URL: process.env.DATABASE_URL,

    // App configuration
    ALLOWED_DOMAIN_PATTERN: process.env.ALLOWED_DOMAIN_PATTERN,
    APL: process.env.APL,
    APP_API_BASE_URL: process.env.APP_API_BASE_URL,
    APP_IFRAME_BASE_URL: process.env.APP_IFRAME_BASE_URL,
    APP_LOG_LEVEL: process.env.APP_LOG_LEVEL,
    MANIFEST_APP_ID: process.env.MANIFEST_APP_ID,
    APP_NAME: process.env.APP_NAME,

    // Security
    SECRET_KEY: process.env.SECRET_KEY,

    // Observability
    OTEL_ACCESS_TOKEN: process.env.OTEL_ACCESS_TOKEN,
    OTEL_ENABLED: process.env.OTEL_ENABLED,
    OTEL_SERVICE_NAME: process.env.OTEL_SERVICE_NAME,

    // Server
    PORT: process.env.PORT,
    REPOSITORY_URL: process.env.REPOSITORY_URL,

    // Vercel
    VERCEL_ENV: process.env.VERCEL_ENV,
    VERCEL_GIT_COMMIT_SHA: process.env.VERCEL_GIT_COMMIT_SHA,

    // Shared
    NODE_ENV: process.env.NODE_ENV,
    ENV: process.env.ENV,

    // Client
    NEXT_PUBLIC_SENTRY_DSN: process.env.NEXT_PUBLIC_SENTRY_DSN,

    // Business logic
    DEFAULT_CURRENCY: process.env.DEFAULT_CURRENCY,
    DEFAULT_CHANNEL_SLUG: process.env.DEFAULT_CHANNEL_SLUG,

    // Price providers
    SCRYFALL_API_BASE_URL: process.env.SCRYFALL_API_BASE_URL,
    SCRYFALL_RATE_LIMIT_MS: process.env.SCRYFALL_RATE_LIMIT_MS,
    TCGPLAYER_API_KEY: process.env.TCGPLAYER_API_KEY,
    TCGPLAYER_API_SECRET: process.env.TCGPLAYER_API_SECRET,
    PRICE_PROVIDER: process.env.PRICE_PROVIDER,

    // Price sync job
    PRICE_SYNC_API_KEY: process.env.PRICE_SYNC_API_KEY,
  },
  isServer: typeof window === "undefined" || process.env.NODE_ENV === "test",
  /*
   * Skip validation during Docker builds when SKIP_ENV_VALIDATION is set
   * This allows the Next.js build to complete without real env vars
   */
  skipValidation: process.env.SKIP_ENV_VALIDATION === "true",
  onValidationError(issues) {
    const validationError = fromError(issues);
    const EnvValidationError = BaseError.subclass("EnvValidationError");

    throw new EnvValidationError(validationError.toString(), {
      cause: issues,
    });
  },
});
