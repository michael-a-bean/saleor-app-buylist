import { cacheExchange, Client, fetchExchange } from "urql";

import { createLogger } from "./logger";

const logger = createLogger("graphql-client");

export interface GraphQLClientConfig {
  saleorApiUrl: string;
  token: string;
}

/**
 * Create a GraphQL client for Saleor API
 */
export function createGraphQLClient(config: GraphQLClientConfig): Client {
  return new Client({
    url: config.saleorApiUrl,
    exchanges: [cacheExchange, fetchExchange],
    fetchOptions: () => ({
      headers: {
        Authorization: `Bearer ${config.token}`,
        "Content-Type": "application/json",
      },
    }),
  });
}

/**
 * Create an instrumented GraphQL client with logging
 */
export function createInstrumentedGraphqlClient(config: GraphQLClientConfig): Client {
  logger.debug("Creating GraphQL client", { saleorApiUrl: config.saleorApiUrl });

  return createGraphQLClient(config);
}
