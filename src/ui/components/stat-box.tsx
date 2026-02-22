import { Box, Text } from "@saleor/macaw-ui";

interface StatBoxProps {
  label: string;
  value: string;
  color?: string;
}

export const StatBox = ({ label, value, color }: StatBoxProps) => (
  <Box>
    <Text size={1} color="default2">
      {label}
    </Text>
    {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
    <Text size={4} fontWeight="bold" color={color as any}>
      {value}
    </Text>
  </Box>
);
