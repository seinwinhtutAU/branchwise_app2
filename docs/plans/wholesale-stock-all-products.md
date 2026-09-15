# Plan — Stock Records must list every product in the pipeline, not only received ones

**Goal.** Today the wholesale Stock Records list only contains products that have
physically been counted at a gate (an opened receiving package) or delivered out of one.
A product that is on a supplier voucher, travelling on a shipment, or ordered by a
customer but not yet received does not exist on the screen at all — you cannot search for
it, and its "Incoming" figure can only be seen on a row that already has stock.

After this change, Stock Records lists **one row per product that appears anywhere in the
wholesale pipeline**: supplier voucher lines, shipments, receivings, customer order lines
and customer deliveries. A product with nothing on hand still gets a row, showing what is
coming and who is waiting for it.

---

## 1. Why the current screen behaves this way

| File | What it does today |
| --- | --- |
| `backend/app/services/wholesale/inventory.py::movements` | Returns `incoming_movements` (opened `ReceivingItem` rows) + `outgoing_movements` (`WholesaleStockMovement` rows). Nothing else. |
| `backend/app/routers/wholesale_inventory.py::list_inventory` | `GET /api/wholesale/inventory` — filters/paginates those movement rows. |
| `frontend/renderer/src/components/features/wholesale/stock.ts::stockLines` | Groups movements by `stock_code@@location` into `StockLine`. **A product with no movement produces no line.** |
| `frontend/.../InventoryPage.tsx` | Renders `stockLines(...)`; `incomingPairsForLine` / `stockStatusForLine` read `shipments` and `vouchers` from the in-memory store. |

Two consequences worth fixing at the same time:

1. **Row identity is `(stock_code, location)`.** A product that has never arrived has no
   location, so it cannot be represented at all under the current key.
2. **`InventoryPage` never fetches vouchers or shipments.** It reads them from
   `store.ts`, which is seeded with front-end demo data (`SEED_VOUCHERS`,
   `SEED_SHIPMENTS`). Unless the user visited Supplier Vouchers or Delivery first in the
   same window, the "Incoming" column and the "At Supplier"/"In Transit" summary cards are
   showing **demo numbers, not real ones**. The new endpoint removes that dependency.

---

## 2. Design decisions (settle these before coding)

**D1 — One row per product, locations nested inside the row.**
The list is keyed by `stock_code` alone. On-hand quantity is the sum across locations, and
each row carries a `locations[]` breakdown (used by the Location column, the location
filter, and the detail page). This is the only key that can represent a product that has
not arrived anywhere yet.

**D2 — Computed server-side, in one endpoint.**
All five sources are read in the backend and returned already summed. The front end stops
deriving pipeline figures from the store. This fixes the demo-data leak above and keeps
one definition of every figure.

**D3 — Quantities are always whole pairs**, as everywhere else in wholesale
(`app/services/wholesale/units.py`). Colours keep the existing `"black10,pink2p"` shorthand.

**D4 — Everything is branch-scoped** exactly like the existing wholesale services:
`branch_id is None` (admin) means "all branches", otherwise filter on the user's branch.
Admin keeps full access (`_require_wholesale` already allows `UserRole.ADMIN`).

**D5 — Splitting "still to come" between At Supplier and In Transit is an estimate.**
Shipments count *packages*; packages do not say which product is inside them. The split
below is proportional and must be documented in code as approximate. The *total* still to
come is exact (it comes from voucher lines minus receiving items), only its stage split is
estimated.

---

## 3. Backend

### 3.1 New service: `backend/app/services/wholesale/stock_records.py`

One public function:

```python
def stock_records(db: Session, branch_id: str | None) -> list[dict]:
    """One row per product seen anywhere in the wholesale pipeline."""
```

It must build the whole list with **batched, grouped queries** — no per-product round
trips. (`_available_color_pairs` in `inventory.py` loops receivings per location; do not
copy that shape here, the list can cover every product in the catalogue.)

Gather these aggregates first, each one query:

| Aggregate | Source | Grouped by |
| --- | --- | --- |
| `ordered_from_supplier` | `SupplierVoucherLine.quantity_pairs` joined to `SupplierVoucher` | `(voucher_no, stock_code)` |
| `supplier_lost` | `SupplierVoucherLine.lost_quantity_pairs` | `(voucher_no, stock_code)` |
| `received` | opened `ReceivingItem.quantity_pairs` (join `ReceivingPackage.opened is True` → `Receiving`) — reuse `wholesale_supplier_vouchers.received_pairs_by_voucher_stock` | `(voucher_no, stock_code)` |
| `on_hand_by_location` | same opened items | `(stock_code, Receiving.gate)` |
| `delivered_by_location` | `WholesaleStockMovement.quantity_pairs` | `(stock_code, location)` |
| `customer_ordered` | `CustomerOrderLine.quantity_pairs` where `CustomerOrder.cancelled is False` | `stock_code` |
| `customer_lost` | `CustomerOrderLine.lost_quantity_pairs`, same filter | `stock_code` |
| `delivered_total` | `WholesaleStockMovement.quantity_pairs` | `stock_code` |
| shipment package progress | `Shipment` + `ShipmentLeg` for every `voucher_no` seen | `voucher_no` |
| colour breakdowns | `ReceivingItem.color_breakdown` (in) and `WholesaleStockMovement.color_breakdown` (out) | `(stock_code, location)` |

Product identity (`description`, `product_group`) is denormalised on every line in this
schema. Take it from the most recent source that has one, in this order: receiving item →
supplier voucher line → customer order line → stock movement. Fall back to `""` /
`ProductGroup.MAN` only if none carries it. (Optionally prefer
`WholesaleProduct` from `app/models/wholesale_master_data.py` when the code is in the
master list — see §6.)

### 3.2 The arithmetic, per product

All figures in pairs, never negative (clamp with `max(0, …)`).

```
on_hand              = Σ opened receiving items  −  Σ stock movements out
allocated            = Σ effective_allocated_color_pairs over open order lines
                       (reuse inventory.effective_allocated_color_pairs — it already
                        subtracts what has been delivered, per colour)
available            = max(0, on_hand − allocated)

# per supplier voucher line, per stock code:
still_to_come(line)  = max(0, line.quantity_pairs
                              − received[(voucher_no, stock_code)]
                              − line.lost_quantity_pairs)
still_to_come        = Σ over every open voucher line for this product

# stage split, per voucher_no (see D5 — estimate):
P                    = Σ shipment.total_packages         for shipments of this voucher_no
S                    = Σ shipment.packages_sent_by_cargo
A                    = Σ min(intoFinal(shipment), packages actually recorded on its
                             receivings, falling back to shipment.final_received_packages)
L                    = Σ shipment.lost_packages + Σ leg.lost_packages
not_sent_pkgs        = max(0, P − S)
in_transit_pkgs      = max(0, S − A − L)
at_supplier          = round(still_to_come × not_sent_pkgs / (not_sent_pkgs + in_transit_pkgs))
in_transit           = still_to_come − at_supplier
# no shipment exists for the voucher  → at_supplier = still_to_come, in_transit = 0
# not_sent_pkgs + in_transit_pkgs == 0 → at_supplier = still_to_come, in_transit = 0

customer_ordered     = Σ open order-line quantity_pairs
delivered            = Σ stock movements out
owed_to_customers    = max(0, customer_ordered − delivered − customer_lost)
lost                 = supplier_lost + customer_lost   (reported separately too)
```

`intoFinal` is `shipments.ts::intoFinal` — its Python twin already exists in
`app/services/wholesale/shipments.py`; reuse it rather than re-deriving.
The "packages actually recorded on its receivings" fallback rule is
`app/services/wholesale_receivings.py::final_received_by_shipment` — reuse that too.

### 3.3 Row shape returned by the endpoint

```jsonc
{
  "stock_code": "A1001",
  "description": "Men's leather sandal",
  "product_group": "man",

  "on_hand_pairs": 48,
  "allocated_pairs": 12,
  "available_pairs": 36,

  "at_supplier_pairs": 60,
  "in_transit_pairs": 24,
  "incoming_pairs": 84,            // at_supplier + in_transit, for the existing column

  "customer_ordered_pairs": 120,
  "owed_to_customers_pairs": 72,
  "delivered_pairs": 48,
  "lost_pairs": 6,

  "colors": "black6s,white2p",     // net on hand, same shorthand staff type
  "color_quantities_pairs": { "black": 36, "white": 2 },

  "locations": [
    { "location": "Bogyoke Rd, Mawlamyine",
      "on_hand_pairs": 48, "colors": "black6s,white2p", "last_moved_on": "2026-09-11" }
  ],

  "sources": ["voucher", "shipment", "receiving", "order", "delivery"],
  "voucher_nos": ["SV-260901-0001"],
  "shipment_nos": ["SHP-260902-0001"],
  "order_nos": ["ORD-260902-0001"],
  "receiving_nos": ["RCV-260908-0001"],

  "status": "In Transit",          // see §3.4
  "last_activity_on": "2026-09-11" // latest of any dated source, null if none
}
```

Schemas go in a new `backend/app/schemas/wholesale_stock_records.py` (response model
only — this endpoint is read-only).

### 3.4 Status, computed server-side

Replaces `stockStatusForLine` in the front end. First match wins:

1. `on_hand > 0 and allocated >= on_hand` → **"Customer Allocated"**
2. `on_hand > 0` → **"In Stock"** (rename of the old "At Receiving"; it was never about the gate)
3. `in_transit > 0` → **"In Transit"**
4. `at_supplier > 0` → **"At Supplier"**
5. `owed_to_customers > 0` → **"Customer Ordered"** (wanted, nothing ordered from a supplier yet)
6. otherwise → **"Finished"** (everything that was bought has arrived and gone out)

Health (the second pill) changes too, because "Out of Stock" on a product that has never
arrived reads wrong:

- `on_hand > OVERSTOCK_THRESHOLD` → Overstock
- `0 < on_hand < LOW_STOCK_THRESHOLD` → Low Stock
- `on_hand > 0` → Healthy
- `on_hand == 0` and the product has receiving history → **Out of Stock**
- `on_hand == 0` and it never arrived → **"Not arrived yet"**

Keep the thresholds where the front end has them today
(`LOW_STOCK_THRESHOLD = 20`, `OVERSTOCK_THRESHOLD = 150`); health can stay a front-end
calculation as long as the row carries `on_hand_pairs` and a `has_receiving_history` flag
(add it to the row shape).

### 3.5 New endpoint

In `backend/app/routers/wholesale_inventory.py`:

```python
@router.get("/stock")
def list_stock_records(
    search: str = "", location: str | None = None, status: str | None = None,
    source: str | None = None, page: int = 1, page_size: int = 100,
    user=Depends(get_current_app_user), db=Depends(get_db), response: Response = None,
) -> list[dict]:
```

- `_require_wholesale(user)` first, as every other handler here does.
- `search` matches `stock_code`, `description`, any `locations[].location`, `colors`, and
  any reference in `voucher_nos` / `order_nos` / `shipment_nos` / `receiving_nos`.
- `location` keeps a row if **any** of its `locations[]` matches.
- `source` filters on the `sources` list (`voucher` / `shipment` / `order` / `receiving` /
  `delivery`), so "show me things only a customer has asked for" is one click.
- Sort by `stock_code`; set `X-Total-Count` before slicing, same as `list_inventory`.

**Leave `GET /api/wholesale/inventory` (movements) exactly as it is** — the Movement tab
and `list_product_movements` still use it, and other screens read it.

`GET /api/wholesale/inventory/movements/{stock_code}` currently **requires** a `location`
query parameter. Make `location` optional: with no location it returns every movement for
that product across all places. The detail page needs that once rows are per product.

---

## 4. Front end

### 4.1 `api.ts`

- `export const WHOLESALE_STOCK_URL = `${apiBaseUrl}/api/wholesale/inventory/stock`;`
- `StockRecordWire` type mirroring §3.3 and a `stockRecordsFromWire()` converter, in the
  same style as `inventoryMovementsFromWire`.

### 4.2 `stock.ts`

- Add `export interface StockRecord { … }` (the §3.3 shape).
- **Keep** `StockLine`, `stockLines`, `incomingMovements`, `movementsFor` — the Movement
  tab and the seed-data fallback path still use them.
- Mark `allocatedPairs`, `stockPurpose`, `ordersWaitingFor`, `owedPairs` as used only by
  the fallback path; the server now supplies those figures.

### 4.3 `InventoryPage.tsx`

- Add a third query: `["wholesale", "stock"]` → `WHOLESALE_STOCK_URL`. `reload()`
  invalidates it alongside the other two.
- `StockList` takes `records: StockRecord[]` instead of `lines: StockLine[]`. Fallback
  when the fetch has not resolved: derive records from the store the way `lines` are
  derived today, so an offline launch still shows the last known picture
  (`docs/architecture.md`, "Working on a weak connection").
- Table columns become:

  | Product | Color | Stock (On hand / Allocated / Available / Incoming) | Location | Stock Status | Stock Health | Last Activity |

  - **Stock** keeps its 2×2 grid. Add a fifth and sixth figure under it, or a second grid
    row: **Customer owed** (`owed_to_customers_pairs`) and **At supplier / In transit**
    split, so a row with nothing on hand still says something useful.
  - **Location** shows the single location when there is one, `"3 places"` when there are
    several (tooltip lists them), and **"Not arrived yet"** when `locations` is empty.
  - **Last Activity** uses `last_activity_on`, `—` when null.
- Filters: keep search / location / health; replace the status list with the six statuses
  from §3.4 and add a **Source** select ("Anywhere", "On a supplier voucher", "On a
  shipment", "On a customer order", "Received", "Delivered"). Pass `search`, `location`,
  `status`, `source` to the endpoint rather than filtering client-side once the list is
  long enough to paginate server-side; keeping it client-side is acceptable for now, but
  then pass `page_size=100` and page in the client exactly as today.
- Empty state text: *"Products appear here as soon as they are on a supplier voucher, a
  shipment or a customer order — not only once they arrive."*
- `stockStatusForLine`, `incomingPairsForLine`, `pairsForShipmentStage` and the
  `remainingQty` / `intoFinal` imports are deleted from this file; the server supplies
  those numbers now. `InventorySummaryCards` sums the records
  (`Σ at_supplier_pairs`, `Σ in_transit_pairs`, `Σ on_hand_pairs`, `Σ allocated_pairs`)
  instead of reading `shipments` from the store — **this is the fix for the demo-data leak
  in §1.2**, so it must not be skipped.
- Selection state becomes `selected: string | null` (the stock code). `initialStockCode`
  deep-linking gets simpler: match on `stock_code` only.

### 4.4 `StockDetail`

- Keyed by `stock_code`; header shows the product, its status and health.
- "Stock information" gains a **Pipeline** block reading top to bottom:
  At supplier → In transit → On hand (by location) → Allocated → Delivered → Lost, each
  with its pairs figure. This is the whole point of the change: one place that says where
  every pair of this product currently is.
- The existing "Related orders" table is unchanged.
- The movements table now lists every location for the product (the Location column is
  already there); fetch it from `GET /api/wholesale/inventory/movements/{stock_code}`
  without a `location` parameter (§3.5).
- Reference chips: the voucher, shipment, receiving and order numbers from the row, each
  using the existing `Reference` component so they read the same as elsewhere.

---

## 5. Tests

Backend, in `backend/tests/test_wholesale_inventory.py` (uses the in-memory SQLite
fixtures in `conftest.py` — never the real database):

1. A product on a supplier voucher with no receiving appears, with
   `at_supplier_pairs == voucher line pairs`, `on_hand_pairs == 0`,
   `status == "At Supplier"`, `locations == []`.
2. Same product once its shipment has `packages_sent_by_cargo > 0` and nothing received →
   `in_transit_pairs > 0`, `status == "In Transit"`.
3. Partly received → `on_hand_pairs` and `still to come` both non-zero, and
   `at_supplier + in_transit == ordered − received − lost`.
4. A product only on a customer order (no voucher) appears with
   `status == "Customer Ordered"` and `owed_to_customers_pairs > 0`.
5. A cancelled order contributes nothing.
6. A voucher-line write-off reduces `at_supplier_pairs`; a shipment `lost_packages`
   reduces `in_transit_pairs`.
7. Delivering to a customer reduces `on_hand_pairs` and raises `delivered_pairs`.
8. Branch scoping: a wholesale user sees only their branch; admin sees every branch.
9. `search`, `location`, `status`, `source` filters and `X-Total-Count` behave.
10. `GET /api/wholesale/inventory/movements/{stock_code}` with no `location` returns
    movements from every location.

Run: `uv run --directory backend pytest -q tests/test_wholesale_inventory.py`
(always `--directory`, never `--project`, or `backend/.env` is not the file that loads).

Front end: `npm run typecheck` and `npm run lint` must pass; check the page by hand with
`npm run dev:all` against seeded wholesale demo data
(`uv run --directory backend python scripts/seed_wholesale_demo.py --branch "Wholesale"`).

---

## 6. Optional follow-up (do not bundle unless asked)

Products in the master list (`wholesale_products`, `app/models/wholesale_master_data.py`)
that have **no** pipeline activity at all are still missing after this change. If the owner
wants the full catalogue, add a `include_catalogue=true` query parameter that unions the
master list in with every figure zero and `status = "No activity"`. Keep it off by
default — a stock screen full of zero rows is harder to read, not easier.

---

## 7. Files touched

**New**
- `backend/app/services/wholesale/stock_records.py`
- `backend/app/schemas/wholesale_stock_records.py`
- tests added to `backend/tests/test_wholesale_inventory.py`

**Changed**
- `backend/app/routers/wholesale_inventory.py` (new `/stock` route; `location` optional on
  the movements route)
- `frontend/renderer/src/components/features/wholesale/api.ts`
- `frontend/renderer/src/components/features/wholesale/stock.ts`
- `frontend/renderer/src/components/features/wholesale/InventoryPage.tsx`
- `CLAUDE.md` — the Inventory sentence in "Wholesale: rebuilt screen by screen" now
  undersells the screen; say that Stock Records covers the whole pipeline, not only
  received goods.

**Not touched**
- `wholesale_stock_movements` and every other table — this change adds no migration. Every
  figure is derived from rows that already exist.
