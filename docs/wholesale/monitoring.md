# Monitoring — the wholesale Dashboard

The wholesale Dashboard has five tabs: **Summary**, **Revenue**, **Cost**, **Customer** and
**Inventory** (the analytical tabs, see "Revenue, Customer and Inventory tabs" further down).
There is no separate Reports page or live "Operations" board any more; both were removed and
their figures live on these tabs.

## Summary endpoint

**`GET /api/wholesale/monitoring/summary`** (`app/wholesale/services/monitoring.py`,
`routers/monitoring.py`) feeds the Summary tab only. The earlier `GET /api/wholesale/monitoring`
snapshot (shipments in transit, pending orders, unpaid vouchers/orders, zero-stock products,
recent activity) was deleted along with the Operations tab.

## Revenue, Customer and Inventory tabs

Served by `GET /api/wholesale/dashboard/{revenue,cost,customer,inventory}`
(`app/wholesale/services/dashboard.py`, `routers/dashboard.py`, `schemas/dashboard.py`; frontend
in `monitoring/Wholesale{Revenue,Cost,Customer,Inventory}Dashboard.tsx`). Summary, Revenue, Cost and Customer share one period control, the same one the retail Dashboard uses (Daily, Weekly, Monthly or a custom From/To range, sent as `period`, `month` or `date_from`/`date_to`) and compare with the immediately preceding window of
the same length; Inventory is a point in time and has no period. All of them are scoped by the
signed-in user's branch, use the unpaged source rows (so nothing stops at a page limit), and
exclude cancelled orders. Dates: orders use `order_date`, deliveries `delivered_on`, payments
`paid_on`.

- **Revenue** — delivered revenue is recognised on delivery, not on order. *Money collected* is
  payments against orders in the window. *Outstanding receivables* is what customers owed on
  unfinished orders **as of the end date** (payments after it do not reduce it). *Potential stock
  sales value* is each product's on-hand pairs at the price it was last quoted to a customer, and
  *inventory cost value* the same pairs at the estimated buying price (the quantity-weighted price
  on the latest supplier-voucher date on or before today); a product with no known price on a side
  adds nothing to that side. *Potential gross profit* is the difference. *Revenue by factory*
  attributes each delivery to the factory that supplied most of that product on the latest voucher
  date before the delivery (the same voucher the cost estimate reads); a delivery with no earlier
  voucher counts under "Unknown factory". The trend is daily, folded into weeks in the browser once
  the window is longer than 14 days.
- **Cost** — *goods purchased* is the value of supplier vouchers dated in the window;
  *cost* is everything spent getting goods in (`wholesale_receiving_costs`) on receivings that
  arrived in the window, kept as one figure for the batch and never split across products;
  *total cost* is the two added, with the split shown as a bar. The screen calls it "cost", not
  freight or landed cost. *Supplier balance due* is what is still unpaid on vouchers at the end
  of the window (payments after it do not count yet); "Supplier payables" lists the newest ten
  unpaid vouchers, each opening the voucher. *Cost by factory* ranks purchases by supplier.
- **Customer** — *active* customers ordered in the window; *new* ones had no order before it;
  *repeat* ones did (share of active shown). *Open orders* is every non-cancelled order not yet
  fulfilled, whenever it was placed. The ranking is by ordered (not delivered) value. The delivery
  status donut counts the window's orders as fulfilled / partly delivered / awaiting delivery (ready
  to deliver and waiting for stock both count as awaiting). "Orders awaiting delivery" lists the
  newest ten open orders with the pairs still to deliver, shown in sets.
- **Inventory** — from `stock_records`: products managed, physical stock, available (physical less
  committed), committed (allocated to orders), incoming (at supplier + in transit) and customer
  backlog (pairs still owed), the pipeline flow, physical stock by location, and available /
  committed / incoming by product group. Quantities are shown in sets (1 set = 6 pairs).

Numbers are shown without a currency prefix ("103.8M"); each tab's footer says values are in MMK. The Summary's revenue and factory bars are the Revenue tab's own figures for the chosen period (`GET /api/wholesale/monitoring/summary` accepts the same `period`/`month`/`date_from`/`date_to`). Inventory is a point in time, so it has no period. Location is not a filter on these three tabs: revenue and customers have no per-location figures,
and Inventory always shows every location. Only the Summary keeps a location selector.

## Export all wholesale data

The Dashboard header has **Export to Excel** and **CSV files** buttons
(`monitoring/ExportDataButtons.tsx`), which call `GET /api/wholesale/export?format=xlsx|csv`
(`backend/app/wholesale/routers/export.py`, tables defined in `services/export.py`).

- One workbook (or a zip of CSVs) with a "Read Me" sheet plus one flat table per topic:
  Vouchers, Voucher Lines, Supplier Payments, Shipments, Shipment Legs, Receivings,
  Receiving Items, Receiving Costs, Orders, Order Lines, Customer Payments, Stock Movements,
  Stock Now, Stock By Gate, Colour Detail (one row per colour), Customer Balances,
  Write-offs and the master lists.
- The router calls the same list endpoints the screens use (unpaged), so every status,
  total and balance matches the screens. Only two things are computed in the export: a
  line's amount (quantity × price in the unit it was quoted in) and the per-colour split.
- Money totals appear only on the header tables (Vouchers, Orders), never repeated per
  line, so summing a column cannot double-count. Quantities are in pairs with sets shown
  beside them; money is Ks.
- Wholesale-only (`require_wholesale`); an account tied to a branch exports that branch.

## Frontend

- **`MonitoringDashboardPage.tsx`** — renders the six sections above as cards/lists (shipments
  in transit, pending orders, unpaid vouchers/orders, zero-stock products, and a recent-
  activity feed with relative timestamps).
- **`monitoringApi.ts`** — the fetch wrapper and wire types.
