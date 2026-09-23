import { useEffect, useMemo, useState } from "react";
import type { Session } from "@renderer/lib/auth";
import { apiBaseUrl } from "@renderer/lib/auth";
import { useUrlQuery } from "@renderer/lib/queryClient";
import { cn } from "@renderer/lib/utils";
import {
  formatRetailDate,
  formatRetailDateTime,
} from "@renderer/lib/retailDateTime";
import { useImportFilePicker } from "@renderer/lib/useImportFilePicker";
import { useStickyAbove } from "@renderer/lib/useStickyAbove";
import { Button } from "@renderer/components/ui/Button";
import { RefreshButton } from "@renderer/components/ui/RefreshButton";
import { Badge, type BadgeVariant } from "@renderer/components/ui/Badge";
import { CardHeader } from "@renderer/components/ui/Card";
import { EmptyState } from "@renderer/components/ui/EmptyState";
import { Input } from "@renderer/components/ui/Input";
import { Select } from "@renderer/components/ui/Select";
import { TabBar } from "@renderer/components/ui/Tabs";
import { TableSkeleton } from "@renderer/components/ui/Skeleton";
import {
  TableContainer,
  Thead,
  Tbody,
  Tr,
  Th,
  Td,
} from "@renderer/components/ui/Table";
import { downloadCsv } from "@renderer/lib/csv";
import { downloadExcel } from "@renderer/lib/excel";
import {
  WarningIcon,
  ChevronDownIcon,
  ChevronUpIcon,
  SearchIcon,
  DownloadIcon,
} from "@renderer/components/ui/icons";
import type {
  PendingImport,
  Profile,
} from "@renderer/components/features/types";

interface WarningField {
  label: string;
  value: string;
}

interface SourceImport {
  id: string;
  filename: string | null;
  date: string;
}

interface WarningRow {
  note: string;
  fields: WarningField[];
  // Labels of the field(s) that are actually the problem — e.g. ["Qty"] for a zero-qty
  // sale line. Empty when nothing single field is "the" issue (a missing inventory
  // record is an absence, not a bad value).
  highlight: string[];
  // Which confirmed import this bad value came from, if any. Null for checks that can
  // span several imports (nothing single to point at).
  source_import: SourceImport | null;
}

interface WarningSection {
  id: string;
  title: string;
  description: string;
  severity: "warning" | "critical";
  rows: WarningRow[];
}

interface Props {
  session: Session;
  profile: Profile | null;
  onCountChange?: (count: number) => void;
  saleWindowDays: number;
  purchaseWindowDays: number;
  // The left-nav branch switcher's current choice, resolved to a branch name ("" = All
  // branches — App.tsx does this mapping since this page's rows carry a branch name, not
  // an id). This page's own branch filter dropdown was removed in favour of that one
  // control (see AppShell).
  branchFilter: string;
  onViewImportBatch?: (batchId: string) => void;
  // Hands off a picked-and-parsed file to the app-level confirm flow — used by every
  // "Reimport to fix" button below.
  onFileReady?: (pending: PendingImport) => void;
}

type ImportType = "sales" | "inventory" | "purchase";

const IMPORT_TYPE_ENDPOINT: Record<ImportType, string> = {
  sales: "/api/imports/sales",
  purchase: "/api/imports/purchase",
  inventory: "/api/imports/inventory",
};

const IMPORT_TYPE_LABEL: Record<ImportType, string> = {
  sales: "Sales",
  purchase: "Purchase",
  inventory: "Inventory",
};

type Category = "Inventory" | "Sale" | "Purchase";

// Order used by the "All" tab — inventory surfaces first ahead of transaction checks.
const ALL_TAB_ORDER: Category[] = ["Inventory", "Sale", "Purchase"];

type Tab = "All" | Category;
const TAB_ORDER: Tab[] = ["All", "Inventory", "Sale", "Purchase"];

// Which broad area each backend check belongs under — purely a display grouping. The
// backend still returns one row per check (each has its own detail fields), but every
// check's row now boils down to the same shape once you pull out Branch/Stock
// Code/Description: an identity, plus a short action.
const SECTION_CATEGORY: Record<string, Category> = {
  sale_numeric: "Sale",
  missing_product: "Inventory",
  inventory_numeric: "Inventory",
  purchase_numeric: "Purchase",
  reconciliation_uom: "Inventory",
  reconciliation_mismatch: "Inventory",
};

// Every category's rows are grouped by which import produced them (see buildBatchGroups)
// so each group's "Reimport to fix" button can revert that one batch and replace it with
// a corrected file in one action — the only fix path, for every category:
// - Sale/Purchase: the bad value lives inside the uploaded file itself, so a corrected
//   re-import only takes effect once that exact batch is removed first (re-confirming
//   otherwise skips already-imported slips as duplicates for Sale, or double-counts for
//   Purchase).
// - Inventory: `stock_levels` is append-only, so a bad snapshot doesn't strictly need
//   removing — "current stock" is always just the latest one. But the daily
//   reconciliation check compares the latest snapshot against the one right before it,
//   so a bad value can still get used as "the prior count" for one more comparison even
//   after being superseded by a newer, correct snapshot. Reimport-ing the specific bad
//   batch (instead of just adding a new one alongside it) avoids that by removing it
//   from history outright — simpler for staff than having to reason about which fix
//   applies to which category.

// Which upload endpoint a category's Reimport buttons parse against.
const CATEGORY_IMPORT_TYPE: Record<Category, ImportType> = {
  Sale: "sales",
  Purchase: "purchase",
  Inventory: "inventory",
};

const RETAIL_REMOVE_WINDOW_MS = 24 * 60 * 60 * 1000;

function isRemoveLocked(dateIso: string, profile: Profile | null): boolean {
  return (
    profile?.role === "retail" &&
    Date.now() - new Date(dateIso).getTime() > RETAIL_REMOVE_WINDOW_MS
  );
}

// Every check names its date field a little differently depending on which real list
// page it mirrors (Sale/Purchase call it "Date", Inventory calls it "Last Updated",
// a missing-product row only has a "Last Date" it was seen on, and daily reconciliation
// rows have an "Until" date) — try them in order so the main table can show one "Date"
// column regardless of which check a row is from.
const DATE_LABELS = ["Date", "Last Updated", "Last Date", "Until"];

function fieldValue(fields: WarningField[], label: string): string {
  return fields.find((f) => f.label === label)?.value ?? "—";
}

function filterSections(
  sections: WarningSection[] | null,
  branch: string,
  severity: string,
  search: string,
): WarningSection[] | null {
  if (!sections) return sections;
  const q = search.trim().toLowerCase();

  return sections.map((section) => {
    if (severity && section.severity !== severity) {
      return { ...section, rows: [] };
    }

    const filteredRows = section.rows.filter((row) => {
      if (branch && fieldValue(row.fields, "Branch") !== branch) {
        return false;
      }
      if (q) {
        const stockCode = fieldValue(row.fields, "Stock Code").toLowerCase();
        const desc = fieldValue(row.fields, "Description").toLowerCase();
        const rowBranch = fieldValue(row.fields, "Branch").toLowerCase();
        const note = row.note.toLowerCase();
        if (
          !stockCode.includes(q) &&
          !desc.includes(q) &&
          !rowBranch.includes(q) &&
          !note.includes(q)
        ) {
          return false;
        }
      }
      return true;
    });

    return { ...section, rows: filteredRows };
  });
}

function dateFieldLabel(fields: WarningField[]): string | undefined {
  return DATE_LABELS.find((label) => fields.some((f) => f.label === label));
}

interface FlatRow {
  key: string;
  severity: "warning" | "critical";
  sectionId?: string;
  row: WarningRow;
}

// Critical first, so the thing most worth acting on is always at the top.
// If same severity, newest date first, then by stock code.
function bySeverity(a: FlatRow, b: FlatRow): number {
  if (a.severity !== b.severity) {
    return a.severity === "critical" ? -1 : 1;
  }
  const dateLabelA = dateFieldLabel(a.row.fields);
  const dateLabelB = dateFieldLabel(b.row.fields);
  const dateA = dateLabelA ? fieldValue(a.row.fields, dateLabelA) : "";
  const dateB = dateLabelB ? fieldValue(b.row.fields, dateLabelB) : "";
  if (dateA && dateB && dateA !== "—" && dateB !== "—") {
    const comp = dateB.localeCompare(dateA);
    if (comp !== 0) return comp;
  }
  const codeA = fieldValue(a.row.fields, "Stock Code");
  const codeB = fieldValue(b.row.fields, "Stock Code");
  return codeA.localeCompare(codeB);
}

function formatDateLabel(iso: string): string {
  if (iso === "—") return iso;
  return formatRetailDate(iso);
}

// A reconciliation mismatch row always has these fields (see
// inventory_reconciliation_warnings) — used to pick DailyCheckDetails over the generic
// label/value grid, since only mismatch rows tell this particular story.
function isReconciliationMismatch(row: WarningRow): boolean {
  return row.fields.some((f) => f.label === "Expected Qty");
}

function DailyCheckDetailsCard({
  row,
  onViewImportBatch,
}: {
  row: WarningRow;
  onViewImportBatch?: (batchId: string) => void;
}): React.JSX.Element {
  const since = formatDateLabel(fieldValue(row.fields, "Since"));
  const until = formatDateLabel(fieldValue(row.fields, "Until"));
  const priorQty = fieldValue(row.fields, "Prior Qty");
  const sold = fieldValue(row.fields, "Sold");
  const purchased = fieldValue(row.fields, "Purchased");
  const expected = fieldValue(row.fields, "Expected Qty");
  const actual = fieldValue(row.fields, "Actual Qty");
  const difference = fieldValue(row.fields, "Difference");
  const diffNum = Number(difference);

  return (
    <div className="p-3 bg-bg-subtle/40">
      <div className="bg-bg-base border border-border rounded-lg p-3.5 space-y-2.5">
        {/* Simple Plain-English Explanation */}
        <div className="flex items-start gap-2 text-xs">
          <span className="text-sm">💡</span>
          <div className="text-text-primary leading-relaxed">
            <span className="font-semibold">{row.note}</span>
          </div>
        </div>

        {/* Intuitive Step-by-Step Numbers */}
        <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-border text-xs text-text-primary">
          <div className="px-2.5 py-1.5 rounded-md bg-bg-subtle border border-border/70">
            <span className="font-medium">Start ({since}): </span>
            <span className="font-bold font-mono">{priorQty}</span>
          </div>
          <span className="font-bold">+</span>
          <div className="px-2.5 py-1.5 rounded-md bg-bg-subtle border border-border/70">
            <span className="font-medium">Bought: </span>
            <span className="font-bold font-mono">{purchased}</span>
          </div>
          <span className="font-bold">−</span>
          <div className="px-2.5 py-1.5 rounded-md bg-bg-subtle border border-border/70">
            <span className="font-medium">Sold: </span>
            <span className="font-bold font-mono">{sold}</span>
          </div>
          <span className="font-bold">=</span>
          <div className="px-2.5 py-1.5 rounded-md bg-bg-subtle border border-border/70">
            <span className="font-medium">Should be: </span>
            <span className="font-bold font-mono">{expected}</span>
          </div>
          <span className="font-semibold">vs</span>
          <div className="px-2.5 py-1.5 rounded-md bg-bg-subtle border border-border/70">
            <span className="font-medium">Counted ({until}): </span>
            <span className="font-bold font-mono">{actual}</span>
          </div>
          <div className="ml-auto px-2.5 py-1.5 rounded-md font-semibold text-xs font-mono bg-warning-subtle text-warning border border-warning/30">
            Difference: {diffNum > 0 ? `+${difference}` : difference}
          </div>
        </div>

        {/* Source file reference link */}
        {row.source_import && (
          <div className="pt-1.5 text-xs text-text-muted flex items-center justify-between border-t border-border/50">
            <span>
              Source file:{" "}
              <span className="font-medium text-text-secondary">
                {row.source_import.filename ?? "Imported file"}
              </span>
            </span>
            <button
              type="button"
              onClick={() => onViewImportBatch?.(row.source_import!.id)}
              className="text-brand hover:text-brand-hover underline underline-offset-2 font-medium"
            >
              View imported file →
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function GenericWarningDetailsCard({
  row,
  showSourceImportLink,
  onViewImportBatch,
}: {
  row: WarningRow;
  showSourceImportLink: boolean;
  onViewImportBatch?: (batchId: string) => void;
}): React.JSX.Element {
  return (
    <div className="p-3 bg-bg-subtle/40">
      <div className="bg-bg-base border border-border rounded-lg p-3.5 space-y-2.5">
        {/* Simple Plain-English Explanation */}
        <div className="flex items-start gap-2 text-xs">
          <span className="text-sm">💡</span>
          <div className="text-text-primary leading-relaxed">
            <span className="font-semibold">{row.note}</span>
          </div>
        </div>

        {/* Quick Problem Highlight */}
        {row.highlight.length > 0 && (
          <div className="flex flex-wrap items-center gap-2.5 pt-2 border-t border-border text-xs">
            {row.highlight.map((h) => {
              const val = fieldValue(row.fields, h);
              return (
                <div
                  key={h}
                  className="px-2.5 py-1 rounded-md bg-bg-subtle border border-border/70 text-text-primary font-medium"
                >
                  <span className="text-text-muted">{h}: </span>
                  <span className="font-mono font-bold text-error">{val}</span>
                </div>
              );
            })}
          </div>
        )}

        {/* Source file reference link */}
        {showSourceImportLink && row.source_import && (
          <div className="pt-1.5 text-xs text-text-muted flex items-center justify-between border-t border-border/50">
            <span>
              Source file:{" "}
              <span className="font-medium text-text-secondary">
                {row.source_import.filename ?? "Imported file"}
              </span>
            </span>
            <button
              type="button"
              onClick={() => onViewImportBatch?.(row.source_import!.id)}
              className="text-brand hover:text-brand-hover underline underline-offset-2 font-medium"
            >
              View imported file →
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

const ISSUE_TEXT_COLOR: Record<BadgeVariant, string> = {
  error: "text-error",
  warning: "text-warning",
  info: "text-brand",
  brand: "text-brand",
  success: "text-success",
  default: "text-text-primary",
};

function parseWarningIssue(
  row: WarningRow,
  sectionId?: string,
  severity?: "warning" | "critical",
): {
  type: string;
  typeBadgeVariant: BadgeVariant;
  summary: React.JSX.Element;
} {
  const isMismatch = isReconciliationMismatch(row);
  if (isMismatch) {
    const expected = fieldValue(row.fields, "Expected Qty");
    const actual = fieldValue(row.fields, "Actual Qty");
    const diff = fieldValue(row.fields, "Difference");
    const diffNum = Number(diff);
    const diffFormatted = isNaN(diffNum)
      ? diff
      : diffNum > 0
        ? `+${diffNum}`
        : `${diffNum}`;

    return {
      type: "Stock Mismatch",
      typeBadgeVariant: severity === "critical" ? "error" : "warning",
      summary: (
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-text-muted text-xs">
            Exp:{" "}
            <span className="font-mono text-text-primary font-medium">
              {expected}
            </span>{" "}
            → Act:{" "}
            <span className="font-mono text-text-primary font-medium">
              {actual}
            </span>
          </span>
          <span
            className={cn(
              "font-mono font-semibold text-xs",
              diffNum < 0 ? "text-error" : "text-warning",
            )}
          >
            Diff: {diffFormatted}
          </span>
        </div>
      ),
    };
  }

  // Missing product check
  const timesSold = fieldValue(row.fields, "Times Sold");
  const timesPurchased = fieldValue(row.fields, "Times Purchased");
  if (
    timesSold !== "—" ||
    timesPurchased !== "—" ||
    sectionId === "missing_product" ||
    row.note.includes("no inventory record")
  ) {
    let activityText = "";
    if (timesSold !== "—" && timesPurchased !== "—") {
      activityText = `Sold ${timesSold}x, Bought ${timesPurchased}x`;
    } else if (timesSold !== "—") {
      activityText = `Sold ${timesSold} time${timesSold === "1" ? "" : "s"}`;
    } else if (timesPurchased !== "—") {
      activityText = `Purchased ${timesPurchased} time${timesPurchased === "1" ? "" : "s"}`;
    } else {
      activityText = "Unregistered Item";
    }

    return {
      type: "Missing in Inventory",
      typeBadgeVariant: "warning",
      summary: (
        <div className="flex items-center gap-1.5 text-xs">
          <span className="text-text-secondary font-medium">
            {activityText}
          </span>
          <span className="text-text-muted font-normal">(no stock record)</span>
        </div>
      ),
    };
  }

  // Unit mix
  const unitsSeen = fieldValue(row.fields, "Units Seen");
  if (unitsSeen !== "—" || sectionId === "reconciliation_uom") {
    return {
      type: "Multi-UOM",
      typeBadgeVariant: "info",
      summary: (
        <div className="text-xs text-text-secondary">
          Mixed units:{" "}
          <span className="font-mono font-medium text-text-primary">
            {unitsSeen}
          </span>
        </div>
      ),
    };
  }

  // Numeric issues
  if (row.highlight && row.highlight.length > 0) {
    const highlights = row.highlight;
    let type = "Invalid Value";
    if (
      highlights.some(
        (h) =>
          h.toLowerCase().includes("qty") ||
          h.toLowerCase().includes("quantity"),
      )
    ) {
      type = "Invalid Qty";
    } else if (highlights.some((h) => h.toLowerCase().includes("price"))) {
      type = "Invalid Price";
    } else if (highlights.some((h) => h.toLowerCase().includes("amount"))) {
      type = "Invalid Amount";
    }

    return {
      type,
      typeBadgeVariant: severity === "critical" ? "error" : "warning",
      summary: (
        <div className="flex items-center gap-2 flex-wrap text-xs">
          {highlights.map((h) => {
            const val = fieldValue(row.fields, h);
            return (
              <span key={h} className="inline-flex items-center gap-1">
                <span className="text-text-muted">{h}:</span>
                <span className="text-error font-mono font-semibold">
                  {val}
                </span>
              </span>
            );
          })}
        </div>
      ),
    };
  }

  // Fallback
  return {
    type: "Warning",
    typeBadgeVariant: severity === "critical" ? "error" : "warning",
    summary: <span className="text-xs text-text-secondary">{row.note}</span>,
  };
}

function WarningRowItem({
  item,
  index,
  showSourceImportLink,
  onViewImportBatch,
}: {
  item: FlatRow;
  index: number;
  showSourceImportLink: boolean;
  onViewImportBatch?: (batchId: string) => void;
}): React.JSX.Element {
  const [expanded, setExpanded] = useState(false);
  const { row, severity, sectionId } = item;
  const isMismatch = isReconciliationMismatch(row);
  const issue = parseWarningIssue(row, sectionId, severity);
  const columnCount = 8;

  return (
    <>
      <Tr>
        <Td className="w-10 sm:w-12 text-center text-xs font-mono text-text-muted tabular-nums select-none">
          {index + 1}
        </Td>
        <Td>
          <Badge variant={severity === "critical" ? "error" : "warning"} dot>
            {severity === "critical" ? "Critical" : "Warning"}
          </Badge>
        </Td>
        <Td className="whitespace-nowrap">
          {fieldValue(row.fields, "Branch")}
        </Td>
        <Td className="font-mono text-xs whitespace-nowrap">
          {fieldValue(row.fields, "Stock Code")}
        </Td>
        <Td>{fieldValue(row.fields, "Description")}</Td>
        <Td className="whitespace-nowrap text-xs font-semibold">
          <span
            className={
              ISSUE_TEXT_COLOR[issue.typeBadgeVariant] ?? "text-text-primary"
            }
          >
            {issue.type}
          </span>
        </Td>
        <Td title={row.note}>{issue.summary}</Td>
        <Td>
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            className="inline-flex items-center gap-1 text-xs text-brand hover:text-brand-hover font-medium"
          >
            Details
            {expanded ? (
              <ChevronUpIcon className="w-3 h-3" />
            ) : (
              <ChevronDownIcon className="w-3 h-3" />
            )}
          </button>
        </Td>
      </Tr>
      {expanded && (
        <Tr>
          <Td colSpan={columnCount} className="p-0 border-b border-border">
            {isMismatch ? (
              <DailyCheckDetailsCard
                row={row}
                onViewImportBatch={onViewImportBatch}
              />
            ) : (
              <GenericWarningDetailsCard
                row={row}
                showSourceImportLink={showSourceImportLink}
                onViewImportBatch={onViewImportBatch}
              />
            )}
          </Td>
        </Tr>
      )}
    </>
  );
}

interface BatchGroup {
  key: string;
  sourceImport: SourceImport | null;
  items: FlatRow[];
}

// Buckets a category's rows by which import produced them, so reimporting one bad file
// clears a whole cluster of warnings in one action instead of hunting through a flat
// list. Rows with no source_import — missing-product checks always lack one (they can
// span several imports, so there's no single batch to point at), and it's theoretically
// possible but rare for a Sale/Purchase/Inventory row too, since import_batch_id is
// nullable — fall into a trailing "not linked to an import" bucket with no action.
function buildBatchGroups(items: FlatRow[]): BatchGroup[] {
  const groups = new Map<string, BatchGroup>();
  for (const item of items) {
    const key = item.row.source_import?.id ?? "no-batch";
    const existing = groups.get(key);
    if (existing) {
      existing.items.push(item);
    } else {
      groups.set(key, {
        key,
        sourceImport: item.row.source_import,
        items: [item],
      });
    }
  }
  return Array.from(groups.values()).sort((a, b) => {
    // Batches with Critical warnings come first
    const aHasCrit = a.items.some((i) => i.severity === "critical") ? 0 : 1;
    const bHasCrit = b.items.some((i) => i.severity === "critical") ? 0 : 1;
    if (aHasCrit !== bHasCrit) return aHasCrit - bHasCrit;

    if (a.key === "no-batch") return 1;
    if (b.key === "no-batch") return -1;
    return (b.sourceImport?.date ?? "").localeCompare(
      a.sourceImport?.date ?? "",
    );
  });
}

// A full-width table row rather than a bordered card — group boundaries read as a
// divider within the same table (like a spreadsheet sub-total row) instead of nested
// boxes.
function BatchGroupHeaderRow({
  group,
  columnCount,
  profile,
  disabled,
  category,
  onImportToFix,
}: {
  group: BatchGroup;
  columnCount: number;
  profile: Profile | null;
  disabled?: boolean;
  category?: Category;
  onImportToFix?: (batchId: string, filename: string | null) => void;
}): React.JSX.Element {
  const meta = group.sourceImport;
  const locked = meta ? isRemoveLocked(meta.date, profile) : false;
  const canReimport = category === "Sale" || category === "Purchase";

  return (
    <tr>
      <td
        colSpan={columnCount}
        className="bg-brand-subtle px-4 py-2 border-b border-border"
      >
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2 text-sm">
            <span className="font-medium text-text-primary">
              {meta?.filename ?? "Missing stock code from Inventory"}
            </span>
            <Badge>{group.items.length}</Badge>
            {meta && (
              <span className="text-xs font-normal text-text-muted">
                imported {formatRetailDateTime(meta.date)}
              </span>
            )}
          </div>
          {meta && canReimport && (
            <Button
              variant="primary"
              size="sm"
              disabled={locked || disabled}
              title={
                locked
                  ? "Retail accounts can only remove an import within 1 day of importing it."
                  : undefined
              }
              onClick={() => onImportToFix?.(meta.id, meta.filename)}
            >
              Reimport to fix
            </Button>
          )}
        </div>
      </td>
    </tr>
  );
}

function WarningCategoryCard({
  category,
  sections,
  showTitle,
  profile,
  disabled,
  onViewImportBatch,
  onImportToFix,
}: {
  category: Category;
  sections: WarningSection[];
  showTitle: boolean;
  profile: Profile | null;
  disabled?: boolean;
  onViewImportBatch?: (batchId: string) => void;
  // Called from a batch group's "Reimport to fix" button, with that batch's id/filename.
  onImportToFix?: (
    importType: ImportType,
    batchId: string,
    filename: string | null,
  ) => void;
}): React.JSX.Element {
  const importType = CATEGORY_IMPORT_TYPE[category];
  const items: FlatRow[] = sections.flatMap((section) =>
    section.rows.map((row, i) => ({
      key: `${section.id}:${i}`,
      severity: section.severity,
      sectionId: section.id,
      row,
    })),
  );

  const columnCount = 8;
  const titleBar = showTitle ? (
    <h3 className="flex items-center gap-2 text-sm font-semibold text-text-primary">
      {category}
      <Badge>{items.length}</Badge>
    </h3>
  ) : null;

  return (
    <div className="flex flex-col gap-3">
      {titleBar}
      <TableContainer>
        <Thead>
          <Tr>
            <Th className="w-10 sm:w-12 text-center text-text-muted font-normal select-none">
              #
            </Th>
            <Th>Severity</Th>
            <Th>Branch</Th>
            <Th>Stock Code</Th>
            <Th>Description</Th>
            <Th>Issue</Th>
            <Th>Discrepancy / Details</Th>
            <Th />
          </Tr>
        </Thead>
        <Tbody>
          {category === "Sale" || category === "Purchase"
            ? (() => {
                let globalIdx = 0;
                return buildBatchGroups(items).flatMap((group) => {
                  const sortedGroupItems = [...group.items].sort(bySeverity);
                  const header = (
                    <BatchGroupHeaderRow
                      key={`group:${group.key}`}
                      group={group}
                      columnCount={columnCount}
                      profile={profile}
                      disabled={disabled}
                      category={category}
                      onImportToFix={(batchId, filename) =>
                        onImportToFix?.(importType, batchId, filename)
                      }
                    />
                  );
                  const rows = sortedGroupItems.map((item) => {
                    const rowIdx = globalIdx++;
                    return (
                      <WarningRowItem
                        key={item.key}
                        index={rowIdx}
                        item={item}
                        showSourceImportLink
                        onViewImportBatch={onViewImportBatch}
                      />
                    );
                  });
                  return [header, ...rows];
                });
              })()
            : [...items]
                .sort(bySeverity)
                .map((item, idx) => (
                  <WarningRowItem
                    key={item.key}
                    index={idx}
                    item={item}
                    showSourceImportLink
                    onViewImportBatch={onViewImportBatch}
                  />
                ))}
        </Tbody>
      </TableContainer>
    </div>
  );
}

function WarningTabBar({
  activeTab,
  onSelect,
  counts,
}: {
  activeTab: Tab;
  onSelect: (tab: Tab) => void;
  counts: Record<Tab, number>;
}): React.JSX.Element {
  const tabs = useMemo(
    () =>
      TAB_ORDER.map((tab) => ({
        id: tab,
        label: tab,
        count: counts[tab],
      })),
    [counts],
  );

  return <TabBar<Tab> tabs={tabs} activeTab={activeTab} onSelect={onSelect} />;
}

function WarningsPage({
  session,
  profile,
  onCountChange,
  saleWindowDays,
  purchaseWindowDays,
  branchFilter,
  onViewImportBatch,
  onFileReady,
}: Props): React.JSX.Element {
  const { aboveRef, containerStyle } = useStickyAbove();
  // Cached like the dashboard tabs — coming back to the Warning page from somewhere
  // else shows the rows it showed last time rather than a skeleton, and refetches only
  // when the window settings change, an import is confirmed or reverted, or the entry
  // ages out. See lib/queryClient.ts.
  const { data, isRefreshing, failed, reload } = useUrlQuery<{
    sections: WarningSection[];
  }>(
    `${apiBaseUrl}/api/warnings?sale_days=${saleWindowDays}&purchase_days=${purchaseWindowDays}`,
    session,
    "Warning page",
  );
  const sections = data?.sections ?? null;
  const [activeTab, setActiveTab] = useState<Tab>("All");
  const [search, setSearch] = useState("");
  const [severityFilter, setSeverityFilter] = useState("");
  const {
    trigger: triggerFilePicker,
    input: filePickerInput,
    picking,
  } = useImportFilePicker(session, onFileReady);

  // Rows are always fetched for every branch this account can see; the filters
  // narrow what's displayed/counted below.
  const displaySections = useMemo(
    () => filterSections(sections, branchFilter, severityFilter, search),
    [sections, branchFilter, severityFilter, search],
  );

  // The nav badge's count follows whatever the fetch produced, cached or fresh.
  useEffect(() => {
    if (sections)
      onCountChange?.(
        sections.reduce((sum, section) => sum + section.rows.length, 0),
      );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sections]);

  // Opens the file picker right here on the Warning page.
  function handleImportToFix(
    importType: ImportType,
    batchId: string,
    filename: string | null,
  ): void {
    triggerFilePicker({
      endpoint: IMPORT_TYPE_ENDPOINT[importType],
      importLabel: IMPORT_TYPE_LABEL[importType],
      revertBatchId: batchId,
      replacingFilename: filename,
    });
  }

  const hasActiveFilters = search !== "" || severityFilter !== "";

  function clearFilters(): void {
    setSearch("");
    setSeverityFilter("");
  }

  const totalFilteredIssues =
    displaySections?.reduce((sum, section) => sum + section.rows.length, 0) ??
    0;
  const totalRawIssues =
    sections?.reduce((sum, section) => sum + section.rows.length, 0) ?? 0;

  function categoryCount(category: Category): number {
    return (
      displaySections
        ?.filter((s) => SECTION_CATEGORY[s.id] === category)
        .reduce((sum, s) => sum + s.rows.length, 0) ?? 0
    );
  }

  const tabCounts: Record<Tab, number> = {
    All: totalFilteredIssues,
    Inventory: categoryCount("Inventory"),
    Sale: categoryCount("Sale"),
    Purchase: categoryCount("Purchase"),
  };

  const recountRows = useMemo(() => {
    if (!displaySections) return [];
    const result: { branch: string; stockCode: string; description: string }[] =
      [];
    const seen = new Set<string>();

    for (const section of displaySections) {
      for (const r of section.rows) {
        const branch = fieldValue(r.fields, "Branch") || "";
        const stockCode = fieldValue(r.fields, "Stock Code") || "";
        const description = fieldValue(r.fields, "Description") || "";
        if (!stockCode && !description) continue;
        const key = `${branch}__${stockCode}`;
        if (!seen.has(key)) {
          seen.add(key);
          result.push({ branch, stockCode, description });
        }
      }
    }
    return result;
  }, [displaySections]);

  function handleExportRecountCsv(): void {
    if (recountRows.length === 0) return;
    const dateStr = new Date().toISOString().slice(0, 10);
    const branchSuffix = branchFilter
      ? `-${branchFilter.toLowerCase().replace(/\s+/g, "-")}`
      : "";
    downloadCsv(
      `recount-list${branchSuffix}-${dateStr}.csv`,
      ["Branch", "Stock Code", "Description", "Actual Count"],
      recountRows.map((r) => [r.branch, r.stockCode, r.description, ""]),
    );
  }

  function handleExportRecountExcel(): void {
    if (recountRows.length === 0) return;
    const dateStr = new Date().toISOString().slice(0, 10);
    const branchSuffix = branchFilter
      ? `-${branchFilter.toLowerCase().replace(/\s+/g, "-")}`
      : "";
    downloadExcel(
      `recount-list${branchSuffix}-${dateStr}.xlsx`,
      "Recount List",
      ["Branch", "Stock Code", "Description", "Actual Count"],
      recountRows.map((r) => [r.branch, r.stockCode, r.description, ""]),
    );
  }

  return (
    <div className="flex flex-col" style={containerStyle}>
      {filePickerInput}

      {/* Pinned top toolbar matching SimpleDataTable (Sale/Purchases/Inventory) */}
      <div
        ref={aboveRef}
        className="sticky top-14 lg:top-0 z-30 bg-bg-base py-2 border-b border-border space-y-3"
      >
        <CardHeader
          title="Data Quality"
          description="Sale, inventory, and purchase data discrepancies, missing master links, and recount flags."
          action={
            <div className="flex items-center gap-2">
              <Button
                variant="secondary"
                size="sm"
                onClick={handleExportRecountCsv}
                disabled={recountRows.length === 0}
                title={
                  recountRows.length === 0
                    ? "No items to recount"
                    : `Export ${recountRows.length} recount items to CSV`
                }
              >
                <DownloadIcon className="w-4 h-4" />
                CSV
              </Button>
              <Button
                variant="secondary"
                size="sm"
                onClick={handleExportRecountExcel}
                disabled={recountRows.length === 0}
                title={
                  recountRows.length === 0
                    ? "No items to recount"
                    : `Export ${recountRows.length} recount items to Excel`
                }
              >
                <DownloadIcon className="w-4 h-4" />
                Excel
              </Button>
              <RefreshButton onClick={reload} refreshing={isRefreshing} />
            </div>
          }
        />

        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2 flex-wrap min-w-0 flex-1">
            <div className="w-60 max-w-full">
              <Input
                size="sm"
                placeholder="Search stock code, product, note…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                startIcon={<SearchIcon className="w-3.5 h-3.5" />}
              />
            </div>

            <div className="w-36 max-w-full">
              <Select
                size="sm"
                value={severityFilter}
                onChange={(e) => setSeverityFilter(e.target.value)}
              >
                <option value="">All severities</option>
                <option value="critical">Critical only</option>
                <option value="warning">Warning only</option>
              </Select>
            </div>

            {hasActiveFilters && (
              <Button variant="ghost" size="sm" onClick={clearFilters}>
                Clear filters
              </Button>
            )}
          </div>
        </div>
      </div>

      <div className="pt-4 flex flex-col gap-4">
        {sections === null && !failed && <TableSkeleton rows={4} cols={4} />}

        {sections === null && failed && (
          <EmptyState
            icon={<WarningIcon />}
            title="Couldn't load warnings"
            description="Something went wrong reaching the backend."
            action={
              <Button variant="secondary" size="sm" onClick={reload}>
                Try again
              </Button>
            }
          />
        )}

        {sections !== null && totalRawIssues === 0 && (
          <EmptyState
            icon={<WarningIcon />}
            title="All clear"
            description="No data-quality warnings right now."
          />
        )}

        {sections !== null &&
          totalRawIssues > 0 &&
          totalFilteredIssues === 0 && (
            <EmptyState
              icon={<WarningIcon />}
              title="No matching warnings"
              description="Try adjusting or clearing your filters to see warnings."
              action={
                <Button variant="secondary" size="sm" onClick={clearFilters}>
                  Clear filters
                </Button>
              }
            />
          )}

        {sections !== null && totalFilteredIssues > 0 && (
          <div className="flex flex-col gap-4">
            <WarningTabBar
              activeTab={activeTab}
              onSelect={setActiveTab}
              counts={tabCounts}
            />
            <div className="flex flex-col gap-6">
              {(activeTab === "All" ? ALL_TAB_ORDER : [activeTab]).map(
                (category) => {
                  const categorySections = (displaySections ?? []).filter(
                    (s) =>
                      SECTION_CATEGORY[s.id] === category && s.rows.length > 0,
                  );
                  if (categorySections.length === 0) {
                    if (activeTab === "All") return null;
                    return (
                      <EmptyState
                        key={category}
                        icon={<WarningIcon />}
                        title="All clear"
                        description={`No ${category.toLowerCase()} warnings right now.`}
                      />
                    );
                  }
                  return (
                    <WarningCategoryCard
                      key={category}
                      category={category}
                      sections={categorySections}
                      showTitle={activeTab === "All"}
                      profile={profile}
                      disabled={picking}
                      onViewImportBatch={onViewImportBatch}
                      onImportToFix={handleImportToFix}
                    />
                  );
                },
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default WarningsPage;
