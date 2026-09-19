import React, { useMemo, useState } from "react";
import { useSearchShortcut } from "@renderer/lib/useSearchShortcut";
import { cn } from "@renderer/lib/utils";
import { Button } from "@renderer/components/ui/Button";
import { RefreshButton } from "@renderer/components/ui/RefreshButton";
import { TabBar } from "@renderer/components/ui/Tabs";
import { CollapsibleKpiSummary } from "@renderer/components/ui/CollapsibleKpiSummary";
import { ColumnHeaderFilter } from "@renderer/components/ui/ColumnHeaderFilter";
import { EmptyState } from "@renderer/components/ui/EmptyState";
import { Input } from "@renderer/components/ui/Input";
import { Pagination } from "@renderer/components/ui/Pagination";
import {
  TableContainer,
  Thead,
  Tbody,
  Tr,
  Th,
  Td,
} from "@renderer/components/ui/Table";
import {
  CheckIcon,
  CloseIcon,
  FactoryIcon,
  PlusIcon,
  SearchIcon,
} from "@renderer/components/ui/icons";
import {
  FigureCard,
  Panel,
  PAGE_SIZE,
  Reference,
  RowProgress,
} from "@renderer/components/features/wholesale/shared/ui";
import {
  formatDate,
  formatKyat,
  formatQty,
} from "@renderer/components/features/wholesale/shared/shared";
import {
  paymentStatus,
  receivedPct,
  receivingStatus,
  remainingQty,
  voucherBalance,
  type SupplierVoucher,
} from "@renderer/components/features/wholesale/vouchers/supplierVouchers";
import {
  sets,
  RECEIVING_STATUSES,
  RECEIVING_LABELS,
  PAYMENT_STATUSES,
  PAYMENT_LABELS,
  type ReceivingFilter,
  type PayFilter,
} from "./types";
import { ReceivingBadge, PaymentBadge, RowMenu } from "./VoucherBadges";

export function VoucherList({
  vouchers,
  toOrderCount,
  onToOrder,
  onOpen,
  onPay,
  onDelete,
  onNew,
  onRefresh,
  refreshing,
}: {
  vouchers: SupplierVoucher[];
  toOrderCount?: number;
  onToOrder: () => void;
  onOpen: (voucherId: string) => void;
  onPay: (voucherId: string) => void;
  onDelete: (voucherId: string) => void;
  onNew: () => void;
  onRefresh: () => void;
  refreshing: boolean;
}): React.JSX.Element {
  const [search, setSearch] = useState("");
  const [receiving, setReceiving] = useState<ReceivingFilter>("all");
  const [pay, setPay] = useState<PayFilter>("all");
  const [supplier, setSupplier] = useState("all");
  const [page, setPage] = useState(1);

  const suppliers = useMemo(() => {
    return [...new Set(vouchers.map((v) => v.supplier_name).filter(Boolean))].sort();
  }, [vouchers]);

  const totalQty = vouchers.reduce(
    (sum, voucher) => sum + voucher.total_quantity_pairs,
    0,
  );
  const remainingAll = vouchers.reduce(
    (sum, voucher) => sum + remainingQty(voucher),
    0,
  );
  const openVouchers = vouchers.filter(
    (voucher) => receivingStatus(voucher) !== "fully_received",
  );
  const waitingVouchers = vouchers.filter(
    (voucher) => receivingStatus(voucher) === "waiting",
  );
  const countWaiting = waitingVouchers.length;
  const unpaid = vouchers.reduce(
    (sum, voucher) => sum + voucherBalance(voucher),
    0,
  );
  const unpaidCount = vouchers.filter(
    (voucher) => voucherBalance(voucher) > 0,
  ).length;

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    return vouchers.filter((voucher) => {
      const matchesQuery =
        query === "" ||
        voucher.voucher_no.toLowerCase().includes(query) ||
        voucher.supplier_name.toLowerCase().includes(query) ||
        voucher.carrier_name.toLowerCase().includes(query) ||
        voucher.lines.some(
          (line) =>
            line.stock_code.toLowerCase().includes(query) ||
            line.description.toLowerCase().includes(query),
        );
      const matchesReceiving =
        receiving === "all" || receivingStatus(voucher) === receiving;
      const matchesPay = pay === "all" || paymentStatus(voucher) === pay;
      const matchesSupplier =
        supplier === "all" || voucher.supplier_name === supplier;

      return (
        matchesQuery &&
        matchesReceiving &&
        matchesPay &&
        matchesSupplier
      );
    });
  }, [vouchers, search, receiving, pay, supplier]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const visible = filtered.slice(
    (safePage - 1) * PAGE_SIZE,
    safePage * PAGE_SIZE,
  );
  const isFiltered =
    search.trim() !== "" ||
    receiving !== "all" ||
    pay !== "all" ||
    supplier !== "all";

  const searchInputRef = useSearchShortcut();

  function resetFilters(): void {
    setSearch("");
    setReceiving("all");
    setPay("all");
    setSupplier("all");
    setPage(1);
  }

  return (
    <div className="flex flex-col gap-4">
      <CollapsibleKpiSummary storageKey="wholesale_vouchers" title="Vouchers Summary">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <FigureCard
            label="Open Vouchers"
            value={formatQty(openVouchers.length)}
            sub="in transit or partly received"
          />
          <FigureCard
            label="Waiting to Arrive"
            value={formatQty(countWaiting)}
            sub="factory dispatched, on the way"
            tone={countWaiting > 0 ? "warning" : "success"}
          />
          <FigureCard
            label="Qty Remaining to Arrive"
            value={sets(remainingAll)}
            sub={`of ${sets(totalQty)} ordered`}
            tone={remainingAll > 0 ? "error" : "success"}
          />
          <FigureCard
            label="Unpaid to Suppliers"
            value={formatKyat(unpaid)}
            sub={`${unpaidCount} voucher${unpaidCount === 1 ? "" : "s"} not fully paid`}
            tone={unpaid > 0 ? "error" : "success"}
          />
        </div>
      </CollapsibleKpiSummary>

      <TabBar<"vouchers" | "to_order">
        tabs={[
          {
            id: "vouchers",
            label: "Supplier Vouchers",
            count: vouchers.length,
          },
          {
            id: "to_order",
            label: "To Order",
            count: toOrderCount,
          },
        ]}
        activeTab="vouchers"
        onSelect={(tabId) => {
          if (tabId === "to_order") onToOrder();
        }}
      />

      <Panel className="shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-2.5 border-b border-border bg-bg-base">
          <div className="flex items-center gap-2 flex-wrap min-w-0">
            <h2 className="text-base font-semibold text-text-primary tracking-tight mr-1">
              Supplier Vouchers
            </h2>
            <span className="text-xs text-text-muted hidden sm:inline">
              Track supplier procurement vouchers, payments, and arrivals
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
                aria-label="Search vouchers"
                placeholder="Search vouchers… (/)"
                startIcon={<SearchIcon className="w-3.5 h-3.5" />}
                value={search}
                onChange={(event) => {
                  setSearch(event.target.value);
                  setPage(1);
                }}
                className="h-8 text-xs"
              />
            </div>
            <RefreshButton
              onClick={onRefresh}
              refreshing={refreshing}
            />
            <Button onClick={onNew} size="sm" className="h-8 text-xs">
              <PlusIcon className="w-3.5 h-3.5" />
              New voucher
            </Button>
          </div>
        </div>

        {visible.length === 0 ? (
          <EmptyState
            icon={<FactoryIcon />}
            title={isFiltered ? "No vouchers match" : "No vouchers yet"}
            description={
              isFiltered
                ? "Nothing here matches what you searched for. Try a different supplier or status."
                : "When a supplier sends its voucher for a batch, add it here so what is coming is written down."
            }
            action={
              isFiltered ? (
                <Button variant="secondary" onClick={resetFilters}>
                  Clear filters
                </Button>
              ) : (
                <Button onClick={onNew}>
                  <PlusIcon className="w-4 h-4" />
                  New voucher
                </Button>
              )
            }
          />
        ) : (
          <>
            <TableContainer className="border-0 rounded-none">
              <Thead>
                <Tr>
                  <Th className="w-10 sm:w-12 text-center text-text-muted font-normal select-none">#</Th>
                  <Th className="whitespace-nowrap min-w-[10rem]">Voucher no.</Th>
                  <Th className="whitespace-nowrap min-w-[12rem]">
                    {suppliers.length > 1 ? (
                      <ColumnHeaderFilter
                        label="Supplier / Factory"
                        isActive={supplier !== "all"}
                      >
                        {(close) => (
                          <div className="flex flex-col gap-1.5">
                            <div className="font-semibold text-text-primary text-[11px] uppercase tracking-wider pb-1 border-b border-border">
                              Filter Supplier
                            </div>
                            <div className="space-y-0.5 max-h-48 overflow-y-auto">
                              <button
                                type="button"
                                onClick={() => {
                                  setSupplier("all");
                                  setPage(1);
                                  close();
                                }}
                                className={cn(
                                  "w-full text-left px-2 py-1 rounded text-xs transition-colors flex items-center justify-between",
                                  supplier === "all"
                                    ? "bg-brand/10 font-bold text-brand"
                                    : "hover:bg-bg-subtle text-text-secondary",
                                )}
                              >
                                <span>All suppliers</span>
                                {supplier === "all" && (
                                  <CheckIcon className="w-3.5 h-3.5" />
                                )}
                              </button>
                              {suppliers.map((name) => (
                                <button
                                  key={name}
                                  type="button"
                                  onClick={() => {
                                    setSupplier(name);
                                    setPage(1);
                                    close();
                                  }}
                                  className={cn(
                                    "w-full text-left px-2 py-1 rounded text-xs transition-colors flex items-center justify-between",
                                    supplier === name
                                      ? "bg-brand/10 font-bold text-brand"
                                      : "hover:bg-bg-subtle text-text-secondary",
                                  )}
                                >
                                  <span>{name}</span>
                                  {supplier === name && (
                                    <CheckIcon className="w-3.5 h-3.5" />
                                  )}
                                </button>
                              ))}
                            </div>
                          </div>
                        )}
                      </ColumnHeaderFilter>
                    ) : (
                      "Supplier / Factory"
                    )}
                  </Th>
                  <Th className="whitespace-nowrap">Date</Th>
                  <Th className="min-w-[17.5rem] whitespace-nowrap">
                    Received / Ordered
                  </Th>
                  <Th className="whitespace-nowrap">
                    <ColumnHeaderFilter
                      label="Receiving status"
                      isActive={receiving !== "all"}
                    >
                      {(close) => (
                        <div className="flex flex-col gap-1.5">
                          <div className="font-semibold text-text-primary text-[11px] uppercase tracking-wider pb-1 border-b border-border">
                            Filter Receiving Status
                          </div>
                          <div className="space-y-0.5 max-h-48 overflow-y-auto">
                            <button
                              type="button"
                              onClick={() => {
                                setReceiving("all");
                                setPage(1);
                                close();
                              }}
                              className={cn(
                                "w-full text-left px-2 py-1 rounded text-xs transition-colors flex items-center justify-between",
                                receiving === "all"
                                  ? "bg-brand/10 font-bold text-brand"
                                  : "hover:bg-bg-subtle text-text-secondary",
                              )}
                            >
                              <span>Any receiving status</span>
                              {receiving === "all" && (
                                <CheckIcon className="w-3.5 h-3.5" />
                              )}
                            </button>
                            {RECEIVING_STATUSES.map((option) => (
                              <button
                                key={option}
                                type="button"
                                onClick={() => {
                                  setReceiving(option);
                                  setPage(1);
                                  close();
                                }}
                                className={cn(
                                  "w-full text-left px-2 py-1 rounded text-xs transition-colors flex items-center justify-between",
                                  receiving === option
                                    ? "bg-brand/10 font-bold text-brand"
                                    : "hover:bg-bg-subtle text-text-secondary",
                                )}
                              >
                                <span>{RECEIVING_LABELS[option]}</span>
                                {receiving === option && (
                                  <CheckIcon className="w-3.5 h-3.5" />
                                )}
                              </button>
                            ))}
                          </div>
                        </div>
                      )}
                    </ColumnHeaderFilter>
                  </Th>
                  <Th className="whitespace-nowrap">
                    <ColumnHeaderFilter
                      label="Payment status"
                      isActive={pay !== "all"}
                    >
                      {(close) => (
                        <div className="flex flex-col gap-1.5">
                          <div className="font-semibold text-text-primary text-[11px] uppercase tracking-wider pb-1 border-b border-border">
                            Filter Payment Status
                          </div>
                          <div className="space-y-0.5 max-h-48 overflow-y-auto">
                            <button
                              type="button"
                              onClick={() => {
                                setPay("all");
                                setPage(1);
                                close();
                              }}
                              className={cn(
                                "w-full text-left px-2 py-1 rounded text-xs transition-colors flex items-center justify-between",
                                pay === "all"
                                  ? "bg-brand/10 font-bold text-brand"
                                  : "hover:bg-bg-subtle text-text-secondary",
                              )}
                            >
                              <span>Any payment</span>
                              {pay === "all" && (
                                <CheckIcon className="w-3.5 h-3.5" />
                              )}
                            </button>
                            {PAYMENT_STATUSES.map((option) => (
                              <button
                                key={option}
                                type="button"
                                onClick={() => {
                                  setPay(option);
                                  setPage(1);
                                  close();
                                }}
                                className={cn(
                                  "w-full text-left px-2 py-1 rounded text-xs transition-colors flex items-center justify-between",
                                  pay === option
                                    ? "bg-brand/10 font-bold text-brand"
                                    : "hover:bg-bg-subtle text-text-secondary",
                                )}
                              >
                                <span>{PAYMENT_LABELS[option]}</span>
                                {pay === option && (
                                  <CheckIcon className="w-3.5 h-3.5" />
                                )}
                              </button>
                            ))}
                          </div>
                        </div>
                      )}
                    </ColumnHeaderFilter>
                  </Th>
                  <Th className="w-12 text-right" aria-label="Actions" />
                </Tr>
              </Thead>
              <Tbody>
                {visible.map((voucher, index) => {
                  const remaining = remainingQty(voucher);
                  const receivedPairs = voucher.received_quantity_pairs ?? 0;
                  const orderedPairs = voucher.total_quantity_pairs;
                  const hasBalance = voucherBalance(voucher) > 0;
                  const canDelete = voucher.allowed_actions
                    ? voucher.allowed_actions.includes("delete")
                    : true;
                  const rowNum = (safePage - 1) * PAGE_SIZE + index + 1;
                  return (
                    <Tr key={voucher.voucher_id}>
                      <Td className="text-center text-xs font-mono text-text-muted tabular-nums select-none">
                        {rowNum}
                      </Td>
                      <Td className="whitespace-nowrap">
                        <Reference
                          value={voucher.voucher_no}
                          what="voucher no."
                          onClick={() => onOpen(voucher.voucher_id)}
                        />
                      </Td>
                      <Td className="font-medium whitespace-nowrap">
                        <div className="flex flex-col gap-0.5">
                          <span className="font-semibold text-text-primary">
                            {voucher.supplier_name}
                          </span>
                          {voucher.carrier_name && (
                            <span className="text-[11px] text-text-muted">
                              {voucher.carrier_name}
                              {voucher.total_packages ? (
                                <span className="text-brand font-medium">
                                  {" "}({voucher.total_packages} {voucher.total_packages === 1 ? "package" : "packages"})
                                </span>
                              ) : (
                                ""
                              )}
                            </span>
                          )}
                        </div>
                      </Td>
                      <Td className="text-text-muted whitespace-nowrap">
                        {formatDate(voucher.voucher_date)}
                      </Td>
                      <Td className="whitespace-nowrap">
                        <div className="flex flex-col gap-1.5 w-full min-w-[16.5rem] max-w-[21rem]">
                          <div className="flex items-center justify-between gap-4 text-xs font-mono">
                            <span className="font-semibold text-text-primary whitespace-nowrap shrink-0">
                              {sets(receivedPairs)}
                              <span className="text-text-muted/60 font-normal"> / </span>
                              <span className="text-text-secondary font-normal">{sets(orderedPairs)}</span>
                            </span>
                            {remaining > 0 ? (
                              <span className="text-error text-[11px] font-sans font-medium whitespace-nowrap shrink-0">
                                {sets(remaining)} left
                              </span>
                            ) : (
                              <span className="text-success text-[11px] font-sans font-medium whitespace-nowrap shrink-0">
                                Done
                              </span>
                            )}
                          </div>
                          <RowProgress
                            pct={receivedPct(voucher)}
                            label={`Receiving progress for ${voucher.voucher_no}`}
                          />
                        </div>
                      </Td>
                      <Td>
                        <ReceivingBadge status={receivingStatus(voucher)} />
                      </Td>
                      <Td>
                        <PaymentBadge status={paymentStatus(voucher)} />
                      </Td>
                      <Td className="text-right">
                        <RowMenu
                          onOpen={() => onOpen(voucher.voucher_id)}
                          onPay={
                            hasBalance
                              ? () => onPay(voucher.voucher_id)
                              : () => onPay(voucher.voucher_id)
                          }
                          onDelete={() => onDelete(voucher.voucher_id)}
                          canDelete={canDelete}
                        />
                      </Td>
                    </Tr>
                  );
                })}
              </Tbody>
            </TableContainer>
            <div className="px-4 py-1.5 border-t border-border">
              <Pagination
                page={safePage}
                totalPages={totalPages}
                totalItems={filtered.length}
                pageSize={PAGE_SIZE}
                onPageChange={setPage}
              />
            </div>
          </>
        )}
      </Panel>
    </div>
  );
}
