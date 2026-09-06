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
ones. A Neon Auth JWT lasts **15 minutes**, so the app refreshes on a 10-minute timer;
only a rejected *session* returns anyone to the sign-in screen.

The backend verifies each JWT (`app/core/security.py::get_current_user`) against Neon
Auth's JWKS. Two differences from the Supabase era worth knowing: the algorithm is
**EdDSA (Ed25519)**, not ES256; and `iss`/`aud` are the auth host's **origin**
(`https://<endpoint>.neonauth.<region>.aws.neon.tech`), *not* the full base URL with its
`/<db>/auth` path — verifying against the full base URL rejects every token.

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

## Seeded accounts (dev)

Five accounts exist, matching the business's actual branches. All five share the dev password **`12345678`**. It was `123456` under Supabase Auth;
Neon Auth enforces a minimum of eight characters, so the shortest equivalent was used
instead and `App.tsx`'s `DEV_PASSWORD` matches it. This is a development convenience on a
service reachable from the internet — the accounts the branches actually use should be
given real passwords before daily use.

| Email | Role | Branch |
|---|---|---|
| admin@branchwise.app | admin | *(none)* |
| wholesale@branchwise.app | wholesale | Wholesale |
| aungthitsar@branchwise.app | retail | AungThitSar |
| ashley@branchwise.app | retail | Ashley |
| retail3@branchwise.app | retail | Retail 3 |

In dev builds (`import.meta.env.DEV`), the login screen shows one-click buttons for each of these — see `App.tsx`. They're hidden in production builds since the password is hardcoded in the client bundle.

Admin has no branch — anywhere branch matters (e.g. confirming an import), admin must pick one explicitly. See [data-import.md](./data-import.md#branch-resolution-on-confirm).
