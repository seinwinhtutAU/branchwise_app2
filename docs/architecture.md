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
      lib/          Supabase client setup
      components/   FileImport (upload/preview/confirm UI)
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

Two kinds of services:
- **`*_import.py`** (`pos_import`, `inventory_import`, `purchase_import`) — parse a raw POS export into a clean pandas DataFrame. Pure functions, no database access.
- **`*_persist.py`** (`sales_persist`, `inventory_persist`, `purchase_persist`) — take a cleaned DataFrame and write it to the database.

`import_common.py` holds logic shared across all three import types: reading csv/xls/xlsx into a raw grid, numeric parsing, Zawgyi-aware Myanmar text cleaning, and batched product upsert. See [data-import.md](./data-import.md) for the full pipeline.

## Frontend structure

The renderer is a single `App.tsx` handling auth state (sign in/up, demo login buttons in dev) and rendering `FileImport` — one instance per import type (sales/inventory/purchase), parameterized by `endpoint` and `label`. `FileImport` handles the whole upload → preview → confirm flow, including the branch picker shown when the signed-in account has no assigned branch.
