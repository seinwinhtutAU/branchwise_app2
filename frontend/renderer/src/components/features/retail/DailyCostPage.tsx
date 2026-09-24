import type { Session } from "@renderer/lib/auth";
import { formatRetailDate } from "@renderer/lib/retailDateTime";
import {
  SimpleDataTable,
  type DataTableColumn,
  type DataTableFilter,
} from "@renderer/components/features/SimpleDataTable";

interface DailyCostRow {
  Date: string;
  Branch: string;
  DailyUsage: string | null;
  UsageTotal: number;
  DigitalIncome: string | null;
  DigitalIncomeTotal: number;
  Return: string | null;
  ReturnTotal: number;
  CapitalExpenditure: string | null;
  CapitalTotal: number;
}

const COLUMNS: DataTableColumn<DailyCostRow>[] = [
  {
    key: "Date",
    label: "Date",
    format: (value) => formatRetailDate(String(value)),
  },
  { key: "Branch", label: "Branch" },
  { key: "DailyUsage", label: "Daily usage" },
  { key: "UsageTotal", label: "Usage total", align: "right" },
  { key: "DigitalIncome", label: "Digital income" },
  {
    key: "DigitalIncomeTotal",
    label: "Digital income total",
    align: "right",
  },
  { key: "Return", label: "Return" },
  { key: "ReturnTotal", label: "Return total", align: "right" },
  { key: "CapitalExpenditure", label: "Capital expenditure" },
  { key: "CapitalTotal", label: "Capital total", align: "right" },
];

export default function DailyCostPage({
  session,
  branchOptions,
  branchFilter = "",
}: {
  session: Session;
  branchOptions: string[];
  branchFilter?: string;
}): React.JSX.Element {
  const filters: DataTableFilter<DailyCostRow>[] = [
    {
      type: "dateRange",
      key: "Date",
      label: "Date",
      serverParam: { from: "date_from", to: "date_to" },
    },
  ];

  return (
    <SimpleDataTable<DailyCostRow>
      session={session}
      endpoint="/api/daily-costs"
      title="Daily General Usage"
      description="One daily record per branch: usage, digital income, returns, and capital expenditure."
      icon={<div className="h-3.5 w-5 rounded-sm bg-orange-400 shrink-0" />}
      columns={COLUMNS}
      filters={filters}
      branchFilter={branchFilter}
      branchOptions={branchOptions}
      rowKey={(row) => `${row.Date}-${row.Branch}`}
      emptyTitle="No daily cost records yet"
      emptyDescription="Upload a General Usage workbook in General File to populate this table."
      serverPaged
    />
  );
}
