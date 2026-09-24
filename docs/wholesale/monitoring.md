# Monitoring

A live operational status board — distinct in purpose from [Reports](./reports.md)'s four
analytical pillars. Built, but currently hidden from the wholesale nav (see "Currently hidden"
below), the same as Reports.

## Endpoint

**`GET /api/wholesale/monitoring`** (`app/wholesale/services/monitoring.py`,
`routers/monitoring.py`) returns one `monitoring_snapshot` combining six read-only aggregates,
each `{count, rows}` except `recent_activity` (a flat list):

- **`shipments_in_transit`** — every non-completed shipment, each with `days_in_transit`.
- **`orders_pending`** — every non-cancelled, non-fulfilled order, each with `days_open`.
- **`unpaid_vouchers`** — supplier vouchers with `balance_due > 0`.
- **`unpaid_orders`** — customer orders with `balance_due > 0`.
- **`zero_stock_products`** — active products with `net_pairs_by_stock_code <= 0`, tagged
  `out_of_stock` (has receiving history) vs. `not_arrived` (never received at all).
- **`recent_activity`** — the 15 most recent receivings/deliveries/payments, merged from all
  three sources and sorted by `created_at desc`.

## Navigation

`HIDDEN_WHOLESALE_NAV_IDS` in `frontend/renderer/src/App.tsx` is now `{"reports"}`: the
Dashboard tab is shown in the wholesale sidebar (it carries the data export below), while
Reports stays hidden but reachable in code until it is ready for the daily workflow.

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
