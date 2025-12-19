import { vi } from "vitest";

// Mock environment variables for tests
vi.mock("@/lib/env", () => ({
  env: {
    NODE_ENV: "test",
    DATABASE_URL: "postgresql://test:test@localhost:5432/test",
    SECRET_KEY: "test-secret-key-that-is-at-least-32-chars",
    APP_IFRAME_BASE_URL: "http://localhost:3003",
    APP_API_BASE_URL: "http://localhost:3003",
    DEFAULT_CURRENCY: "USD",
    DEFAULT_CHANNEL_SLUG: "webstore",
    SCRYFALL_API_BASE_URL: "https://api.scryfall.com",
    SCRYFALL_RATE_LIMIT_MS: 100,
  },
}));
