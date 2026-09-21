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

The renderer talks to the FastAPI backend and nothing else — including for sign-in, which the backend proxies to Neon Auth (see [auth-and-accounts.md](./auth-and-accounts.md)). Every request carries the auth JWT as a Bearer token. The backend verifies that JWT against Neon Auth's JWKS endpoint and talks to the application's Postgres database via SQLAlchemy.

**Both the database and the auth are on Neon.** They were the same Supabase project until 2026-09-05, when the database was moved: the free plan's 5 GB monthly egress was the binding limit (storage was never close — the whole database is ~28 MB), and every dashboard query crossed from Supabase to the backend's own host. Auth followed two days later, when the Supabase project was shut down outright: Neon Auth cannot import Supabase's bcrypt password hashes, so the five accounts were recreated with new passwords. The move was a `pg_dump` of the `public` schema restored into Neon, with `DATABASE_URL` repointed; no application code changed. Note that egress is metered by Neon too — the durable fix is fewer rows crossing the wire, i.e. aggregating in SQL rather than pulling rows into Python.

## Repo layout

```
frontend/
  main/            Electron main process (creates the BrowserWindow)
  preload/         contextBridge — exposes a safe API surface to the renderer
  renderer/         React app (Vite)
    src/
      lib/          Supabase client setup, theme, warning-window preference
      components/   one component per screen (import, history, warnings, settings, ...)
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

Wholesale uses the same router/service split, but it is a workflow rather than an import
pipeline: `services/wholesale/` owns colour parsing, units, references, receiving and
shipment rules; the feature services own transactions. Its five screens persist to the
same Neon database. Only outgoing customer deliveries are rows; incoming stock is read
from opened receiving packages, and all stock/order figures are derived on request.

`import_common.py` holds logic shared across all three import types: reading csv/xls/xlsx into a raw grid, numeric parsing, Zawgyi-aware Myanmar text cleaning, and batched product upsert. See [data-import.md](./retail/data-import.md) for the full pipeline.

## Frontend structure

`App.tsx` handles auth state (sign in/up, demo login buttons in dev) and, once signed in, renders a role-dependent sidebar nav (`AppShell`) plus one component per section. Retail/admin accounts see Import, Import History, Import Overview, Data Overview, Sale, Inventory, Purchase, and Warning; wholesale accounts see Customer Orders, Supplier Vouchers, Delivery, Receiving, and Inventory; admin sees both sets. Every role also sees Settings. Sign-out clears both the in-memory and persisted GET cache before another account can see a prior branch's pages.

The retail Import section renders `FileImportCard` — one per import type (sales/inventory/purchase), parameterized by `endpoint` and `label` — which hands off to `ImportReviewPage` for the actual upload → preview → confirm flow, including the branch picker shown when the signed-in account has no assigned branch.

## Working on a weak connection

The app runs on the branch machine, but the data does not: the FastAPI backend is local
(`127.0.0.1:8000`) while Postgres is Neon and auth is Neon Auth, both across the
internet. So every screen depends on a link that, in these shops, is often slow and
occasionally drops for a few seconds. Left alone that reads as a broken app — pages stuck
on skeletons, a stack of red "Failed to load" toasts, and no way to tell a bad connection
from bad data. Four pieces address it, none of which changes what the app computes.

**The database connection is kept honest** (`app/db/session.py`). For a Postgres URL the
engine sets `pool_pre_ping` (a `SELECT 1` before a pooled connection is handed out, so one
that died while idle is replaced instead of failing the request), `pool_recycle=300`
(connections older than five minutes are dropped, since Neon's pooler and any NAT in
between will close them anyway), a 10-second `connect_timeout`, and TCP keepalives every
30 seconds. Without the pre-ping the classic failure was "server closed the connection
unexpectedly" on the first request after an idle spell — the network was back, the pooled
socket was not. SQLite (used by the tests and early development) keeps its old settings.

**Requests time out and reads are retried** (`frontend/renderer/src/lib/network.ts`).
`installNetworkResilience()` patches `window.fetch` for URLs under `apiBaseUrl` only —
the same technique `installAuthRetry` already uses for expired tokens, and installed
after it so the wrappers nest network → auth → real fetch. Reads (`GET`/`HEAD`) get a
45-second budget and two retries backing off 0.5s then 2s; writes get five minutes and
**no** retry, because a confirm or revert that may already have been
applied server-side must never be sent twice by the app itself. A request cut off for
taking too long throws `RequestTimeoutError` rather than a bare abort, which is what lets
callers tell "it never left the machine" (safe to send again) from "no answer came back"
(may already be saved).

**Pages fall back to their last known numbers** (`lib/useCachedFetch.ts`). The in-memory
page cache is now also written to `localStorage`, debounced, newest entries first, capped
at 512 KB per entry and 3 MB in total, and dropped after a week. Launching the app on a
slow link used to be its worst moment — every page a skeleton, every request queued behind
the same link; now a launch paints yesterday's numbers immediately and revalidates behind
them. Freshness is not assumed: the server's data-version token is stored beside the cache,
so the first poll after launch compares against what this machine last saw and invalidates
everything if anyone imported in the meantime. Sign-out clears both, since the next
account may be scoped to a different branch.

**The state of the connection is said once, plainly** (`lib/connection.ts`,
`components/features/shell/ConnectionBanner.tsx`). Status is inferred from the app's own
requests rather than from `navigator.onLine`, which is useless here: the backend is on
this machine, so it is always "online", and a slow-but-connected link reports fine. A
request that comes back marks the connection `online` (or `slow` past six seconds); one
that fails at the transport level marks it `offline`, and HTTP errors never do, since
those travelled the wire perfectly well. While offline the network layer polls
`GET /api/health/db` — unauthenticated, one `SELECT 1`, and specifically a check of the
_database_ rather than of the local backend — every five seconds, so the banner clears
itself when the link returns instead of waiting for the next click. Pages stop toasting
individual failures while that banner is up.

**Who you are is remembered too** (`lib/lastKnown.ts`). The profile from `/api/me` and
the branch lists are kept in `localStorage` and seeded into state at first render, because
they decide _which_ pages exist rather than what's on them: without the profile an admin
account looks branch-scoped, and the Dashboard renders a single branch's detail page —
"couldn't load" — while every branch card sits unused in the page cache. A failed
`/api/me` now keeps the last known profile instead of replacing it with "no role"; only
the server actually answering (including with "no profile") changes it. For the same
reason `App.tsx` restores the stored session synchronously with `useState(() =>
loadStoredSession())`: doing it in an effect gave every launch one render with no session,
which read as a sign-out and wiped the remembered profile.

**A refresh that can't reach the server no longer signs you out.** `refreshSession` runs
immediately at launch, and it used to return null on any failure — so opening the app with
no connection dropped straight to the sign-in screen, where signing in was impossible for
the same reason. `post()` in `lib/auth.ts` now throws `AuthRejectedError` only when the
server answered and said no (wrong password, revoked or expired session); anything else is
a network failure, and `refreshSession` returns the session unchanged so the app opens on
its saved data.

The one thing that cannot fall back to cache is an import, so `ImportReviewPage` holds a
file whose confirm never reached the server and sends it automatically once the
connection is back, telling the reader it is waiting. That queue lives in memory only:
closing the app means picking the file again. A confirm that _timed out_ is deliberately
not retried — purchase imports are not idempotent (see `docs/retail/data-import.md`), so the message
sends the reader to Import History to check before importing again.
