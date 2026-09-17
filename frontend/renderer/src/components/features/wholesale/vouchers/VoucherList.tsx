import React, { useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@renderer/components/ui/Button";
import { EmptyState } from "@renderer/components/ui/EmptyState";
import { Input } from "@renderer/components/ui/Input";
import { Pagination } from "@renderer/components/ui/Pagination";
import { Select } from "@renderer/components/ui/Select";
import {
  TableContainer,
  Thead,
  Tbody,
  Tr,
  Th,
  Td,
} from "@renderer/components/ui/Table";
import {
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
} from "@renderer/components/features/wholesale/ui";
import {
  formatDate,
  formatKyat,
  formatQty,
} from "@renderer/components/features/wholesale/shared";
import {
  paymentStatus,
  receivedPct,
  receivingStatus,
  remainingQty,
  voucherBalance,
  type SupplierVoucher,
} from "@renderer/components/features/wholesale/supplierVouchers";
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
import { SupplierVoucherTabs } from "./ToOrderView";

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
  const [page, setPage] = useState(1);

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

      return matchesQuery && matchesReceiving && matchesPay;
    });
  }, [vouchers, search, receiving, pay]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const visible = filtered.slice(
    (safePage - 1) * PAGE_SIZE,
    safePage * PAGE_SIZE,
  );
  const isFiltered =
    search.trim() !== "" || receiving !== "all" || pay !== "all";

  const searchInputRef = useRef<HTMLInputElement>(null);
  const isMac = typeof window !== "undefined" && Boolean(window.api?.isMac);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent): void => {
      const activeEl = document.activeElement;
      const isInput =
        activeEl instanceof HTMLInputElement ||
        activeEl instanceof HTMLTextAreaElement;

      if ((e.key === "/" && !isInput) || ((e.metaKey || e.ctrlKey) && (e.key === "f" || e.key === "F"))) {
        e.preventDefault();
        searchInputRef.current?.focus();
        searchInputRef.current?.select();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  function resetFilters(): void {
    setSearch("");
    setReceiving("all");
    setPay("all");
    setPage(1);
  }

  return (
    <div className="flex flex-col gap-4">
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

      <Panel className="shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3 px-6 py-4 border-b border-border">
          <div>
            <h2 className="text-base font-semibold text-text-primary tracking-tight">
              Supplier vouchers
            </h2>
            <p className="text-sm text-text-muted mt-0.5">
              Manage all supplier vouchers.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="secondary"
              size="sm"
              onClick={onRefresh}
              loading={refreshing}
            >
              Refresh
            </Button>
            <Button onClick={onNew}>
              <PlusIcon className="w-4 h-4" />
              New voucher
            </Button>
          </div>
        </div>

        <SupplierVoucherTabs
          active="vouchers"
          onVouchers={() => undefined}
          onToOrder={onToOrder}
          toOrderCount={toOrderCount}
        />

        <div className="flex flex-wrap items-center gap-3 px-6 py-3 border-b border-border bg-bg-subtle">
          <div className="w-full sm:w-[28rem] lg:w-[32rem]">
            <Input
              ref={searchInputRef}
              aria-label="Search vouchers"
              placeholder="Search voucher no., supplier, cargo or product (/ or ⌘F)"
              startIcon={<SearchIcon className="w-4 h-4" />}
              endIcon={
                <span className="text-[10px] text-text-muted/60 border border-border rounded px-1.5 py-0.5 select-none hidden sm:inline">
                  {isMac ? "⌘F" : "Ctrl+F"}
                </span>
              }
              value={search}
              onChange={(event) => {
                setSearch(event.target.value);
                setPage(1);
              }}
            />
          </div>
          <div className="w-full sm:w-52">
            <Select
              aria-label="Filter by receiving status"
              value={receiving}
              onChange={(event) => {
                setReceiving(event.target.value as ReceivingFilter);
                setPage(1);
              }}
            >
              <option value="all">Any receiving status</option>
              {RECEIVING_STATUSES.map((option) => (
                <option key={option} value={option}>
                  {RECEIVING_LABELS[option]}
                </option>
              ))}
            </Select>
          </div>
          <div className="w-full sm:w-48">
            <Select
              aria-label="Filter by payment"
              value={pay}
              onChange={(event) => {
                setPay(event.target.value as PayFilter);
                setPage(1);
              }}
            >
              <option value="all">Any payment</option>
              {PAYMENT_STATUSES.map((option) => (
                <option key={option} value={option}>
                  {PAYMENT_LABELS[option]}
                </option>
              ))}
            </Select>
          </div>
          {isFiltered && (
            <Button variant="ghost" size="sm" onClick={resetFilters}>
              <CloseIcon className="w-4 h-4" />
              Clear filters
            </Button>
          )}
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
                  <Th className="whitespace-nowrap min-w-[10rem]">Voucher no.</Th>
                  <Th className="whitespace-nowrap min-w-[12rem]">Supplier / Factory</Th>
                  <Th className="whitespace-nowrap">Date</Th>
                  <Th className="min-w-[17.5rem] whitespace-nowrap">
                    Received / Ordered
                  </Th>
                  <Th className="whitespace-nowrap">Receiving status</Th>
                  <Th className="whitespace-nowrap">Payment status</Th>
                  <Th className="w-12 text-right" aria-label="Actions" />
                </Tr>
              </Thead>
              <Tbody>
                {visible.map((voucher) => {
                  const remaining = remainingQty(voucher);
                  const receivedPairs = voucher.received_quantity_pairs ?? 0;
                  const orderedPairs = voucher.total_quantity_pairs;
                  const hasBalance = voucherBalance(voucher) > 0;
                  const canDelete = voucher.allowed_actions
                    ? voucher.allowed_actions.includes("delete")
                    : true;
                  return (
                    <Tr key={voucher.voucher_id}>
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
            <div className="px-6 py-3 border-t border-border">
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
