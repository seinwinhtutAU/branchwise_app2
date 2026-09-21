# Wholesale reports

**Currently hidden from the nav**, the same as [Monitoring](./monitoring.md) — see that doc's
"Currently hidden" section; the route (`section === "reports"`) still works, it's just not in
the sidebar yet.

The wholesale Reports page is organized around four server-aggregated pillars:
Revenue, Cost & Supplier, Inventory, and Customer. The endpoints are:

- `GET /api/wholesale/reports/revenue`
- `GET /api/wholesale/reports/cost`
- `GET /api/wholesale/reports/inventory`
- `GET /api/wholesale/reports/customer`

They accept `period=today|yesterday|7d|30d` (default `30d`) or a custom `date_from` and
`date_to` pair. Custom ranges have no maximum length. Period KPIs compare with the
immediately preceding window of the same length; a zero previous value produces a null
percentage change.

All report queries are scoped by the signed-in user's `branch_id`. An admin with no
branch sees wholesale rows across branches. The report endpoints do not use paginated
list endpoints, so totals do not stop at the first 100 rows.

Dates mean different things in different pillars: orders use `order_date`; deliveries use
`delivered_on`; payments use `paid_on`; purchases use `voucher_date`; and arrivals and
freight use `received_on`. Revenue is recognized on delivery, ordered value is separate,
and cancelled orders contribute nothing.

Inventory is a point-in-time snapshot from `stock_records()`; only its received and
delivered movement figures follow the selected period. Cost of goods delivered uses the
estimated quantity-weighted buying price on the latest supplier-voucher date on or before
each delivery. Freight is kept separate and is never split across products, so gross
margin is before freight.

## Frontend

`frontend/renderer/src/components/features/wholesale/reports/`: `ReportsPage.tsx` is the
four-tab shell, reusing `PeriodControls`/`usePeriodRange` from the shared `dashboard/` folder —
the same one the retail Dashboard uses (see `CLAUDE.md`'s note on `dashboard/` not being
retail-only). `RevenueTab.tsx`/`CostTab.tsx`/`InventoryTab.tsx`/`CustomerTab.tsx` each render
one pillar's KPIs/trend/tables; `reportsApi.ts` holds the four fetch wrappers; `shared.tsx`
holds pieces shared across the tabs.
