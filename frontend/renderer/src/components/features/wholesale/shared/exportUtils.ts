/**
 * Cross-platform CSV Export Utility for BranchWise Wholesale
 *
 * Prepends UTF-8 Byte Order Mark (\uFEFF) so that Microsoft Excel on Windows
 * and Apple Numbers / Excel on macOS recognize Unicode characters and text correctly
 * without encoding glitches.
 */

export interface CsvColumn<T> {
  header: string;
  accessor: (item: T) => string | number | null | undefined;
}

function escapeCsvField(value: unknown): string {
  if (value === null || value === undefined) return "";
  const str = String(value);
  // If the field contains comma, quote, or newline, wrap it in double quotes and escape internal quotes
  if (
    str.includes(",") ||
    str.includes('"') ||
    str.includes("\n") ||
    str.includes("\r")
  ) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

export function exportToCsv<T>({
  filename,
  columns,
  data,
}: {
  filename: string;
  columns: CsvColumn<T>[];
  data: T[];
}): void {
  const headerRow = columns.map((col) => escapeCsvField(col.header)).join(",");
  const dataRows = data.map((item) =>
    columns.map((col) => escapeCsvField(col.accessor(item))).join(","),
  );

  // Prepend \uFEFF for Windows Excel UTF-8 compatibility
  const csvContent = "\uFEFF" + [headerRow, ...dataRows].join("\r\n");

  const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);

  const link = document.createElement("a");
  link.href = url;
  link.setAttribute(
    "download",
    filename.endsWith(".csv") ? filename : `${filename}.csv`,
  );
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}
