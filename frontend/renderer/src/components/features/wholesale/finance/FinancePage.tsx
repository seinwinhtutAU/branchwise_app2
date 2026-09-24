import React, { useMemo, useState } from "react";
import { useSearchShortcut } from "@renderer/lib/useSearchShortcut";
import { useQuery } from "@tanstack/react-query";
import { type Session } from "@renderer/lib/auth";
import { fetchJson, useLoadErrorToast } from "@renderer/lib/queryClient";
import { useToast } from "@renderer/lib/useToast";
import { cn } from "@renderer/lib/utils";
import { Button } from "@renderer/components/ui/Button";
import { RefreshButton } from "@renderer/components/ui/RefreshButton";
import { TabBar } from "@renderer/components/ui/Tabs";
import { CollapsibleKpiSummary } from "@renderer/components/ui/CollapsibleKpiSummary";
import { ColumnHeaderFilter } from "@renderer/components/ui/ColumnHeaderFilter";
import { EmptyState } from "@renderer/components/ui/EmptyState";
import { Input } from "@renderer/components/ui/Input";
import { Pagination } from "@renderer/components/ui/Pagination";
import { Spinner } from "@renderer/components/ui/Spinner";
import {
  TableContainer,
  Tbody,
  Td,
  Th,
  Thead,
  Tr,
} from "@renderer/components/ui/Table";
import {
  CheckIcon,
  CloseIcon,
  DollarIcon,
  SearchIcon,
} from "@renderer/components/ui/icons";
import {
  addCustomerOrderPayment,
  addSupplierVoucherPayment,
  RECEIVINGS_URL,
  receivingsFromWire,
  SUPPLIER_VOUCHERS_URL,
  WHOLESALE_FINANCE_CUSTOMERS_URL,
  type ReceivingWire,
} from "@renderer/components/features/wholesale/shared/api";
import {
  DotPill,
  FigureCard,
  PAGE_SIZE,
  Panel,
  Reference,
} from "@renderer/components/features/wholesale/shared/ui";
import {
  formatDate,
  formatKyat,
  formatQty,
  todayIso,
} from "@renderer/components/features/wholesale/shared/shared";
import {
  paidAmount as paidVoucherAmount,
  paymentStatus as voucherPaymentStatus,
  voucherBalance,
  type SupplierVoucher,
} from "@renderer/components/features/wholesale/vouchers/supplierVouchers";
import { pricedAmount } from "@renderer/components/features/wholesale/shared/units";

interface FinanceCustomerRow {
  order_id: string;
  customer_name: string;
  order_no: string;
  total_amount: number;
  paid_amount: number;
  balance: number;
  payment_status: "unpaid" | "partial" | "paid";
}

type Tab = "customers" | "suppliers" | "shipment-costs";
type StatusFilter = "all" | "unpaid" | "partial" | "paid";
type PaymentStatus = Exclude<StatusFilter, "all">;

interface FinanceTabItem {
  id: Tab;
  label: string;
  description: string;
}

const FINANCE_TABS: FinanceTabItem[] = [
  {
    id: "customers",
    label: "Customer Receivables",
    description:
      "Track customer orders, payments received, and outstanding balances",
  },
  {
    id: "suppliers",
    label: "Supplier Payables",
    description:
      "Track supplier vouchers, settlement payments, and unpaid balances",
  },
  {
    id: "shipment-costs",
    label: "Shipment Costs",
    description:
      "Overview of freight, customs, gate, and transportation costs across shipments",
  },
];

const STATUS_LABELS: Record<PaymentStatus, string> = {
  unpaid: "Unpaid",
  partial: "Part paid",
  paid: "Paid",
};

const STATUS_STYLES: Record<PaymentStatus, { bg: string; dot: string }> = {
  unpaid: {
    bg: "bg-error-subtle text-error border border-error-pill",
    dot: "bg-error",
  },
  partial: {
    bg: "bg-warning-subtle text-warning border border-warning-pill",
    dot: "bg-warning",
  },
  paid: {
    bg: "bg-success-subtle text-success border border-success-pill",
    dot: "bg-success",
  },
};

interface SupplierFinanceRow {
  voucher: SupplierVoucher;
  totalAmount: number;
  paidAmount: number;
  balance: number;
  status: PaymentStatus;
}

interface PaymentTarget {
  id: string;
  name: string;
  reference: string;
  kind: "customer" | "supplier";
}

interface ShipmentCostRow {
  id: string;
  costDate: string;
  receivingNo: string;
  shipmentNo: string;
  supplierName: string;
  stage: string;
  carrier: string;
  kind: string;
  amount: number;
  note: string;
}

export default function FinancePage({
  session,
  onOpenOrder,
  onOpenVoucher,
}: {
  session: Session;
  onOpenOrder: (orderId: string) => void;
  onOpenVoucher: (voucherId: string) => void;
}): React.JSX.Element {
  const showToast = useToast();
  const [tab, setTab] = useState<Tab>("customers");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const searchInputRef = useSearchShortcut();
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [paymentTarget, setPaymentTarget] = useState<PaymentTarget | null>(
    null,
  );

  const customerQuery = useQuery({
    queryKey: ["wholesale", "finance", "customers"],
    queryFn: () =>
      fetchJson<FinanceCustomerRow[]>(WHOLESALE_FINANCE_CUSTOMERS_URL, session),
  });
  const supplierQuery = useQuery({
    queryKey: ["wholesale", "finance", "suppliers"],
    queryFn: () => fetchJson<SupplierVoucher[]>(SUPPLIER_VOUCHERS_URL, session),
  });
  const receivingQuery = useQuery({
    queryKey: ["wholesale", "finance", "shipment-costs"],
    queryFn: async () =>
      receivingsFromWire(
        await fetchJson<ReceivingWire[]>(RECEIVINGS_URL, session),
      ),
  });

  useLoadErrorToast(customerQuery.isError, "customer finance");
  useLoadErrorToast(supplierQuery.isError, "supplier payables");
  useLoadErrorToast(receivingQuery.isError, "shipment costs");

  const isRefreshing =
    customerQuery.isFetching ||
    supplierQuery.isFetching ||
    receivingQuery.isFetching;

  function refreshFinance(): void {
    void Promise.all([
      customerQuery.refetch(),
      supplierQuery.refetch(),
      receivingQuery.refetch(),
    ]);
  }

  const customers = useMemo(
    () => customerQuery.data ?? [],
    [customerQuery.data],
  );

  const suppliers = useMemo<SupplierFinanceRow[]>(
    () =>
      (supplierQuery.data ?? []).map((voucher) => {
        const totalAmount = voucher.lines.reduce(
          (sum, line) =>
            sum +
            pricedAmount(
              line.quantity_pairs,
              line.unit,
              line.buying_price,
              line.unit_conversions,
            ),
          0,
        );
        return {
          voucher,
          totalAmount,
          paidAmount: paidVoucherAmount(voucher),
          balance: voucherBalance(voucher),
          status: voucherPaymentStatus(voucher),
        };
      }),
    [supplierQuery.data],
  );

  const shipmentCosts = useMemo<ShipmentCostRow[]>(
    () =>
      (receivingQuery.data ?? []).flatMap((receiving) =>
        receiving.costs.map((cost) => ({
          id: `${receiving.receiving_id}-${cost.cost_id}`,
          costDate: cost.cost_date,
          receivingNo: receiving.receiving_no,
          shipmentNo: receiving.shipment_no,
          supplierName: receiving.supplier_name,
          stage: cost.stage || "—",
          carrier: cost.carrier || "—",
          kind: cost.kind || "—",
          amount: cost.amount,
          note: cost.note,
        })),
      ),
    [receivingQuery.data],
  );

  const totalCustomerReceivable = customers.reduce(
    (sum, row) => sum + row.balance,
    0,
  );
  const unpaidCustomersCount = customers.filter(
    (row) => row.balance > 0,
  ).length;

  const totalSupplierPayable = suppliers.reduce(
    (sum, row) => sum + row.balance,
    0,
  );
  const unpaidSuppliersCount = suppliers.filter(
    (row) => row.balance > 0,
  ).length;

  const totalShipmentCost = shipmentCosts.reduce(
    (sum, row) => sum + row.amount,
    0,
  );

  const queryText = search.trim().toLowerCase();

  const filteredCustomers = useMemo(
    () =>
      customers.filter((row) => {
        const matchesSearch =
          !queryText ||
          row.customer_name.toLowerCase().includes(queryText) ||
          row.order_no.toLowerCase().includes(queryText);
        return (
          matchesSearch &&
          (statusFilter === "all" || row.payment_status === statusFilter)
        );
      }),
    [customers, queryText, statusFilter],
  );

  const filteredSuppliers = useMemo(
    () =>
      suppliers.filter(({ voucher, status }) => {
        const matchesSearch =
          !queryText ||
          voucher.supplier_name.toLowerCase().includes(queryText) ||
          voucher.voucher_no.toLowerCase().includes(queryText);
        return (
          matchesSearch && (statusFilter === "all" || status === statusFilter)
        );
      }),
    [queryText, statusFilter, suppliers],
  );

  const filteredShipmentCosts = useMemo(
    () =>
      shipmentCosts.filter((row) => {
        if (!queryText) return true;
        return [
          row.receivingNo,
          row.shipmentNo,
          row.supplierName,
          row.stage,
          row.carrier,
          row.kind,
          row.note,
        ].some((value) => value.toLowerCase().includes(queryText));
      }),
    [queryText, shipmentCosts],
  );

  const isFiltered =
    search.trim() !== "" ||
    (tab !== "shipment-costs" && statusFilter !== "all");

  function resetFilters(): void {
    setSearch("");
    setStatusFilter("all");
    setPage(1);
  }

  function handleTabChange(nextTab: Tab): void {
    setTab(nextTab);
    setPage(1);
  }

  const activeTab =
    FINANCE_TABS.find((item) => item.id === tab) ?? FINANCE_TABS[0];

  const tabCounts: Record<Tab, number> = {
    customers: customers.length,
    suppliers: suppliers.length,
    "shipment-costs": shipmentCosts.length,
  };

  return (
    <div className="flex flex-col gap-4">
      <CollapsibleKpiSummary
        storageKey="wholesale_finance"
        title="Finance Summary"
      >
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <FigureCard
            label="Customer Receivables"
            description="Money customers still owe."
            value={formatKyat(totalCustomerReceivable)}
            sub={`${formatQty(unpaidCustomersCount)} order${unpaidCustomersCount === 1 ? "" : "s"} with balance`}
            tone={totalCustomerReceivable > 0 ? "error" : "success"}
          />
          <FigureCard
            label="Supplier Payables"
            description="Money still owed to suppliers."
            value={formatKyat(totalSupplierPayable)}
            sub={`${formatQty(unpaidSuppliersCount)} voucher${unpaidSuppliersCount === 1 ? "" : "s"} with balance`}
            tone={totalSupplierPayable > 0 ? "error" : "success"}
          />
          <FigureCard
            label="Shipment Costs"
            description="Costs recorded for shipments."
            value={formatKyat(totalShipmentCost)}
            sub={`${formatQty(shipmentCosts.length)} recorded entry${shipmentCosts.length === 1 ? "" : "ies"}`}
          />
        </div>
      </CollapsibleKpiSummary>

      <TabBar<Tab>
        tabs={FINANCE_TABS.map((item) => ({
          id: item.id,
          label: item.label,
          count: tabCounts[item.id],
        }))}
        activeTab={tab}
        onSelect={handleTabChange}
      />

      <Panel className="shadow-xs">
        <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-2.5 border-b border-border bg-bg-base">
          <div className="flex items-center gap-2 flex-wrap min-w-0">
            <h2 className="text-base font-semibold text-text-primary tracking-tight mr-1">
              {activeTab.label}
            </h2>
            <span className="text-xs text-text-muted hidden sm:inline">
              {activeTab.description}
            </span>

            {isFiltered && (
              <Button
                variant="ghost"
                size="sm"
                onClick={resetFilters}
                className="text-xs h-6 px-1.5 text-text-muted hover:text-error"
              >
                <CloseIcon className="w-3.5 h-3.5" />
                Clear
              </Button>
            )}
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <div className="w-48 sm:w-64">
              <Input
                ref={searchInputRef}
                value={search}
                onChange={(event) => {
                  setSearch(event.target.value);
                  setPage(1);
                }}
                placeholder="Search name or reference… (/)"
                startIcon={<SearchIcon className="w-3.5 h-3.5" />}
                aria-label="Search name or reference"
                className="h-8 text-xs"
              />
            </div>
            <RefreshButton onClick={refreshFinance} refreshing={isRefreshing} />
          </div>
        </div>

        {tab === "customers" ? (
          <FinanceTable
            loading={customerQuery.isLoading}
            emptyTitle={
              isFiltered
                ? "No customer receivables match"
                : "No customer receivables yet"
            }
            emptyDescription={
              isFiltered
                ? "Nothing here matches what you searched for. Try adjusting your search or status filter."
                : "Unpaid balances from customer orders will appear here."
            }
            rows={filteredCustomers}
            page={page}
            onPageChange={setPage}
            statusFilter={statusFilter}
            onStatusFilterChange={(val) => {
              setStatusFilter(val);
              setPage(1);
            }}
            onResetFilters={resetFilters}
            isFiltered={isFiltered}
            onRecordPayment={(row) =>
              setPaymentTarget({
                id: row.order_id,
                name: row.customer_name,
                reference: row.order_no,
                kind: "customer",
              })
            }
            onOpenReference={onOpenOrder}
          />
        ) : tab === "suppliers" ? (
          <SupplierTable
            loading={supplierQuery.isLoading}
            emptyTitle={
              isFiltered
                ? "No supplier payables match"
                : "No supplier payables yet"
            }
            emptyDescription={
              isFiltered
                ? "Nothing here matches what you searched for. Try adjusting your search or status filter."
                : "Outstanding balances owed to suppliers will appear here."
            }
            rows={filteredSuppliers}
            page={page}
            onPageChange={setPage}
            statusFilter={statusFilter}
            onStatusFilterChange={(val) => {
              setStatusFilter(val);
              setPage(1);
            }}
            onResetFilters={resetFilters}
            isFiltered={isFiltered}
            onRecordPayment={(row) =>
              setPaymentTarget({
                id: row.voucher.voucher_id,
                name: row.voucher.supplier_name,
                reference: row.voucher.voucher_no,
                kind: "supplier",
              })
            }
            onOpenReference={onOpenVoucher}
          />
        ) : (
          <ShipmentCostTable
            loading={receivingQuery.isLoading}
            emptyTitle={
              isFiltered ? "No shipment costs match" : "No shipment costs yet"
            }
            emptyDescription={
              isFiltered
                ? "Nothing here matches what you searched for."
                : "Recorded receiving and transport costs will appear here."
            }
            rows={filteredShipmentCosts}
            page={page}
            onPageChange={setPage}
            onResetFilters={resetFilters}
            isFiltered={isFiltered}
          />
        )}
      </Panel>

      {paymentTarget && (
        <RecordPaymentModal
          session={session}
          target={paymentTarget}
          onClose={() => setPaymentTarget(null)}
          onSaved={() => {
            setPaymentTarget(null);
            refreshFinance();
            showToast("success", "Payment recorded");
          }}
        />
      )}
    </div>
  );
}

function PaymentStatusBadge({
  status,
}: {
  status: PaymentStatus;
}): React.JSX.Element {
  const style = STATUS_STYLES[status];
  return (
    <DotPill
      label={STATUS_LABELS[status]}
      className={style.bg}
      dotClassName={style.dot}
    />
  );
}

function FinanceTable({
  loading,
  emptyTitle,
  emptyDescription,
  rows,
  page,
  onPageChange,
  statusFilter,
  onStatusFilterChange,
  onResetFilters,
  isFiltered,
  onRecordPayment,
  onOpenReference,
}: {
  loading: boolean;
  emptyTitle: string;
  emptyDescription: string;
  rows: FinanceCustomerRow[];
  page: number;
  onPageChange: (page: number) => void;
  statusFilter: StatusFilter;
  onStatusFilterChange: (status: StatusFilter) => void;
  onResetFilters: () => void;
  isFiltered: boolean;
  onRecordPayment: (row: FinanceCustomerRow) => void;
  onOpenReference: (referenceId: string) => void;
}): React.JSX.Element {
  const totals = useMemo(
    () =>
      rows.reduce(
        (summary, row) => ({
          total: summary.total + row.total_amount,
          paid: summary.paid + row.paid_amount,
          balance: summary.balance + row.balance,
        }),
        { total: 0, paid: 0, balance: 0 },
      ),
    [rows],
  );

  const totalPages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const visible = rows.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);

  if (loading) {
    return <Loading />;
  }

  if (rows.length === 0) {
    return (
      <EmptyState
        icon={<DollarIcon />}
        title={emptyTitle}
        description={emptyDescription}
        action={
          isFiltered ? (
            <Button variant="secondary" onClick={onResetFilters}>
              Clear filters
            </Button>
          ) : undefined
        }
      />
    );
  }

  return (
    <>
      <TableContainer className="rounded-none border-0">
        <Thead>
          <Tr>
            <Th className="w-10 sm:w-12 text-center text-text-muted font-normal select-none">
              #
            </Th>
            <Th className="whitespace-nowrap">Customer</Th>
            <Th className="whitespace-nowrap">Order no.</Th>
            <Th className="text-right whitespace-nowrap">Total Amount</Th>
            <Th className="text-right whitespace-nowrap">Paid Amount</Th>
            <Th className="text-right whitespace-nowrap">Balance</Th>
            <Th className="whitespace-nowrap">
              <ColumnHeaderFilter
                label="Status"
                isActive={statusFilter !== "all"}
              >
                {(close) => (
                  <div className="flex flex-col gap-1.5">
                    <div className="font-semibold text-text-primary text-[11px] uppercase tracking-wider pb-1 border-b border-border">
                      Filter Status
                    </div>
                    <div className="space-y-0.5 max-h-48 overflow-y-auto">
                      <button
                        type="button"
                        onClick={() => {
                          onStatusFilterChange("all");
                          close();
                        }}
                        className={cn(
                          "w-full text-left px-2 py-1 rounded text-xs transition-colors flex items-center justify-between",
                          statusFilter === "all"
                            ? "bg-brand/10 font-bold text-brand"
                            : "hover:bg-bg-subtle text-text-secondary",
                        )}
                      >
                        <span>Any status</span>
                        {statusFilter === "all" && (
                          <CheckIcon className="w-3.5 h-3.5" />
                        )}
                      </button>
                      {(["unpaid", "partial", "paid"] as const).map(
                        (option) => (
                          <button
                            key={option}
                            type="button"
                            onClick={() => {
                              onStatusFilterChange(option);
                              close();
                            }}
                            className={cn(
                              "w-full text-left px-2 py-1 rounded text-xs transition-colors flex items-center justify-between",
                              statusFilter === option
                                ? "bg-brand/10 font-bold text-brand"
                                : "hover:bg-bg-subtle text-text-secondary",
                            )}
                          >
                            <span>{STATUS_LABELS[option]}</span>
                            {statusFilter === option && (
                              <CheckIcon className="w-3.5 h-3.5" />
                            )}
                          </button>
                        ),
                      )}
                    </div>
                  </div>
                )}
              </ColumnHeaderFilter>
            </Th>
            <Th className="w-28 text-right whitespace-nowrap">Actions</Th>
          </Tr>
        </Thead>
        <Tbody>
          {visible.map((row, index) => {
            const rowNum = (safePage - 1) * PAGE_SIZE + index + 1;
            return (
              <Tr key={row.order_id}>
                <Td className="text-center text-xs font-mono text-text-muted tabular-nums select-none">
                  {rowNum}
                </Td>
                <Td className="font-medium whitespace-nowrap">
                  {row.customer_name}
                </Td>
                <Td className="whitespace-nowrap">
                  <Reference
                    value={row.order_no}
                    what="order no."
                    onClick={() => onOpenReference(row.order_id)}
                    singleLine
                  />
                </Td>
                <Td className="text-right tabular-nums whitespace-nowrap">
                  {formatKyat(row.total_amount)}
                </Td>
                <Td className="text-right tabular-nums whitespace-nowrap text-text-secondary">
                  {formatKyat(row.paid_amount)}
                </Td>
                <Td
                  className={cn(
                    "text-right tabular-nums whitespace-nowrap font-semibold",
                    row.balance > 0 ? "text-warning" : "text-success",
                  )}
                >
                  {formatKyat(row.balance)}
                </Td>
                <Td className="whitespace-nowrap">
                  <PaymentStatusBadge status={row.payment_status} />
                </Td>
                <Td className="text-right whitespace-nowrap">
                  <Button
                    size="sm"
                    variant={row.balance > 0 ? "primary" : "secondary"}
                    onClick={() => onRecordPayment(row)}
                    className="h-7 text-xs"
                  >
                    Record payment
                  </Button>
                </Td>
              </Tr>
            );
          })}
        </Tbody>
        <tfoot>
          <Tr className="bg-bg-subtle font-semibold">
            <Td colSpan={3} className="text-right">
              Total ({formatQty(rows.length)} items)
            </Td>
            <Td className="text-right font-bold tabular-nums whitespace-nowrap">
              {formatKyat(totals.total)}
            </Td>
            <Td className="text-right font-bold tabular-nums whitespace-nowrap">
              {formatKyat(totals.paid)}
            </Td>
            <Td className="text-right font-bold tabular-nums whitespace-nowrap text-warning">
              {formatKyat(totals.balance)}
            </Td>
            <Td />
            <Td />
          </Tr>
        </tfoot>
      </TableContainer>
      <div className="px-4 py-1.5 border-t border-border">
        <Pagination
          page={safePage}
          totalPages={totalPages}
          totalItems={rows.length}
          pageSize={PAGE_SIZE}
          onPageChange={onPageChange}
        />
      </div>
    </>
  );
}

function SupplierTable({
  loading,
  emptyTitle,
  emptyDescription,
  rows,
  page,
  onPageChange,
  statusFilter,
  onStatusFilterChange,
  onResetFilters,
  isFiltered,
  onRecordPayment,
  onOpenReference,
}: {
  loading: boolean;
  emptyTitle: string;
  emptyDescription: string;
  rows: SupplierFinanceRow[];
  page: number;
  onPageChange: (page: number) => void;
  statusFilter: StatusFilter;
  onStatusFilterChange: (status: StatusFilter) => void;
  onResetFilters: () => void;
  isFiltered: boolean;
  onRecordPayment: (row: SupplierFinanceRow) => void;
  onOpenReference: (referenceId: string) => void;
}): React.JSX.Element {
  const totals = useMemo(
    () =>
      rows.reduce(
        (summary, row) => ({
          total: summary.total + row.totalAmount,
          paid: summary.paid + row.paidAmount,
          balance: summary.balance + row.balance,
        }),
        { total: 0, paid: 0, balance: 0 },
      ),
    [rows],
  );

  const totalPages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const visible = rows.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);

  if (loading) {
    return <Loading />;
  }

  if (rows.length === 0) {
    return (
      <EmptyState
        icon={<DollarIcon />}
        title={emptyTitle}
        description={emptyDescription}
        action={
          isFiltered ? (
            <Button variant="secondary" onClick={onResetFilters}>
              Clear filters
            </Button>
          ) : undefined
        }
      />
    );
  }

  return (
    <>
      <TableContainer className="rounded-none border-0">
        <Thead>
          <Tr>
            <Th className="w-10 sm:w-12 text-center text-text-muted font-normal select-none">
              #
            </Th>
            <Th className="whitespace-nowrap">Supplier</Th>
            <Th className="whitespace-nowrap">Voucher no.</Th>
            <Th className="text-right whitespace-nowrap">Total Amount</Th>
            <Th className="text-right whitespace-nowrap">Paid Amount</Th>
            <Th className="text-right whitespace-nowrap">Balance</Th>
            <Th className="whitespace-nowrap">
              <ColumnHeaderFilter
                label="Status"
                isActive={statusFilter !== "all"}
              >
                {(close) => (
                  <div className="flex flex-col gap-1.5">
                    <div className="font-semibold text-text-primary text-[11px] uppercase tracking-wider pb-1 border-b border-border">
                      Filter Status
                    </div>
                    <div className="space-y-0.5 max-h-48 overflow-y-auto">
                      <button
                        type="button"
                        onClick={() => {
                          onStatusFilterChange("all");
                          close();
                        }}
                        className={cn(
                          "w-full text-left px-2 py-1 rounded text-xs transition-colors flex items-center justify-between",
                          statusFilter === "all"
                            ? "bg-brand/10 font-bold text-brand"
                            : "hover:bg-bg-subtle text-text-secondary",
                        )}
                      >
                        <span>Any status</span>
                        {statusFilter === "all" && (
                          <CheckIcon className="w-3.5 h-3.5" />
                        )}
                      </button>
                      {(["unpaid", "partial", "paid"] as const).map(
                        (option) => (
                          <button
                            key={option}
                            type="button"
                            onClick={() => {
                              onStatusFilterChange(option);
                              close();
                            }}
                            className={cn(
                              "w-full text-left px-2 py-1 rounded text-xs transition-colors flex items-center justify-between",
                              statusFilter === option
                                ? "bg-brand/10 font-bold text-brand"
                                : "hover:bg-bg-subtle text-text-secondary",
                            )}
                          >
                            <span>{STATUS_LABELS[option]}</span>
                            {statusFilter === option && (
                              <CheckIcon className="w-3.5 h-3.5" />
                            )}
                          </button>
                        ),
                      )}
                    </div>
                  </div>
                )}
              </ColumnHeaderFilter>
            </Th>
            <Th className="w-28 text-right whitespace-nowrap">Actions</Th>
          </Tr>
        </Thead>
        <Tbody>
          {visible.map((row, index) => {
            const rowNum = (safePage - 1) * PAGE_SIZE + index + 1;
            return (
              <Tr key={row.voucher.voucher_id}>
                <Td className="text-center text-xs font-mono text-text-muted tabular-nums select-none">
                  {rowNum}
                </Td>
                <Td className="font-medium whitespace-nowrap">
                  {row.voucher.supplier_name}
                </Td>
                <Td className="whitespace-nowrap">
                  <Reference
                    value={row.voucher.voucher_no}
                    what="voucher no."
                    onClick={() => onOpenReference(row.voucher.voucher_id)}
                    singleLine
                  />
                </Td>
                <Td className="text-right tabular-nums whitespace-nowrap">
                  {formatKyat(row.totalAmount)}
                </Td>
                <Td className="text-right tabular-nums whitespace-nowrap text-text-secondary">
                  {formatKyat(row.paidAmount)}
                </Td>
                <Td
                  className={cn(
                    "text-right tabular-nums whitespace-nowrap font-semibold",
                    row.balance > 0 ? "text-warning" : "text-success",
                  )}
                >
                  {formatKyat(row.balance)}
                </Td>
                <Td className="whitespace-nowrap">
                  <PaymentStatusBadge status={row.status} />
                </Td>
                <Td className="text-right whitespace-nowrap">
                  <Button
                    size="sm"
                    variant={row.balance > 0 ? "primary" : "secondary"}
                    onClick={() => onRecordPayment(row)}
                    className="h-7 text-xs"
                  >
                    Record payment
                  </Button>
                </Td>
              </Tr>
            );
          })}
        </Tbody>
        <tfoot>
          <Tr className="bg-bg-subtle font-semibold">
            <Td colSpan={3} className="text-right">
              Total ({formatQty(rows.length)} items)
            </Td>
            <Td className="text-right font-bold tabular-nums whitespace-nowrap">
              {formatKyat(totals.total)}
            </Td>
            <Td className="text-right font-bold tabular-nums whitespace-nowrap">
              {formatKyat(totals.paid)}
            </Td>
            <Td className="text-right font-bold tabular-nums whitespace-nowrap text-warning">
              {formatKyat(totals.balance)}
            </Td>
            <Td />
            <Td />
          </Tr>
        </tfoot>
      </TableContainer>
      <div className="px-4 py-1.5 border-t border-border">
        <Pagination
          page={safePage}
          totalPages={totalPages}
          totalItems={rows.length}
          pageSize={PAGE_SIZE}
          onPageChange={onPageChange}
        />
      </div>
    </>
  );
}

function ShipmentCostTable({
  loading,
  emptyTitle,
  emptyDescription,
  rows,
  page,
  onPageChange,
  onResetFilters,
  isFiltered,
}: {
  loading: boolean;
  emptyTitle: string;
  emptyDescription: string;
  rows: ShipmentCostRow[];
  page: number;
  onPageChange: (page: number) => void;
  onResetFilters: () => void;
  isFiltered: boolean;
}): React.JSX.Element {
  const total = useMemo(
    () => rows.reduce((sum, row) => sum + row.amount, 0),
    [rows],
  );

  const totalPages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const visible = rows.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);

  if (loading) {
    return <Loading />;
  }

  if (rows.length === 0) {
    return (
      <EmptyState
        icon={<DollarIcon />}
        title={emptyTitle}
        description={emptyDescription}
        action={
          isFiltered ? (
            <Button variant="secondary" onClick={onResetFilters}>
              Clear filters
            </Button>
          ) : undefined
        }
      />
    );
  }

  return (
    <>
      <TableContainer className="rounded-none border-0">
        <Thead>
          <Tr>
            <Th className="w-10 sm:w-12 text-center text-text-muted font-normal select-none">
              #
            </Th>
            <Th className="whitespace-nowrap">Receiving</Th>
            <Th className="whitespace-nowrap">Date</Th>
            <Th className="whitespace-nowrap">Shipment</Th>
            <Th className="whitespace-nowrap">Supplier</Th>
            <Th className="whitespace-nowrap">Stage</Th>
            <Th className="whitespace-nowrap">Carrier</Th>
            <Th className="whitespace-nowrap">Type</Th>
            <Th className="text-right whitespace-nowrap">Amount</Th>
            <Th className="whitespace-nowrap">Note</Th>
          </Tr>
        </Thead>
        <Tbody>
          {visible.map((row, index) => {
            const rowNum = (safePage - 1) * PAGE_SIZE + index + 1;
            return (
              <Tr key={row.id}>
                <Td className="text-center text-xs font-mono text-text-muted tabular-nums select-none">
                  {rowNum}
                </Td>
                <Td className="whitespace-nowrap">
                  <Reference
                    value={row.receivingNo}
                    what="receiving no."
                    singleLine
                  />
                </Td>
                <Td className="whitespace-nowrap text-text-muted">
                  {row.costDate ? formatDate(row.costDate) : "—"}
                </Td>
                <Td className="whitespace-nowrap">
                  {row.shipmentNo ? (
                    <Reference
                      value={row.shipmentNo}
                      what="shipment no."
                      singleLine
                    />
                  ) : (
                    "—"
                  )}
                </Td>
                <Td className="font-medium whitespace-nowrap">
                  {row.supplierName}
                </Td>
                <Td className="whitespace-nowrap">{row.stage}</Td>
                <Td className="whitespace-nowrap">{row.carrier}</Td>
                <Td className="whitespace-nowrap">{row.kind}</Td>
                <Td className="text-right font-semibold tabular-nums whitespace-nowrap text-text-primary">
                  {formatKyat(row.amount)}
                </Td>
                <Td className="max-w-xs truncate text-text-secondary">
                  {row.note || "—"}
                </Td>
              </Tr>
            );
          })}
        </Tbody>
        <tfoot>
          <Tr className="bg-bg-subtle font-semibold">
            <Td colSpan={8} className="text-right">
              Total ({formatQty(rows.length)} entries)
            </Td>
            <Td className="text-right font-bold tabular-nums whitespace-nowrap">
              {formatKyat(total)}
            </Td>
            <Td />
          </Tr>
        </tfoot>
      </TableContainer>
      <div className="px-4 py-1.5 border-t border-border">
        <Pagination
          page={safePage}
          totalPages={totalPages}
          totalItems={rows.length}
          pageSize={PAGE_SIZE}
          onPageChange={onPageChange}
        />
      </div>
    </>
  );
}

function Loading(): React.JSX.Element {
  return (
    <div className="flex justify-center py-14">
      <Spinner className="h-6 w-6 text-text-muted" />
    </div>
  );
}

function RecordPaymentModal({
  session,
  target,
  onClose,
  onSaved,
}: {
  session: Session;
  target: PaymentTarget;
  onClose: () => void;
  onSaved: () => void;
}): React.JSX.Element {
  const [amount, setAmount] = useState("");
  const [paidOn, setPaidOn] = useState(todayIso());
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function submit(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    const amountValue = Number(amount);
    if (!Number.isFinite(amountValue) || amountValue <= 0) {
      setError("Enter a payment amount.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const payment = {
        payment_id: "",
        paid_on: paidOn,
        amount: amountValue,
        note: note.trim(),
      };
      if (target.kind === "customer")
        await addCustomerOrderPayment(session, target.id, payment);
      else await addSupplierVoucherPayment(session, target.id, payment);
      onSaved();
    } catch (saveError) {
      setError(
        saveError instanceof Error
          ? saveError.message
          : "Could not record payment.",
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="record-payment-title"
    >
      <form
        onSubmit={submit}
        className="w-full max-w-md rounded-xl border border-border bg-bg-base p-5 shadow-xl"
      >
        <div className="flex items-start justify-between">
          <div>
            <h3
              id="record-payment-title"
              className="text-lg font-semibold text-text-primary"
            >
              Record Payment
            </h3>
            <p className="mt-1 text-sm text-text-muted">
              {target.name} · {target.reference}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md p-1 text-text-muted hover:bg-bg-raised"
            aria-label="Close"
          >
            <CloseIcon className="h-5 w-5" />
          </button>
        </div>
        <div className="mt-5 space-y-4">
          <Input
            label="Amount"
            value={amount}
            onChange={(event) => setAmount(event.target.value)}
            inputMode="decimal"
            placeholder="0"
            required
          />
          <Input
            label="Date"
            type="date"
            value={paidOn}
            onChange={(event) => setPaidOn(event.target.value)}
            required
          />
          <Input
            label="Note"
            value={note}
            onChange={(event) => setNote(event.target.value)}
            placeholder="Optional note"
          />
        </div>
        {error && <p className="mt-3 text-sm text-error">{error}</p>}
        <div className="mt-5 flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" loading={saving}>
            Save payment
          </Button>
        </div>
      </form>
    </div>
  );
}
