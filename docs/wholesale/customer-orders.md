# Customer Orders

What a customer has ordered, what's been set aside for them (allocation), and what's actually
gone out the door (delivery). Two project rules govern this screen: allocation happens
automatically the moment stock arrives at [Receiving](./receiving.md), and the Allocate screen
here exists only for exceptions — not the normal path — and goods can only be delivered to a
customer after they've been allocated to that customer's order.

## Models (`app/wholesale/models/entities.py`)

**`CustomerOrder`** (table `wholesale_customer_orders`): `id`, `branch_id`, `order_no`
(`ORD-YYMMDD-NNNN`, unique per branch), `customer_name`, `customer_phone`, `customer_address`,
`order_date`, `cancelled` (bool), `version_id` (optimistic locking).

**`CustomerOrderLine`** (table `wholesale_customer_order_lines`, cascade): `id`, `order_id`,
`stock_code`, `description`, `product_group`, `supplier_name`, `color_qty` (colour breakdown,
e.g. `"black10,pink10"`), `colors` (JSON parse-cache), `unit`, `unit_conversions`,
`wanted_pairs` (always pairs, derived from `color_qty`+`unit`), `allocated_quantity_pairs`/
`allocated_color_breakdown` (the *current reservation* — overwritten in place, not a log — see
below), `lost_quantity_pairs`, `selling_price` (always Kyat), `currency_code`,
`original_selling_price`/`exchange_rate` (non-MMK only).

**`WholesalePayment`** — shared with Supplier Vouchers; here `order_id` is set (not
`voucher_id`), and `paid_quantity_pairs` is meaningful (a customer payment can be tied to a
quantity, not just an amount).

**`AllocationEvent`** (table `wholesale_allocation_events`) — the append-only audit log behind
`allocated_quantity_pairs`/`allocated_color_breakdown`, written only when a manual allocation
actually changes the value. Fields: `order_id`, `order_line_id`, `order_no`, `customer_name`,
`stock_code`, `description`, `product_group`, `unit`, `unit_conversions`,
`previous_color_breakdown`, `previous_quantity_pairs`, `color_breakdown`, `quantity_pairs`,
`recorded_by_user_id`, `created_at`. `GET /api/wholesale/orders/allocations` lists these — the
Allocation Record screen.

## Colour validation and duplicate stock codes

Same rules as every other line type: `color_qty_problem` before save, `wanted_pairs` computed
server-side from the breakdown text, and `_check_no_duplicate_stock_codes` forbids two lines
with the same stock code on one order — deliveries are attributed to an order by stock code
alone (not by line id), so a duplicate would make that attribution ambiguous.

## Status (computed, never stored)

`order_status(total_wanted, received, allocated, cancelled, lost)`:

1. `cancelled` → **`cancelled`**
2. `received + lost >= total_wanted` (and `total_wanted > 0`) → **`fulfilled`**
3. `received > 0` → **`partly_delivered`**
4. `allocated > 0` → **`ready_to_deliver`**
5. else → **`waiting_for_stock`**

There is deliberately no `"allocating"` status — allocation happens automatically at receiving,
so a status implying manual, in-progress activity would be misleading.

## Totals

`app/wholesale/services/money.py::order_totals(order)`: `total = Σ priced_amount(line.wanted_pairs,
line.unit, line.selling_price, line.unit_conversions)`; `paid = Σ payment.amount`; `balance_due
= total - paid`. Always computed fresh, never stored.

## Delivered/remaining — computed from `WholesaleStockMovement`, never stored on the order

- `delivered_pairs_by_order` / `delivered_color_pairs_by_order`
  (`app/wholesale/services/inventory.py`) sum `WholesaleStockMovement.qty_pairs`, grouped by
  order/stock code (and by colour) — see [Inventory](./inventory.md).
- Per line (`_out()` in `routers/orders.py`): `delivered_quantity_pairs = min(delivered_by_stock,
  line.wanted_pairs)`; `remaining_quantity_pairs = max(0, wanted_pairs - delivered_quantity_pairs
  - lost_quantity_pairs)`.
- Order-level: sums of the line figures, `order_status` computed from them, plus
  `allowed_actions` from the lifecycle FSM below.

## Allocation

`PUT /api/wholesale/orders/lines/{order_line_id}/allocation` → `allocate_order_line` in
`services/orders.py` — reserves stock against a line, by colour. Validates:

- the colour text parses;
- the requested pairs don't exceed what's still owed (`wanted_pairs - delivered - lost`);
- each requested colour doesn't exceed `available - reserved_by_other_lines` for that colour
  (`available_color_pairs_for_stock_code` minus `allocated_color_pairs_for_stock_code`, excluding
  this line itself);
- the total requested pairs don't exceed total available stock net of other reservations.

**A subtlety**: what the caller sends is the *net* (still-to-set-aside) amount, but the stored
column is the *cumulative* (gross, including already-delivered) amount — so before writing,
already-delivered colours are added back on. This exists specifically so a partial delivery
followed by re-saving the Allocate screen doesn't silently eat the remaining reservation. An
`AllocationEvent` row is written only if the resulting value actually differs from the prior
one.

**`effective_allocated_color_pairs`** (`services/inventory.py`) is the read-time
reconciliation: it clamps the *stored* (gross) allocation per colour to `min(stored - delivered,
wanted - delivered)`, so a read never keeps "reserving" pairs that have already gone out, and a
delivery of one colour can never eat into another colour's separate reservation.

### Auto-allocation on arrival

`auto_allocate_arrivals` (`services/inventory.py`) is the mechanism behind "allocation happens
automatically at receiving" — triggered the moment a `ReceivingPackage` is opened (see
[Receiving](./receiving.md#opening-a-package)). For each touched stock code: computes free
stock minus already-reserved, then walks open (non-cancelled) order lines **oldest order first**
(`order_date`, `order_no`), colour by colour, granting as much as is still owed and available,
and writes the result directly onto the line — no `AllocationEvent` is written for this path
(only the manual `allocate_order_line` writes those). Whatever can't be covered is left
unallocated, for the Allocate screen to handle — the documented exception case, not the norm.

## Delivery

`POST /api/wholesale/inventory/deliveries` (single line) and `/deliveries/batch` (multi-product,
one transaction, up to 50 lines, each product only once per batch) — see
[Inventory](./inventory.md) for the movement model itself. `_validate_delivery` is the
authoritative server-side gate, checked per colour and per stock code:

1. The colour text parses.
2. The product is actually on the order.
3. Each requested colour is on the order line's colour breakdown at all.
4. Each requested colour doesn't exceed what's still owed of that colour (`ordered_colors -
   delivered_colors`).
5. **Allocation gate**: each requested colour can't exceed what's currently *allocated to this
   order* for that colour (`effective_allocated_color_pairs`) — an order can only draw down its
   own reservation. If nothing is allocated: `'Color "X" has not been allocated to this order —
   allocate it first'`. This is the literal enforcement of "goods can only be delivered after
   they've been allocated."
6. **Stock-at-location gate**: each requested colour can't exceed `available_at_location -
   reserved_by_other_open_orders` for that colour.
7. Pair-total checks mirroring the colour checks (`still_owed`, `available` net of other
   orders' reservations).

This one function is the exact mechanism behind "a delivery is capped by both shelf stock and
the customer's remaining order quantity" — called by `create_delivery`, `create_delivery_batch`,
and `update_delivery` (the last with `excluding_id` so a delivery being edited doesn't count
against its own totals).

The frontend mirrors these same four checks, in the same order, in
`orders/orderColorUtils.ts::deliveryValidationMessage` for instant feedback; the server remains
authoritative. `OrderDeliveryView.tsx` computes, per row, `deliverableColors =
min(allocatedColors, owedColors, availableColors)` — the intersection of "reserved for me,"
"still owed," and "physically here at the selected location" — and only offers up to that
amount in the colour picker. `OrderAllocationTable.tsx` does the equivalent for allocation:
`availableToAllocate = stockColors - reservedByOtherOrders - ownCurrentAllocation`, capped
further per colour by what's still owed on the line.

## Cancellation

`cancel_order` sets `cancelled = True` and zeroes every line's `allocated_quantity_pairs`/
`allocated_color_breakdown` — releasing any reservation back to the pool immediately. Blocked
(via the lifecycle FSM) if any deliveries already exist: *"Some of this order has already gone
out to the customer. Take those deliveries back before cancelling it."*

## What's allowed when

`OrderStatus`/`OrderAction`/`ALLOWED_ORDER_ACTIONS` (`lifecycle.py`):

| Status | Allowed actions |
| --- | --- |
| `waiting_for_stock` | edit, allocate, add_payment, cancel, delete, write_off |
| `ready_to_deliver` | + deliver (still allows cancel/delete) |
| `partly_delivered` | allocate, deliver, add_payment, write_off only — no edit/cancel/delete, since lines with deliveries can't be replaced |
| `fulfilled` | add_payment only |
| `cancelled` | delete only |

Dynamic overrides on top of the table: `has_payments || has_movements` removes `delete`;
`has_movements` removes `cancel`.

## Endpoints

All under `/api/wholesale/orders`:

| Method & path | Notes |
| --- | --- |
| `GET ""` | `branch_id`, `search` (order_no/customer_name/stock_code/description), `order_status`, `payment_status`, `page`/`page_size` (≤100). |
| `GET "/allocations"` | Lists `AllocationEvent` rows — the Allocation Record screen. `branch_id`, `search`, pagination. |
| `GET "/next-no"` | Preview the next `order_no` before creating. |
| `GET "/{order_id}"` | Full detail with lines/payments/totals. |
| `POST ""` | Create; `branch_id` resolved the usual way (own branch wins; admin must supply one). |
| `PUT "/{order_id}"` | Full-line replacement; preserves allocation/loss data per stock code where it still fits the new line. |
| `POST "/{order_id}/cancel"` | |
| `DELETE "/{order_id}"` | 204; blocked if payments/movements exist. |
| `POST "/{order_id}/payments"` | `{paid_on, amount, paid_quantity_pairs?, note}`. Rejects if `paid + amount > total`, or if `paid_quantity_pairs` pushes cumulative paid pairs past delivered pairs. |
| `DELETE "/{order_id}/payments/{payment_id}"` | |
| `PUT "/lines/{order_line_id}/allocation"` | `{color_breakdown}` — an empty string clears the reservation. |
| `POST "/lines/{line_id}/write-off"` | See [Write-offs](./write-offs.md). |

Visibility: a branch-scoped account always sees only its own branch; an admin with no
`branch_id` filter sees every branch.

## Frontend

`frontend/renderer/src/components/features/wholesale/orders/`:

- **`customerOrders.ts`** — wire types, pure helpers (`lineRemaining`, `remainingQty`,
  `orderAmount`, `orderBalance`, `orderAllocatedPairs`, `needsAllocation`, `nextAction`), and
  `SEED_ORDERS` (offline/demo fallback).
- **`customerOrdersApi.ts`** — the write calls: `createCustomerOrder`, `updateCustomerOrder`,
  `cancelCustomerOrder`, `deleteCustomerOrder`, `updateCustomerOrderLineAllocation`,
  `writeOffCustomerOrderLine`, `addCustomerOrderPayment`, `removeCustomerOrderPayment`.
- **`orderColorUtils.ts`** — the client-side mirror of the server's allocation/delivery
  validation described above.
- **`OrderAllocationTable.tsx`** — the Allocate tab's table.
- **`OrderFulfillmentBody.tsx`** — the "Allocate & Deliver" sub-tab switcher inside order
  detail; computes the two badge totals (`availableToAllocatePairs`, `availableToDeliverPairs`)
  using the same three-way caps as the row-level logic, so the tab badges can never disagree
  with the table rows.
- **`OrderDeliveryView.tsx`** — the Deliver tab's table.
- **`OrderDetail.tsx`** — the order detail screen (tabs: order info/edit, allocate & deliver,
  payments); `react-hook-form` + zod for the edit form.
- **`OrderList.tsx`** — list/table screen with search, status filters, KPI summary cards.
- **`NewOrderForm.tsx`** — the multi-step "new order" form.
- **`CustomerOrdersPage.tsx`** — top-level page (data fetching + `store.ts` hydration via
  `hydrateOrders`).
- **`OrderBadges.tsx`** — status/payment badge components.
- **`types.ts`** — small shared formatting helpers.
