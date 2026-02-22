import { Box, Text } from "@saleor/macaw-ui";
import { ReactNode } from "react";

interface Column<T> {
  header: string;
  align?: "left" | "right" | "center";
  render: (row: T) => ReactNode;
}

interface DataTableProps<T> {
  columns: Column<T>[];
  data: T[];
  rowKey: (row: T) => string;
  onRowClick?: (row: T) => void;
  fontSize?: string;
}

export function DataTable<T>({
  columns,
  data,
  rowKey,
  onRowClick,
  fontSize,
}: DataTableProps<T>) {
  return (
    <Box as="table" width="100%" __fontSize={fontSize}>
      <Box as="thead">
        <Box as="tr">
          {columns.map((col) => (
            <Box
              as="th"
              key={col.header}
              padding={2}
              textAlign={col.align ?? "left"}
              borderBottomStyle="solid"
              borderBottomWidth={1}
              borderColor="default2"
            >
              <Text size={1} fontWeight="bold">
                {col.header}
              </Text>
            </Box>
          ))}
        </Box>
      </Box>
      <Box as="tbody">
        {data.map((row) => (
          <Box
            as="tr"
            key={rowKey(row)}
            cursor={onRowClick ? "pointer" : undefined}
            onClick={onRowClick ? () => onRowClick(row) : undefined}
            className="data-table-row"
          >
            {columns.map((col) => (
              <Box as="td" key={col.header} padding={2} textAlign={col.align ?? "left"}>
                {col.render(row)}
              </Box>
            ))}
          </Box>
        ))}
      </Box>
    </Box>
  );
}
