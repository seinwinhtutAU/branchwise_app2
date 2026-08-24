# Known limitations

Things that are known gaps, deliberately deferred rather than oversights.

- **No self-service onboarding.** Signing up in the app creates a Supabase Auth account but not a corresponding `users` row, so a self-signed-up account can authenticate but gets a 404 from `/api/me` and can't import data. Only the 5 seeded accounts (see [auth-and-accounts.md](./auth-and-accounts.md)) are fully provisioned today.

- **Purchase import isn't idempotent.** `purchase.csv` has no natural per-batch key in the source data, so every confirmed import creates a new `Purchase` batch — re-uploading the same file double-counts. Will need real purchase-order references/dates from a richer export to fix properly.

- **`purchases.purchase_date` is a placeholder.** Set to the import date, not a real purchase date, since the source file doesn't have one yet.

- **No "current stock" or "current cost" query yet.** The data to compute both exists (`stock_levels` snapshots + `sale_lines`/`purchase_lines` movements since the last snapshot for stock; most recent `purchase_lines.buying_price` for cost), but no service/endpoint reads it that way yet — see [database-schema.md](./database-schema.md#not-yet-built).

- **Branch resolution has no explicit mapping.** The CSVs' `Location` field doesn't correspond to branch names and isn't used for anything beyond audit (`location_raw`) — branch is resolved from the uploading user's own account instead. If a single account ever needs to import for multiple branches, this will need revisiting.

- **`orders`, `inventory`, `allocation` routers are empty placeholders** (`app/routers/{orders,inventory,allocation}.py`) — scaffolded early, not yet built out. The actual sales/inventory/purchase data lives behind `/api/imports/*` for now.

- **Electron CSP allowlist is manual.** Any new external host the renderer needs to reach must be added to the `connect-src` directive in `frontend/renderer/index.html`, or the request fails silently.
