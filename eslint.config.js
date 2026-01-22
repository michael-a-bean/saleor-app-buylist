import { config } from "@saleor/eslint-config-apps/index.js";
import nodePlugin from "eslint-plugin-n";

/** @type {import("eslint").Linter.Config} */
export default [
  ...config,
  {
    name: "saleor-app-buylist/custom-config",
    files: ["**/*.ts", "**/*.tsx"],
    plugins: {
      n: nodePlugin,
    },
    rules: {
      "n/no-process-env": "error",
      "padding-line-between-statements": "off",
    },
  },
  {
    name: "saleor-app-buylist/override-no-process-env",
    files: [
      "next.config.ts",
      "src/lib/env.ts",
      "src/__tests__/**/*setup.*.ts",
    ],
    rules: {
      "n/no-process-env": "off",
      "turbo/no-undeclared-env-vars": "off",
    },
  },
  {
    name: "saleor-app-buylist/override-turbo-env-requirement",
    files: ["src/__tests__/**", "*.test.ts"],
    rules: {
      "turbo/no-undeclared-env-vars": "off",
    },
  },
  {
    name: "saleor-app-buylist/allow-console-in-tests",
    files: ["src/__tests__/**", "*.test.ts"],
    rules: {
      "no-console": "off",
    },
  },
  {
    name: "saleor-app-buylist/relaxed-test-rules",
    files: ["**/*.test.ts", "**/*.test.tsx"],
    rules: {
      "@typescript-eslint/no-unused-vars": "warn",
      "vitest/prefer-strict-equal": "warn",
    },
  },
  {
    name: "saleor-app-buylist/relaxed-rules",
    files: ["**/*.ts", "**/*.tsx"],
    rules: {
      "@saleor/saleor-app/logger-leak": "warn",
      "@typescript-eslint/max-params": "off",
      "react-naming-convention/filename": "off",
      "react/prop-types": "off",
    },
  },
  {
    name: "saleor-app-buylist/ignore-graphql-schema",
    ignores: ["graphql/**/*.graphql"],
  },
  {
    name: "saleor-app-buylist/allow-default-export",
    files: ["src/ui/components/**/*.tsx"],
    rules: {
      "import/no-default-export": "off",
    },
  },
];
