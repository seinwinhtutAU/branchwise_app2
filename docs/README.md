# branchwise-app2 docs

A desktop app for a Myanmar retail business with one wholesale branch and three retail branches. Electron + React frontend, FastAPI backend, Supabase for Auth and Postgres.

- [Setup](./setup.md) — getting the app running locally
- [Architecture](./architecture.md) — how the pieces fit together
- [Database schema](./database-schema.md) — tables, columns, relationships
- [Data import pipeline](./data-import.md) — cleaning and persisting POS exports
- [Auth & accounts](./auth-and-accounts.md) — how login works, seeded accounts
- [Retail dashboard](./retail_dashboard.md) — the per-branch Revenue/Cost/Inventory/Customer tabs and how each number is computed
- [Branch health score](./branch_health.md) — the Overview tab's 0-100 score per dimension, its weight/band table, and how it handles data it can't measure
- [Import health](./import_health.md) — checks on whether an import's cleaning/confirm step behaved correctly
- [UI overview](./ui-overview.md) — design system and component conventions
- [Help page](./help.md) — the in-app plain-language reference for staff
- [Known limitations](./known-limitations.md) — gaps that are known and deliberately deferred

For day-to-day dev commands (running tests, migrations, the dev server), see [`CLAUDE.md`](../CLAUDE.md) at the repo root.
