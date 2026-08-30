# Retail dashboard

**Status: all four tabs implemented.** Revenue shipped first — deliberately, since it's the pillar with no new fields and no caveats — to establish the shared pattern (period control, KPI tiles with vs-previous-period deltas, a data-quality tile) that Cost, Inventory, and Customer then reused. What exists: `GET /api/dashboard/{revenue,cost,inventory,customer}` (`app/routers/dashboard.py`, `app/services/dashboard.py`) and a tabbed `frontend/renderer/src/components/features/DashboardPage.tsx` (with per-tab components under `dashboard/`), wired into the retail nav as "Dashboard." A layout sketch (HTML mock, not real data) was published as a Claude Artifact during the original design conversation; ask in a new session if the link is needed, since artifact URLs aren't durable enough to paste into a doc that outlives one conversation.

## Revenue — implemented

- **Endpoint**: `GET /api/dashboard/revenue?period=today|yesterday|7d|30d&branch_id=...` — `branch_id` is required for an admin account (no fixed branch) and ignored for a branch-scoped one (same `resolve_branch_id` rule every other scoped endpoint uses), and is rejected with a 400 if it doesn't resolve to a *retail* branch (`list_retail_branches`), since Wholesale never has anything for this dashboard to show.
- **Response**: branch identity + resolved date range, three KPIs (`net_revenue`, `transaction_count`, `avg_basket`) each as `{value, previous_value, delta_pct}` compared against the immediately-preceding period of the same length, a zero-filled daily `trend`, a weekday × 3-hour-band `heatmap` (parses `sales.sale_time` best-effort — a row whose time doesn't match a handful of common formats is simply left out of the heatmap, not an error), a `top_products` ranking, and `sale_warnings` (the exact same `sale_numeric_warnings` check the Warning page runs, scoped to the dashboard's selected branch and period start).
- **Frontend**: period + (admin-only) branch selectors, three stat tiles with a success/error delta badge, a hand-rolled SVG bar trend chart and weekday/hour heatmap (no charting library added — kept consistent with this project's existing inline-SVG icon approach; both single-hue, sequential-by-value, brand-token-derived per the dataviz method, not a hand-picked palette), a top-products table, and a compact Sale-warnings list.

## Cost — implemented

- **Endpoint**: `GET /api/dashboard/cost?period=...&branch_id=...` — same branch/period resolution as Revenue.
- **Response**: `estimated_cogs`, `estimated_gross_margin_pct`, `estimated_margin_per_basket` (each a `{value, previous_value, delta_pct}` KPI), a `products` list (same top products as Revenue, each with `estimated_cost`/`estimated_margin`/`margin_pct` — `null`, not `0`, when a product has no priced sale lines in the period), and `purchase_warnings` (the `purchase_numeric` check, scoped to the period).
- **Cost lookup**: `app/services/dashboard.py`'s `_cost_totals_and_products` reuses `point_in_time_buying_price` exactly as `GET /api/sales` and the Warning page do — one pass over the period's sale lines produces both the branch-wide COGS total and the per-product breakdown together, rather than a second differently-computed figure.
- **Frontend**: a persistent "every number here is an estimate" callout banner (per the design note below), the three KPI tiles, a cost/margin-by-product table, and the Purchase data-quality tile.
- **Known gap vs. the original design note below**: a duplicated (non-reverted) purchase batch is *not* specially detected or flagged yet — `purchase_numeric_warnings` still catches bad values on individual lines, but nothing yet flags "this looks like the same purchase file imported twice." Left as a follow-up.

## Inventory — implemented

- **Endpoint**: `GET /api/dashboard/inventory?branch_id=...` — no `period` param, since current stock is a point-in-time fact, not a date-range query.
- **Response**: `as_of` (the latest stock snapshot timestamp for the branch, or `null`), `sku_count`, `critical_count`/`low_count`/`watch_count`, `estimated_stock_value`, `median_days_of_stock`, `stock_value_by_category`, `low_stock_items`, and `warnings` (the combined `inventory_numeric`/`missing_product`/`reconciliation_uom`/`reconciliation_mismatch` rows, using the business-wide check-window settings since there's no period control here to derive a window from).
- **Days-of-stock**: sales velocity is a fixed trailing 30-day average (`STOCK_VELOCITY_WINDOW_DAYS`), independent of anything selected elsewhere in the dashboard. Status thresholds (`CRITICAL_DAYS_OF_STOCK`/`LOW_DAYS_OF_STOCK`/`WATCH_DAYS_OF_STOCK` = 3/7/14 days) are a reasonable default, not a business-configured setting — a product with zero recent sales gets no computable days-left and simply doesn't appear in the low-stock table (not flagged as either healthy or at-risk).
- **Frontend**: four stat tiles (no delta badges — there's no "previous period" here), a category value bar-list, a low-stock table with a Critical/Low/Watch badge, and the combined Inventory data-quality tile.

## Customer — implemented

- **Endpoint**: `GET /api/dashboard/customer?period=...&branch_id=...` — same branch/period resolution as Revenue.
- **Response**: `avg_items_per_basket`/`single_item_basket_share_pct` as KPIs (line-item count per transaction, not qty sum — kept consistent with the histogram below), `busiest_hour` (a plain fact, not a KPI — a bucket has no "up/down vs last period" to compare), `footfall_heatmap` (transaction count, not revenue), `basket_value_trend`, `items_per_basket_histogram` (buckets 1–5, 6 meaning "6+"), and `sale_warnings` (same `sale_numeric` rows as Revenue).
- **Frontend**: three stat tiles (busiest-hour tile has no delta), a basket-value trend chart, a footfall heatmap (reusing the same `WeekdayHourHeatmap` component as Revenue, parameterized by `getValue`), a histogram bar-list, and the Sale data-quality tile.

## Frontend structure

`frontend/renderer/src/components/features/dashboard/` holds `shared.tsx` (types, formatters, `StatTile`/`DeltaBadge`, the generic `DailyBarChart` and `WeekdayHourHeatmap` chart primitives, `WarningsTile`) plus one file per tab (`RevenueTab.tsx`, `CostTab.tsx`, `InventoryTab.tsx`, `CustomerTab.tsx`) — each owns its own fetch/loading/error state so switching tabs doesn't require the parent to track four loading states at once. `DashboardPage.tsx` is just the tab bar plus the shared branch/period controls (period is hidden for the Inventory tab) and renders whichever tab is active.

## Tests

`backend/tests/test_dashboard.py` covers: period math, branch resolution (retail-only, admin-requires-branch_id) for Revenue (shared by all four via the same `_resolve_retail_branch` helper), Revenue's KPI/delta values, trend zero-fill, top-products ordering, heatmap bucketing, and warning-tile branch scoping; Cost's point-in-time cost/margin math and null-cost-when-unpriced case; Inventory's stock value, category rollup, and low-stock status/velocity math; and Customer's basket-stats/histogram math.

## Design notes (for context — all four pillars above are now implemented against these)

## Scope: one branch at a time

This is not a cross-branch rollup. A retail user sees only their own branch (`users.branch_id`, the same scoping rule `imports.py`/`data_quality.py` already use); admin has no branch and gets a branch selector, but still views one branch at a time — an all-branch aggregate view was considered and deliberately deferred as a separate, later feature. The Wholesale branch never appears here since it never has POS-imported data (see the `wholesale-branch-has-no-pos-data` note in project memory).

## Four pillars

The dashboard is organized as four tabs: **Revenue**, **Cost**, **Inventory**, **Customer**. The Customer tab is *not* customer-level tracking — the retail sales pipeline has no customer identifier anywhere. `Sale` (`app/models/sale.py`) carries only `slip_id`/`slip_number`/`sale_date`/`sale_time`/`location_raw` — a POS slip is structurally anonymous. The only `Customer*` models in the codebase (`app/models/wholesale.py`'s `CustomerOrder`/`CustomerOrderLine`) belong to the wholesale workflow, which is a deliberately separate business line (see CLAUDE.md) and out of scope here. If real customer-level tracking (repeat visits, loyalty) is ever wanted, that's a POS/data-capture decision upstream of this dashboard (a loyalty card, phone number, or membership ID captured at the point of sale) — not something this tab fakes from existing tables. Instead, the Customer tab reframes the same anonymous slip data Revenue already uses as **basket/visit behavior** — a proxy for "customers," not an identity.

Each pillar's original design notes (period control choice, which existing plumbing to reuse, caveats to surface) now live in its "— implemented" section near the top of this doc, alongside what was actually built and any place the implementation diverged from or narrowed the original note (e.g. Cost's duplicated-purchase-batch detection, still a follow-up).

## Aggregation endpoint decision (resolved)

Settled while building Revenue, and followed for the other three: **one endpoint per pillar** (`GET /api/dashboard/{revenue,cost,inventory,customer}`), each parameterized by `branch_id`+`period` and returning that whole tab's pre-aggregated payload in one response, rather than one endpoint per individual widget or a single endpoint switched by a `pillar` param. Reasoning: the four pillars don't share a single query shape (Inventory doesn't even have a period control), a per-pillar endpoint keeps each one's aggregation logic (and tests) independently readable, and a whole-tab payload means the frontend fires one request per tab switch instead of 4-6 parallel ones. `app/services/dashboard.py` holds the aggregation helpers; add each new pillar's functions there rather than starting a second service module, so date-range/period logic (`resolve_period`) stays shared.
