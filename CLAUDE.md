# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

An Electron + React desktop app (frontend) with a FastAPI + Python backend, used by a Myanmar retail business ("branchwise") with one wholesale and three retail branches. Auth is Supabase Auth; the app database is Supabase's Postgres. Core features: cleaning messy POS report exports (sales/inventory/purchases, in Zawgyi-mixed Myanmar text) into structured data and persisting it (retail/admin); a wholesale-only customer-orders/factory-vouchers workflow, entered inline rather than imported, fully separate from the retail import pipeline; and a data-quality "Warning" page that surfaces numeric/missing-record/reconciliation issues found in the imported retail data.

This file is a quick-reference summary. For depth, read `docs/` — it's not auto-loaded, so check it deliberately when a task touches its area: `docs/architecture.md` (system overview), `docs/database-schema.md` (every table/column/relationship), `docs/data-import.md` (the CSV cleaning pipeline, Zawgyi handling, branch resolution), `docs/auth-and-accounts.md` (Supabase Auth + seeded dev accounts), `docs/known-limitations.md` (deliberately-deferred gaps — check this before assuming something is a bug).

## Commands

### Frontend / orchestration (run from repo root)

```
npm install
npm run dev:all          # Electron+Vite dev server AND the FastAPI backend together (recommended)
npm run dev               # Electron+Vite only
npm run backend:dev       # FastAPI only (uv run --directory backend uvicorn app.main:app --reload --port 8000)
npm run typecheck         # tsc for both the main/preload (node) and renderer (web) tsconfig projects
npm run lint
npm run format
npm run build             # typecheck + electron-vite build
npm run build:mac / build:win / build:linux
```

### Backend (Python, managed with `uv`)

**Always run backend commands with `uv run --directory backend ...`** (or `cd backend` first) — not `uv run --project backend ...` from the repo root. `--project` only locates the venv/pyproject; it does not change the working directory, and `app/config.py`'s `Settings` loads `.env` via a relative path, so running from the repo root silently loads the *root* `.env` (the frontend's Vite vars) instead of `backend/.env`, and `DATABASE_URL`/`SUPABASE_URL` end up empty. This has bitten this project's own dev workflow before (see `package.json`'s `backend:dev` script, which uses `--directory backend`).

Exception: the one-off scripts in `backend/scripts/` (see below) don't touch `app.config`/the database at all, so they're fine to run with `--project backend` from the repo root.

```
uv sync --project backend                                   # install/update deps (creates backend/.venv)

uv run --directory backend pytest -q                        # all tests
uv run --directory backend pytest -q tests/test_pos_import.py                                    # one file
uv run --directory backend pytest -q tests/test_pos_import.py::test_zawgyi_description_converted_to_unicode   # one test

uv run --directory backend alembic revision --autogenerate -m "..."   # new migration (review before applying)
uv run --directory backend alembic upgrade head                       # apply migrations

# Clean a raw POS export without going through the app (writes retail_data/*_clean.csv by default):
uv run --project backend python backend/scripts/clean_sale_csv.py
uv run --project backend python backend/scripts/clean_inventory_csv.py
uv run --project backend python backend/scripts/clean_purchase_csv.py
```

Tests never touch the real database: `backend/tests/conftest.py`'s `client`/`db_session` fixtures override `get_db` with a fresh in-memory SQLite per test. This matters because `backend/.env`'s `DATABASE_URL` points at a real Supabase Postgres instance — any test that exercises a DB-writing endpoint must go through these fixtures (`authed_client` also overrides `get_current_user` to skip real JWT/network verification).

## Architecture

### Two-language monorepo, one root `package.json`

`frontend/` (Electron main/preload/renderer, TypeScript) and `backend/` (FastAPI, Python/uv) are independent toolchains glued together by `npm run dev:all` (via `concurrently`). `electron.vite.config.ts` at the repo root points at `frontend/main`, `frontend/preload`, `frontend/renderer` explicitly (the electron-vite convention of `src/main` etc. doesn't apply here since the layout was renamed).

There are **two separate `.env` files** — don't confuse them: repo-root `.env` holds `VITE_*` vars for the Electron renderer (Supabase URL/anon key, API base URL); `backend/.env` holds the FastAPI vars (`DATABASE_URL`, `SUPABASE_URL`, `PORT`). See the `uv run --directory backend` note above for why mixing these up silently breaks things rather than erroring loudly.

### Auth: two layers, two "users"

Supabase Auth issues JWTs (asymmetric ES256 signing keys, not a shared HS256 secret) — `app/core/security.py`'s `get_current_user` verifies them via Supabase's JWKS endpoint (`PyJWKClient`), not a static secret. `get_current_app_user` goes one step further: it loads the corresponding row from *our own* `users` table (same UUID as the Supabase auth user id) to get app-level profile data (`role`, `branch_id`, `name`). A Supabase-authenticated user isn't fully onboarded until both exist — self-service sign-up (the app's own Sign Up form) only creates the Supabase Auth side; there's no `users` row until one is created separately (currently done by seeding, not self-service).

`GET /api/me` returns the full app-level profile (via `get_current_app_user`), not just raw JWT claims.

### The CSV/XLS/XLSX import pipeline

POS exports (`retail_data/{sale,inventory,purchase}.csv`) are printed-report formats, not clean tables — metadata lines, multi-row headers, repeating slip blocks (sales), grand-total/footer rows. Each of `app/services/{pos,inventory,purchase}_import.py` parses one export type by **structurally classifying rows** (does this row have a numeric quantity/price in the expected position? does it start with a known label like "Total"?) rather than assuming fixed line numbers, so the same parser keeps working across different files of the same format. Shared, format-agnostic logic lives in `app/services/import_common.py`: reading csv/xls/xlsx into a raw grid, number parsing (strips thousands separators), and `clean_text`/`is_zawgyi`.

**Zawgyi**: Myanmar retail data is a mix of legacy Zawgyi-encoded text and standard Unicode — both use the same Unicode code points but order them differently, so a file can contain *both* correctly-encoded and Zawgyi-encoded Myanmar text side by side. `clean_text` only runs the Zawgyi→Unicode converter (`pyidaungsu.cvt2uni`) when `is_zawgyi` actually detects Zawgyi encoding — blindly converting corrupts already-correct text. `is_zawgyi` calls `pyidaungsu`'s underlying fasttext model directly (`pds.f.f.predict`) rather than its public `detect()`/`predict()` wrapper, which crashes under the numpy version this project uses.

Each import type has a matching pair of endpoints in `app/routers/imports.py`: `POST /api/imports/{type}` (parse + preview only, returns both the raw grid and the cleaned rows, nothing persisted) and `POST /api/imports/{type}/confirm` (re-parses the same upload and persists via `app/services/{sales,inventory,purchase}_persist.py`). Confirm endpoints resolve which branch the data belongs to from the uploader's own `users.branch_id`; an account with no branch (e.g. admin) must supply one explicitly via a `branch_id` form field, and the server ignores any client-supplied `branch_id` for accounts that already have one. Purchase confirm also accepts an optional `purchase_date` form field (`YYYY-MM-DD`) to override the default of "the import date."

Products (`app/models/product.py`) are shared/deduplicated across all three import types, upserted by the natural key `stock_code` via `import_common.get_or_create_products` — a single batched `SELECT ... IN (...)` plus in-memory create/update, not a per-row round trip. This matters at scale: a naive per-row version of this against the remote Supabase Postgres pooler took minutes on a 900-row inventory file and hit request timeouts; batched, the same file imports in ~5s. All the ORM models use client-generated UUID primary keys (`id=str(uuid.uuid4())` set explicitly in the persist services, not left to the SQLAlchemy column `default`) specifically so child rows can reference a parent's `id` before any flush.

Sales import is idempotent per slip (`sales.slip_id` is unique; re-confirming the same file skips already-imported slips). Purchase import is **not** idempotent — `purchase.csv` has no natural per-batch key in the source data, so every confirm creates a new `Purchase` batch; re-uploading the same file double-counts. `stock_levels` (inventory) intentionally keeps full history — every confirmed import adds new snapshot rows rather than overwriting, so "current stock" for a product+branch is the row with the latest `snapshot_at`.

Every confirmed import also creates one `ImportBatch` row (`app/models/import_batch.py`), and every `Sale`/`Purchase`/`StockLevel` it creates links back to it via `import_batch_id`. `GET /api/imports/history` lists these (same own-branch-or-admin visibility rule as confirm); `POST /api/imports/history/{id}/revert` deletes the batch's data rows but keeps the `ImportBatch` itself marked `reverted` — an audit trail, not a silent erase. This is also the mechanism for fixing a wrong import: revert it, then just confirm the corrected file again through the normal flow.

### Database models

SQLAlchemy 2.0 style (`Mapped`/`mapped_column`) in `app/models/`, one file per entity, registered in `app/models/__init__.py` (required for Alembic autogenerate to see them). `Branch`/`User` are the base entities (`users.branch_id` nullable — not every role has a branch). `Product` is shared across `SaleLine`, `PurchaseLine`, and `StockLevel` — the retail import pipeline's shared product catalog, keyed by POS `stock_code`. Money/quantity columns use `Numeric`, not `Float`. `alembic/env.py` reads the DB URL from `app.config.get_settings()` at migration time rather than from `alembic.ini`.

### Wholesale: customer orders and factory vouchers

`app/models/wholesale.py` defines a second, deliberately separate data model for the wholesale workflow: `CustomerOrder`/`CustomerOrderLine` and `FactoryVoucher`/`FactoryVoucherLine`, each a header row plus per-product line items. Unlike the retail import pipeline, wholesale data is entered inline in the UI (`CustomerOrdersPage.tsx`/`FactoryVouchersPage.tsx`), not imported from a file, and its `product_code` is free text in its own namespace — **not** a foreign key into the shared `products` table. A `FactoryVoucherLine` auto-prices every open `CustomerOrderLine` matching its `product_code` (within the same branch) and flips that line's status from `not_start` to `waiting`; a `complete` line is never repriced by a later voucher. Wholesale accounts see only this workflow in the nav — none of the retail import/sale/inventory/purchase/history/overview/warnings sections apply to them; admin sees both.

### Data-quality Warnings

`app/services/data_quality.py` backs `GET /api/warnings`, read by the "Warning" nav page (retail/admin only). It runs a set of independent checks over already-imported retail data — bad numeric values on sale/inventory/purchase rows (reusing each import type's own `VALIDATION_RULES`), stock codes sold/purchased but missing an inventory record, and a daily reconciliation check comparing the latest inventory snapshot against `previous snapshot + purchases − sales` since then. Each check returns rows with a plain-English note, the field(s) actually at fault, and (when traceable to one confirmed import) a link into Import History — reverting and re-confirming that batch is the fix for most of these. The reconciliation check is UOM-naive (no per-product unit-conversion table), so a mixed-unit product surfaces as a separate "verify by hand" warning rather than a false mismatch. The Sale/Purchase check window (default: today only) is user-configurable on the Settings page and passed as `?days=`.

### Electron CSP

`frontend/renderer/index.html` sets a `Content-Security-Policy` meta tag with an explicit `connect-src` allowlist (backend origin + `https://*.supabase.co`). Any new external endpoint the renderer needs to `fetch()` must be added there, or the request fails silently with no network-level error surfaced — this has already caused a debugging session once in this project.
