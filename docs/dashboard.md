# Retail dashboard

**Status: design only.** Nothing described here is implemented yet — no router, no service, no frontend page. This doc records the design decided in conversation with Claude Code so the next person (or the next session) can pick it up without re-deriving it. A layout sketch (HTML mock, not real data) was published as a Claude Artifact during that conversation; ask in a new session if the link is needed, since artifact URLs aren't durable enough to paste into a doc that outlives one conversation.

## Scope: one branch at a time

This is not a cross-branch rollup. A retail user sees only their own branch (`users.branch_id`, the same scoping rule `imports.py`/`data_quality.py` already use); admin has no branch and gets a branch selector, but still views one branch at a time — an all-branch aggregate view was considered and deliberately deferred as a separate, later feature. The Wholesale branch never appears here since it never has POS-imported data (see the `wholesale-branch-has-no-pos-data` note in project memory).

## Three pillars, not four

The dashboard is organized as three tabs: **Revenue**, **Cost**, **Inventory**. A fourth pillar, **Customer**, was proposed and rejected: the retail sales pipeline has no customer identifier anywhere. `Sale` (`app/models/sale.py`) carries only `slip_id`/`slip_number`/`sale_date`/`sale_time`/`location_raw` — a POS slip is structurally anonymous. The only `Customer*` models in the codebase (`app/models/wholesale.py`'s `CustomerOrder`/`CustomerOrderLine`) belong to the wholesale workflow, which is a deliberately separate business line (see CLAUDE.md) and out of scope here. If real customer-level tracking (repeat visits, loyalty) is ever wanted, that's a POS/data-capture decision upstream of this dashboard, not something to fake from existing tables.

### Revenue

Fully supported by existing data — no new fields needed.

- **KPIs** (period-scoped: Today / 7D / 30D, each with a vs-previous-period delta): net revenue, transaction count, average basket (revenue ÷ transactions), discount rate.
- **Sales trend** — daily net revenue over the selected window.
- **Sales by day & hour** — a weekday × time-band heatmap of revenue concentration, using `sales.sale_time`; intended for staffing decisions.
- **Top products** — ranked by revenue, from `sale_lines` joined to `products`.
- **Data source**: `sales`/`sale_lines`, same branch/date-range shape `GET /api/sales` (`app/routers/sales.py`) already filters on — that endpoint returns row-level data bounded to a 90-day window by default, so the dashboard's aggregates (daily totals, top-N products, the heatmap buckets) should be computed server-side rather than summed client-side from a raw row dump.
- **Data quality tile**: a filtered view of `GET /api/warnings`' `Sale` category only (`sale_numeric` in `app/services/data_quality.py`), not the full Warning list.

### Cost

Supportable, but every number here is an estimate layered on top of what was actually imported, and the UI should say so plainly (a callout banner, not just a footnote) rather than presenting these as accounting figures.

- **KPIs**: purchase spend, estimated cost of goods sold, estimated gross margin %, estimated margin per basket.
- **Purchase spend trend** — deliberately **not** a smooth daily line like Revenue's. `Purchase` import is a per-batch upload, not a daily POS export, so most days genuinely have zero recorded spend and a handful have a large batch total. The chart should render as sparse bars/spikes so it doesn't visually imply a granularity the data doesn't have.
- **Cost & margin by product** — same top-N products as the Revenue tab, viewed through a cost lens (estimated unit cost, estimated unit margin, margin %).
- **Existing plumbing to reuse, not rebuild**: `app/services/pricing.py`'s `point_in_time_buying_price` already computes exactly this "cost of a product as of a given date" lookup, and `GET /api/sales`, `GET /api/data-overview`, and the Warning page's sale-numeric check all already call it to derive a `Profit`/`Profit_Margin_Pct` column. It prices each sale line using whichever purchase price was on record as of that sale's own date (not "the latest price," which would silently re-price old sales every time a new purchase comes in) — falling back to a stock-snapshot price as of that date, and then, bounded to an admin-configurable window (default 30 days, via `GET`/`PUT /api/settings`), a stock snapshot recorded shortly *after* the sale, since inventory recounts are physical work on their own cadence and often lag the sale they'd price. It returns `(price, source)`, and all three callers already expose `source` as `Buying_Price_Source`/`_BuyingPriceSource` (`"purchase"`, `"stock"`, or `"stock_forward_fill"`). The dashboard's Cost pillar should call this same function and read that field rather than reimplementing the cost lookup.
- **Caveats the UI must surface, not hide** (see `docs/known-limitations.md`):
  - `Buying_Price_Source` is now rendered, not just returned: the Sale and Data Overview tables show it as a column, labeled via `frontend/renderer/src/lib/buyingPriceSource.ts`'s `formatBuyingPriceSource` ("Purchase" / "Stock count" / "Later recount (est.)"), with a per-device Settings toggle ("Buying Price Source column") to show or hide it — the dashboard's Cost pillar should reuse that same helper rather than inventing its own labels. What's still missing everywhere, including there: the column is plain text today, with no visual distinction for the `"stock_forward_fill"` case specifically (e.g. a muted/asterisked treatment) — a recount-based estimate reads identically to an exact-date match unless you read the label. The Warning page's sale-numeric detail also still shows the raw value (`purchase`/`stock`/`stock_forward_fill`) with no label translation and no hide toggle.
  - `purchases.purchase_date` is the import date, not a real purchase-order date, so "purchase spend by day" is really "purchase spend by import."
  - Purchase import isn't idempotent — a re-uploaded purchase file creates a second batch and double-counts spend. Any Cost aggregate should exclude reverted `ImportBatch` rows and ideally flag branches/periods with a suspiciously repeated batch. This also undermines the point-in-time cost lookup above: a duplicated purchase batch means the "price on record as of that date" might itself be wrong.
- **Data quality tile**: `GET /api/warnings`' `Purchase` category only (`purchase_numeric`).

### Inventory

Mostly supported by existing data; the "current stock" half of this is less new than it might look.

- **Snapshot framing, not a period toggle**: current stock is a point-in-time fact, so this tab replaces the Today/7D/30D control with a static "as of latest snapshot" label instead of pretending a date range applies.
- **KPIs**: SKUs tracked, low/critical stock count, estimated stock value (on-hand qty × latest known buying price), a stock-runway estimate (e.g. median days-of-stock).
- **Stock value by category** — using `products.group_name`, which should be spot-checked for how consistently it's populated in real imports before committing to this as a headline widget.
- **Low stock table** — product, on-hand qty, estimated days left, status (Critical/Low/Watch).
- **Data source**: `GET /api/inventory` (`app/routers/inventory.py`) already computes "current stock" — the latest `stock_levels` snapshot per product+branch, branch-scoped the same way as everywhere else. `docs/known-limitations.md` and `docs/database-schema.md`'s "Not yet built" section have both been corrected to reflect this. Cost-per-unit for the stock-value KPI can reuse `point_in_time_buying_price` from the Cost pillar above rather than adding a second cost lookup.
- **Days-of-stock is genuinely new**: no existing service computes a runway estimate. It would need sales velocity (recent `sale_lines` qty for the product/branch) divided into on-hand qty, and — per `docs/known-limitations.md` — inherits the UOM-mixing caveat (`sale_lines`/`purchase_lines` UOM is free text with no conversion table) the same way the reconciliation check does, so it should reuse whatever guard that check already applies rather than re-deriving it. In this business's data specifically, UOM is reportedly always "Each," so in practice the risk is closer to occasional human data-entry error than routine unit mismatches — worth a sanity check against real data rather than assuming it, since the field itself is still free text with nothing enforcing that.
- **Data quality tile**: `GET /api/warnings`' `Inventory` and `Daily check` categories (`missing_product`, `inventory_numeric`, `reconciliation_uom`, `reconciliation_mismatch`).

## Open question for whoever builds this

Every pillar above assumes new **aggregation** endpoints (daily totals, top-N, heatmap buckets, category rollups) rather than reusing `GET /api/sales`/`GET /api/purchases`/`GET /api/inventory` as-is, since those return row-level data meant for export/detail views, not pre-aggregated dashboard series. Whether that's one new `GET /api/dashboard`-style endpoint parameterized by branch+period+pillar, or one endpoint per widget, hasn't been decided yet.
