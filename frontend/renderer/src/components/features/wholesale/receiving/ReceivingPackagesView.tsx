import React from "react";
import { cn } from "@renderer/lib/utils";
import { Button } from "@renderer/components/ui/Button";
import { Input } from "@renderer/components/ui/Input";
import {
  CopyIcon,
  PlusIcon,
  TrashIcon,
  WarningIcon,
} from "@renderer/components/ui/icons";
import {
  TableContainer,
  Tbody,
  Td,
  Th,
  Thead,
  Tr,
} from "@renderer/components/ui/Table";
import {
  CellInput,
  SuggestInput,
} from "@renderer/components/features/wholesale/shared/ui";
import {
  packagePairs,
  type Receiving,
  type ReceivingPackage,
} from "@renderer/components/features/wholesale/receiving/receivings";
import { formatSets } from "@renderer/components/features/wholesale/shared/units";
import { STOCK_CODES } from "@renderer/components/features/wholesale/masterData/masterData";
import { colorQtyProblem } from "@renderer/components/features/wholesale/shared/shared";
import { OpenedToggle } from "./ReceivingBadges";
import {
  formatStoredQuantity,
  receivedColorProblem,
  receivedColorQuantityProblem,
  receivedStockCodeProblem,
  type VoucherExpectations,
} from "./voucherCheckUtils";

export function ReceivingPackagesView({
  receiving,
  expected,
  allProblems,
  packageSearch,
  setPackageSearch,
  setSelectedPackageIndex,
  safePackageIndex,
  activePackage,
  filteredPackagesWithIndex,
  filteredMissingNos,
  counted,
  opened,
  isLastPackage,
  activePackageHasCount,
  confirmUndoArrival,
  setConfirmUndoArrival,
  undoLastArrival,
  markPackageArrived,
  toggleOpened,
  setPackage,
  duplicatePreviousPackage,
  addItem,
  removeItem,
  setStockCode,
  setColorQty,
}: {
  receiving: Receiving;
  expected: VoucherExpectations;
  allProblems: string[];
  packageSearch: string;
  setPackageSearch: (query: string) => void;
  setSelectedPackageIndex: (index: number) => void;
  safePackageIndex: number;
  activePackage: ReceivingPackage | undefined;
  filteredPackagesWithIndex: { pkg: ReceivingPackage; originalIndex: number }[];
  filteredMissingNos: number[];
  counted: number;
  opened: number;
  isLastPackage: boolean;
  activePackageHasCount: boolean;
  confirmUndoArrival: boolean;
  setConfirmUndoArrival: (confirming: boolean) => void;
  undoLastArrival: () => void;
  markPackageArrived: (packageNo: number) => void;
  toggleOpened: (index: number) => void;
  setPackage: (index: number, patch: Partial<ReceivingPackage>) => void;
  duplicatePreviousPackage: (targetIndex: number) => void;
  addItem: (packageIndex: number) => void;
  removeItem: (packageIndex: number, itemIndex: number) => void;
  setStockCode: (packageIndex: number, itemIndex: number, stockCode: string) => void;
  setColorQty: (packageIndex: number, itemIndex: number, colorBreakdown: string) => void;
}): React.JSX.Element {
  return (
    <div className="flex flex-col gap-2.5 flex-1 min-h-0">
      {allProblems.length > 0 && (
        <div className="rounded-lg border border-warning/40 bg-warning-subtle/60 px-4 py-2.5">
          <span className="text-xs font-bold text-warning flex items-center gap-1.5">
            <WarningIcon className="w-3.5 h-3.5" />
            Does not match the voucher ({allProblems.length})
          </span>
          <ul className="mt-1.5 text-[11px] text-text-secondary grid gap-x-6 gap-y-1 sm:grid-cols-2 lg:grid-cols-3 max-h-24 overflow-y-auto">
            {allProblems.map((prob, i) => (
              <li key={i} className="leading-tight">
                • {prob}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Main 2-Column Cockpit */}
      <div className="flex-1 min-h-[540px] flex border border-border rounded-xl bg-bg-base overflow-hidden shadow-xs">
        {/* ── Left Column: Packages list ─────────────────────────────── */}
        <aside className="w-64 sm:w-72 shrink-0 border-r border-border flex flex-col bg-bg-subtle/40">
          <div className="p-3 border-b border-border/80 flex items-center justify-between gap-2">
            <div className="flex items-center gap-1.5">
              <span className="text-xs font-bold uppercase tracking-wider text-text-secondary">
                Packages
              </span>
              <span className="rounded-full bg-border px-1.5 py-0.2 text-[10px] font-mono text-text-muted">
                {receiving.packages.length}
              </span>
            </div>
          </div>

          <div className="p-2 border-b border-border/60">
            <Input
              placeholder="Filter package #..."
              value={packageSearch}
              onChange={(e) => setPackageSearch(e.target.value)}
              className="h-7 text-xs bg-bg-base"
            />
          </div>

          <div className="flex-1 overflow-y-auto divide-y divide-border/40 p-1.5 space-y-1">
            {filteredPackagesWithIndex.map(({ pkg, originalIndex }) => {
              const isSelected = originalIndex === safePackageIndex;
              const pairs = packagePairs(pkg);
              return (
                <div
                  key={pkg.package_id}
                  role="button"
                  tabIndex={0}
                  onClick={() => setSelectedPackageIndex(originalIndex)}
                  className={cn(
                    "w-full text-left px-3 py-2 rounded-lg cursor-pointer transition-all flex items-center justify-between gap-2 select-none",
                    isSelected
                      ? "bg-brand text-white shadow-xs font-semibold"
                      : "hover:bg-bg-base text-text-primary bg-transparent",
                  )}
                >
                  <div className="min-w-0 flex items-center gap-2">
                    <span
                      className={cn(
                        "w-2 h-2 rounded-full shrink-0",
                        pkg.opened
                          ? isSelected
                            ? "bg-white"
                            : "bg-success"
                          : isSelected
                            ? "bg-white/50"
                            : "bg-text-muted/40",
                      )}
                    />
                    <span className="font-mono text-sm tracking-tight truncate">
                      #{pkg.package_no}
                    </span>
                  </div>

                  <div className="flex items-center gap-2 shrink-0 text-xs">
                    <span
                      className={cn(
                        "font-mono text-[11px]",
                        isSelected ? "text-white/90" : "text-text-muted",
                      )}
                    >
                      {pkg.opened
                        ? `${pkg.items.length} ${pkg.items.length === 1 ? "product" : "products"} · ${formatSets(pairs)}`
                        : "Unopened"}
                    </span>
                  </div>
                </div>
              );
            })}

            {/* Slots for packages the shipment sent that are not here, and the way
                they are brought in: click the slot when the package turns up and it
                becomes a real package ready to open. Kept grey rather than amber —
                one shipment's packages often arrive in more than one trip, so this
                is a normal in-progress state, not a fault. */}
            {filteredMissingNos.map((no) => (
              <div key={`missing-${no}`}>
                <button
                  type="button"
                  onClick={() => markPackageArrived(no)}
                  className="group w-full text-left px-3 py-2 rounded-lg flex items-center justify-between gap-2 select-none border border-dashed border-border-strong bg-transparent transition-colors hover:border-solid hover:border-brand hover:bg-brand-subtle"
                  title={
                    no === receiving.packages.length + 1
                      ? `Package #${no} has arrived — click to receive it`
                      : `Packages #${receiving.packages.length + 1}–#${no} have arrived — click to receive them`
                  }
                >
                  <div className="min-w-0 flex items-center gap-2">
                    <span className="w-2 h-2 rounded-full shrink-0 border border-text-muted/50 group-hover:border-brand" />
                    <span className="font-mono text-sm tracking-tight truncate text-text-muted group-hover:text-brand">
                      #{no}
                    </span>
                  </div>
                  <span className="font-mono text-[11px] text-text-muted group-hover:hidden">
                    Still to come
                  </span>
                  <span className="hidden font-mono text-[11px] font-semibold text-brand group-hover:inline">
                    It's here →
                  </span>
                </button>
              </div>
            ))}

            {filteredPackagesWithIndex.length === 0 &&
              filteredMissingNos.length === 0 && (
                <p className="p-4 text-center text-xs text-text-muted">
                  No packages match filter.
                </p>
              )}

            {/* The exception, kept quiet. Every package the shipment announced has
                a slot of its own above; this is for the ones it did not — an extra
                package that turned up, or a receiving with no shipment behind it to
                say how many to expect. */}
            {packageSearch.trim() === "" && (
              <button
                type="button"
                onClick={() =>
                  markPackageArrived(receiving.packages.length + 1)
                }
                className="w-full px-3 py-2 rounded-lg flex items-center gap-1.5 text-xs text-text-muted hover:text-brand hover:bg-bg-base transition-colors"
                title="Record a package the shipment did not list"
              >
                <PlusIcon className="w-3.5 h-3.5" />
                Extra package arrived
              </button>
            )}
          </div>

          <div className="p-2.5 border-t border-border/80 bg-bg-base flex items-center justify-between text-xs text-text-muted">
            <span>
              Opened: {opened}/{receiving.packages.length}
            </span>
            <span className="font-semibold text-text-primary font-mono">
              {formatSets(counted)}
            </span>
          </div>
        </aside>

        {/* ── Middle Column: Active Package Workbench ───────────────────── */}
        <main className="flex-1 min-w-0 flex flex-col bg-bg-base">
          {activePackage ? (
            <>
              {/* Active Package Top Bar */}
              <div className="px-5 py-3 border-b border-border flex flex-wrap items-center justify-between gap-3 bg-bg-subtle/20">
                <div className="flex items-center gap-4">
                  <div className="flex items-center gap-2">
                    <h3 className="text-base font-bold text-text-primary tracking-tight font-mono">
                      Package #{activePackage.package_no}
                    </h3>
                    <OpenedToggle
                      opened={activePackage.opened}
                      onToggle={() => toggleOpened(safePackageIndex)}
                    />
                  </div>

                  <div className="h-4 w-px bg-border" />

                  <div className="flex items-center gap-1.5 text-xs text-text-muted">
                    <span>Date:</span>
                    <CellInput
                      label="Package received date"
                      placeholder="YYYY-MM-DD"
                      type="date"
                      value={activePackage.received_on}
                      onChange={(received_on) =>
                        setPackage(safePackageIndex, { received_on })
                      }
                      className="w-28 text-xs font-mono"
                    />
                  </div>

                  <div className="flex items-center gap-1.5 text-xs text-text-muted">
                    <span>Note:</span>
                    <CellInput
                      label="Package note"
                      placeholder="Optional note"
                      value={activePackage.note}
                      onChange={(note) =>
                        setPackage(safePackageIndex, { note })
                      }
                      className="w-36 text-xs"
                    />
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  {safePackageIndex > 0 && (
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() =>
                        duplicatePreviousPackage(safePackageIndex)
                      }
                      className="h-7 text-xs gap-1"
                      title="Copy products & colors from previous package"
                    >
                      <CopyIcon className="w-3.5 h-3.5" />
                      <span>Copy Prev</span>
                    </Button>
                  )}

                  <Button
                    size="sm"
                    onClick={() => addItem(safePackageIndex)}
                    className="h-7 text-xs gap-1"
                    title="Add product to this package"
                  >
                    <PlusIcon className="w-3.5 h-3.5" />
                    <span>Add Product</span>
                  </Button>
                </div>
              </div>

              {/* Active Package Products Table */}
              <div className="flex-1 overflow-y-auto p-4">
                {!activePackage.opened ? (
                  <div className="h-full flex flex-col items-center justify-center text-center p-8 border-2 border-dashed border-border/80 rounded-xl bg-bg-subtle/20">
                    <p className="text-sm font-semibold text-text-primary">
                      Package #{activePackage.package_no} is currently
                      unopened.
                    </p>
                    <p className="mt-1 text-xs text-text-muted max-w-sm">
                      Open the package to physically count and record shoes
                      inside.
                    </p>
                    <Button
                      size="sm"
                      onClick={() => toggleOpened(safePackageIndex)}
                      className="mt-4 gap-1.5"
                    >
                      <span>Open Package</span>
                    </Button>

                    {isLastPackage &&
                      receiving.packages.length > 1 &&
                      (confirmUndoArrival ? (
                        <div className="mt-4 flex items-center gap-2">
                          <span className="text-xs text-text-muted">
                            This package already has products counted in it.
                          </span>
                          <Button
                            variant="destructive"
                            size="sm"
                            onClick={undoLastArrival}
                            className="h-7 text-xs"
                          >
                            Discard count
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => setConfirmUndoArrival(false)}
                            className="h-7 text-xs"
                          >
                            Keep
                          </Button>
                        </div>
                      ) : (
                        <button
                          type="button"
                          onClick={() =>
                            activePackageHasCount
                              ? setConfirmUndoArrival(true)
                              : undoLastArrival()
                          }
                          className="mt-3 text-xs text-text-muted underline underline-offset-2 hover:text-error"
                          title="This package has not arrived — take it back off this receiving"
                        >
                          Undo arrival
                        </button>
                      ))}
                  </div>
                ) : activePackage.items.length === 0 ? (
                  <div className="h-full flex flex-col items-center justify-center text-center p-8">
                    <p className="text-sm text-text-muted">
                      No shoes recorded in Package #
                      {activePackage.package_no} yet.
                    </p>
                    <Button
                      size="sm"
                      onClick={() => addItem(safePackageIndex)}
                      className="mt-3 gap-1.5"
                    >
                      <PlusIcon className="w-3.5 h-3.5" />
                      Add First Product
                    </Button>
                  </div>
                ) : (
                  <TableContainer className="rounded-lg border border-border">
                    <Thead>
                      <Tr>
                        <Th className="w-12 text-center">#</Th>
                        <Th className="min-w-[14rem]">Stock Code</Th>
                        <Th className="min-w-[16rem]">Color & Qty</Th>
                        <Th className="w-36 text-right">Received</Th>
                        <Th className="w-12" aria-label="Actions" />
                      </Tr>
                    </Thead>
                    <Tbody>
                      {activePackage.items.map((item, itemIndex) => {
                        const codeProblem = receivedStockCodeProblem(
                          item.stock_code,
                          expected,
                        );
                        const colorProblem =
                          colorQtyProblem(item.color_breakdown) ??
                          receivedColorProblem(
                            item.stock_code,
                            item.color_breakdown,
                            expected,
                          ) ??
                          receivedColorQuantityProblem(
                            item.stock_code,
                            receiving,
                            expected,
                          );

                        return (
                          <Tr key={item.item_id}>
                            <Td className="text-center text-xs font-mono text-text-muted">
                              {itemIndex + 1}
                            </Td>
                            <Td className="align-top">
                              <SuggestInput
                                label={`Stock code ${itemIndex + 1}`}
                                placeholder="e.g. A1001"
                                suggestions={STOCK_CODES}
                                bare
                                value={item.stock_code}
                                onChange={(code) =>
                                  setStockCode(
                                    safePackageIndex,
                                    itemIndex,
                                    code,
                                  )
                                }
                                error={codeProblem ?? undefined}
                              />
                            </Td>
                            <Td className="align-top">
                              <CellInput
                                label={`Colors for ${item.stock_code || "product"}`}
                                placeholder="e.g. black10s, pink2p"
                                multiline
                                value={item.color_breakdown}
                                onChange={(breakdown) =>
                                  setColorQty(
                                    safePackageIndex,
                                    itemIndex,
                                    breakdown,
                                  )
                                }
                                error={colorProblem ?? undefined}
                              />
                            </Td>
                            <Td className="align-top text-right">
                              <div className="min-h-9 px-3 flex items-center justify-end rounded-md bg-bg-subtle/80 text-sm font-bold font-mono text-text-primary">
                                {formatStoredQuantity(
                                  item.quantity,
                                  item.unit,
                                )}
                              </div>
                            </Td>
                            <Td className="align-top text-center">
                              <button
                                type="button"
                                onClick={() =>
                                  removeItem(safePackageIndex, itemIndex)
                                }
                                className="p-1.5 rounded text-text-muted hover:text-error hover:bg-error-subtle transition-colors"
                                title="Remove this product line"
                              >
                                <TrashIcon className="w-4 h-4" />
                              </button>
                            </Td>
                          </Tr>
                        );
                      })}
                    </Tbody>
                  </TableContainer>
                )}
              </div>

              {/* Active Package Footer */}
              <div className="px-5 py-2.5 border-t border-border bg-bg-subtle/40 flex items-center justify-between text-xs">
                <span className="text-text-muted">
                  Package #{activePackage.package_no} Subtotal:{" "}
                  <strong className="text-text-primary">
                    {activePackage.items.length}{" "}
                    {activePackage.items.length === 1
                      ? "product"
                      : "products"}
                  </strong>
                </span>
                <span className="font-bold font-mono text-success text-sm">
                  {formatSets(packagePairs(activePackage))}
                </span>
              </div>
            </>
          ) : (
            <div className="h-full flex items-center justify-center text-text-muted text-sm">
              Select a package from the list on the left.
            </div>
          )}
        </main>
      </div>
    </div>
  );
}
