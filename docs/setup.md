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
VITE_API_BASE_URL=http://127.0.0.1:8000
```

**`backend/.env`** (copy from `backend/.env.example`) — used by FastAPI:

```
PORT=8000
DATABASE_URL=postgresql://...   # Neon Postgres connection string (the pooled endpoint, with sslmode=require)
NEON_AUTH_BASE_URL=https://<endpoint>.neonauth.<region>.aws.neon.tech/<db>/auth   # Neon console → branch → Auth
NEON_AUTH_JWKS_URL=<the JWKS URL shown beside it>
```

Both the database and the auth values come from the Neon console: the connection string under the project's **Connect** button (use the pooled endpoint, `sslmode=require`), and the two auth URLs under **branch → Auth**.

Auth verification uses Neon Auth's JWKS endpoint (EdDSA/Ed25519 signing keys), not a shared secret — no JWT secret needs to be configured. See [auth-and-accounts.md](./auth-and-accounts.md).

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
