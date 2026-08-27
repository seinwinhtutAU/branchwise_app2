# Data import pipeline

POS exports (`retail_data/{sale,inventory,purchase}.csv`) are printed-report formats, not clean tables. Cleaning them is a two-stage process — **parse** (pure, no DB) then **persist** (writes to the database) — exposed as a preview/confirm pair of endpoints so nothing is written until the user has seen what it looks like cleaned.

## Source formats

**`sale.csv`** — repeating blocks: a metadata line, a column-header line, a report-wide `Date` line, then per-slip blocks (`Slip Number`/`Time` header line, one or more line-item rows, a per-slip subtotal row), a grand-`Total` row, a page footer.

**`inventory.csv`** — a flat table: metadata line, one header row (some header cells are quoted multi-line strings), one row per stock item, a `Grand Total` row, a page footer.

**`purchase.csv`** — the simplest: just a header row and data rows, no metadata/footer, no comma-formatted numbers, no date.

Each parser (`app/services/{pos,inventory,purchase}_import.py`) classifies rows **structurally** rather than by fixed position — e.g. a sale line-item row is recognized by "does this row have a parseable price and quantity in the expected columns," not "is this the 5th line after a Slip Number line." This is deliberate: the same parser keeps working if a future export from the same POS software has slightly different row counts or optional fields.

## Target columns

| Source | Output columns |
|---|---|
| `sale.csv` | `Date, SlipID, SlipNumber, LineNo, LineID, StockCode, Description, Location, Selling_Price, Qty, UOM, Discount_Amount, Amount, Net_Amount, Time` |
| `inventory.csv` | `StockCode, Description, Location, Group, On_Hand_Qty, Buying_Price, Selling_Price` |
| `purchase.csv` | `StockCode, Description, Location, Quantity, UOM, Buying_Price` |

`SlipID`/`LineID` don't exist in the source — they're synthesized (`SlipID = {date}-{slip_number}`, e.g. `20260821-002`; `LineID = {SlipID}-{line_no}`) to be stable, human-readable, and unique across multiple days' files.

## The Zawgyi problem

Myanmar retail software historically used **Zawgyi**, a pre-2019, non-Unicode-compliant font encoding — it reuses the same Unicode Myanmar code points as standard Unicode but in a different order, so a font/renderer built for real Unicode Myanmar displays Zawgyi text with broken character ordering (and vice versa). Real POS data is a **mix** of both within the same file/column, because entries get added over years spanning the transition.

`import_common.py`'s `clean_text` handles this: it only converts a string through `pyidaungsu.cvt2uni` (Zawgyi → Unicode) when `is_zawgyi` actually detects Zawgyi encoding first. Blindly converting every Myanmar-containing string corrupts the ones that are already correct Unicode — this was a real bug caught partway through building this (see [known-limitations.md](./known-limitations.md) for what's still not handled).

`is_zawgyi` calls `pyidaungsu`'s underlying fasttext model directly (`pds.f.f.predict(...)`) instead of its public `detect()` function, because that public wrapper crashes under the numpy version this project uses (`np.array(x, copy=False)` — a numpy 2.x incompatibility in an old release of `fasttext`).

## Preview vs. confirm

- `POST /api/imports/{sales,inventory,purchase}` — parses the upload and returns both the raw grid (`origin`) and the cleaned rows (`clean`), for the user to review. Nothing is written to the database.
- `POST /api/imports/{sales,inventory,purchase}/confirm` — re-parses the same upload and persists it via the matching `*_persist.py` service.

The frontend (`FileImportCard.tsx`) keeps the selected file in memory between the two steps so confirming doesn't require re-picking it.

Purchase confirm additionally accepts an optional `purchase_date` form field (`YYYY-MM-DD`) to override the default of "the import date" — see `purchases.purchase_date` in [database-schema.md](./database-schema.md).

## Branch resolution on confirm

The source `Location` column (e.g. `"Aung Thit Sar"`) doesn't reliably match actual branch names (Wholesale/AungThitSar/Ashley/Retail 3) and isn't used to resolve the branch. Instead: the confirm endpoint uses the **uploading user's own `users.branch_id`**. An account with no branch (admin) must supply one explicitly via a `branch_id` form field; the server ignores any client-supplied `branch_id` for accounts that already have one (defense in depth — a retail account can't tag data to another branch even if the frontend were tampered with). The raw `Location` string is still stored (`location_raw`) on every row for audit/backfill purposes.

## Product upsert & performance

Every row references a `Product`, upserted by `stock_code` (see [database-schema.md](./database-schema.md)). This is batched (`import_common.get_or_create_products` — one `SELECT ... WHERE stock_code IN (...)` plus in-memory create/update) rather than looked up per row. This isn't a micro-optimization: a naive per-row version against the remote Supabase Postgres pooler took minutes and hit request timeouts on a 900-row inventory file; batched, the same file imports in ~5 seconds.

## Idempotency differs by type

- **Sales**: idempotent per slip. `sales.slip_id` is unique; re-confirming the same file skips slips already imported (reported in the response as `sales_skipped_duplicate`).
- **Purchases**: **not** idempotent. `purchase.csv` has no natural batch/date key, so every confirm creates a new `Purchase` batch — re-uploading the same file double-counts.
- **Inventory**: intentionally not deduplicated — every confirm adds a new snapshot batch by design (see `stock_levels` in [database-schema.md](./database-schema.md)).

## Import history & revert

Every confirmed import (any of the three types) creates one `ImportBatch` row (`app/models/import_batch.py`), and every `Sale`/`Purchase`/`StockLevel` it creates is linked to it via `import_batch_id`. This is what makes two things possible:

- **`GET /api/imports/history`** — lists past imports (type, filename, branch, uploader, status, summary, timestamps). No longer includes the summary breakdown inline — see the detail endpoint below. Non-admin accounts only see their own branch's history; an account with no branch (admin) sees all — same visibility rule as branch resolution on confirm.
- **`GET /api/imports/history/{batch_id}`** — the same metadata as one row of the list, plus `summary` and the `origin`/`clean` grids (same shape as the preview endpoints), read back from the batch's `preview_data` column. Backs the "click a history row to see what was imported" detail page in the frontend — same Cleaned/Original tabs and row highlighting as the review screen, just read-only (no branch picker, no Confirm/Cancel). Same visibility rule and 404 behavior as the list/revert endpoints.
- **`POST /api/imports/history/{batch_id}/revert`** — the fix for a wrong import. Deletes the batch's actual data rows (`SaleLine`s then `Sale`s / `PurchaseLine`s then `Purchase` / `StockLevel`s) but **keeps the `ImportBatch` row**, marked `status=reverted` with who/when — an audit trail, not a silent erase. `Product` rows are never touched (they're shared across batches). 404s if the batch doesn't exist or isn't visible to the caller; 409s if it's already reverted.

To actually fix a wrong import: revert it, then just use the normal "Confirm Import" flow again with the corrected file — no separate "reimport" mechanism exists or is needed. For sales this falls out naturally: reverting frees up the `slip_id`s that were blocking re-confirmation as duplicates. For purchases/inventory, a fresh confirm just creates a new batch as usual.
