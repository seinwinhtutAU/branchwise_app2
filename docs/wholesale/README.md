# Wholesale

The wholesale business sells footwear in bulk. Goods move: **Supplier Voucher** (what was
ordered from a supplier) → **Shipment** (the freight journey from supplier to gate, via a
cargo company and any number of stops) → **Receiving** (counted into packages at the gate,
opened into real stock) → allocated and delivered against **Customer Orders**. **Inventory /
Stock Records** is the read-only lens over all of that; **Finance** is receivables/payables
over the same data; **Monitoring** and **Reports** are dashboards, currently built but hidden
from the nav; **Master Data** manages the reference lists (products, suppliers, customers,
cargo companies, carriers, destinations, receiving gates) everything else picks from.

This mirrors `CLAUDE.md`'s "Wholesale: rebuilt screen by screen, source-first" section, which
covers *why* the backend was built in this order (Delivery → Receiving → Supplier Vouchers →
Customer Orders → Inventory) and what the old, deleted workflow looked like. These docs cover
*what each screen actually does*, in full depth.

## The screens

- [Shipments (Delivery)](./shipments.md) — the freight journey, and how the "can't send more than a stop received" rule works
- [Receiving](./receiving.md) — counting packages at the gate, and how opening one turns it into real stock
- [Supplier Vouchers](./supplier-vouchers.md) — the commercial document a shipment/receiving fulfills
- [Customer Orders](./customer-orders.md) — allocation, delivery, and the caps that keep both honest
- [Inventory / Stock Records](./inventory.md) — the whole pipeline, including stock that hasn't arrived yet
- [Finance](./finance.md) — receivables, payables, shipment costs
- [Monitoring](./monitoring.md) — a live operational status board (hidden from the nav)
- [Reports](./reports.md) — the four analytical pillars (hidden from the nav)
- [Master Data](./master-data.md) — products, suppliers, customers, and the other reference lists
- [Write-offs](./write-offs.md) — the shared "explain the mismatch" mechanism used by Shipments, Vouchers, and Orders

## Quantities: always stored in pairs

Every quantity in the wholesale schema is stored as `quantity_pairs` (or a `*_pairs` column),
regardless of what unit a screen displays it in. `WholesaleUnit` is `pair` / `set` / `dozen`,
with `PAIRS_PER = {pair: 1, set: 6, dozen: 12}` (`app/wholesale/services/units.py`). A line
usually also carries its own `unit_conversions` JSON snapshot (default the same 1/6/12) rather
than trusting a global constant, so a rate that's later changed doesn't retroactively reprice
old lines. `to_pairs`/`from_pairs` convert between a typed quantity and pairs (the latter can
be fractional — "9 pairs is one and a half sets"); `priced_amount(quantity_pairs, unit, price,
conversions)` converts pairs back to a line's own priced unit before multiplying by its
per-unit price — every total (voucher, order) routes through this so a line quoted per-dozen
is priced as dozens, not silently as pairs.

## Colours: one shorthand, validated identically on both ends

A line's colour breakdown is one string like `"black10s,pink2p"` — colour name, count, an
optional unit letter (`p`/`s`/`d` for pair/set/dozen; missing means "use the line's own unit").
`app/wholesale/services/colors.py::color_qty_problem` is the validator: it returns `None` for a
valid string or a plain-English sentence explaining exactly what's wrong (e.g. `'"black10" needs
a unit — s for sets, p for pairs, d for dozens.'`). The same wording is ported into the
frontend's own client-side validator, checked against each other by
`backend/tests/test_wholesale_colors.py` and `backend/tests/fixtures/color_qty_cases.json`, so
a typo is never explained one way while typing and another way on submit. `color_qty_pairs`
sums a breakdown to a total pairs figure; `color_qty_pairs_by_color` breaks it out per colour
(casefolded, whitespace-collapsed) — this per-colour figure is what allocation and delivery
actually reserve/consume against, not just the line total.

## Money: everything stored in Kyat, foreign currency snapshotted once

Every money column (`buying_price` on a voucher line, `selling_price` on an order line, a
receiving cost's `amount`) is **always the Kyat amount**, computed server-side. A line entered
in a foreign currency additionally stores `original_amount`/`exchange_rate` — snapshotted once,
immutably, at save time (a database check constraint enforces MMK rows never carry these two
columns and non-MMK rows always do). `app/wholesale/services/currency.py::resolve_money` is the
one function every money-carrying builder routes through: it computes the Kyat amount from the
original+rate for a foreign currency and ignores any client-sent Kyat figure, so a stale
exchange rate typed on the client can never silently override the number the server trusts.
Editing an old foreign-currency line later doesn't reprice it — the snapshot stands — and a
later change to today's exchange rate only affects new lines, never old ones. Currently
supported: `MMK`, `THB`.

## Server-generated reference numbers

Every document type gets its own server-assigned reference: `SHP-YYMMDD-NNNN` (shipments),
`RCV-YYMMDD-NNNN` (receivings), `VCH-YYMMDD-NNNN` (supplier vouchers), `ORD-YYMMDD-NNNN`
(customer orders) — `app/wholesale/services/references.py`. The sequence resets daily and is
scoped per branch (two branches can both have `SHP-260827-0001` on the same day). Two
concurrent creates racing for the same number are handled by `retry_on_reference_collision`,
which catches the resulting unique-constraint `IntegrityError` and retries the whole
allocate-and-insert once rather than surfacing a 500.

## Two audit trails, for two different purposes

- **`wholesale_audit_logs`** (`app/wholesale/services/audit.py::record_audit_log`) — a general
  operational log: who did what to which entity, when, with a JSON payload. Written throughout
  the shipment/receiving/voucher services on create/edit/delete/split/payment actions.
- **`wholesale_write_offs`** — specifically the "expected vs. actual doesn't match, here's why"
  log, covering shipment/leg package losses, voucher-line losses, and order-line losses. See
  [Write-offs](./write-offs.md) — it's shared machinery used by three different screens, so it
  gets its own doc rather than being described three times.

Neither log is ever edited or deleted through the API; both are pure audit trails.

## State machines, not free-form status fields

Every entity's "status" (a shipment's `waiting_at_cargo`/`in_transit`/`partly_delivered`/
`completed`, an order's `waiting_for_stock`/`ready_to_deliver`/`partly_delivered`/`fulfilled`/
`cancelled`, a receiving's `recorded`/`checking`/`checked`/`issue`, a voucher's
`draft`/`in_transit`/`partly_received`/`received`/`settled`) is **computed on every read**, never
stored — see each screen's own doc for its exact rule. What *is* explicit is which actions are
currently allowed: `app/wholesale/services/lifecycle.py` defines an `ALLOWED_*_ACTIONS` table
per entity type, `get_allowed_*_actions(...)` returns the list the API exposes as
`allowed_actions` on every detail response, and `assert_can_perform_*_action(...)` is the guard
every write endpoint calls first — attempting a write the current state doesn't allow is a 409,
not a silently-ignored no-op.

## Access control

`app/wholesale/routers/common.py::require_wholesale` gates every wholesale router: it allows
`UserRole.WHOLESALE` and `UserRole.ADMIN` only, rejecting `retail`/`retail_management` — the
mirror image of `app/retail/routers/common.py::require_retail`, which allows
`admin`/`retail_management`/`retail` and rejects `wholesale`. Admin is the only role with both.
See [auth-and-accounts.md](../auth-and-accounts.md).

The same file's `paginate(rows, page, page_size, response)` is the shared pagination
convention nearly every wholesale list endpoint uses: filter/search an already-loaded Python
list, slice it to one page, and set `X-Total-Count` on the response so the frontend can render
page controls — not a database-level `LIMIT`/`OFFSET`.
