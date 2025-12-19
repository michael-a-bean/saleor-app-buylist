import "@saleor/macaw-ui/style";

import { AppBridge, AppBridgeProvider } from "@saleor/app-sdk/app-bridge";
import { RoutePropagator } from "@saleor/app-sdk/app-bridge/next";
import { GraphQLProvider } from "@saleor/apps-shared/graphql-provider";
import { IframeProtectedFallback } from "@saleor/apps-shared/iframe-protected-fallback";
import { IframeProtectedWrapper } from "@saleor/apps-shared/iframe-protected-wrapper";
import { NoSSRWrapper } from "@saleor/apps-shared/no-ssr-wrapper";
import { ThemeSynchronizer } from "@saleor/apps-shared/theme-synchronizer";
import { Box, ThemeProvider } from "@saleor/macaw-ui";
import { AppProps } from "next/app";

import { trpcClient } from "@/modules/trpc/trpc-client";
import { AppLayout } from "@/ui/components/app-layout";

/**
 * Ensure instance is a singleton.
 * TODO: This is React 18 issue, consider hiding this workaround inside app-sdk
 */
export const appBridgeInstance = typeof window !== "undefined" ? new AppBridge() : undefined;

function NextApp({ Component, pageProps }: AppProps) {
  return (
    <NoSSRWrapper>
      <ThemeProvider>
        <IframeProtectedWrapper
          allowedPathNames={[
            "/",
            // FOH routes
            "/buylists",
            "/buylists/new",
            "/buylists/[id]",
            "/buylists/[id]/grading",
            "/buylists/[id]/quote",
            "/buylists/[id]/payout",
            // BOH routes
            "/boh/queue",
            "/boh/buylists/[id]/review",
            "/boh/buylists/[id]/receive",
            // Pricing routes
            "/pricing/policies",
            "/pricing/history",
          ]}
          fallback={<IframeProtectedFallback appName="Buylist" />}
        >
          <AppBridgeProvider appBridgeInstance={appBridgeInstance}>
            <GraphQLProvider>
              <ThemeSynchronizer />
              <RoutePropagator />
              <Box padding={6}>
                <AppLayout>
                  <Component {...pageProps} />
                </AppLayout>
              </Box>
            </GraphQLProvider>
          </AppBridgeProvider>
        </IframeProtectedWrapper>
      </ThemeProvider>
    </NoSSRWrapper>
  );
}

export default trpcClient.withTRPC(NextApp);
