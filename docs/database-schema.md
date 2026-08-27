# Database schema

All tables use `String(36)` UUID primary keys, generated client-side (`str(uuid.uuid4())`) rather than by the database — see [architecture.md](./architecture.md) for why that matters for import performance. Source of truth is `backend/app/models/`; this is a reference, not a substitute for reading them.

## `branches`

| column | type | notes |
|---|---|---|
| id | uuid | PK |
| name | string | |
| phone_number | string | |
| address | string | |

Has many `users`, `sales`, `purchases`, `stock_levels`, `import_batches`.

## `users`

Mirrors a Supabase Auth user — `id` is the *same* UUID as the corresponding Supabase Auth user id, not a separate identity. See [auth-and-accounts.md](./auth-and-accounts.md).

| column | type | notes |
|---|---|---|
| id | uuid | PK, same value as the Supabase Auth user id |
| name | string | |
| email | string | unique |
| role | enum | `admin` \| `wholesale` \| `retail` |
| branch_id | uuid, nullable | FK → branches. Null for admin |

## `products`

Shared across sales, purchases, and inventory — deduplicated by `stock_code`, the natural business key from the POS.

| column | type | notes |
|---|---|---|
| id | uuid | PK |
| stock_code | string | unique — business key |
| description | string | last-write-wins across imports |
| group_name | string, nullable | only ever set from inventory imports ("Lady"/"Men"/"Baby"/...); sales/purchase imports never clear it |
| created_at / updated_at | datetime | |

## `sales` + `sale_lines`

One `Sale` per POS "slip" (receipt), with one or more `SaleLine`s. Sourced from `pos_import.py`.

**sales**

| column | type | notes |
|---|---|---|
| id | uuid | PK |
| branch_id | uuid, nullable | FK → branches, resolved at import time from the uploader's own branch |
| import_batch_id | uuid, nullable | FK → import_batches — which upload created this row (see below) |
| location_raw | string, nullable | the raw `Location` text from the source file, kept for audit even though branch_id is what's actually used |
| slip_id | string | **unique** — synthetic id (`{date}-{slip_number}`, e.g. `20260821-002`); this is what makes sales import idempotent |
| slip_number | string | raw slip number from the POS (resets/repeats across dates, hence the synthetic slip_id) |
| sale_date | date | |
| sale_time | string, nullable | |
| source_file | string, nullable | uploaded filename |
| created_at | datetime | |

**sale_lines** (indexed on `sale_id`)

| column | type | notes |
|---|---|---|
| id | uuid | PK |
| sale_id | uuid | FK → sales |
| line_id | string | **unique** — synthetic (`{slip_id}-{line_no}`) |
| line_no | int | 1-based, per slip |
| product_id | uuid | FK → products |
| selling_price, qty, discount_amount, amount, net_amount | numeric(14,2) / numeric(12,2) | |
| uom | string, nullable | |

## `purchases` + `purchase_lines`

One `Purchase` batch per **confirmed import** (not per real purchase order — the source `purchase.csv` has no batch/date info yet). Sourced from `purchase_import.py`.

**purchases**

| column | type | notes |
|---|---|---|
| id | uuid | PK |
| branch_id | uuid, nullable | FK → branches |
| import_batch_id | uuid, nullable | FK → import_batches |
| location_raw | string, nullable | |
| purchase_date | date | defaults to the import date, but confirm accepts an optional `purchase_date` form field to override it — see [known-limitations.md](./known-limitations.md) |
| source_file | string, nullable | |
| created_at | datetime | |

**purchase_lines** (indexed on `purchase_id`)

| column | type | notes |
|---|---|---|
| id | uuid | PK |
| purchase_id | uuid | FK → purchases |
| product_id | uuid | FK → products |
| quantity | numeric(12,2) | |
| uom | string, nullable | |
| buying_price | numeric(14,2) | the cost paid *in this purchase* — this is the source of truth for "current cost," not `stock_levels.buying_price` (see below) |

## `stock_levels`

Append-only snapshots — every confirmed inventory import adds new rows, it never overwrites. "Current stock" for a product+branch is the row with the latest `snapshot_at`. Indexed on `(product_id, branch_id, snapshot_at)` for that lookup — `GET /api/inventory` (`app/routers/inventory.py`) uses exactly this to return only the latest row per product+branch, not full history (see [data-import.md](./data-import.md)). Sourced from `inventory_import.py`.

| column | type | notes |
|---|---|---|
| id | uuid | PK |
| branch_id | uuid, nullable | FK → branches |
| import_batch_id | uuid, nullable | FK → import_batches |
| location_raw | string, nullable | |
| product_id | uuid | FK → products |
| on_hand_qty | numeric(12,2) | |
| buying_price | numeric(14,2) | the POS's own calculated cost *as of this snapshot* — can be stale a few weeks into the month once new purchases land at different prices; prefer the most recent `purchase_lines.buying_price` for "current cost" |
| selling_price | numeric(14,2) | |
| snapshot_at | datetime | when this snapshot was imported |
| source_file | string, nullable | |

## Wholesale: `customer_orders` + `customer_order_lines`, `factory_vouchers` + `factory_voucher_lines`

A separate data model for the wholesale-only workflow (`app/models/wholesale.py`) — entered inline in the UI, not imported from a file, and unrelated to `products`/`sales`/`purchases`/`stock_levels` above. Line items reference products by a free-text `product_code` in their own namespace, not a FK into `products`.

**customer_orders** — one header per customer order occasion.

| column | type | notes |
|---|---|---|
| id | uuid | PK |
| order_no | int | |
| branch_id | uuid, nullable | FK → branches |
| order_date | date | |
| customer_name | string | |
| remark | string, nullable | |
| created_at / updated_at | datetime | |

**customer_order_lines** (indexed on `order_id`) — one product within a customer order.

| column | type | notes |
|---|---|---|
| id | uuid | PK |
| order_id | uuid | FK → customer_orders, `ondelete=CASCADE` |
| product_code | string | free text, not a FK into `products` |
| description | string, nullable | |
| factory_name | string, nullable | |
| first_commit_qty / second_commit_qty | numeric(12,2), nullable | customer's initial request vs. internally-approved qty — informational only, neither drives `total_qty` |
| colors | JSON | `list[{"color": str, "qty": number}]` |
| total_qty | numeric(12,2) | recomputed server-side from `colors` on every write, never trusted from the client |
| received_qty | numeric(12,2) | |
| unit | string | default `"Set"` |
| buying_price | numeric(14,2), nullable | set once a matching `FactoryVoucherLine` prices this line |
| status | enum | `not_start` \| `waiting` \| `complete` |
| matched_voucher_id | uuid, nullable | FK → factory_voucher_lines, `ondelete=SET NULL` — which voucher line last priced this row |
| created_at / updated_at | datetime | |

**factory_vouchers** — one header per factory voucher.

| column | type | notes |
|---|---|---|
| id | uuid | PK |
| voucher_no | int | |
| branch_id | uuid, nullable | FK → branches |
| voucher_date | date | |
| factory_name | string, nullable | |
| remark | string, nullable | |
| created_at | datetime | |

**factory_voucher_lines** (indexed on `voucher_id`) — one product within a voucher.

| column | type | notes |
|---|---|---|
| id | uuid | PK |
| voucher_id | uuid | FK → factory_vouchers, `ondelete=CASCADE` |
| product_code | string | free text, matched against `customer_order_lines.product_code` within the same branch |
| qty | numeric(12,2) | |
| buying_price | numeric(14,2) | auto-prices every open (`not_start`) matching `CustomerOrderLine` and flips it to `waiting`; a `complete` line is never repriced |
| colors | JSON | `list[{"color": str, "qty": number}]` |
| discount_per_set | numeric(14,2), nullable | |
| created_at | datetime | |

## `import_batches`

One row per confirmed upload (regardless of type) — what makes import history and revert possible. See [data-import.md](./data-import.md#import-history--revert) for the full behavior.

| column | type | notes |
|---|---|---|
| id | uuid | PK |
| import_type | enum | `sales` \| `inventory` \| `purchase` |
| branch_id | uuid, nullable | FK → branches |
| uploaded_by | uuid, nullable | FK → users |
| filename | string, nullable | |
| status | enum | `completed` \| `reverted` |
| summary | JSON | the same counts dict the confirm endpoint returns (`sales_created`, etc.) |
| preview_data | JSON | snapshot of the origin/clean grids shown at confirm time (same shape as the preview endpoints' response) — backs the import history detail view, since the persisted `Sale`/`PurchaseLine`/`StockLevel` rows don't preserve the original file layout or row-level validation notes |
| created_at | datetime | |
| reverted_at | datetime, nullable | |
| reverted_by | uuid, nullable | FK → users |

Reverting deletes the batch's `Sale`/`Purchase`/`StockLevel` rows (and their lines) but **keeps this row**, marked `reverted` — an audit trail, not a silent erase. `Product` rows are never touched by a revert, since they're shared across batches.

## Relationship map

```
Branch ──< User
Branch ──< Sale ──< SaleLine >── Product
Branch ──< Purchase ──< PurchaseLine >── Product
Branch ──< StockLevel >── Product
Branch ──< ImportBatch >── Sale / Purchase / StockLevel   (one batch, many rows of one type)

Branch ──< CustomerOrder ──< CustomerOrderLine
Branch ──< FactoryVoucher ──< FactoryVoucherLine
CustomerOrderLine >── FactoryVoucherLine   (matched_voucher_id, by branch_id + product_code — not a schema-level FK match)
```

## Not yet built

"Current stock" is available (`GET /api/inventory` — latest `stock_levels` snapshot per product+branch), but it's only as fresh as the last inventory import; it does *not* net out purchases/sales that happened since that snapshot as a live query. `app/services/data_quality.py` (`GET /api/warnings`) does compute exactly that movement math — `previous snapshot + purchases − sales` since then — but only to flag a *mismatch* against the latest snapshot, not to expose it as a general-purpose "current stock" figure elsewhere in the app. "Current cost" (latest purchase price) is similarly not exposed as its own query, though `latest_purchase_buying_prices`/`latest_stock_level_buying_prices` (`app/services/pricing.py`) compute the per-product version of it for the Sale/Data Overview profit columns. See [known-limitations.md](./known-limitations.md).
