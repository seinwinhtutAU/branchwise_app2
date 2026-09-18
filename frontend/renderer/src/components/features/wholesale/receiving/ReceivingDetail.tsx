import React, { useEffect, useMemo, useState } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { useFieldArray, useForm, useWatch } from "react-hook-form";
import type { AppSettings } from "@renderer/lib/appSettings";
import { cn } from "@renderer/lib/utils";
import { Button } from "@renderer/components/ui/Button";
import {
  CheckIcon,
  ChevronLeftIcon,
  TrashIcon,
} from "@renderer/components/ui/icons";
import {
  CellInput,
  Reference,
  SuggestInput,
} from "@renderer/components/features/wholesale/shared/ui";
import { CopyButton } from "@renderer/components/ui/CopyButton";
import {
  DEFAULT_CURRENCY,
  previewKyatAmount,
  type CurrencyCode,
} from "@renderer/components/features/wholesale/shared/currency";
import {
  countedPairs,
  emptyCost,
  emptyItem,
  expectedPairs,
  openedCount,
  receivingStatus,
  resizePackages,
  totalCost,
  type Receiving,
  type ReceivingCost,
  type ReceivingItem,
  type ReceivingPackage,
} from "@renderer/components/features/wholesale/receiving/receivings";
import {
  formatKyat,
  quantityFromColors,
} from "@renderer/components/features/wholesale/shared/shared";
import { PAIRS_PER } from "@renderer/components/features/wholesale/shared/units";
import { useWholesale } from "@renderer/components/features/wholesale/shared/store";
import {
  RECEIVING_GATES,
  productOf,
} from "@renderer/components/features/wholesale/masterData/masterData";
import {
  receivingDetailSchema,
  type ReceivingDetailFormValues,
} from "./types";
import {
  voucherExpectations,
  receivedColorProblem,
  receivedStockCodeProblem,
} from "./voucherCheckUtils";
import { CountCheck, StatusBadge } from "./ReceivingBadges";
import { ReceivingPackagesView } from "./ReceivingPackagesView";
import { ReceivingCostsView } from "./ReceivingCostsView";

export function ReceivingDetail({
  receiving: initialReceiving,
  focus,
  settings,
  onBack,
  onSave,
  onDelete,
}: {
  receiving: Receiving;
  focus?: "packages" | "costs";
  settings: AppSettings | null;
  onBack: () => void;
  onSave: (receiving: Receiving) => Promise<void>;
  onDelete: () => void;
}): React.JSX.Element {
  const [activeTab, setActiveTab] = useState<"packages" | "costs">(
    focus === "costs" ? "costs" : "packages",
  );
  const [selectedPackageIndex, setSelectedPackageIndex] = useState(0);
  const [packageSearch, setPackageSearch] = useState("");
  const [saving, setSaving] = useState(false);
  const [addingCostId, setAddingCostId] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  /** Set while the last package holds counted products and undoing it needs a second
   *  click — taking it back would throw that counting away. */
  const [confirmUndoArrival, setConfirmUndoArrival] = useState(false);

  const {
    control,
    handleSubmit,
    reset,
    setValue,
    formState: { isDirty },
  } = useForm<ReceivingDetailFormValues>({
    resolver: zodResolver(receivingDetailSchema),
    defaultValues: { receiving: initialReceiving },
    mode: "onBlur",
    reValidateMode: "onChange",
  });
  const { replace: replaceCosts } = useFieldArray({
    control,
    name: "receiving.costs",
  });
  const { replace: replacePackages } = useFieldArray({
    control,
    name: "receiving.packages",
  });
  const receiving = useWatch({ control, name: "receiving" }) as Receiving;

  useEffect(() => {
    reset({ receiving: initialReceiving });
    setAddingCostId(null);
    setConfirmUndoArrival(false);
    if (focus) {
      setActiveTab(focus === "costs" ? "costs" : "packages");
    }
  }, [initialReceiving, reset, focus]);

  // An armed "discard this package" must not survive being left behind: walking to
  // another package and back should not find the destructive button still waiting.
  useEffect(() => {
    setConfirmUndoArrival(false);
  }, [selectedPackageIndex]);

  const hasChanges = isDirty;

  function apply(patch: Partial<Receiving>): void {
    if (patch.costs) replaceCosts(patch.costs);
    if (patch.packages) replacePackages(patch.packages);
    for (const [key, value] of Object.entries(patch)) {
      if (key === "costs" || key === "packages") continue;
      setValue(`receiving.${key}` as "receiving.gate", value as never, {
        shouldDirty: true,
        shouldValidate: true,
      });
    }
  }

  async function saveChanges(values: ReceivingDetailFormValues): Promise<void> {
    setSaving(true);
    try {
      await onSave(values.receiving);
    } finally {
      setSaving(false);
    }
  }

  const { shipments, vouchers } = useWholesale();
  const shipment = shipments.find(
    (entry) => entry.shipment_no === receiving.shipment_no,
  );
  const voucher = vouchers.find(
    (entry) => entry.voucher_no === receiving.voucher_no,
  );
  const expected = useMemo(() => voucherExpectations(voucher), [voucher]);
  const stages = useMemo(
    () =>
      [
        ...(shipment ? [shipment.carrier_name] : []),
        ...(shipment ? shipment.legs.map((leg) => leg.stop_name) : []),
        receiving.gate,
      ].filter((stage) => stage.trim() !== ""),
    [shipment, receiving.gate],
  );
  const carriers = useMemo(
    () =>
      [
        ...(shipment ? [shipment.carrier_name] : []),
        ...(shipment ? shipment.legs.map((leg) => leg.carrier_name) : []),
      ].filter((name) => name.trim() !== "" && name !== "—"),
    [shipment],
  );

  const opened = openedCount(receiving);
  const counted = countedPairs(receiving);
  const expectedTotalPairs = expectedPairs(receiving);
  const totalCostAmount = totalCost(receiving);
  const costPerPackage =
    receiving.total_packages > 0
      ? Math.round(totalCostAmount / receiving.total_packages)
      : 0;
  const costPerPair = counted > 0 ? Math.round(totalCostAmount / counted) : 0;

  const safePackageIndex = Math.min(
    Math.max(0, selectedPackageIndex),
    Math.max(0, receiving.packages.length - 1),
  );
  const activePackage = receiving.packages[safePackageIndex] as
    ReceivingPackage | undefined;
  const isLastPackage = safePackageIndex === receiving.packages.length - 1;
  /** Whether anything has actually been counted into the open package — an untouched
   *  package still carries one blank item row, which is not a count. */
  const activePackageHasCount = Boolean(
    activePackage?.items.some(
      (item) => item.stock_code.trim() !== "" || item.quantity > 0,
    ),
  );

  function setPackage(index: number, patch: Partial<ReceivingPackage>): void {
    apply({
      packages: receiving.packages.map((entry, position) =>
        position === index ? { ...entry, ...patch } : entry,
      ),
    });
  }

  function toggleOpened(index: number): void {
    const entry = receiving.packages[index];
    if (!entry) return;
    const nextOpened = !entry.opened;
    setPackage(index, {
      opened: nextOpened,
      received_on:
        nextOpened && entry.received_on === ""
          ? receiving.received_on
          : entry.received_on,
      items:
        nextOpened && entry.items.length === 0
          ? [emptyItem(entry.package_id)]
          : entry.items,
    });
  }

  function markAllOpened(): void {
    apply({
      packages: receiving.packages.map((entry) => ({
        ...entry,
        opened: true,
        received_on:
          entry.received_on === "" ? receiving.received_on : entry.received_on,
        items:
          entry.items.length === 0
            ? [emptyItem(entry.package_id)]
            : entry.items,
      })),
    });
  }

  function duplicatePreviousPackage(targetIndex: number): void {
    if (targetIndex <= 0) return;
    const prev = receiving.packages[targetIndex - 1];
    if (!prev || prev.items.length === 0) return;
    const current = receiving.packages[targetIndex];
    if (!current) return;

    const clonedItems: ReceivingItem[] = prev.items.map((item, i) => ({
      ...item,
      item_id: `cloned-${current.package_id}-${i}-${Date.now()}`,
      package_id: current.package_id,
    }));

    setPackage(targetIndex, {
      opened: true,
      received_on: current.received_on || receiving.received_on,
      items: clonedItems,
    });
  }

  function setCost(index: number, patch: Partial<ReceivingCost>): void {
    apply({
      costs: receiving.costs.map((cost, position) =>
        position === index ? { ...cost, ...patch } : cost,
      ),
    });
  }

  function setCostCurrency(index: number, code: CurrencyCode): void {
    const cost = receiving.costs[index];
    if (code === DEFAULT_CURRENCY) {
      setCost(index, {
        currency_code: DEFAULT_CURRENCY,
        original_amount: null,
        exchange_rate: null,
        amount: 0,
      });
      return;
    }
    const original = cost.original_amount ?? 0;
    const rate =
      cost.exchange_rate ?? (Number(settings?.today_exchange_rates[code]) || 0);
    setCost(index, {
      currency_code: code,
      original_amount: original,
      exchange_rate: rate,
      amount: previewKyatAmount(original, rate),
    });
  }

  function setCostOriginalAmount(index: number, value: number): void {
    const cost = receiving.costs[index];
    setCost(index, {
      original_amount: value,
      amount: previewKyatAmount(value, cost.exchange_rate ?? 0),
    });
  }

  function setCostExchangeRate(index: number, value: number): void {
    const cost = receiving.costs[index];
    setCost(index, {
      exchange_rate: value,
      amount: previewKyatAmount(cost.original_amount ?? 0, value),
    });
  }

  function addCost(): void {
    const cost = emptyCost(
      receiving.receiving_id,
      receiving.gate,
      receiving.received_on,
    );
    setAddingCostId(cost.cost_id);
    apply({
      costs: [...receiving.costs, cost],
    });
  }

  function removeCost(index: number): void {
    if (receiving.costs[index]?.cost_id === addingCostId) {
      setAddingCostId(null);
    }
    apply({
      costs: receiving.costs.filter((_, position) => position !== index),
    });
  }

  function setItem(
    packageIndex: number,
    itemIndex: number,
    patch: Partial<ReceivingItem>,
  ): void {
    const entry = receiving.packages[packageIndex];
    if (!entry) return;
    setPackage(packageIndex, {
      items: entry.items.map((item, position) =>
        position === itemIndex ? { ...item, ...patch } : item,
      ),
    });
  }

  function setColorQty(
    packageIndex: number,
    itemIndex: number,
    colorQty: string,
  ): void {
    const item = receiving.packages[packageIndex]?.items[itemIndex];
    if (!item) return;
    const quantity = quantityFromColors(colorQty, item.unit);
    setItem(packageIndex, itemIndex, {
      color_breakdown: colorQty,
      quantity: quantity.qty,
      unit: quantity.unit,
    });
  }

  function setStockCode(
    packageIndex: number,
    itemIndex: number,
    code: string,
  ): void {
    const known = productOf(code);
    setItem(
      packageIndex,
      itemIndex,
      known
        ? {
            stock_code: code,
            description: known.description,
            product_group: known.product_group,
            unit: "set",
            unit_conversions: known.default_unit_conversions ?? PAIRS_PER,
          }
        : { stock_code: code },
    );
  }

  function addItem(packageIndex: number): void {
    const entry = receiving.packages[packageIndex];
    if (!entry) return;
    setPackage(packageIndex, {
      opened: true,
      items: [...entry.items, emptyItem(entry.package_id)],
    });
  }

  function removeItem(packageIndex: number, itemIndex: number): void {
    const entry = receiving.packages[packageIndex];
    if (!entry) return;
    const items = entry.items.filter((_, position) => position !== itemIndex);
    setPackage(packageIndex, {
      items: items.length > 0 ? items : [emptyItem(entry.package_id)],
    });
  }

  function setPackageCount(count: number): void {
    const safeCount = Math.max(1, count);
    apply({
      total_packages: safeCount,
      packages: resizePackages(
        receiving.packages,
        safeCount,
        receiving.receiving_id,
      ),
    });
  }

  /** A package that was still to come has turned up at the gate. Clicking slot #n
   *  brings in everything up to and including it, so two arriving together is one
   *  click on the later one rather than two clicks in order. */
  function markPackageArrived(packageNo: number): void {
    if (packageNo <= receiving.packages.length) return;
    setPackageCount(packageNo);
    setSelectedPackageIndex(packageNo - 1);
  }

  /** Undo for a mis-click. Only the newest package can be taken back — packages are a
   *  sequential run and dropping one from the middle would renumber the rest — which
   *  is also the only one a stray click could have created. */
  function undoLastArrival(): void {
    const last = receiving.packages.length;
    if (last <= 1) return;
    setPackageCount(last - 1);
    setSelectedPackageIndex(Math.min(safePackageIndex, last - 2));
    setConfirmUndoArrival(false);
  }

  // Save is the one keyboard shortcut this page keeps. Everything else — switching
  // packages, opening a package, adding a line — is a button you can see, so there is no
  // hidden key combination to remember while counting.
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent): void {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        if (document.activeElement instanceof HTMLElement) {
          document.activeElement.blur();
        }
        if (hasChanges && !saving) {
          void handleSubmit(saveChanges)();
        }
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasChanges, saving, handleSubmit]);

  // Filter packages for explorer
  const filteredPackagesWithIndex = useMemo(() => {
    const q = packageSearch.trim().toLowerCase();
    return receiving.packages
      .map((pkg, originalIndex) => ({ pkg, originalIndex }))
      .filter(({ pkg }) => {
        if (!q) return true;
        return (
          String(pkg.package_no).toLowerCase().includes(q) ||
          pkg.items.some((it) => it.stock_code.toLowerCase().includes(q))
        );
      });
  }, [receiving.packages, packageSearch]);

  /** Package numbers the shipment says went out that this receiving has no row for.
   *  They are listed as greyed-out slots alongside the real packages so a package
   *  that never turned up is a visible gap in the list, rather than something the
   *  reader has to notice by comparing two numbers. */
  const missingPackageNos = useMemo(() => {
    if (!shipment) return [];
    const short = shipment.total_packages - receiving.packages.length;
    if (short <= 0) return [];
    const highest = receiving.packages.reduce(
      (max, pkg) => Math.max(max, pkg.package_no),
      0,
    );
    return Array.from({ length: short }, (_, i) => highest + i + 1);
  }, [shipment, receiving.packages]);

  const filteredMissingNos = useMemo(() => {
    const q = packageSearch.trim();
    if (!q) return missingPackageNos;
    return missingPackageNos.filter((no) => String(no).includes(q));
  }, [missingPackageNos, packageSearch]);

  // Problem summary across entire batch
  const allProblems = useMemo(() => {
    const problems: string[] = [];
    for (const pkg of receiving.packages) {
      for (const it of pkg.items) {
        const codeProb = receivedStockCodeProblem(it.stock_code, expected);
        if (codeProb && !problems.includes(codeProb)) {
          problems.push(`[#${pkg.package_no}] ${it.stock_code}: ${codeProb}`);
        }
        const colorProb = receivedColorProblem(
          it.stock_code,
          it.color_breakdown,
          expected,
        );
        if (colorProb && !problems.includes(colorProb)) {
          problems.push(`[#${pkg.package_no}] ${it.stock_code}: ${colorProb}`);
        }
      }
    }
    return problems;
  }, [receiving.packages, expected]);

  const canDelete = receiving.allowed_actions
    ? receiving.allowed_actions.includes("delete")
    : opened === 0;

  return (
    <div className="flex flex-col gap-3 min-h-[calc(100vh-5.5rem)]">
      {/* One panel, not three stacked cards. The identity row, the details being
          edited and the arrival notice are all "what this receiving is", so they sit
          in a single bordered block divided by hairlines rather than floating apart
          with gaps between them. */}
      <div className="rounded-xl border border-border bg-bg-base overflow-hidden divide-y divide-border">
        {/* Identity and its tabs are one block, so no hairline runs between them —
            the selected tab's underline is the separator, the way Customer Orders
            and Supplier Vouchers already do it. */}
        <div>
          {/* ── Identity row ──────────────────────────────────────────────── */}
          <header className="flex flex-wrap items-center justify-between gap-3 px-5 py-3.5">
            <div className="flex items-center gap-3 min-w-0">
              <Button
                variant="ghost"
                size="sm"
                onClick={onBack}
                className="text-text-muted hover:text-text-primary gap-1.5"
                title="Back to receiving list (Esc)"
              >
                <ChevronLeftIcon className="w-4 h-4" />
                <span className="hidden sm:inline">Back</span>
              </Button>

              <div className="h-5 w-px bg-border" />

              <div className="flex items-center gap-2 min-w-0">
                <div className="flex items-center gap-1">
                  <h2 className="text-base font-semibold text-text-primary truncate">
                    {receiving.receiving_no}
                  </h2>
                  <CopyButton value={receiving.receiving_no} what="receiving no." />
                </div>
                <StatusBadge
                  status={receivingStatus(receiving, shipment?.total_packages)}
                />
                <span className="hidden md:inline text-xs text-text-muted truncate">
                  {receiving.supplier_name}
                </span>
              </div>
            </div>

            {/* Action Controls */}
            <div className="flex items-center gap-2">
              {/* One quiet dot is all the "you have unsaved work" signal this page needs —
              the old bottom status bar said the same thing a second time. */}
              {hasChanges && (
                <span
                  className="w-1.5 h-1.5 rounded-full bg-warning"
                  title="Unsaved changes"
                />
              )}

              <Button
                size="sm"
                onClick={() => void handleSubmit(saveChanges)()}
                loading={saving}
                disabled={!hasChanges}
                className="font-medium gap-1.5 shadow-xs"
                title="Save changes (Ctrl+S)"
              >
                <CheckIcon className="w-4 h-4" />
                <span>Save</span>
              </Button>

              {canDelete ? (
                confirmDelete ? (
                  <div className="flex items-center gap-1">
                    <Button
                      variant="destructive"
                      size="sm"
                      onClick={onDelete}
                      className="gap-1 text-xs"
                    >
                      <TrashIcon className="w-3.5 h-3.5" />
                      Confirm
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setConfirmDelete(false)}
                      className="text-xs"
                    >
                      Cancel
                    </Button>
                  </div>
                ) : (
                  <Button
                    variant="destructive"
                    size="sm"
                    onClick={() => setConfirmDelete(true)}
                    className="gap-1.5 text-xs"
                    title="Delete this receiving"
                  >
                    <TrashIcon className="w-3.5 h-3.5" />
                    Delete receiving
                  </Button>
                )
              ) : (
                <Button
                  variant="destructive"
                  size="sm"
                  disabled
                  className="gap-1.5 text-xs opacity-50 cursor-not-allowed"
                  title="Cannot delete a receiving that has opened packages"
                >
                  <TrashIcon className="w-3.5 h-3.5" />
                  Delete receiving
                </Button>
              )}
            </div>
          </header>

          {/* ── Tabs, on their own row ─────────────────────────────────────── */}
          <div
            role="tablist"
            aria-label="Receiving sections"
            className="flex items-center gap-1 px-5 pt-1"
          >
            <button
              type="button"
              role="tab"
              aria-selected={activeTab === "packages"}
              onClick={() => setActiveTab("packages")}
              className={cn(
                "inline-flex items-center gap-2 border-b-2 px-3 pb-2.5 text-sm font-semibold transition-colors duration-150",
                activeTab === "packages"
                  ? "border-brand text-brand"
                  : "border-transparent text-text-muted hover:text-text-primary",
              )}
            >
              <span>Packages</span>
              <span
                className={cn(
                  "inline-flex h-5 min-w-5 items-center justify-center rounded-full px-1.5 text-xs font-bold leading-none tabular-nums",
                  activeTab === "packages"
                    ? "bg-brand text-white"
                    : "bg-brand-subtle text-brand border border-brand-pill",
                )}
              >
                {opened}/{receiving.packages.length}
              </span>
            </button>

            <button
              type="button"
              role="tab"
              aria-selected={activeTab === "costs"}
              onClick={() => setActiveTab("costs")}
              className={cn(
                "inline-flex items-center gap-2 border-b-2 px-3 pb-2.5 text-sm font-semibold transition-colors duration-150",
                activeTab === "costs"
                  ? "border-brand text-brand"
                  : "border-transparent text-text-muted hover:text-text-primary",
              )}
            >
              <span>Costs</span>
              <span
                className={cn(
                  "inline-flex h-5 items-center justify-center rounded-full px-1.5 text-xs font-bold leading-none tabular-nums",
                  activeTab === "costs"
                    ? "bg-brand text-white"
                    : "bg-brand-subtle text-brand border border-brand-pill",
                )}
              >
                {formatKyat(totalCostAmount)}
              </span>
            </button>
          </div>
        </div>

        {/* ── Details row: the fields actually being edited ──────────────── */}
        {activeTab === "packages" && (
          <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-3 text-xs">
            <div className="flex flex-wrap items-center gap-4">
              <div className="flex items-center gap-2">
                <span className="text-text-muted font-medium">Shipment:</span>
                <Reference
                  value={receiving.shipment_no}
                  what="shipment no."
                  singleLine
                />
              </div>

              <div className="h-4 w-px bg-border" />

              <div className="flex items-center gap-2">
                <span className="text-text-muted font-medium">
                  Supplier / Factory:
                </span>
                <span className="font-medium text-text-primary">
                  {receiving.supplier_name || "—"}
                </span>
              </div>

              <div className="h-4 w-px bg-border" />

              <div className="flex items-center gap-2">
                <span className="text-text-muted font-medium">Gate:</span>
                <SuggestInput
                  label="Gate location"
                  suggestions={RECEIVING_GATES}
                  value={receiving.gate}
                  onChange={(next) => apply({ gate: next })}
                  bare
                  placeholder="Select Gate"
                />
              </div>

              <div className="h-4 w-px bg-border" />

              <div className="flex items-center gap-2">
                <span className="text-text-muted font-medium">Date:</span>
                <CellInput
                  label="Received Date"
                  placeholder="YYYY-MM-DD"
                  type="date"
                  value={receiving.received_on}
                  onChange={(received_on) => apply({ received_on })}
                  className="w-32 text-xs font-mono"
                />
              </div>

              <div className="h-4 w-px bg-border" />

              <div className="flex items-center gap-2">
                <span className="text-text-secondary font-semibold">
                  Total received packages:
                </span>
                <span className="whitespace-nowrap">
                  <strong className="font-mono font-bold text-base text-text-primary">
                    {receiving.packages.length}
                  </strong>
                  {shipment && (
                    <span className="text-xs text-text-muted">
                      {" of "}
                      <strong className="font-mono font-bold text-sm text-text-secondary">
                        {shipment.total_packages}
                      </strong>{" "}
                      sent
                    </span>
                  )}
                </span>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <Button
                variant="ghost"
                size="sm"
                onClick={markAllOpened}
                className="text-xs h-7 text-text-secondary hover:text-brand"
                title="Mark all packages as opened"
              >
                ✓ Mark all opened
              </Button>
            </div>
          </div>
        )}

        {/* ── Arrival notice: the panel's bottom strip ──────────────────── */}
        {activeTab === "packages" && (
          <CountCheck
            counted={counted}
            expected={expectedTotalPairs}
            opened={opened}
            total={receiving.packages.length}
            expectedPackages={shipment?.total_packages}
            unit="set"
          />
        )}
      </div>

      {/* ── TAB 1: Package Inspection Split-Pane Workbench ──────────────── */}
      {activeTab === "packages" && (
        <ReceivingPackagesView
          receiving={receiving}
          expected={expected}
          allProblems={allProblems}
          packageSearch={packageSearch}
          setPackageSearch={setPackageSearch}
          setSelectedPackageIndex={setSelectedPackageIndex}
          safePackageIndex={safePackageIndex}
          activePackage={activePackage}
          filteredPackagesWithIndex={filteredPackagesWithIndex}
          filteredMissingNos={filteredMissingNos}
          counted={counted}
          opened={opened}
          isLastPackage={isLastPackage}
          activePackageHasCount={activePackageHasCount}
          confirmUndoArrival={confirmUndoArrival}
          setConfirmUndoArrival={setConfirmUndoArrival}
          undoLastArrival={undoLastArrival}
          markPackageArrived={markPackageArrived}
          toggleOpened={toggleOpened}
          setPackage={setPackage}
          duplicatePreviousPackage={duplicatePreviousPackage}
          addItem={addItem}
          removeItem={removeItem}
          setStockCode={setStockCode}
          setColorQty={setColorQty}
        />
      )}

      {/* ── TAB 2: Costs ─────────────────────────────────────────────── */}
      {activeTab === "costs" && (
        <ReceivingCostsView
          receiving={receiving}
          costPerPackage={costPerPackage}
          costPerPair={costPerPair}
          counted={counted}
          stages={stages}
          carriers={carriers}
          totalCostAmount={totalCostAmount}
          addCost={addCost}
          removeCost={removeCost}
          setCost={setCost}
          setCostCurrency={setCostCurrency}
          setCostOriginalAmount={setCostOriginalAmount}
          setCostExchangeRate={setCostExchangeRate}
        />
      )}
    </div>
  );
}
