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

## Currently hidden

`HIDDEN_WHOLESALE_NAV_IDS` in `frontend/renderer/src/App.tsx` is `{"monitoring", "reports"}` —
both routes remain fully reachable in code (`WHOLESALE_NAV_ITEMS` still lists `monitoring`,
labelled "Dashboard," first in the array, and `reports` near the end, before Master Data), but
that set filters both out of the rendered sidebar for the wholesale workspace specifically. The
comment there: *"Keep the wholesale Dashboard and Reports routes available, but hide their tabs
from the left navigation until those screens are ready to be part of the daily workflow."*

## Frontend

- **`MonitoringDashboardPage.tsx`** — renders the six sections above as cards/lists (shipments
  in transit, pending orders, unpaid vouchers/orders, zero-stock products, and a recent-
  activity feed with relative timestamps).
- **`monitoringApi.ts`** — the fetch wrapper and wire types.
