import { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  reactStrictMode: true,
  transpilePackages: [
    "@saleor/apps-logger",
    "@saleor/apps-otel",
    "@saleor/apps-shared",
    "@saleor/apps-trpc",
  ],
  experimental: {
    optimizePackageImports: ["@sentry/nextjs", "@sentry/node"],
  },
  bundlePagesRouterDependencies: true,
  webpack: (config, { isServer }) => {
    if (isServer) {
      config.ignoreWarnings = [{ module: /require-in-the-middle/ }];
    }
    return config;
  },
};

export default nextConfig;
