# Data import pipeline

POS exports (`retail_data/{sale,inventory,purchase}.csv`) are printed-report formats, not clean tables. Cleaning them is a two-stage process — **parse** (pure, no DB) then **persist** (writes to the database) — exposed as a preview/confirm pair of endpoints so nothing is written until the user has seen what it looks like cleaned.

Every retail import route (`app/retail/routers/imports.py`, `import_health.py`) permits `admin`, `development`, `retail_management`, and `retail`, while blocking `wholesale` — see [auth-and-accounts.md](../auth-and-accounts.md). Admin's only retail restriction is the four high-information Dashboard tabs.

## Source formats

**`sale.csv`** — repeating blocks: a metadata line, a column-header line, a report-wide `Date` line, then per-slip blocks (`Slip Number`/`Time` header line, one or more line-item rows, a per-slip subtotal row), a grand-`Total` row, a page footer.

**`inventory.csv`** — a flat table: metadata line, one header row (some header cells are quoted multi-line strings), one row per stock item, a `Grand Total` row, a page footer.

**`purchase.csv`** — the simplest: just a header row and data rows, no metadata/footer, no comma-formatted numbers, no date.

Each parser (`app/services/{pos,inventory,purchase}_import.py`) classifies rows **structurally** rather than by fixed position — e.g. a sale line-item row is recognized by "does this row have a parseable price and quantity in the expected columns," not "is this the 5th line after a Slip Number line." This is deliberate: the same parser keeps working if a future export from the same POS software has slightly different row counts or optional fields.

## Target columns

| Source          | Output columns                                                                                                                                   |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| `sale.csv`      | `Date, SlipID, SlipNumber, LineNo, LineID, StockCode, Description, Location, Selling_Price, Qty, UOM, Discount_Amount, Amount, Net_Amount, Time` |
| `inventory.csv` | `StockCode, Description, Location, Group, On_Hand_Qty, Buying_Price, Selling_Price`                                                              |
| `purchase.csv`  | `StockCode, Description, Location, Quantity, UOM, Buying_Price`                                                                                  |

`SlipID`/`LineID` don't exist in the source — they're synthesized (`SlipID = {date}-{slip_number}`, e.g. `20260821-002`; `LineID = {SlipID}-{line_no}`) to be stable, human-readable, and unique across multiple days' files.

## The Zawgyi problem

Myanmar retail software historically used **Zawgyi**, a pre-2019, non-Unicode-compliant font encoding — it reuses the same Unicode Myanmar code points as standard Unicode but in a different order, so a font/renderer built for real Unicode Myanmar displays Zawgyi text with broken character ordering (and vice versa). Real POS data is a **mix** of both within the same file/column, because entries get added over years spanning the transition.

`import_common.py`'s `clean_text` handles this: it only converts a string through `pyidaungsu.cvt2uni` (Zawgyi → Unicode) when `is_zawgyi` actually detects Zawgyi encoding first. Blindly converting every Myanmar-containing string corrupts the ones that are already correct Unicode — this was a real bug caught partway through building this (see [known-limitations.md](../known-limitations.md) for what's still not handled).

`is_zawgyi` calls `pyidaungsu`'s underlying fasttext model directly (`pds.f.f.predict(...)`) instead of its public `detect()` function, because that public wrapper crashes under the numpy version this project uses (`np.array(x, copy=False)` — a numpy 2.x incompatibility in an old release of `fasttext`).

## Product name casing

POS operators type descriptions however they like, so the same brand arrives as "lily",
"LiLy", "NIKE", "adidas" and "CLassic" — and every screen shows that inconsistency back to
the reader. Each import runs its Description column through `import_common.clean_description`,
which is `clean_text` plus `title_case`: one capital per word, the rest lowercase.

Two exceptions. Myanmar text has no upper and lower case, so it passes through unchanged.
A word containing a digit is left alone ("500ML", "3D"), since those read as sizes or codes
and lowercasing them looks like a typo. The known cost is run-together brand names —
"AandFicth" becomes "Aandficth" — because nothing in the text marks the word boundary;
that is the trade for fixing the far more common all-caps/all-lowercase case. Only the
display label changes: `stock_code` stays the key that identifies a product.

Rows imported before this rule keep their old casing until re-imported, so
`backend/scripts/titlecase_product_descriptions.py` applies the same function to the
existing `products` table. It is a dry run by default and prints every change; `--apply`
saves. Wholesale order/voucher lines were deliberately untouched — those descriptions are
typed by hand in the app, where the person entering them chooses the casing.

## Preview vs. confirm

- `POST /api/imports/{sales,inventory,purchase}` — parses the upload and returns both the raw grid (`origin`) and the cleaned rows (`clean`), for the user to review. Nothing is written to the database.
- `POST /api/imports/{sales,inventory,purchase}/confirm` — re-parses the same upload and persists it via the matching `*_persist.py` service.
- `POST /api/imports/inspect` — a lighter-weight cousin of the preview endpoint: given a file and an `expected_type` form field, it parses just enough to say whether the file matches (`status`: `valid` / `wrong_type` / `unrecognized` / `invalid`), what date(s) it covers, its extracted `purchase_number` (purchase files only), and a row count — without building the full `origin`/`clean` grids. It exists for the bulk import flow below, which needs to sanity-check several files at once without paying for a full preview on each.

There are now two different frontend flows built on these endpoints, for two different situations:

- **Bulk import (the main Import Hub "Import" tab)** — `FileImportCard.tsx` lets the user pick any number of files for one type at once and hands them straight to `ImportConfirmModal.tsx`, which calls `/api/imports/inspect` on each (three at a time) to show a per-file valid/wrong-type badge plus its detected dates/purchase number/row count, lets the user bulk-select and delete the invalid ones, and then — once every remaining file is valid — posts each straight to its `/confirm` endpoint (again three at a time). There's no full origin/clean grid shown in this flow; the inspect call is a fast gate, not a preview.
- **Single-file targeted reimport** — Import History's "Reimport" button and the Warning page's "Import to fix" link still go through the original full preview: one file at a time into `ImportReviewPage.tsx`, which shows the complete Original/Cleaned grids with row-level issue highlighting before Confirm. This is also the only path that carries a `revertBatchId` — confirming here first calls `POST /api/imports/history/{revertBatchId}/revert?replaced=true` (marking that batch `reimported` rather than `reverted`, see below) and only then confirms the corrected file.

Purchase confirm additionally accepts optional `purchase_date` (`YYYY-MM-DD`) and `purchase_number` form fields. Both have a filename-derived fallback: `extract_purchase_metadata` (`app/retail/services/purchase_import.py`) pulls a normalized `purchase_number` (e.g. `STR-000067`) and a date out of filenames like `STR-000067-purchase-bogyoke-19-9-26.xlsx`, and `/api/imports/inspect`/the bulk confirm flow use that extraction automatically so staff don't have to type either by hand. An explicit form field always wins over the filename guess. See `purchases.purchase_date`/`purchase_number` in [database-schema.md](../database-schema.md).

## Original file storage (Cloudflare R2)

Every confirm endpoint also uploads the raw uploaded bytes to Cloudflare R2 object storage (`app/services/storage.py`'s `R2StorageService`, under key `imports/{a fresh uuid}/{filename}`) and records the resulting key on `import_batches.storage_key`. This is entirely optional: `R2StorageService.is_configured` requires `R2_ACCOUNT_ID`/`R2_ACCESS_KEY_ID`/`R2_SECRET_ACCESS_KEY`/`R2_BUCKET` to all be set in `backend/.env` (see `backend/.env.example`) and the `boto3` package to be installed; without them every upload/download call is a harmless no-op and `storage_key` just stays `null`, same as before this existed.

`GET /api/imports/history/{batch_id}/download` streams the original spreadsheet back for administrators: it tries R2 first via `storage_key`, then (only for daily operation cost files confirmed before this note — see below) the batch's own `original_file` database column. A batch whose R2 upload never succeeded and predates that column has no downloadable original — R2 is the only durability path for a sales/inventory/purchase batch's original file, so this is accepted as a rare, tolerable gap rather than kept working via a second copy of the data. Daily operation cost files are the exception on visibility: any staff account assigned to that file's branch can download its unchanged copy, not just administrators.

Import Detail's "Clean" tab is reconstructed live from the persisted `Sale`/`Purchase`/`StockLevel` rows themselves (see `app/retail/services/clean_rows.py`) — there is nothing to store for it. Its "Original" tab (the raw file rows, including header/footer lines that never became a real record) is re-parsed on demand from the R2-stored original file each time someone opens it, the same parse the live preview endpoints already run — a rare "view an old import" read, not something done on every confirm.

## Daily operation cost storage

The **Daily Operation Cost** card accepts any file type and does not parse it or create sales, purchasing, or inventory records. Each file is associated with the selected branch and mirrored to Cloudflare R2 in the background, the same durability path as sales/inventory/purchase. Pre-existing files (confirmed before this became R2-only) are still stored byte-for-byte on their `ImportBatch` row and remain downloadable from there. Daily operation cost files appear in Import History and can be downloaded by staff in that branch.

## Branch resolution on confirm

The source `Location` column (e.g. `"Aung Thit Sar"`) doesn't reliably match actual branch names (Wholesale/AungThitSar/Ashley/Retail 3) and isn't used to resolve the branch. Instead: the confirm endpoint uses the **uploading user's own `users.branch_id`**. An account with no branch (admin) must supply one explicitly via a `branch_id` form field; the server ignores any client-supplied `branch_id` for accounts that already have one (defense in depth — a retail account can't tag data to another branch even if the frontend were tampered with). The raw `Location` string is still stored (`location_raw`) on every row for audit/backfill purposes.

## Product upsert & performance

Every row references a `Product`, upserted by `stock_code` (see [database-schema.md](../database-schema.md)). This is batched (`import_common.get_or_create_products` — one `SELECT ... WHERE stock_code IN (...)` plus in-memory create/update) rather than looked up per row. This isn't a micro-optimization: a naive per-row version against the remote Postgres pooler took minutes and hit request timeouts on a 900-row inventory file; batched, the same file imports in ~5 seconds.

## Idempotency differs by type

- **Sales**: idempotent per slip, scoped to branch. `sales.slip_id` is unique per `branch_id` (not globally) — `slip_id` is built from just the report date + slip number, and different branches/POS terminals number their own slips independently, so the same `slip_id` can legitimately occur at two branches on the same day. Re-confirming the same file skips slips already imported for that branch (reported in the response as `sales_skipped_duplicate`).
- **Purchases**: **not** idempotent. `purchase.csv` has no natural batch/date key, so every confirm creates a new `Purchase` batch — re-uploading the same file double-counts.
- **Inventory**: intentionally not deduplicated — every confirm adds a new snapshot batch by design (see `stock_levels` in [database-schema.md](../database-schema.md)).

## Import history & revert

Every confirmed import (any of the three types) creates one `ImportBatch` row (`app/retail/models/import_batch.py`), and every `Sale`/`Purchase`/`StockLevel` it creates is linked to it via `import_batch_id`. This is what makes two things possible:

- **`GET /api/imports/history`** — lists past imports (type, filename, branch, uploader, status, summary, timestamps). No longer includes the summary breakdown inline — see the detail endpoint below. Non-admin accounts only see their own branch's history; an account with no branch (admin) sees all — same visibility rule as branch resolution on confirm.
- **`GET /api/imports/history/{batch_id}`** — the same metadata as one row of the list plus one 50-row page for the requested `tab=clean|original`. The `clean` tab is a live, paginated query of the batch's own `Sale`/`Purchase`/`StockLevel` rows; the `original` tab is a paginated, on-demand re-parse of the R2-stored original file (empty if R2 has nothing for this batch — see "Original file storage" above). `GET /api/imports/history/{batch_id}/warnings` supplies warning positions separately, only when the UI needs them. Together they back the read-only Cleaned/Original Import Detail view without transferring both grids upfront. Same visibility rule and 404 behavior as the list/revert endpoints.
- **`POST /api/imports/history/{batch_id}/revert`** — the fix for a wrong import. Deletes the batch's actual data rows (`SaleLine`s then `Sale`s / `PurchaseLine`s then `Purchase` / `StockLevel`s) but **keeps the `ImportBatch` row**, marked `status=reverted` (or `status=reimported` — see below) with who/when — an audit trail, not a silent erase. `Product` rows are never touched (they're shared across batches). 404s if the batch doesn't exist or isn't visible to the caller; 409s if it's already reverted/reimported. A `retail`-role account (not admin or `retail_management`) can only revert a batch within 1 day of importing it; admin and `retail_management` have no such limit.

To actually fix a wrong import: revert it, then just use the normal "Confirm Import" flow again with the corrected file — no separate "reimport" mechanism exists or is needed. For sales this falls out naturally: reverting frees up the `slip_id`s that were blocking re-confirmation as duplicates. For purchases/inventory, a fresh confirm just creates a new batch as usual.

Revert takes an optional `replaced` query flag (`?replaced=true`), used by `ImportReviewPage`'s Reimport path above: it marks the old batch `status=reimported` instead of `status=reverted`. Both statuses have identical effects on the data (rows deleted, batch kept), so this is purely a labeling distinction for Import History — "reimported" tells a reader "a corrected file replaced this one," while a plain "reverted" reads as "removed, nothing replaced it yet."
