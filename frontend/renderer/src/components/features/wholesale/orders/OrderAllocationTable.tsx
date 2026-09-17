import { useEffect, useState } from "react";
import { cn } from "@renderer/lib/utils";
import { useToast } from "@renderer/lib/useToast";
import { Button } from "@renderer/components/ui/Button";
import {
  TableContainer,
  Tbody,
  Td,
  Th,
  Thead,
  Tr,
} from "@renderer/components/ui/Table";
import {
  ColorQtyPicker,
  ColorQtySummary,
} from "@renderer/components/features/wholesale/ColorQtyPicker";
import { GROUP_LABELS } from "@renderer/components/features/wholesale/products";
import { colorQtyProblem } from "@renderer/components/features/wholesale/shared";
import {
  formatIn,
  formatSets,
  PAIRS_PER,
} from "@renderer/components/features/wholesale/units";
import {
  colorPairsForText,
  serializeColorPairs,
  type ColorPairs,
  type StockLine,
} from "@renderer/components/features/wholesale/stock";
import {
  lineRemaining,
  type CustomerOrder,
  type CustomerOrderLine,
} from "@renderer/components/features/wholesale/customerOrders";
import {
  allocationsFromOtherOrders,
  availableStockColors,
  formatColorBreakdown,
  formatColorPairs,
  subtractColorPairs,
} from "./orderColorUtils";

export function AllocationLineRow({
  line,
  order,
  orders,
  inventoryLines,
  inventoryLoading,
  draftPairs,
  onDraftChange,
}: {
  line: CustomerOrderLine;
  order: CustomerOrder;
  orders: CustomerOrder[];
  inventoryLines: StockLine[];
  inventoryLoading: boolean;
  draftPairs: ColorPairs;
  onDraftChange: (next: ColorPairs) => void;
}): React.JSX.Element {
  const setSize = line.unit_conversions?.set ?? PAIRS_PER.set;
  const stockColors = availableStockColors(line.stock_code, inventoryLines);
  const reservedByOthers = allocationsFromOtherOrders(
    orders,
    line.stock_code,
    order.order_id,
  );
  const ownColors = colorPairsForText(
    line.allocated_color_breakdown ?? "",
    line.unit,
    line.unit_conversions,
  );
  // Keep the current allocation available for edit validation, but subtract it from
  // the stock amount shown as still available for a new allocation.
  const availableForEdit = subtractColorPairs(stockColors, reservedByOthers);
  const availableToAllocate = subtractColorPairs(availableForEdit, ownColors);
  const availablePairs = Object.values(availableToAllocate).reduce(
    (sum, pairs) => sum + pairs,
    0,
  );
  const hasAvailableStock = availablePairs > 0;
  const hasCurrentAllocation = (line.allocated_quantity_pairs ?? 0) > 0;
  const orderColors = colorPairsForText(
    line.color_breakdown,
    line.unit,
    line.unit_conversions,
  );

  // Resting state is a figure, not a row of input boxes: most rows of a multi-line order
  // are not being touched today, and a table of open pickers reads as a form to fill in
  // rather than a list to scan.
  const [editing, setEditing] = useState(false);
  const availableForPicker: ColorPairs = {};
  const allColors = new Set([
    ...Object.keys(orderColors),
    ...Object.keys(draftPairs),
  ]);
  for (const color of allColors) {
    const maxOrder = orderColors[color] ?? 0;
    const maxStock = availableForEdit[color] ?? 0;
    availableForPicker[color] = Math.max(0, Math.min(maxOrder, maxStock));
  }

  const serialized = serializeColorPairs(draftPairs, setSize);
  const colorError = colorQtyProblem(serialized);
  const requestedPairs = Object.values(draftPairs).reduce(
    (sum, pairs) => sum + pairs,
    0,
  );
  const validationMessage =
    colorError ??
    (requestedPairs > lineRemaining(line)
      ? `Allocation cannot exceed ${formatIn(lineRemaining(line), line.unit, line.unit_conversions)}.`
      : null);

  return (
    <Tr>
      <Td>
        <div className="flex min-w-[12rem] flex-col gap-0.5">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-bold text-brand">
              {line.stock_code || "No stock code"}
            </span>
            <span className="text-xs text-text-muted">
              {GROUP_LABELS[line.product_group]}
            </span>
          </div>
          <span className="font-semibold text-text-primary">
            {line.description || "Unnamed product"}
          </span>
          <span className="text-xs text-text-secondary">
            <span className="font-semibold text-text-primary">Colors:</span>{" "}
            <span className="font-bold text-brand">
              {formatColorBreakdown(
                line.color_breakdown,
                line.unit,
                line.unit_conversions,
              ) ||
                line.color_breakdown ||
                "—"}
            </span>
          </span>
        </div>
      </Td>
      <Td className="whitespace-nowrap text-right tabular-nums">
        <div className="flex flex-col items-end gap-0.5">
          <div className="flex items-center gap-1.5 font-mono">
            <span
              className={cn(
                "font-semibold",
                lineRemaining(line) === 0 && line.quantity_pairs > 0
                  ? "text-success"
                  : line.delivered_quantity_pairs > 0
                    ? "text-text-primary"
                    : "text-text-muted",
              )}
            >
              {formatIn(
                line.delivered_quantity_pairs,
                line.unit,
                line.unit_conversions,
              )}
            </span>
            <span className="text-text-muted/50 font-normal">/</span>
            <span className="text-text-secondary font-medium">
              {formatIn(line.quantity_pairs, line.unit, line.unit_conversions)}
            </span>
          </div>
          <div className="text-[11px]">
            {lineRemaining(line) > 0 ? (
              <span className="text-error font-medium">
                {formatIn(
                  lineRemaining(line),
                  line.unit,
                  line.unit_conversions,
                )}{" "}
                left
              </span>
            ) : (
              <span className="text-success text-[10px] font-medium">Done</span>
            )}
          </div>
        </div>
      </Td>
      <Td>
        <div className="min-w-[12rem]">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-sm font-semibold text-brand tabular-nums">
              {inventoryLoading ? "—" : formatSets(availablePairs)}
            </span>
            {!inventoryLoading && (
              <span
                className={cn(
                  "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium border",
                  hasAvailableStock
                    ? "bg-success-subtle text-success border-success/20"
                    : hasCurrentAllocation
                      ? "bg-brand-subtle text-brand border-brand/20"
                      : "bg-error-subtle text-error border-error/20",
                )}
              >
                <span
                  className={cn(
                    "w-1.5 h-1.5 rounded-full",
                    hasAvailableStock
                      ? "bg-success"
                      : hasCurrentAllocation
                        ? "bg-brand"
                        : "bg-error",
                  )}
                />
                <span>
                  {hasAvailableStock
                    ? "Available"
                    : hasCurrentAllocation
                      ? "Fully allocated"
                      : "Not available"}
                </span>
              </span>
            )}
          </div>
          <div className="mt-0.5 text-xs text-text-secondary">
            {inventoryLoading
              ? "Checking stock…"
              : hasAvailableStock
                ? formatColorPairs(availableToAllocate, {
                    ...PAIRS_PER,
                    set: setSize,
                  })
                : hasCurrentAllocation
                  ? "No stock remains for another allocation."
                  : "No stock is available for this item."}
          </div>
        </div>
      </Td>
      <Td className="min-w-[21rem]">
        {editing ? (
          <ColorQtyPicker
            available={availableForPicker}
            setSize={setSize}
            value={draftPairs}
            onChange={onDraftChange}
            disabled={inventoryLoading}
          />
        ) : (
          <ColorQtySummary
            value={draftPairs}
            available={availableForPicker}
            setSize={setSize}
            emptyLabel="Nothing available to allocate"
            onEdit={() => setEditing(true)}
            disabled={inventoryLoading}
          />
        )}
        {validationMessage && (
          <div className="mt-1 text-xs font-medium text-error">
            {validationMessage}
          </div>
        )}
        {!validationMessage && serialized !== "" && (
          <div className="mt-1 text-xs text-text-muted">
            {formatSets(requestedPairs, { ...PAIRS_PER, set: setSize })}{" "}
            selected
          </div>
        )}
      </Td>
    </Tr>
  );
}

export function AllocationTable({
  order,
  orders,
  inventoryLines,
  inventoryLoading,
  onSaveAllocation,
  onSaveAllocationsComplete,
}: {
  order: CustomerOrder;
  orders: CustomerOrder[];
  inventoryLines: StockLine[];
  inventoryLoading: boolean;
  onSaveAllocation: (lineId: string, colorBreakdown: string) => Promise<void>;
  onSaveAllocationsComplete: () => Promise<void>;
}): React.JSX.Element {
  const showToast = useToast();
  const [drafts, setDrafts] = useState<Record<string, ColorPairs>>(() => {
    const initial: Record<string, ColorPairs> = {};
    for (const line of order.lines) {
      initial[line.order_line_id] = colorPairsForText(
        line.allocated_color_breakdown ?? "",
        line.unit,
        line.unit_conversions,
      );
    }
    return initial;
  });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const initial: Record<string, ColorPairs> = {};
    for (const line of order.lines) {
      initial[line.order_line_id] = colorPairsForText(
        line.allocated_color_breakdown ?? "",
        line.unit,
        line.unit_conversions,
      );
    }
    setDrafts(initial);
  }, [order]);

  const changedLines = order.lines.filter((line) => {
    const setSize = line.unit_conversions?.set ?? PAIRS_PER.set;
    const currentDraft = drafts[line.order_line_id] ?? {};
    const serialized = serializeColorPairs(currentDraft, setSize);
    return serialized.trim() !== (line.allocated_color_breakdown ?? "").trim();
  });

  const hasValidationErrors = order.lines.some((line) => {
    const setSize = line.unit_conversions?.set ?? PAIRS_PER.set;
    const currentDraft = drafts[line.order_line_id] ?? {};
    const requestedPairs = Object.values(currentDraft).reduce(
      (sum, p) => sum + p,
      0,
    );
    const serialized = serializeColorPairs(currentDraft, setSize);
    const colorError = colorQtyProblem(serialized);
    return colorError !== null || requestedPairs > lineRemaining(line);
  });

  const canSave =
    changedLines.length > 0 &&
    !hasValidationErrors &&
    !saving &&
    !inventoryLoading;

  async function handleSaveAllocations(): Promise<void> {
    if (!canSave || saving) return;
    setSaving(true);
    try {
      for (const line of changedLines) {
        const setSize = line.unit_conversions?.set ?? PAIRS_PER.set;
        const currentDraft = drafts[line.order_line_id] ?? {};
        const serialized = serializeColorPairs(currentDraft, setSize);
        try {
          await onSaveAllocation(line.order_line_id, serialized);
        } catch {
          const label = line.description || line.stock_code || "product";
          showToast("error", `Could not save allocation for ${label}.`);
          return;
        }
      }
      await onSaveAllocationsComplete();
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      {/* Nobody has to come here on an ordinary day, and staff who think they skipped a
          step will go looking for it. Say plainly that the work is already done. */}
      <p className="text-sm text-text-secondary">
        Stock is automatically allocated on arrival (oldest order first). Adjust
        here if needed.
      </p>
      <TableContainer>
        <Thead className="top-0">
          <Tr>
            <Th className="min-w-[12rem]">Product</Th>
            <Th className="text-right whitespace-nowrap min-w-[11rem]">
              Delivered / Ordered
            </Th>
            <Th className="min-w-[12rem]">Available to allocate</Th>
            <Th className="min-w-[21rem]">Allocate colors</Th>
          </Tr>
        </Thead>
        <Tbody>
          {order.lines.map((line) => (
            <AllocationLineRow
              key={line.order_line_id}
              line={line}
              order={order}
              orders={orders}
              inventoryLines={inventoryLines}
              inventoryLoading={inventoryLoading}
              draftPairs={drafts[line.order_line_id] ?? {}}
              onDraftChange={(next) =>
                setDrafts((prev) => ({
                  ...prev,
                  [line.order_line_id]: next,
                }))
              }
            />
          ))}
        </Tbody>
      </TableContainer>

      <div className="flex items-center justify-between border-t border-border pt-3">
        <p className="text-xs text-text-muted">
          {changedLines.length > 0
            ? `${changedLines.length} product allocation${changedLines.length === 1 ? "" : "s"} modified`
            : "No unsaved allocation changes"}
        </p>
        <Button
          onClick={() => void handleSaveAllocations()}
          loading={saving}
          disabled={!canSave}
          size="sm"
        >
          Save allocations
        </Button>
      </div>
    </div>
  );
}
