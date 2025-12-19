import type { IGraphQLConfig } from "graphql-config";

const config: IGraphQLConfig = {
  projects: {
    default: {
      schema: "graphql/schema.graphql",
      documents: ["graphql/**/*.graphql", "src/**/*.graphql"],
      extensions: {
        codegen: {
          generates: {
            "generated/graphql.ts": {
              plugins: [
                "typescript",
                "typescript-operations",
                "typed-document-node",
                "typescript-urql",
              ],
              config: {
                documentMode: "string",
                strictScalars: true,
                scalars: {
                  Date: "string",
                  DateTime: "string",
                  Decimal: "string",
                  GenericScalar: "unknown",
                  JSON: "unknown",
                  JSONString: "string",
                  Metadata: "Record<string, string>",
                  PositiveDecimal: "string",
                  UUID: "string",
                  WeightScalar: "number",
                },
              },
            },
          },
        },
      },
    },
  },
};

export default config;
