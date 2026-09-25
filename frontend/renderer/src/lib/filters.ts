interface DateRange {
  from: string;
  to: string;
}

export function matchesSearch(value: unknown, query: string): boolean {
  if (!query) return true;
  return String(value ?? "")
    .toLowerCase()
    .includes(query.toLowerCase());
}

// Compares only the date portion, so this works whether `value` is a bare
// date ("2026-08-21") or a full ISO timestamp ("2026-08-21T13:55:22").
export function inDateRange(value: unknown, range: DateRange): boolean {
  if (!range.from && !range.to) return true;
  if (value === null || value === undefined || value === "") return false;
  const date = String(value).slice(0, 10);
  if (range.from && date < range.from) return false;
  if (range.to && date > range.to) return false;
  return true;
}

export function distinctValues<T extends object>(
  rows: T[],
  key: keyof T,
): string[] {
  const values = new Set<string>();
  for (const row of rows) {
    const value = row[key];
    if (value !== null && value !== undefined && value !== "")
      values.add(String(value));
  }
  return Array.from(values).sort();
}
