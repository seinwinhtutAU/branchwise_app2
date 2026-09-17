import { useEffect, useState } from "react";
import { cn } from "@renderer/lib/utils";
import { Button } from "@renderer/components/ui/Button";
import {
  ClipboardIcon,
  TruckIcon,
  WarehouseIcon,
} from "@renderer/components/ui/icons";
import {
  lineRemaining,
  type CustomerOrder,
} from "@renderer/components/features/wholesale/orders/customerOrders";
import { type CustomerDeliveryBatchInput } from "@renderer/components/features/wholesale/shared/api";
import {
  colorPairsForText,
  type StockLine,
} from "@renderer/components/features/wholesale/inventory/stock";
import {
  allocationsFromOtherOrders,
  availableStockColors,
  stillOwedColors,
  subtractColorPairs,
} from "./orderColorUtils";
import { sets } from "./types";
import { AllocationTable } from "./OrderAllocationTable";
import { DeliveryView } from "./OrderDeliveryView";

/** The "Allocate & Deliver" tab's body — the sub-tablist choosing between setting
 *  stock aside and handing it over, plus whichever of those two tables is active. It
 *  used to be its own full screen with its own back button and identity header; now it
 *  sits inside OrderDetail's third tab, which already shows the order no./status/
 *  customer, so none of that is repeated here. */
export function FulfillmentBody({
  order,
  orders,
  inventoryLines,
  inventoryLoading,
  initialTab = "deliver",
  onSaveAllocation,
  onSaveAllocationsComplete,
  onSaveDelivery,
}: {
  order: CustomerOrder;
  orders: CustomerOrder[];
  inventoryLines: StockLine[];
  inventoryLoading: boolean;
  initialTab?: "allocate" | "deliver";
  onSaveAllocation: (lineId: string, colorBreakdown: string) => Promise<void>;
  onSaveAllocationsComplete: () => Promise<void>;
  onSaveDelivery: (input: CustomerDeliveryBatchInput) => Promise<void>;
}): React.JSX.Element {
  const [tab, setTab] = useState<"allocate" | "deliver">(initialTab);
  const allocatedPairs = order.lines.reduce(
    (sum, line) => sum + (line.allocated_quantity_pairs ?? 0),
    0,
  );
  // What this order could still set aside — not what the warehouse holds. The three
  // caps are the same three AllocationLineRow enforces below, so the figure on the tab
  // and the rule inside the row can never disagree: a colour has to be on the order, it
  // has to be free stock, and the line's total cannot pass what is still owed.
  const availableToAllocatePairs = order.lines.reduce((sum, line) => {
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
    const orderColors = colorPairsForText(
      line.color_breakdown,
      line.unit,
      line.unit_conversions,
    );
    const freeStock = subtractColorPairs(
      subtractColorPairs(stockColors, reservedByOthers),
      ownColors,
    );
    const stillWanted = subtractColorPairs(orderColors, ownColors);
    const takeable = Object.entries(stillWanted).reduce(
      (acc, [color, wanted]) => acc + Math.min(wanted, freeStock[color] ?? 0),
      0,
    );
    const ownPairs = Object.values(ownColors).reduce((acc, p) => acc + p, 0);
    const roomLeft = Math.max(0, lineRemaining(line) - ownPairs);
    return sum + Math.min(takeable, roomLeft);
  }, 0);
  // What could actually be handed over now: allocated to this order, still owed, and
  // physically there. The same rules deliveryValidationMessage applies, so the badge and
  // the rows below never disagree.
  const availableToDeliverPairs = order.lines.reduce((sum, line) => {
    const owedColors = stillOwedColors(line);
    const allocatedColors = colorPairsForText(
      line.allocated_color_breakdown ?? "",
      line.unit,
      line.unit_conversions,
    );
    const stockColors = availableStockColors(line.stock_code, inventoryLines);
    const reservedByOthers = allocationsFromOtherOrders(
      orders,
      line.stock_code,
      order.order_id,
    );
    const availableStock = subtractColorPairs(stockColors, reservedByOthers);
    const deliverable = Object.entries(allocatedColors).reduce(
      (acc, [color, allocated]) =>
        acc +
        Math.min(allocated, owedColors[color] ?? 0, availableStock[color] ?? 0),
      0,
    );
    return sum + Math.min(deliverable, lineRemaining(line));
  }, 0);

  useEffect(() => {
    setTab(initialTab);
  }, [initialTab]);

  return (
    <div className="flex flex-col gap-4">
      <div
        role="tablist"
        aria-label="Fulfill order tab"
        className="inline-flex w-full sm:w-auto items-center gap-1 rounded-lg bg-bg-subtle p-1 border border-border"
      >
        <button
          type="button"
          role="tab"
          aria-selected={tab === "allocate"}
          onClick={() => setTab("allocate")}
          className={cn(
            "flex-1 sm:flex-none inline-flex items-center justify-center gap-2 rounded-md px-3.5 py-1.5 text-xs font-medium transition-all duration-150",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand",
            tab === "allocate"
              ? "bg-brand text-white shadow-sm font-semibold"
              : "text-text-muted hover:text-text-primary hover:bg-bg-base/60",
          )}
        >
          <ClipboardIcon className="w-3.5 h-3.5 shrink-0" />
          <span>Allocate stock</span>
          <span
            className={cn(
              "ml-1 rounded-full px-1.5 py-0.5 text-[10px] font-semibold tabular-nums leading-none",
              tab === "allocate"
                ? "bg-white/20 text-white"
                : "bg-success-subtle text-success border border-success/20",
            )}
          >
            {inventoryLoading ? "—" : sets(availableToAllocatePairs)}
          </span>
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === "deliver"}
          onClick={() => setTab("deliver")}
          className={cn(
            "flex-1 sm:flex-none inline-flex items-center justify-center gap-2 rounded-md px-3.5 py-1.5 text-xs font-medium transition-all duration-150",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand",
            tab === "deliver"
              ? "bg-brand text-white shadow-sm font-semibold"
              : "text-text-muted hover:text-text-primary hover:bg-bg-base/60",
          )}
        >
          <TruckIcon className="w-3.5 h-3.5 shrink-0" />
          <span>Deliver to customer</span>
          <span
            className={cn(
              "ml-1 rounded-full px-1.5 py-0.5 text-[10px] font-semibold tabular-nums leading-none",
              tab === "deliver"
                ? "bg-white/20 text-white"
                : "bg-success-subtle text-success border border-success/20",
            )}
          >
            {inventoryLoading ? "—" : sets(availableToDeliverPairs)}
          </span>
        </button>
      </div>
      <div>
        {tab === "allocate" ? (
          <AllocationTable
            order={order}
            orders={orders}
            inventoryLines={inventoryLines}
            inventoryLoading={inventoryLoading}
            onSaveAllocation={onSaveAllocation}
            onSaveAllocationsComplete={onSaveAllocationsComplete}
          />
        ) : allocatedPairs <= 0 ? (
          <div className="flex flex-col items-center justify-center gap-3 py-12 text-center">
            <WarehouseIcon className="h-10 w-10 text-text-muted" />
            <div className="flex flex-col gap-1">
              <p className="text-base font-semibold text-text-primary">
                Nothing is allocated yet
              </p>
              <p className="text-sm text-text-muted">
                Allocate stock first before recording a delivery.
              </p>
            </div>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => setTab("allocate")}
            >
              Go to allocation
            </Button>
          </div>
        ) : (
          <DeliveryView
            order={order}
            orders={orders}
            inventoryLines={inventoryLines}
            inventoryLoading={inventoryLoading}
            onSaveDelivery={onSaveDelivery}
          />
        )}
      </div>
    </div>
  );
}
