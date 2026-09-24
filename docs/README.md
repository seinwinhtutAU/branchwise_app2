# branchwise-app2 docs

A desktop app for a Myanmar retail business with one wholesale branch and three retail branches. Electron + React frontend, FastAPI backend, Neon Auth for login and Postgres on Neon for the database.

Docs are split the same way the codebase is: shared docs here at the top level, retail-specific docs under [`retail/`](./retail/), wholesale-specific docs under [`wholesale/`](./wholesale/).

## Shared

- [Setup](./setup.md) — getting the app running locally
- [Architecture](./architecture.md) — how the pieces fit together
- [Database schema](./database-schema.md) — tables, columns, relationships (both businesses — they share `branches`/`users` but no other tables)
- [Auth & accounts](./auth-and-accounts.md) — how login works, roles, seeded accounts, admin's User Management page
- [UI overview](./ui-overview.md) — design system and component conventions
- [Known limitations](./known-limitations.md) — gaps that are known and deliberately deferred (both businesses)

## Retail

- [Data import pipeline](./retail/data-import.md) — cleaning and persisting POS exports
- [Retail dashboard](./retail/dashboard.md) — the per-branch Revenue/Cost/Inventory/Customer tabs and how each number is computed
- [Business alerts](./retail/business-alerts.md) — every alert condition in plain language, with a worked example for each
- [Branch health score](./retail/branch_health.md) — the Overview tab's 0-100 score per dimension, its weight/band table, and how it handles data it can't measure
- [Import health](./retail/import_health.md) — checks on whether an import's cleaning/confirm step behaved correctly
- [Checking](./retail/checking.md) — the physical stock audit screen (built, currently hidden from the nav)
- [User guide](./retail/help.md) — the plain-language reference for staff (written for the in-app Help page, which has since been removed; kept as documentation and as the source material for the chat assistant)

## Wholesale

- [Overview](./wholesale/README.md) — the whole pipeline, and the shared conventions (pairs/colours/money/references/audit/lifecycle) every screen below uses
- [Shipments (Delivery)](./wholesale/shipments.md) — the freight journey and the "can't send more than a stop received" rule
- [Receiving](./wholesale/receiving.md) — counting packages at the gate; opening one is what makes it real stock
- [Supplier Vouchers](./wholesale/supplier-vouchers.md) — the commercial document a shipment/receiving fulfills
- [Customer Orders](./wholesale/customer-orders.md) — allocation, delivery, and the caps that keep both honest
- [Inventory / Stock Records](./wholesale/inventory.md) — the whole pipeline, including stock that hasn't arrived yet
- [Finance](./wholesale/finance.md) — receivables, payables, shipment costs
- [Monitoring](./wholesale/monitoring.md) — a live operational status board (built, hidden from the nav)
- [Master Data](./wholesale/master-data.md) — products, suppliers, customers, and the other reference lists
- [Write-offs](./wholesale/write-offs.md) — the shared "explain the mismatch" mechanism used by Shipments, Vouchers, and Orders

For day-to-day dev commands (running tests, migrations, the dev server), see [`CLAUDE.md`](../CLAUDE.md) at the repo root.
