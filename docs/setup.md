# Setup

## Prerequisites

- Node.js + npm
- Python 3.11+ and [`uv`](https://docs.astral.sh/uv/)
- A Supabase project (Auth + Postgres database)

## Install

```
npm install
uv sync --project backend
```

## Environment variables

Two separate `.env` files — don't mix them up:

**Repo root `.env`** (copy from `.env.example`) — used by the Electron renderer (Vite):

```
VITE_SUPABASE_URL=https://YOUR_PROJECT.supabase.co
VITE_SUPABASE_ANON_KEY=YOUR_ANON_KEY
VITE_API_BASE_URL=http://127.0.0.1:8000
```

**`backend/.env`** (copy from `backend/.env.example`) — used by FastAPI:

```
PORT=8000
DATABASE_URL=postgresql://...   # Neon Postgres connection string (the pooled endpoint, with sslmode=require)
SUPABASE_URL=https://YOUR_PROJECT.supabase.co
```

The Supabase URL/anon key are on the Supabase dashboard under Project Settings → API. The Postgres connection string is under Project Settings → Database → Connection string.

Auth verification uses Supabase's JWKS endpoint (asymmetric ES256 signing keys), not a shared secret — no JWT secret needs to be configured. See [auth-and-accounts.md](./auth-and-accounts.md).

## Database

Apply migrations against the configured `DATABASE_URL`:

```
uv run --directory backend alembic upgrade head
```

## Run

```
npm run dev:all
```

Starts the FastAPI backend (`:8000`) and the Electron app together. See [`CLAUDE.md`](../CLAUDE.md) for the full command reference, including running the backend or frontend independently, tests, and the standalone CSV-cleaning scripts.
