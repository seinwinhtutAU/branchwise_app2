import { useEffect, useState } from "react";
import { cn } from "@renderer/lib/utils";
import { Button } from "@renderer/components/ui/Button";
import { Input } from "@renderer/components/ui/Input";
import { Select } from "@renderer/components/ui/Select";
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
import { todayIso } from "@renderer/components/features/wholesale/shared";
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
} from "@renderer/components/features/wholesale/customerOrders";
import { type CustomerDeliveryBatchInput } from "@renderer/components/features/wholesale/api";
import {
  availableDeliveryColors,
  deliveryLocationsForLine,
  deliveryValidationMessage,
  formatColorBreakdown,
  formatColorPairs,
  stillOwedColors,
} from "./orderColorUtils";

export function DeliveryView({
  order,
  orders,
  inventoryLines,
  inventoryLoading,
  onSaveDelivery,
}: {
  order: CustomerOrder;
  orders: CustomerOrder[];
  inventoryLines: StockLine[];
  inventoryLoading: boolean;
  onSaveDelivery: (input: CustomerDeliveryBatchInput) => Promise<void>;
}): React.JSX.Element {
  const [drafts, setDrafts] = useState<Record<string, ColorPairs>>({});
  // Which rows are open for typing. A delivery usually touches one or two products out
  // of the order, so the rest rest as a figure rather than as a form.
  const [editingLines, setEditingLines] = useState<Set<string>>(new Set());
  const [fromLocation, setFromLocation] = useState("");
  const [deliveryDate, setDeliveryDate] = useState(todayIso());
  const [deliveryAddress, setDeliveryAddress] = useState(
    order.customer_address || "",
  );
  const [deliveryNote, setDeliveryNote] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(
    () => setDeliveryAddress(order.customer_address || ""),
    [order.customer_address],
  );

  const locationOptions = [
    ...new Set(
      order.lines.flatMap((line) =>
        deliveryLocationsForLine(line, inventoryLines),
      ),
    ),
  ];
  const selectedLocation = fromLocation || locationOptions[0] || "";
  const rows = order.lines.map((line) => {
    const owedColors = stillOwedColors(line);
    // Shown, not enforced: what has been set aside for this customer is worth knowing
    // while handing goods over, but it no longer decides what may go out.
    const allocatedColors = colorPairsForText(
      line.allocated_color_breakdown ?? "",
      line.unit,
      line.unit_conversions,
    );
    const availableColors = availableDeliveryColors(
      line,
      order,
      orders,
      inventoryLines,
      selectedLocation,
    );
    const draftPairs = drafts[line.order_line_id] ?? {};
    const setSize = line.unit_conversions?.set ?? PAIRS_PER.set;
    const pairs = Object.values(draftPairs).reduce(
      (sum, value) => sum + value,
      0,
    );
    const serialized = serializeColorPairs(draftPairs, setSize);
    return {
      line,
      draftPairs,
      pairs,
      serialized,
      owedColors,
      allocatedColors,
      availableColors,
      problem: deliveryValidationMessage(
        line,
        serialized,
        owedColors,
        allocatedColors,
        availableColors,
        inventoryLoading,
      ),
    };
  });
  const selectedRows = rows.filter((row) => row.pairs > 0);
  const canSave =
    !inventoryLoading &&
    deliveryDate.trim() !== "" &&
    selectedLocation !== "" &&
    selectedRows.length > 0 &&
    selectedRows.every((row) => row.problem === null);

  async function saveDelivery(): Promise<void> {
    if (!canSave || saving) return;
    setSaving(true);
    try {
      await onSaveDelivery({
        order_id: order.order_id,
        delivered_on: deliveryDate,
        delivery_address: deliveryAddress.trim(),
        note: deliveryNote.trim(),
        lines: selectedRows.map((row) => ({
          stock_code: row.line.stock_code,
          location: selectedLocation,
          color_breakdown: serializeColorPairs(
            drafts[row.line.order_line_id] ?? {},
            row.line.unit_conversions?.set ?? PAIRS_PER.set,
          ),
          unit: row.line.unit,
        })),
      });
      setDrafts({});
      setDeliveryNote("");
      setDeliveryDate(todayIso());
      setFromLocation("");
      setDeliveryAddress(order.customer_address || "");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="rounded-lg border border-border bg-bg-subtle/50 p-4">
        <div className="flex flex-wrap items-center justify-between gap-2 pb-3 mb-3 border-b border-border">
          <div>
            <h3 className="text-sm font-semibold text-text-primary">
              Delivery parameters
            </h3>
            <p className="text-xs text-text-muted">
              Select stock location, dispatch date, and destination address.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xs text-text-muted">To deliver:</span>
            <span
              className={cn(
                "font-mono text-xs font-semibold px-2.5 py-0.5 rounded-full border",
                selectedRows.length > 0
                  ? "bg-brand-subtle text-brand border-brand/20"
                  : "bg-bg-subtle text-text-muted border-border",
              )}
            >
              {formatSets(
                selectedRows.reduce((sum, row) => sum + row.pairs, 0),
              )}{" "}
              selected
            </span>
          </div>
        </div>
        <div className="grid w-full gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Select
            label="From location"
            value={selectedLocation}
            onChange={(event) => setFromLocation(event.target.value)}
            disabled={inventoryLoading || locationOptions.length === 0}
          >
            {locationOptions.length === 0 ? (
              <option value="">No stock location</option>
            ) : (
              locationOptions.map((location) => (
                <option key={location} value={location}>
                  {location}
                </option>
              ))
            )}
          </Select>
          <Input
            label="Delivery date"
            type="date"
            value={deliveryDate}
            onChange={(event) => setDeliveryDate(event.target.value)}
          />
          <Input
            label="Delivery address"
            value={deliveryAddress}
            onChange={(event) => setDeliveryAddress(event.target.value)}
            placeholder="Customer address"
          />
          <Input
            label="Delivery note"
            value={deliveryNote}
            onChange={(event) => setDeliveryNote(event.target.value)}
            placeholder="Optional note"
          />
        </div>
      </div>

      <TableContainer>
        <Thead className="top-0">
          <Tr>
            <Th className="min-w-[12rem]">Product</Th>
            <Th className="text-right whitespace-nowrap">
              Delivered / Ordered
            </Th>
            <Th className="min-w-[13rem]">Available to deliver</Th>
            <Th className="min-w-[21rem]">Deliver colors</Th>
          </Tr>
        </Thead>
        <Tbody>
          {rows.map((row) => {
            const deliverableColors = Object.entries(
              row.allocatedColors,
            ).reduce<ColorPairs>((colors, [color, pairs]) => {
              const deliverablePairs = Math.min(
                pairs,
                row.owedColors[color] ?? 0,
                row.availableColors[color] ?? 0,
              );
              if (deliverablePairs > 0) colors[color] = deliverablePairs;
              return colors;
            }, {});
            const availablePairs = Object.values(deliverableColors).reduce(
              (sum, pairs) => sum + pairs,
              0,
            );
            const setSize = row.line.unit_conversions?.set ?? PAIRS_PER.set;
            return (
              <Tr key={row.line.order_line_id}>
                <Td>
                  <div className="flex min-w-[12rem] flex-col gap-0.5">
                    <div className="flex items-baseline gap-1.5">
                      <span className="font-bold text-brand">
                        {row.line.stock_code || "No stock code"}
                      </span>
                      <span className="text-xs text-text-muted">
                        {GROUP_LABELS[row.line.product_group]}
                      </span>
                    </div>
                    <span className="font-semibold text-text-primary">
                      {row.line.description || "Unnamed product"}
                    </span>
                    {/* What the customer actually asked for — context every row wants,
                        and the only place it appeared before was the allocate screen. */}
                    <span className="text-xs">
                      <span className="font-semibold text-text-primary">
                        Colors:
                      </span>{" "}
                      <span className="font-bold text-brand">
                        {formatColorBreakdown(
                          row.line.color_breakdown,
                          row.line.unit,
                          row.line.unit_conversions,
                        ) || "—"}
                      </span>
                    </span>
                  </div>
                </Td>
                <Td className="whitespace-nowrap text-right tabular-nums">
                  {/* Progress reads better than a lone shortfall: how much has gone out,
                      against how much was asked for, and only then what is still owed. */}
                  <div>
                    <span className="font-bold text-text-primary">
                      {formatIn(
                        row.line.delivered_quantity_pairs,
                        row.line.unit,
                        row.line.unit_conversions,
                      )}
                    </span>
                    <span className="text-text-muted"> / </span>
                    <span className="text-text-secondary">
                      {formatIn(
                        row.line.quantity_pairs,
                        row.line.unit,
                        row.line.unit_conversions,
                      )}
                    </span>
                  </div>
                  {lineRemaining(row.line) > 0 && (
                    <div className="mt-0.5 text-xs font-semibold text-error">
                      {formatIn(
                        lineRemaining(row.line),
                        row.line.unit,
                        row.line.unit_conversions,
                      )}{" "}
                      left
                    </div>
                  )}
                </Td>
                <Td>
                  <div className="min-w-[13rem]">
                    <div className="font-semibold tabular-nums text-brand">
                      {inventoryLoading ? "—" : formatSets(availablePairs)}
                    </div>
                    <div className="mt-0.5 text-xs text-text-secondary">
                      {inventoryLoading
                        ? "Checking stock…"
                        : formatColorPairs(deliverableColors, {
                            ...PAIRS_PER,
                            set: setSize,
                          }) || "Nothing is allocated and in stock here."}
                    </div>
                  </div>
                </Td>
                <Td className="min-w-[21rem]">
                  {editingLines.has(row.line.order_line_id) ? (
                    <ColorQtyPicker
                      available={deliverableColors}
                      setSize={setSize}
                      value={row.draftPairs}
                      onChange={(next) =>
                        setDrafts((current) => ({
                          ...current,
                          [row.line.order_line_id]: next,
                        }))
                      }
                      disabled={
                        (row.line.allocated_quantity_pairs ?? 0) <= 0 ||
                        inventoryLoading ||
                        selectedLocation === ""
                      }
                    />
                  ) : (
                    <ColorQtySummary
                      value={row.draftPairs}
                      available={deliverableColors}
                      setSize={setSize}
                      emptyLabel="Nothing allocated and in stock here"
                      onEdit={() =>
                        setEditingLines((current) =>
                          new Set(current).add(row.line.order_line_id),
                        )
                      }
                      disabled={inventoryLoading || selectedLocation === ""}
                    />
                  )}
                  {row.problem && (
                    <div className="mt-1 text-xs font-medium text-error">
                      {row.problem}
                    </div>
                  )}
                  {!row.problem && row.serialized !== "" && (
                    <div className="mt-1 text-xs text-text-muted">
                      {formatSets(row.pairs, { ...PAIRS_PER, set: setSize })}{" "}
                      selected
                    </div>
                  )}
                </Td>
              </Tr>
            );
          })}
        </Tbody>
      </TableContainer>

      <div className="flex items-center justify-between border-t border-border pt-3">
        <p className="text-xs text-text-muted">
          {selectedRows.length > 0
            ? `${selectedRows.length} item${selectedRows.length === 1 ? "" : "s"} ready for dispatch`
            : "Select quantities to deliver above"}
        </p>
        <Button
          onClick={() => void saveDelivery()}
          loading={saving}
          disabled={!canSave}
          size="sm"
        >
          Record delivery
        </Button>
      </div>
    </div>
  );
}
