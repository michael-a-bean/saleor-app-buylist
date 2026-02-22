import { Box, Text } from "@saleor/macaw-ui";

interface ProgressBarProps {
  percent: number;
  height?: string;
  showLabel?: boolean;
  label?: string;
  sublabel?: string;
}

export const ProgressBar = ({
  percent,
  height = "8px",
  showLabel = false,
  label,
  sublabel,
}: ProgressBarProps) => {
  const clamped = Math.min(Math.max(percent, 0), 100);
  const color = clamped >= 100 ? "success1" : "info1";

  return (
    <Box>
      {showLabel && (
        <Box display="flex" justifyContent="space-between" marginBottom={1}>
          <Text size={1}>{label ?? "Progress"}</Text>
          <Box display="flex" gap={3}>
            {sublabel && (
              <Text size={1} color="default2">
                {sublabel}
              </Text>
            )}
            <Text size={1}>{clamped}%</Text>
          </Box>
        </Box>
      )}
      <Box
        __width="100%"
        __height={height}
        backgroundColor="default2"
        borderRadius={2}
        overflow="hidden"
      >
        <Box
          __width={`${clamped}%`}
          __height="100%"
          backgroundColor={color}
          __transition="width 0.3s ease"
        />
      </Box>
    </Box>
  );
};
