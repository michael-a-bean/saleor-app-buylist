import { SemanticChip } from "@saleor/apps-ui";

const statusVariantMap: Record<string, "default" | "warning" | "error" | "success"> = {
  PENDING: "default",
  DRAFT: "warning",
  SUBMITTED: "warning",
  REVIEWING: "warning",
  APPROVED: "success",
  REJECTED: "error",
  COMPLETED: "success",
  CANCELLED: "default",
  PAID: "success",
};

interface StatusBadgeProps {
  status: string;
}

export const StatusBadge = ({ status }: StatusBadgeProps) => {
  const variant = statusVariantMap[status] ?? "default";
  return <SemanticChip variant={variant}>{status}</SemanticChip>;
};
