import React, { useMemo, useState } from "react";
import { cn } from "@renderer/lib/utils";
import { Button } from "@renderer/components/ui/Button";
import { EmptyState } from "@renderer/components/ui/EmptyState";
import {
  FigureCard,
  Panel,
  Reference,
  SuggestInput,
  CopyButton,
} from "@renderer/components/features/wholesale/ui";
import {
  TableContainer,
  Thead,
  Tbody,
  Tr,
  Th,
  Td,
} from "@renderer/components/ui/Table";
import {
  ChevronLeftIcon,
  ChevronRightIcon,
  ClipboardIcon,
  PlusIcon,
  WarehouseIcon,
} from "@renderer/components/ui/icons";
import {
  GROUP_LABELS,
} from "@renderer/components/features/wholesale/products";
import {
  SUPPLIER_NAMES,
} from "@renderer/components/features/wholesale/masterData";
import { formatQty } from "@renderer/components/features/wholesale/shared";
import { type CustomerOrder } from "@renderer/components/features/wholesale/customerOrders";
import { type SupplierVoucher } from "@renderer/components/features/wholesale/supplierVouchers";
import {
  UNASSIGNED_SUPPLIER,
  sets,
  type OpenOrderLine,
} from "./types";
import { supplierDemandGroups } from "./voucherOrderUtils";

export function SupplierVoucherTabs({
  active,
  onVouchers,
  onToOrder,
  toOrderCount = 0,
}: {
  active: "vouchers" | "to_order";
  onVouchers: () => void;
  onToOrder: () => void;
  toOrderCount?: number;
}): React.JSX.Element {
  return (
    <div className="flex items-center gap-1 px-6 pt-3 border-b border-border">
      <button
        type="button"
        onClick={onVouchers}
        className={cn(
          "border-b-2 px-3 pb-3 text-sm font-semibold transition-colors duration-150",
          active === "vouchers"
            ? "border-brand text-brand"
            : "border-transparent text-text-muted hover:text-text-primary",
        )}
      >
        Supplier vouchers
      </button>
      <button
        type="button"
        onClick={onToOrder}
        className={cn(
          "inline-flex items-center gap-2 border-b-2 px-3 pb-3 text-sm font-semibold transition-colors duration-150",
          active === "to_order"
            ? "border-brand text-brand"
            : "border-transparent text-text-muted hover:text-text-primary",
        )}
      >
        <span>Create from customer orders</span>
        {toOrderCount > 0 && (
          <span
            className={cn(
              "inline-flex h-5 min-w-5 items-center justify-center rounded-full px-1.5 text-xs font-bold leading-none tabular-nums",
              active === "to_order"
                ? "bg-brand text-white"
                : "bg-brand-subtle text-brand border border-brand/30",
            )}
          >
            {toOrderCount}
          </span>
        )}
      </button>
    </div>
  );
}

export function ToOrderView({
  orders,
  vouchers,
  onOpenVouchers,
  onRefresh,
  refreshing,
  onCreateVoucher,
  onAssignSupplier,
}: {
  orders: CustomerOrder[];
  vouchers: SupplierVoucher[];
  onOpenVouchers: () => void;
  onRefresh: () => void;
  refreshing: boolean;
  onCreateVoucher: (supplierName: string, orderLines: OpenOrderLine[]) => void;
  onAssignSupplier: (
    orderId: string,
    orderLineId: string,
    supplierName: string,
  ) => Promise<void>;
}): React.JSX.Element {
  const [supplierDrafts, setSupplierDrafts] = useState<Record<string, string>>(
    {},
  );
  const [savingLineId, setSavingLineId] = useState<string | null>(null);
  const [selectedSupplier, setSelectedSupplier] = useState<string | null>(null);
  const [selectedLineIds, setSelectedLineIds] = useState<string[]>([]);
  const groups = useMemo(
    () => supplierDemandGroups(orders, vouchers),
    [orders, vouchers],
  );
  const totalQty = groups.reduce(
    (sum, group) => sum + group.total,
    0,
  );
  const selectedGroup = groups.find(
    (group) => group.supplierName === selectedSupplier,
  );
  const selectedLines =
    selectedGroup?.lines.filter((line) =>
      selectedLineIds.includes(line.order_line_id),
    ) ?? [];
  const selectedTotal = selectedLines.reduce(
    (sum, line) => sum + line.remaining,
    0,
  );
  const allProductsSelected =
    !!selectedGroup &&
    selectedGroup.lines.length > 0 &&
    selectedGroup.lines.every((line) =>
      selectedLineIds.includes(line.order_line_id),
    );

  async function saveSupplier(line: OpenOrderLine): Promise<void> {
    const supplierName = supplierDrafts[line.order_line_id]?.trim() ?? "";
    if (!supplierName || savingLineId) return;

    setSavingLineId(line.order_line_id);
    try {
      await onAssignSupplier(line.order_id, line.order_line_id, supplierName);
      setSupplierDrafts((current) => {
        const next = { ...current };
        delete next[line.order_line_id];
        return next;
      });
    } finally {
      setSavingLineId(null);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="grid gap-4 grid-cols-1 sm:grid-cols-3">
        <FigureCard
          label="Suppliers waiting"
          value={formatQty(groups.length)}
          sub="with customer demand"
          tone={groups.length > 0 ? "warning" : "success"}
        />
        <FigureCard
          label="Products waiting"
          value={formatQty(
            groups.reduce(
              (sum, group) => sum + group.lines.length,
              0,
            ),
          )}
          sub="products to request"
        />
        <FigureCard
          label="Quantity to request"
          value={sets(totalQty)}
          sub="after existing vouchers"
          tone={totalQty > 0 ? "error" : "success"}
        />
      </div>

      <Panel>
        <div className="flex flex-wrap items-center justify-between gap-3 px-6 py-4 border-b border-border">
          <div className="flex min-w-0 items-center gap-3">
            <div className="min-w-0">
              <h2 className="text-base font-semibold text-text-primary tracking-tight">
                Create from customer orders
              </h2>
              <p className="text-sm text-text-muted mt-0.5">
                Customer order products still waiting for a supplier voucher.
              </p>
            </div>
          </div>
          <Button
            variant="secondary"
            size="sm"
            onClick={onRefresh}
            loading={refreshing}
          >
            Refresh
          </Button>
        </div>

        <SupplierVoucherTabs
          active="to_order"
          onVouchers={onOpenVouchers}
          onToOrder={() => undefined}
          toOrderCount={groups.reduce((sum, g) => sum + g.lines.length, 0)}
        />

        {groups.length === 0 ? (
          <EmptyState
            icon={<ClipboardIcon />}
            title="Nothing to order"
            description="All open customer demand is already covered by supplier vouchers."
          />
        ) : !selectedGroup ? (
          <div className="p-6">
            <div className="mb-5">
              <h3 className="font-semibold text-text-primary">
                Choose a supplier
              </h3>
              <p className="mt-1 text-sm text-text-muted">
                Select a supplier to see only the customer-order products it
                needs to supply.
              </p>
            </div>
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
              {groups.map((group) => {
                const isUnassigned =
                  group.supplierName === UNASSIGNED_SUPPLIER;
                return (
                  <section
                    key={group.supplierName}
                    className="flex flex-col overflow-hidden rounded-xl border border-border bg-bg-base transition-all duration-150 hover:border-brand/50 hover:shadow-sm"
                  >
                    <div className="flex items-center justify-between gap-3 border-b border-border bg-bg-subtle/40 px-5 py-4">
                      <div className="flex min-w-0 items-center gap-3">
                        <span
                          className={cn(
                            "flex h-8 w-8 shrink-0 items-center justify-center rounded-full",
                            isUnassigned
                              ? "bg-warning-subtle text-warning"
                              : "bg-brand-subtle text-brand",
                          )}
                        >
                          <WarehouseIcon className="h-4 w-4" />
                        </span>
                        <div className="min-w-0">
                          <p className="text-[11px] font-semibold uppercase tracking-wide text-text-muted">
                            Supplier
                          </p>
                          <h4
                            className={cn(
                              "mt-0.5 break-words text-base font-semibold",
                              isUnassigned
                                ? "text-warning"
                                : "text-text-primary",
                            )}
                          >
                            {isUnassigned
                              ? "Supplier not chosen"
                              : group.supplierName}
                          </h4>
                        </div>
                      </div>
                    </div>
                    <div className="grid grid-cols-2 divide-x divide-border">
                      <div className="px-5 py-4">
                        <p className="text-xs font-medium text-text-muted">
                          Products
                        </p>
                        <p className="mt-1 text-lg font-semibold tabular-nums text-text-primary">
                          {formatQty(group.lines.length)}
                        </p>
                      </div>
                      <div className="px-5 py-4">
                        <p className="text-xs font-medium text-text-muted">
                          To request
                        </p>
                        <p className="mt-1 text-lg font-semibold tabular-nums text-text-primary">
                          {sets(group.total)}
                        </p>
                      </div>
                    </div>
                    <div className="px-5 pb-5">
                      <Button
                        className="w-full justify-center"
                        size="sm"
                        variant={isUnassigned ? "secondary" : "primary"}
                        onClick={() => {
                          setSelectedSupplier(group.supplierName);
                          setSelectedLineIds(
                            group.lines.map(
                              (line) => line.order_line_id,
                            ),
                          );
                        }}
                      >
                        {isUnassigned ? "Assign supplier" : "Choose products"}
                        <ChevronRightIcon className="h-4 w-4" />
                      </Button>
                    </div>
                  </section>
                );
              })}
            </div>
          </div>
        ) : (
          <div className="flex flex-col">
            <div className="flex flex-wrap items-center justify-between gap-3 bg-bg-subtle px-6 py-4">
              <div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    aria-label="Back to suppliers"
                    title="Back to suppliers"
                    className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-border text-text-muted transition-colors duration-150 hover:border-brand/50 hover:bg-brand-subtle hover:text-brand focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2"
                    onClick={() => {
                      setSelectedSupplier(null);
                      setSelectedLineIds([]);
                    }}
                  >
                    <ChevronLeftIcon className="h-4 w-4" />
                  </button>
                  <h3
                    className={cn(
                      "font-semibold",
                      selectedGroup.supplierName === UNASSIGNED_SUPPLIER
                        ? "text-warning"
                        : "text-text-primary",
                    )}
                  >
                    {selectedGroup.supplierName === UNASSIGNED_SUPPLIER
                      ? "Supplier not chosen"
                      : selectedGroup.supplierName}
                  </h3>
                </div>
                <p className="text-sm text-text-muted">
                  {selectedGroup.supplierName === UNASSIGNED_SUPPLIER
                    ? "Assign a supplier to each product before creating a supplier voucher."
                    : `${formatQty(selectedGroup.lines.length)} product${selectedGroup.lines.length === 1 ? "" : "s"} · ${sets(selectedGroup.total)} to request`}
                </p>
              </div>
              <div className="flex flex-wrap items-center justify-end gap-3">
                <span className="text-sm text-text-muted">
                  {formatQty(selectedLines.length)} selected ·{" "}
                  {sets(selectedTotal)}
                </span>
                {selectedGroup.supplierName !== UNASSIGNED_SUPPLIER && (
                  <Button
                    size="sm"
                    disabled={selectedLines.length === 0}
                    onClick={() =>
                      onCreateVoucher(selectedGroup.supplierName, selectedLines)
                    }
                  >
                    <PlusIcon className="w-4 h-4" />
                    Create voucher
                  </Button>
                )}
              </div>
            </div>
            <TableContainer className="rounded-none border-0">
              <Thead>
                <Tr>
                  <Th>
                    <label className="flex cursor-pointer items-center gap-2">
                      <input
                        type="checkbox"
                        className="h-4 w-4 accent-brand"
                        aria-label="Select all products"
                        checked={allProductsSelected}
                        ref={(element) => {
                          if (element) {
                            element.indeterminate =
                              selectedLines.length > 0 && !allProductsSelected;
                          }
                        }}
                        onChange={(event) =>
                          setSelectedLineIds(
                            event.target.checked
                              ? selectedGroup.lines.map(
                                  (line) => line.order_line_id,
                                )
                              : [],
                          )
                        }
                      />
                      <span>Order</span>
                    </label>
                  </Th>
                  <Th>Customer</Th>
                  <Th>Product</Th>
                  <Th>Colors</Th>
                  <Th className="text-right whitespace-nowrap">
                    Qty to request
                  </Th>
                  {selectedGroup.supplierName === UNASSIGNED_SUPPLIER && (
                    <Th className="min-w-[17rem]">Supplier</Th>
                  )}
                </Tr>
              </Thead>
              <Tbody>
                {selectedGroup.lines.map((line, index) => (
                  <Tr key={`${line.order_no}-${line.stock_code}-${index}`}>
                    <Td>
                      <div className="flex items-start gap-2">
                        <input
                          type="checkbox"
                          className="h-4 w-4 accent-brand"
                          aria-label={`Select ${line.stock_code || "product"} from ${line.order_no}`}
                          checked={selectedLineIds.includes(line.order_line_id)}
                          onChange={(event) =>
                            setSelectedLineIds((current) =>
                              event.target.checked
                                ? [...new Set([...current, line.order_line_id])]
                                : current.filter(
                                    (id) => id !== line.order_line_id,
                                  ),
                            )
                          }
                        />
                        <Reference value={line.order_no} what="order no." />
                      </div>
                    </Td>
                    <Td className="font-medium whitespace-nowrap">
                      {line.customer_name}
                    </Td>
                    <Td>
                      <div className="flex min-w-0 flex-col items-start gap-0.5">
                        <div className="flex min-w-0 items-center gap-1">
                          <span className="break-words font-semibold text-brand">
                            {line.stock_code || "No stock code"}
                          </span>
                          {line.stock_code && (
                            <CopyButton
                              value={line.stock_code}
                              what="stock code"
                            />
                          )}
                        </div>
                        <span className="break-words text-text-primary">
                          {line.description || "—"}
                        </span>
                        <span className="text-xs text-text-muted">
                          {GROUP_LABELS[line.product_group]}
                        </span>
                      </div>
                    </Td>
                    <Td className="font-mono text-xs text-text-secondary whitespace-normal break-words">
                      {line.color_breakdown || "—"}
                    </Td>
                    <Td className="text-right tabular-nums font-semibold text-error whitespace-nowrap">
                      {sets(line.remaining)}
                    </Td>
                    {selectedGroup.supplierName === UNASSIGNED_SUPPLIER && (
                      <Td>
                        <div className="flex min-w-[16rem] items-start gap-2">
                          <div className="min-w-0 flex-1">
                            <SuggestInput
                              bare
                              label={`Supplier for ${line.stock_code || "product"} in ${line.order_no}`}
                              placeholder="Choose or type supplier"
                              suggestions={SUPPLIER_NAMES}
                              value={supplierDrafts[line.order_line_id] ?? ""}
                              onChange={(value) =>
                                setSupplierDrafts((current) => ({
                                  ...current,
                                  [line.order_line_id]: value,
                                }))
                              }
                            />
                          </div>
                          <Button
                            size="sm"
                            onClick={() => void saveSupplier(line)}
                            loading={savingLineId === line.order_line_id}
                            disabled={
                              !supplierDrafts[line.order_line_id]?.trim() ||
                              savingLineId !== null
                            }
                          >
                            Save
                          </Button>
                        </div>
                      </Td>
                    )}
                  </Tr>
                ))}
              </Tbody>
            </TableContainer>
          </div>
        )}
      </Panel>
    </div>
  );
}
