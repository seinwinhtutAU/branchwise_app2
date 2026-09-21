# Auth & accounts

## How login works

Logins moved from **Supabase Auth** to **Neon Auth** (managed Better Auth) on 2026-09-05,
when the Supabase project was shut down. Supabase's bcrypt password hashes cannot be
imported into Neon Auth — it hashes differently, and Neon's own migration guide says so —
so all five accounts were recreated with new passwords.

**The renderer never talks to the auth service.** It posts email and password to this
project's own backend (`POST /api/auth/login`), which holds the conversation with Neon
Auth and hands back a JWT. That is deliberate: Neon Auth keeps its session in a
`__Secure-neon-auth.session_token` cookie, and a packaged Electron app runs from `file://`,
whose requests carry `Origin: null` — a cookie is the one thing that renderer cannot hold
comfortably. Doing it in the backend means the app talks to exactly one origin, keeps
sending the same `Authorization: Bearer` header it always did, and its content-security
policy needs no third-party entry (`https://*.supabase.co` is gone from it).

The endpoints are in `app/routers/auth.py`: `login`, `signup`, `refresh`, `logout`. The
app stores two things (`frontend/renderer/src/lib/auth.ts`): the short-lived
`access_token` it sends to the API, and the long-lived opaque `session` that mints new
ones. A Neon Auth JWT lasts **15 minutes**, and the app keeps it fresh three ways, because any
one of them alone leaves a hole:

- **On launch**, immediately — a session restored from a previous run is almost always
  carrying a dead token. Refreshing only on the timer meant the first ten minutes of every
  session showed "Couldn't load" on every page, an expired-token error dressed up as
  missing data.
- **Before sending**, when the token's own `exp` says it has already passed. One refresh
  serves every caller waiting on it, so a launch that fires six requests at once costs one
  round trip, not six.
- **After a 401**, refresh and replay the request once. `installAuthRetry` patches `fetch`
  in one place rather than threading a retry through fifty call sites, and it is scoped
  tightly: only this app's API, only a 401, only one retry.

Only a rejected _session_ returns anyone to the sign-in screen.

The backend verifies each JWT (`app/core/security.py::get_current_user`) against Neon
Auth's JWKS. Two differences from the Supabase era worth knowing: the algorithm is
**EdDSA (Ed25519)**, not ES256; and `iss`/`aud` are the auth host's **origin**
(`https://<endpoint>.neonauth.<region>.aws.neon.tech`), _not_ the full base URL with its
`/<db>/auth` path — verifying against the full base URL rejects every token.

## Roles

Four roles exist (`UserRole` in `app/models/user.py`): `admin`, `retail_management`, `wholesale`, `retail`. `admin` and `retail_management` have no `branch_id` (`app/routers/users.py`'s `_validate_assignment` rejects assigning one to a branch); `wholesale` and `retail` must have one.

`retail_management` was added as a middle ground: full admin-equivalent access to the retail workspace (every retail screen, every retail branch, no revert time-limit — see [data-import.md](./retail/data-import.md)) without also getting the Wholesale workspace or the ability to manage other accounts. `require_retail` (`app/retail/routers/common.py`) is the shared dependency behind this: every retail router (`imports`, `dashboard`, `warnings`, `checking`, `chat`, `sales`, `inventory`, `purchases`, `purchasing`, `data_overview`) now depends on it instead of each repeating its own role check, and it allows `admin`, `retail_management`, and `retail` while rejecting `wholesale`.

## Two "users"

The auth service holds credentials. This app's own `users` table (see
[database-schema.md](./database-schema.md)) holds the app-level profile — `name`, `role`,
`branch_id`.

Until the move, a `users` row's **primary key was the Supabase auth user id**. That is
exactly what made changing providers painful: every account got a new id at Neon Auth, and
a primary key owned by a third party cannot survive that without rewriting every row that
references it. So `users` now carries a separate **`auth_user_id`** column, and
`get_current_app_user` matches on it — falling back to the primary key for any row not yet
linked, which is what let the two systems overlap during the cutover. Swapping auth
providers again would now be a script that rewrites one column.

`backend/scripts/link_auth_accounts.py` is that script: it creates a Neon Auth account for
every `users` row that lacks one, links it, and prints the temporary passwords.
`backend/scripts/seed_retail_accounts.py` is the narrower, idempotent cousin used to add the
Bogyoke/BHS 1 branches and their retail accounts specifically.

## Provisioning accounts from the app

Admin no longer has to run a script to add someone: **Settings → User Management**
(`UserManagementPage.tsx`, backed by admin-only `app/routers/users.py`) creates, edits, and
deletes accounts directly. Creating one (`POST /api/users`) does both halves in one call — it
opens a Neon Auth account with the given password (`_create_auth_account`, same
`sign-up/email` call the seed scripts use) *and* the app's own `users` row, atomically enough
that a failure on either side leaves nothing half-created. Editing (`PATCH /api/users/{id}`)
only ever touches the `users` row (name/role/branch) — it can't change email or password, since
those live with Neon Auth, not this table. Deleting (`DELETE /api/users/{id}`) refuses to
delete the caller's own account or the last remaining `admin`, nulls out that user's references
on any `ImportBatch` (`uploaded_by`/`reverted_by`/`health_dismissed_by` — the import stays in
history, it just no longer names a specific account) rather than blocking the delete, and — on
Postgres only, since Neon Auth's tables don't exist in the SQLite test database — deletes the
matching `neon_auth."user"` row too, so the deleted account can no longer sign in.

This is the recommended way to add or change accounts today; the scripts above remain for
one-off bulk/dev seeding.

## Seeded accounts (dev)

Five accounts exist, matching the business's actual branches. All five share the dev password **`12345678`**. It was `123456` under Supabase Auth;
Neon Auth enforces a minimum of eight characters, so the shortest equivalent was used
instead and `App.tsx`'s `DEV_PASSWORD` matches it. This is a development convenience on a
service reachable from the internet — the accounts the branches actually use should be
given real passwords before daily use.

| Email                      | Role      | Branch      |
| -------------------------- | --------- | ----------- |
| admin@branchwise.app       | admin     | _(none)_    |
| wholesale@branchwise.app   | wholesale | Wholesale   |
| bogyoke@branchwise.app      | retail    | Bogyoke     |
| bhs1@branchwise.app        | retail    | BHS 1       |
| aungthitsar@branchwise.app | retail    | AungThitSar |
| ashley@branchwise.app      | retail    | Ashley      |
| retail3@branchwise.app     | retail    | Retail 3    |

In dev builds (`import.meta.env.DEV`), the login screen shows one-click buttons for each of these — see `App.tsx`. They're hidden in production builds since the password is hardcoded in the client bundle.

Admin has no branch — anywhere branch matters (e.g. confirming an import), admin must pick one explicitly. See [data-import.md](./retail/data-import.md#branch-resolution-on-confirm).
