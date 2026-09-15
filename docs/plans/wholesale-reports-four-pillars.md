# Plan — Wholesale Reports, rebuilt as four pillars

**Goal.** Replace the current wholesale Reports page (tabs: Sales / Inventory / Payments /
Delivery, all computed in the browser) with a four-pillar report that matches the retail
Dashboard the owner already reads: **Revenue · Cost & Supplier · Inventory · Customer**.
Same tab pattern, same period control, same KPI-with-comparison tiles, same words for the
same things — but with the wholesale reality (suppliers, shipments, named customers) in
place of retail's POS slips.

Read `docs/retail_dashboard.md` before starting. This plan deliberately copies its
structure, its endpoint-per-pillar decision and its front-end components; anywhere this
plan is silent, follow what that doc already settled.

---

## 1. What exists today, and what is wrong with it

`frontend/renderer/src/components/features/wholesale/ReportsPage.tsx` (582 lines) fetches
five list endpoints (`/orders`, `/supplier-vouchers`, `/shipments`, `/inventory`,
`/receivings`), filters them by a from/to date in the browser, and sums them inline.

Three real problems, all fixed by moving the work to the server:

1. **The figures are silently truncated.** Every wholesale list endpoint paginates with
   `page_size` defaulting to 100 and the page sends no paging parameters. Once the
   business has more than 100 orders, the "Total sales" figure is the total of the *first
   hundred orders only*, with nothing on screen saying so.
2. **"Available stock" is wrong.** The Inventory tab calls `stockLines(filteredMovements)`
   — movements already filtered to the selected dates — so its Available column is the
   *net movement inside the window*, not stock on hand. A product that arrived last month
   and has not moved since reads as zero.
3. **No comparison and no presets.** There is a from/to date pair and nothing else: no
   "last 30 days", and no way to see whether a number is better or worse than before.

---

## 2. Shape of the new page

```
Reports
  [ Period: Today | Yesterday | 7d | 30d | custom from–to ]          [ Refresh ]
  [ Revenue ] [ Cost & Supplier ] [ Inventory ] [ Customer ]
  4 KPI tiles (value, vs previous period)
  1–2 charts
  2–3 tables
```

- One endpoint per pillar, each returning that whole tab's payload — the decision already
  settled for retail in `docs/retail_dashboard.md` ("Aggregation endpoint decision").
- Every KPI is `{value, previous_value, delta_pct}` against the immediately-preceding
  window of the same length, exactly as retail's tiles.
- Tabs own their own fetch, loading and error state; the page owns the tab bar, the period
  control and Refresh.
- **Inventory has no period control** (stock is a point-in-time fact) except for its
  movement figures — see §3.5.

### House rules that apply to this page

These are settled preferences; do not re-decide them.

- Money is **Myanmar Kyat** — `formatKyat`, never a dollar sign.
- A change in a percentage is shown as plain **"%"**, never "percentage points".
- **No per-day selling rates** ("0.17 pairs/day" means nothing for shoes). Use "days since
  last movement", counts, and totals instead.
- **KPI cards are figures to read, not filters** — nothing on them is clickable.
- **No hover-lift animation** on cards.
- Tables keep the **spreadsheet gridline look** (use `components/ui/Table`, which already
  does this).
- **No maximum on a custom date range.**
- Cache with React Query and a `staleTime`, so coming back to the page does not blank it
  into a skeleton every time.
- Wording is a shop owner explaining the business, not a developer showing the formula.

---

## 3. The four pillars

Everything below is branch-scoped the way every wholesale service already is:
`user.branch_id is None` (admin) means every branch, otherwise that branch only. Admin
keeps full wholesale access (`_require_wholesale` already allows `UserRole.ADMIN`).

### 3.1 Which date does a figure belong to?

State this on the page, because wholesale figures come from four different dates:

| Figure | Dated by |
| --- | --- |
| Orders taken | `CustomerOrder.order_date` |
| Goods delivered / revenue earned | `WholesaleStockMovement.delivered_on` |
| Money in and out | `WholesalePayment.paid_on` |
| Goods bought | `SupplierVoucher.voucher_date` |
| Goods arrived, freight spent | `Receiving.received_on` |

### 3.2 Revenue — what we sold

**Recognised on delivery, not on order.** A wholesale order can sit half-delivered for
weeks; counting the whole order as revenue on the day it was written would overstate every
period. Ordered value is shown beside it as a separate figure, never added to it.

```
delivered_revenue = Σ over stock movements in the period:
                      movement.quantity_pairs × selling_price of the matching
                      CustomerOrderLine (same order_id + stock_code)
ordered_value     = Σ over orders placed in the period: Σ line.quantity_pairs × line.selling_price
collected         = Σ customer payments (WholesalePayment.order_id not null) paid in the period
pairs_delivered   = Σ movement.quantity_pairs in the period
```

- **KPIs**: Delivered revenue · Ordered value · Pairs delivered · Money collected.
- **Charts**: daily delivered revenue (bar/line toggle, reuse `TrendChart`); delivered
  revenue vs money collected on one axis (`TwoLineTrendChart` — same unit, so the gap
  between the lines reads as "sold but not yet paid for").
- **Tables**: Top customers by delivered revenue; top products by delivered revenue (pairs,
  Ks, average selling price weighted by quantity, not a plain average of line prices);
  orders placed in the period (order no, customer, pairs, value, delivered %, balance).
- A cancelled order contributes nothing, anywhere.

### 3.3 Cost & Supplier — what we paid, and what we still owe

Two things live here and must not be mixed: the **cost of the goods** and the **cost of
getting them here**.

```
purchases          = Σ over vouchers dated in the period: Σ line.quantity_pairs × line.buying_price
freight_and_handling = Σ ReceivingCost.amount on receivings received in the period
paid_to_suppliers  = Σ supplier payments (WholesalePayment.voucher_id not null) in the period
owed_to_suppliers  = Σ voucher_totals(voucher)["balance_due"] over every voucher (point in time)

cost_of_goods_delivered = Σ over stock movements in the period:
                            movement.quantity_pairs × estimated buying price for that stock code
gross_margin       = delivered_revenue − cost_of_goods_delivered
gross_margin_pct   = gross_margin / delivered_revenue × 100      (null when nothing was delivered)
```

**Estimated buying price.** A delivery does not record which voucher its pairs came from,
so the buying price is the **quantity-weighted average of the buying prices on supplier
voucher lines for that stock code dated on or before the delivery date**. This mirrors
retail's `point_in_time_buying_price` and must be documented in code as an estimate. A
product with no voucher line at all has no cost estimate: leave it out of the margin
ranking rather than treating it as costing zero.

**Freight is never split across products.** A transport charge covers a whole mixed
batch; dividing it per pair would invent a number nobody spent. Show freight as its own
period total and its own by-stage table, and state on the page that gross margin is before
freight. This is a standing business rule, not a shortcut.

- **KPIs**: Purchases · Freight & handling · Gross margin % · Owed to suppliers.
- **Charts**: daily revenue vs cost of goods delivered (`TwoLineTrendChart`); freight by
  stage (reuse `app/services/wholesale/receivings.py::cost_by_stage`, which already orders
  stages along the route and labels blanks "Not said where").
- **Tables**: Spend by supplier (vouchers, pairs, value, paid, balance); supplier payables
  with days since the voucher date; write-offs in the period (`WholesaleWriteOff`, with its
  reason) valued at buying price — goods paid for that will never be sold.

### 3.4 Inventory — where every pair is

This pillar is the whole pipeline, not shelf stock: at supplier → in transit → on hand →
allocated → delivered.

**Dependency:** it reads `backend/app/services/wholesale/stock_records.py` (see
`docs/plans/wholesale-stock-all-products.md`, already in progress). Do not compute stock a
second way here — call `stock_records(db, branch_id)` and aggregate its rows.

```
on_hand / available / allocated / at_supplier / in_transit = Σ over stock records (point in time)
stock_value        = Σ record.on_hand_pairs × estimated buying price (same estimate as §3.3)
received_in_period = Σ incoming movements dated in the period
delivered_in_period= Σ outgoing movements dated in the period
```

- **KPIs**: On hand · Available (on hand less allocated) · Incoming (at supplier + in
  transit) · Stock value.
- Say plainly on the tab which figures ignore the period: stock is "as of now", the
  received/delivered figures follow the dates.
- **Charts**: stock by location (bar list); pipeline stages as a simple horizontal
  breakdown (at supplier / in transit / on hand / allocated).
- **Tables**: Stock by product and location; **Cannot supply** — products customers are
  waiting for with nothing on hand and nothing on the way (`owed_to_customers_pairs > 0`
  and `on_hand_pairs + incoming_pairs == 0`); **Not moving** — on hand, with the date of
  its last movement and how many days ago that was (days since, never a per-day rate).

### 3.5 Customer — who buys, who owes

Wholesale has named customers, so this is real customer analysis, not retail's anonymous
basket proxy. **Do not copy retail's basket measures** (items per basket, single-item
share) — they are meaningless here.

```
active_customers   = distinct customer_name on orders placed in the period
new_customers      = of those, the ones with no order before the period start
avg_order_value    = ordered_value / order count in the period
receivables        = Σ order_totals(order)["balance_due"] over open orders (point in time)
fulfilment_days    = for orders fully delivered in the period: last delivery date − order date
```

- **KPIs**: Active customers · New customers · Average order value · Owed by customers.
- **Charts**: daily order count; top ten customers by delivered revenue (bar list).
- **Tables**: Customer ranking (orders, pairs ordered, pairs delivered, Ks delivered, paid,
  balance); orders still open with how many days they have been open; **quiet customers** —
  bought before, nothing in this period (a list worth phoning).
- Match names case-insensitively on trimmed `customer_name`; the orders table has no
  customer table behind it, and "Ma Su Su" and "ma su su " are one person.

---

## 4. Backend

### 4.1 Files

**New**
- `backend/app/services/wholesale/reports.py` — four functions:
  `revenue_report`, `cost_report`, `inventory_report`, `customer_report`,
  each `(db: Session, branch_id: str | None, window) -> dict`.
- `backend/app/schemas/wholesale_reports.py` — response models (read-only endpoints).
- `backend/app/routers/wholesale_reports.py` — prefix `/api/wholesale/reports`, tag
  `wholesale`, `_require_wholesale(user)` in every handler, routes `/revenue`, `/cost`,
  `/inventory`, `/customer`, each taking `period` (`today|yesterday|7d|30d`, default `30d`)
  plus optional `date_from`/`date_to` (both together, `date_from <= date_to`, **no maximum
  length**).

**Changed**
- `backend/app/main.py` — register the router next to the other wholesale ones.
- `CLAUDE.md` + a new `docs/wholesale_reports.md` once it ships.

**No migration.** Every figure is derived from tables that already exist.

### 4.2 Reuse, do not rewrite

| Need | Use |
| --- | --- |
| Period + previous period | `app.services.dashboard.resolve_period` (pure date maths, no retail dependency) |
| KPI `{value, previous_value, delta_pct}` | the same helper retail's dashboard service uses — move it to a shared place rather than copying it |
| Order and voucher money totals | `app.services.wholesale.money.order_totals` / `voucher_totals` |
| Order status | `app.services.wholesale.orders.order_status` |
| Delivered pairs per order | `app.services.wholesale.inventory.delivered_pairs_by_order` |
| Received against a voucher | `wholesale_supplier_vouchers.received_pairs_by_voucher_stock` |
| Freight by stage | `wholesale.receivings.cost_by_stage` |
| Shipment status / packages received | `wholesale.shipments.shipment_status`, `wholesale_receivings.final_received_by_shipment` |
| Whole-pipeline stock | `wholesale.stock_records.stock_records` |

### 4.3 Performance

A report touches every order, voucher, receiving and movement in range, so:

- Load each entity **once per request** with `selectinload` for its lines/payments, then do
  the arithmetic in memory. Two pulls per pillar at most: the selected window and the
  previous one.
- Do **not** follow `monitoring.py::_order_statuses`, which calls
  `delivered_color_pairs_by_order` once per order line — that is an N+1 against a remote
  Postgres and is the shape this project has already been bitten by.
- Filter by date **in SQL**, not by loading everything and filtering in Python.
- Aim for one round trip per entity per window; if a pillar needs more than ~8 queries,
  reshape it.

---

## 5. Front end

### 5.1 Files

```
frontend/renderer/src/components/features/wholesale/reports/
  RevenueTab.tsx
  CostTab.tsx
  InventoryTab.tsx
  CustomerTab.tsx
```

`ReportsPage.tsx` is rewritten as: header, `PeriodControls`, tab bar, Refresh, and
whichever tab is active. All of its current client-side aggregation is deleted — the
truncation and stale-stock bugs in §1 go with it.

### 5.2 Reuse the retail dashboard's components

Import from `@renderer/components/features/dashboard/shared`: `PeriodControls`,
`StatTile`, `DeltaBadge`, `TrendChart`, `TwoLineTrendChart`, `ChartViewToggle`,
`RefreshingHint`. They are generic and already carry the agreed look; a second set of
chart components for wholesale would drift.

Wholesale-specific chrome (`Panel`, `FigureCard`, `Reference`, `StatusPill`,
`ProductCell`) stays from `features/wholesale/ui`.

### 5.3 api.ts

```ts
export const WHOLESALE_REPORTS_URL = `${apiBaseUrl}/api/wholesale/reports`;
```
plus one wire type and converter per pillar, in the existing `…FromWire` style.

Query keys: `["wholesale", "reports", pillar, periodParams]` so changing the period
refetches that tab and nothing else, and switching back to a tab already loaded shows it
instantly.

### 5.4 Empty and error states

Every table gets its own empty line in plain words ("No goods went out to customers in
this period."). A failed tab shows the existing `EmptyState` with a Retry, not a blank
page — and the rest of the tabs keep working.

---

## 6. Tests

`backend/tests/test_wholesale_reports.py` (in-memory SQLite fixtures from `conftest.py` —
never the real database; `authed_client` for auth):

1. **Revenue is delivery-based**: an order placed inside the period but not delivered adds
   to Ordered value and nothing to Delivered revenue; delivering half of it next period
   moves half the money into that next period.
2. Delivered revenue prices each movement from its own order line, including two orders for
   the same stock code at different prices.
3. A cancelled order is excluded from every pillar.
4. Previous-period comparison: same window length immediately before; `delta_pct` is null
   (not infinity) when the previous value is zero.
5. Custom `date_from`/`date_to` overrides the preset; `date_from > date_to` is a 400;
   a range of any length is accepted.
6. **Cost**: buying price comes from the latest voucher line on or before the delivery
   date; a product with no voucher line is left out of the margin ranking, not costed at 0.
7. Freight is reported as its own total and never appears inside gross margin.
8. Write-offs in the period are listed and valued.
9. **Inventory** totals equal the sum of `stock_records` rows (guards against a second,
   divergent stock calculation); received/delivered follow the period while on-hand does not.
10. **Customer**: new vs returning classification, receivables, and that customer names are
    matched case-insensitively after trimming.
11. Branch scoping: a wholesale user sees only their branch; admin sees all branches.
12. No pillar truncates at 100 rows — seed 120 orders and check the totals.

Run: `uv run --directory backend pytest -q tests/test_wholesale_reports.py`
(always `--directory backend`, never `--project`, or the wrong `.env` loads).

Front end: `npm run typecheck`, `npm run lint`, then check by hand with `npm run dev:all`
against `uv run --directory backend python scripts/seed_wholesale_demo.py --branch "Wholesale"`.

---

## 7. Order of work

1. Backend `reports.py` + router + schemas, Revenue only, with its tests. Revenue first for
   the same reason retail did it first: no estimates, no caveats, and it sets the shape.
2. `ReportsPage.tsx` rewritten to the new frame with the Revenue tab live; the other three
   tabs render "coming next" rather than the old client-side code.
3. Cost & Supplier (the estimated-buying-price helper lands here).
4. Customer.
5. Inventory last — it depends on `stock_records.py` from the other plan being merged.
6. `docs/wholesale_reports.md` and the CLAUDE.md pointer.

## 8. Deliberately not in this plan

- CSV / Excel export and printing. Worth doing, but it is its own piece of work once the
  figures are settled.
- Profit after freight per product — impossible without splitting shared costs, which this
  business does not do.
- Cross-branch comparison. Wholesale is one branch today; adding a comparison view now
  would be designing against nothing.
