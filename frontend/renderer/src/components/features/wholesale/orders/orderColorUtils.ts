import {
  type CustomerOrder,
  type CustomerOrderLine,
  lineRemaining,
} from "@renderer/components/features/wholesale/customerOrders";
import { colorQtyProblem } from "@renderer/components/features/wholesale/shared";
import {
  formatIn,
  formatSets,
  PAIRS_PER,
  type Unit,
  type UnitConversions,
} from "@renderer/components/features/wholesale/units";
import {
  colorPairsForText,
  type ColorPairs,
  type StockLine,
} from "@renderer/components/features/wholesale/stock";

export function mergeColorPairs(target: ColorPairs, source: ColorPairs): ColorPairs {
  for (const [color, pairs] of Object.entries(source)) {
    target[color] = (target[color] ?? 0) + pairs;
  }
  return target;
}

export function subtractColorPairs(
  colors: ColorPairs,
  reserved: ColorPairs,
): ColorPairs {
  return Object.fromEntries(
    Object.entries(colors).map(([color, pairs]) => [
      color,
      Math.max(0, pairs - (reserved[color] ?? 0)),
    ]),
  );
}

export function availableStockColors(
  stockCode: string,
  inventoryLines: StockLine[],
): ColorPairs {
  return inventoryLines
    .filter((line) => line.stock_code === stockCode)
    .reduce(
      (colors, line) => mergeColorPairs(colors, line.color_quantities_pairs),
      {},
    );
}

export function allocationsFromOtherOrders(
  orders: CustomerOrder[],
  stockCode: string,
  orderId: string,
): ColorPairs {
  return orders
    .filter(
      (order) =>
        order.order_id !== orderId && order.order_status !== "cancelled",
    )
    .reduce(
      (colors, order) =>
        order.lines
          .filter((line) => line.stock_code === stockCode)
          .reduce(
            (result, line) =>
              mergeColorPairs(
                result,
                // That line's own conversion, not the default six: a product whose set
                // is twelve pairs would otherwise read as half the stock it really
                // holds back, and this order would be free to take what is spoken for.
                colorPairsForText(
                  line.allocated_color_breakdown ?? "",
                  line.unit,
                  line.unit_conversions,
                ),
              ),
            colors,
          ),
      {},
    );
}

export function formatColorPairs(
  colorPairs: ColorPairs,
  conversions: UnitConversions = PAIRS_PER,
): string {
  return Object.entries(colorPairs)
    .filter(([, pairs]) => pairs > 0)
    .map(([color, pairs]) => `${color} ${formatSets(pairs, conversions)}`)
    .join(", ");
}

export function formatColorBreakdown(
  breakdown: string | null | undefined,
  unit: Unit = "set",
  conversions: UnitConversions = PAIRS_PER,
): string {
  if (!breakdown || breakdown.trim() === "") return "";
  const pairs = colorPairsForText(breakdown, unit, conversions);
  return formatColorPairs(pairs, conversions);
}

/** What is still owed of each colour on one line: what was ordered less what has already
 *  gone out. The per-colour ceiling for a delivery — the line total alone would let one
 *  colour be over-delivered while another stayed short. */
export function stillOwedColors(line: CustomerOrderLine): ColorPairs {
  const ordered = colorPairsForText(
    line.color_breakdown,
    line.unit,
    line.unit_conversions,
  );
  const delivered = colorPairsForText(
    line.delivered_color_breakdown ?? "",
    line.unit,
    line.unit_conversions,
  );
  return subtractColorPairs(ordered, delivered);
}

export function deliveryLocationsForLine(
  line: CustomerOrderLine,
  inventoryLines: StockLine[],
): string[] {
  return [
    ...new Set(
      inventoryLines
        .filter((stockLine) => stockLine.stock_code === line.stock_code)
        .map((stockLine) => stockLine.location)
        .filter(Boolean),
    ),
  ];
}

export function availableDeliveryColors(
  line: CustomerOrderLine,
  order: CustomerOrder,
  orders: CustomerOrder[],
  inventoryLines: StockLine[],
  location: string,
): ColorPairs {
  const stockColors = inventoryLines
    .filter(
      (stockLine) =>
        stockLine.stock_code === line.stock_code &&
        stockLine.location === location,
    )
    .reduce(
      (colors, stockLine) =>
        mergeColorPairs(colors, stockLine.color_quantities_pairs),
      {},
    );
  return subtractColorPairs(
    stockColors,
    allocationsFromOtherOrders(orders, line.stock_code, order.order_id),
  );
}

/** The same rules the server applies to a delivery: the colour has to be allocated to
 *  this order, the line cannot pass what the customer is still owed, and the stock has to
 *  be there at this place.
 *
 *  Allocation is the ceiling, not a suggestion. It is the step that decides whose goods
 *  these are, so handing over stock nobody set aside would let one customer walk off with
 *  what another is waiting for. */
export function deliveryValidationMessage(
  line: CustomerOrderLine,
  draft: string,
  owedColors: ColorPairs,
  allocatedColors: ColorPairs,
  availableColors: ColorPairs,
  inventoryLoading: boolean,
): string | null {
  if (draft.trim() === "" || inventoryLoading) return null;
  const parseError = colorQtyProblem(draft);
  if (parseError) return parseError;
  const requestedColors = colorPairsForText(
    draft,
    line.unit,
    line.unit_conversions,
  );
  const requestedPairs = Object.values(requestedColors).reduce(
    (sum, pairs) => sum + pairs,
    0,
  );
  if (requestedPairs > lineRemaining(line))
    return `Delivery cannot exceed ${formatIn(lineRemaining(line), line.unit, line.unit_conversions)}.`;
  for (const [color, pairs] of Object.entries(requestedColors)) {
    if ((allocatedColors[color] ?? 0) <= 0)
      return `${color} is not allocated to this order — allocate it first.`;
    if (pairs > (allocatedColors[color] ?? 0))
      return `Only ${formatSets(allocatedColors[color] ?? 0)} of ${color} is allocated.`;
    if (pairs > (owedColors[color] ?? 0))
      return `Only ${formatSets(owedColors[color] ?? 0)} of ${color} is still owed.`;
    if (pairs > (availableColors[color] ?? 0))
      return `Only ${formatSets(availableColors[color] ?? 0)} of ${color} is available at this location.`;
  }
  return null;
}
