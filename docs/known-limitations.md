# Known limitations

Things that are known gaps, deliberately deferred rather than oversights.

- **No self-service onboarding.** Signing up in the app creates a Supabase Auth account but not a corresponding `users` row, so a self-signed-up account can authenticate but gets a 404 from `/api/me` and can't import data. Only the 5 seeded accounts (see [auth-and-accounts.md](./auth-and-accounts.md)) are fully provisioned today.

- **Purchase import isn't idempotent.** `purchase.csv` has no natural per-batch key in the source data, so every confirmed import creates a new `Purchase` batch — re-uploading the same file double-counts. Will need real purchase-order references/dates from a richer export to fix properly.

- **`purchases.purchase_date` is a placeholder.** Set to the import date, not a real purchase date, since the source file doesn't have one yet.

- **No "current stock" or "current cost" query yet.** The data to compute both exists (`stock_levels` snapshots + `sale_lines`/`purchase_lines` movements since the last snapshot for stock; most recent `purchase_lines.buying_price` for cost), but no service/endpoint reads it that way yet — see [database-schema.md](./database-schema.md#not-yet-built).

- **Branch resolution has no explicit mapping.** The CSVs' `Location` field doesn't correspond to branch names and isn't used for anything beyond audit (`location_raw`) — branch is resolved from the uploading user's own account instead. If a single account ever needs to import for multiple branches, this will need revisiting.

- **`allocation` router is still an empty placeholder** (`app/routers/allocation.py`) — scaffolded early, not yet built out. `orders.py` and `inventory.py` are no longer placeholders: `orders.py` backs the wholesale Customer Orders workflow, and `inventory.py` backs `GET /api/inventory` (current-stock-per-product view over `stock_levels`).

- **Electron CSP allowlist is manual.** Any new external host the renderer needs to reach must be added to the `connect-src` directive in `frontend/renderer/index.html`, or the request fails silently.

- **The Warning tab's daily inventory reconciliation assumes one consistent unit per product.** `GET /api/warnings` (`app/services/data_quality.py`) compares a branch's latest inventory snapshot against `previous snapshot + purchases − sales` since then, but `SaleLine.uom`/`PurchaseLine.uom` are free-text with no conversion table, and `stock_levels` has no unit at all — if a product's sale/purchase rows use more than one UOM string in the window, the math may silently mix units. This is flagged as a separate (non-critical) "unit mismatch" warning rather than solved, since a real fix needs a per-product unit-conversion table. It also relies on `purchases.purchase_date` being the import date (see above) — the reconciliation window is really "since the last inventory import," not calendar dates from a purchase order.

- **Reconciliation "expected" is only as trustworthy as its inputs.** The comparison in the bullet above (prior snapshot + purchases − sales) breaks down if the prior snapshot was itself wrong, or if a purchase/sale file for that window was never imported — in both cases the "expected" number is wrong, not the new count. `inventory_reconciliation_warnings` mitigates this rather than solving it: gaps under `RECONCILIATION_MISMATCH_THRESHOLD` (2 units) are treated as routine noise and not flagged at all; when there was zero purchase/sale activity recorded for a product in the window, the message points at a likely missing import instead of telling staff to recount; and a negative "expected" (which can never be a real stock count) gets an explanation instead of being shown as a target number. There's still no way to detect "the prior snapshot itself was wrong but there *was* purchase/sale activity" — that case still produces a "recount" message that may be pointing at the wrong thing.
