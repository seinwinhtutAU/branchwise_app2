# Architecture

## Overview

```
┌─────────────────────────────┐         ┌──────────────────────────┐
│  Electron app                │         │  Supabase                │
│  ┌────────────┐  ┌─────────┐ │  HTTPS  │  ┌────────┐  ┌─────────┐ │
│  │  main       │  │renderer │─┼────────▶│  │  Auth  │  │Postgres │ │
│  │ (Node)      │  │ (React) │ │         │  └────────┘  └─────────┘ │
│  └────────────┘  └────┬────┘ │         └──────────────────────────┘
└────────────────────────┼─────┘                    ▲
                          │ HTTP (Bearer JWT)          │ SQLAlchemy
                          ▼                            │
                 ┌──────────────────┐                  │
                 │  FastAPI backend  │──────────────────┘
                 │  (uv/Python)      │
                 └──────────────────┘
```

The renderer talks directly to Supabase Auth for sign-in/sign-up (via `@supabase/supabase-js`), and to the FastAPI backend for everything else, attaching the Supabase session's JWT as a Bearer token. The backend verifies that JWT against Supabase's JWKS endpoint and talks to the same Supabase project's Postgres database via SQLAlchemy.

## Repo layout

```
frontend/
  main/            Electron main process (creates the BrowserWindow)
  preload/         contextBridge — exposes a safe API surface to the renderer
  renderer/         React app (Vite)
    src/
      lib/          Supabase client setup, theme, warning-window preference
      components/   one component per screen (import, history, warnings, wholesale orders/vouchers, settings, ...)
backend/
  app/
    main.py         FastAPI app factory, mounts routers
    config.py       Settings (env vars)
    core/security.py   JWT verification, app-user resolution
    db/             SQLAlchemy engine/session
    models/         ORM models (one file per entity)
    routers/        HTTP endpoints, one file per resource
    services/        Business logic — CSV parsing/cleaning, DB persistence
  alembic/          Migrations
  scripts/          Standalone CLI scripts (CSV cleaning without the app)
  tests/
retail_data/        Sample POS exports + their cleaned output (for reference/testing)
```

Root `package.json` orchestrates both halves (`npm run dev:all` runs the Electron dev server and the FastAPI dev server together via `concurrently`).

## Backend layers

`routers/` are thin — they handle HTTP concerns (auth dependency, file upload, status codes) and delegate to `services/`. `services/` hold the actual logic and don't know about FastAPI at all, which is why they're independently unit-testable (see `backend/tests/test_pos_import.py` etc., which call service functions directly rather than going through HTTP).

Three kinds of services:
- **`*_import.py`** (`pos_import`, `inventory_import`, `purchase_import`) — parse a raw POS export into a clean pandas DataFrame. Pure functions, no database access.
- **`*_persist.py`** (`sales_persist`, `inventory_persist`, `purchase_persist`) — take a cleaned DataFrame and write it to the database.
- **`data_quality.py`** — reads already-persisted retail data (sales/inventory/purchases) and runs data-quality checks over it (bad numeric values, missing inventory records, snapshot reconciliation), backing `GET /api/warnings`. See [database-schema.md](./database-schema.md) and [known-limitations.md](./known-limitations.md) for what it checks and its known gaps.

`wholesale.py` (service) and `orders.py`/`factory_vouchers.py` (routers) are a separate case: the wholesale customer-orders/factory-vouchers workflow is entered inline through the UI rather than imported from a file, so there's no `*_import.py`/`*_persist.py` split for it — the router and service together handle validation, auto-pricing, and persistence directly.

`import_common.py` holds logic shared across all three import types: reading csv/xls/xlsx into a raw grid, numeric parsing, Zawgyi-aware Myanmar text cleaning, and batched product upsert. See [data-import.md](./data-import.md) for the full pipeline.

## Frontend structure

`App.tsx` handles auth state (sign in/up, demo login buttons in dev) and, once signed in, renders a role-dependent sidebar nav (`AppShell`) plus one component per section. Retail/admin accounts see Import, Import History, Import Overview, Data Overview, Sale, Inventory, Purchase, and Warning; wholesale accounts see only Customer Orders and Factory Vouchers instead (a completely separate workflow — own product-code namespace, no shared `products` table, entered inline rather than imported); admin sees both sets. Every role also sees Settings (theme switcher + the Warning check-window preference, the latter hidden for wholesale since it has no Warning page).

The retail Import section renders `FileImportCard` — one per import type (sales/inventory/purchase), parameterized by `endpoint` and `label` — which hands off to `ImportReviewPage` for the actual upload → preview → confirm flow, including the branch picker shown when the signed-in account has no assigned branch.
