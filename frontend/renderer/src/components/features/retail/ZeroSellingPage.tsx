import { useState } from "react";
import type { Session } from "@renderer/lib/auth";
import {
  formatRetailDate,
  formatRetailTime,
} from "@renderer/lib/retailDateTime";
import {
  SimpleDataTable,
  type DataTableColumn,
  type DataTableFilter,
} from "@renderer/components/features/SimpleDataTable";
import { TabBar, type TabItem } from "@renderer/components/ui/Tabs";

type ZeroSellingTab = "conversion" | "records";

interface ConversionRow {
  Date: string;
  Branch: string;
  SalesSlips: number;
  ZeroSelling: number;
  ConversionRate: number | null;
}

interface ZeroSellingRow {
  Date: string;
  Time: string | null;
  Branch: string;
  Category: string | null;
  Reason: string | null;
}

const TABS: TabItem<ZeroSellingTab>[] = [
  { id: "conversion", label: "Conversion rate" },
  { id: "records", label: "Zero-selling records" },
];

const CONVERSION_COLUMNS: DataTableColumn<ConversionRow>[] = [
  {
    key: "Date",
    label: "Date",
    format: (value) => formatRetailDate(String(value)),
  },
  { key: "Branch", label: "Branch" },
  { key: "SalesSlips", label: "Sales slips", align: "right" },
  { key: "ZeroSelling", label: "Zero selling", align: "right" },
  {
    key: "ConversionRate",
    label: "Conversion rate",
    align: "right",
    format: (value) =>
      value === null || value === undefined
        ? "—"
        : `${Number(value).toFixed(2)}%`,
  },
];

const ZERO_SELLING_COLUMNS: DataTableColumn<ZeroSellingRow>[] = [
  {
    key: "Date",
    label: "Date",
    format: (value) => formatRetailDate(String(value)),
  },
  {
    key: "Time",
    label: "Time",
    format: (value) => formatRetailTime(value as string | null),
  },
  { key: "Branch", label: "Branch" },
  { key: "Category", label: "Category" },
  { key: "Reason", label: "Reason" },
];

function dateRangeFilter<T extends { Date: string }>(): DataTableFilter<T>[] {
  return [
    {
      type: "dateRange",
      key: "Date",
      label: "Date",
      serverParam: { from: "date_from", to: "date_to" },
    },
  ];
}

export default function ZeroSellingPage({
  session,
  branchOptions,
  branchFilter = "",
}: {
  session: Session;
  branchOptions: string[];
  branchFilter?: string;
}): React.JSX.Element {
  const [activeTab, setActiveTab] = useState<ZeroSellingTab>("conversion");

  return (
    <div className="flex flex-col gap-3">
      <div className="border-b border-border">
        <TabBar tabs={TABS} activeTab={activeTab} onSelect={setActiveTab} />
      </div>
      {activeTab === "conversion" && (
        <SimpleDataTable<ConversionRow>
          session={session}
          endpoint="/api/zero-selling/conversion"
          title="Conversion rate"
          description="Sales slips ÷ (sales slips + zero-selling records), grouped by date and branch."
          columns={CONVERSION_COLUMNS}
          filters={dateRangeFilter<ConversionRow>()}
          branchFilter={branchFilter}
          branchOptions={branchOptions}
          rowKey={(row) => `${row.Date}-${row.Branch}`}
          emptyTitle="No conversion data yet"
          emptyDescription="Upload a zero-selling workbook to calculate conversion rates."
          serverPaged
        />
      )}
      {activeTab === "records" && (
        <SimpleDataTable<ZeroSellingRow>
          session={session}
          endpoint="/api/zero-selling"
          title="Zero-selling records"
          description="Customer visits that did not become a sales slip."
          columns={ZERO_SELLING_COLUMNS}
          filters={[
            {
              type: "search",
              keys: ["Category", "Reason"],
              placeholder: "Category or reason",
              serverParam: "search",
            },
            ...dateRangeFilter<ZeroSellingRow>(),
          ]}
          branchFilter={branchFilter}
          branchOptions={branchOptions}
          rowKey={(row, index) =>
            `${row.Date}-${row.Time}-${row.Branch}-${index}`
          }
          emptyTitle="No zero-selling records yet"
          emptyDescription="Upload a zero-selling workbook in General File to populate this table."
          serverPaged
        />
      )}
    </div>
  );
}
