import { Permission } from "@saleor/app-sdk/types";
import { REQUIRED_SALEOR_PERMISSIONS } from "@saleor/apps-shared/permissions";

export const REQUIRED_CLIENT_PERMISSIONS: Permission[] = [
  ...REQUIRED_SALEOR_PERMISSIONS,
  "MANAGE_PRODUCTS", // Required for stock operations and product queries
];
