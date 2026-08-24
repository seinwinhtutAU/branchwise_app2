# Auth & accounts

## How login works

The Electron renderer uses `@supabase/supabase-js` to sign in/up directly against Supabase Auth — the FastAPI backend is never involved in credential handling. Once signed in, the renderer attaches the Supabase session's JWT as `Authorization: Bearer <token>` on every request to the backend.

The backend verifies that JWT itself (`app/core/security.py::get_current_user`) against Supabase's public JWKS endpoint (`{SUPABASE_URL}/auth/v1/.well-known/jwks.json`), because this Supabase project issues session tokens signed with an asymmetric key (ES256), not the legacy shared HS256 secret — there is no JWT secret to configure.

## Two "users"

Supabase Auth (its own `auth.users` table, which this app never touches directly) handles credentials. This app's own `users` table (see [database-schema.md](./database-schema.md)) holds the app-level profile — `name`, `role`, `branch_id` — keyed by **the same UUID** as the Supabase Auth user id.

`get_current_app_user` (used by `/api/me` and the import `/confirm` endpoints) loads that `users` row. If someone is authenticated with Supabase but has no matching `users` row, this 404s — see [known-limitations.md](./known-limitations.md).

## Seeded accounts (dev)

Five accounts exist, matching the business's actual branches, all sharing the dev password `123456`:

| Email | Role | Branch |
|---|---|---|
| admin@branchwise.app | admin | *(none)* |
| wholesale@branchwise.app | wholesale | Wholesale |
| aungthitsar@branchwise.app | retail | AungThitSar |
| ashley@branchwise.app | retail | Ashley |
| retail3@branchwise.app | retail | Retail 3 |

In dev builds (`import.meta.env.DEV`), the login screen shows one-click buttons for each of these — see `App.tsx`. They're hidden in production builds since the password is hardcoded in the client bundle.

Admin has no branch — anywhere branch matters (e.g. confirming an import), admin must pick one explicitly. See [data-import.md](./data-import.md#branch-resolution-on-confirm).
