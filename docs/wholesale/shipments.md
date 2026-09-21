# Shipments (Delivery screen)

A shipment is one supplier voucher travelling as freight: a cargo company picks up some
number of packages, carries them through zero or more intermediate stops (each a "leg"), and
they finally arrive at a receiving gate. See [README.md](./README.md) for the shared
quantity/colour/money/reference conventions this screen uses.

## Models

**`Shipment`** (table `wholesale_shipments`, `app/wholesale/models/entities.py`): `id`,
`branch_id`, `shipment_no` (server-assigned `SHP-YYMMDD-NNNN`, unique per branch),
`voucher_no` (the supplier voucher this carries — a plain string, matched by human reference
only, no FK, since Supplier Vouchers didn't exist yet when Delivery was built), `supplier_name`,
`cargo_name` (the carrier), `final_location` (the receiving gate's short address — gate and
warehouse are treated as one place), `sent_date`, `total_packages`, `total_pairs` (always
stored in pairs), `total_unit` (`WholesaleUnit` — display only, the unit it was written in),
`packages_sent_by_cargo`, `final_received_packages` (a stored fallback — see below),
`lost_packages` (a running total, explained by `WholesaleWriteOff` rows), `split_from_shipment_id`
(nullable self-FK, `SET NULL` on delete, set when this shipment was carved out of another via a
split), `version_id` (optimistic locking).

**`ShipmentLeg`** (table `wholesale_shipment_legs`, cascade-deleted with its shipment): `id`,
`shipment_id`, `leg_order` (1..N, no gaps, rewritten on every add/remove), `stop_name`,
`carrier_name`, `packages_received`, `packages_sent`, `lost_packages`.

## The "can't send more than a stop received" rule

`app/wholesale/services/shipments.py`:

- `max_for_leg(shipment, index)` — the most a stop could ever have received: for leg 0 that's
  `packages_sent_by_cargo`; for a later leg it's the *previous* leg's `packages_sent`.
- `leg_remaining(shipment, index) = max(0, max_for_leg(...) - leg.packages_sent - leg.lost_packages)`
  — deliberately measured against what was **sent to** the stop, not what it happened to
  receive: if cargo sends 10 but only 7 arrive and the stop forwards all 7, the stop still
  "owes" 3 — the missing 3 are attributed to the leg *before* it, not silently absorbed into
  this one.
- `cargo_remaining(shipment) = max(0, total_packages - packages_sent_by_cargo)`.
- `final_remaining(shipment, final_received) = max(0, total_packages - final_received - total_lost)`,
  where `total_lost` sums the shipment's own `lost_packages` plus every leg's `lost_packages`.

**`normalise_flow(total_packages, packages_sent_by_cargo, legs, final_received_packages)`** is
the actual enforcement, run on every create/update: it walks the chain start to end —
`available = min(packages_sent_by_cargo, total_packages)`; for each leg in order,
`received = min(leg.packages_received, available)`, `sent = min(leg.packages_sent, received)`,
then `available = sent` for the next leg; finally `final_received` is clamped to
`min(final_received_packages, available)`. This makes an impossible route unrepresentable — it
clamps rather than rejects, so lowering an earlier figure (or removing a leg) after the fact
re-settles everything downstream instead of leaving a stale, now-impossible number sitting in
the database.

## Stored vs. computed

Stored: `total_packages`, `packages_sent_by_cargo`, `final_received_packages` (fallback only),
`lost_packages`, and each leg's `packages_received`/`packages_sent`/`lost_packages`. Everything
else is computed on read (`shipment_derived` in `shipments.py`):

- **`shipment_status(shipment, final_received)`** — `"waiting_at_cargo"` if
  `packages_sent_by_cargo <= 0`; `"completed"` if `accounted >= total_packages` (`accounted` =
  `final_received` + the shipment's own `lost_packages` + every leg's `lost_packages`);
  `"partly_delivered"` if `final_received > 0`; otherwise `"in_transit"`.
- **`destination_count(shipment) = len(legs) + 2`** — the cargo company, each leg, and the
  final gate. The supplier is excluded: it's where the goods start, not somewhere they're
  delivered to.
- **`arrived_pct(shipment, final_received) = share_pct(final_received, total_packages)`** — a
  safe-percentage helper (0 if the whole is ≤0, otherwise rounded and capped at 100).

**`final_received_packages` override**: once a `Receiving` exists for a shipment, the API
prefers the *actual count of package rows recorded at the gate* (opened or not — see
[Receiving](./receiving.md)'s `final_received_by_shipment`) over the shipment's own stored
column. A shipment with no receiving yet keeps its own stored figure — the same fallback rule
the frontend follows when settling a shipment's numbers.

## What's allowed when (`app/wholesale/services/lifecycle.py`)

`ShipmentAction` = `EDIT`, `SPLIT`, `DELETE`, `WRITE_OFF`, `RECEIVE`. All four non-completed
statuses allow `EDIT`/`SPLIT`/`DELETE` (`waiting_at_cargo` additionally disallows `WRITE_OFF`,
since nothing has moved yet to have gone wrong). `completed` allows nothing. On top of that
table: **once a `Receiving` exists against the shipment, `DELETE` and `SPLIT` are always
forbidden**, regardless of status (409) — the receiving is the authoritative count from here on,
and deleting or splitting the shipment underneath it would orphan that count. `SPLIT` is also
withdrawn from the advertised `allowed_actions` list if there's nothing physically undispatched
anywhere on the route (`cargo_remaining <= 0` and no leg has spare `received - sent - lost`) —
there'd be nothing left to carve out.

## Split shipment

`POST /api/wholesale/shipments/{id}/split` (`shipments_service.py::split_shipment`, behind
`SplitShipmentPage.tsx`) carves `packages` (and optionally `quantity_pairs`) out of a shipment's
still-**undispatched** remainder into a brand-new `Shipment`. Two modes, chosen by
`split_leg_order` (1-based; omitted means the cargo stage):

- **Cargo-stage split**: available = `cargo_remaining(original)`. The new shipment starts fresh
  — `packages_sent_by_cargo = 0`, no travelled legs — unless an intermediate `destination` is
  given, which becomes leg 1 of the new shipment.
- **Leg-stage split**: available = `leg.packages_received - leg.packages_sent - leg.lost_packages`
  at that stop. The new shipment **inherits every stop up to and including the split point**,
  each copied across at the split `packages` count, so its route history still shows where it's
  actually been; the same amount is subtracted from the original's matching stops and from its
  `packages_sent_by_cargo`.

`packages` must be `> 0` and `<= available` (422 otherwise, naming the exact stage and count
still there). `quantity_pairs`, if left unset, is proportionally allocated:
`round(total_quantity_pairs * (packages / total_packages))`, capped at the original's total. An
optional `destination` distinct from the split stop and the final destination is appended as a
new leg on the new shipment's route. The new shipment's `SHP-...` reference is allocated the
same way any other creation is (see [README.md](./README.md#server-generated-reference-numbers)),
and both shipments are written in one transaction so their totals can never drift apart.
Guarded by `assert_can_perform_shipment_action(original, SPLIT, ...)` — blocked if the original
is `completed` or already has a receiving.

`SplitShipmentPage.tsx` renders the shipment's real journey as clickable stage cards
(`buildStages`), lets the user pick any stage with `available > 0` packages, and shows a live
"branch" preview (new-shipment card → final-gate card) growing out of the selected stage as
packages/quantity/destination/gate/carrier are typed — capping the packages input at that
stage's physically-available count client-side, mirroring the server's own clamp.

## Write-offs (losses and recounts)

`POST /api/wholesale/shipments/{id}/write-off` records either a loss (lost in transit / damaged
/ short-shipped / other — increments `lost_packages` on the shipment or a specific leg) or a
recount correction (`repackaged` — overwrites the actual `packages_received`/`packages_sent`,
or `total_packages`, in place). See [Write-offs](./write-offs.md) for the full mechanics; this
is the same machinery Supplier Vouchers and Customer Orders use.

## Endpoints

All under `/api/wholesale/shipments`, gated by `require_wholesale` (see
[README.md](./README.md#access-control)):

- **`GET ""`** — list. Query params: `search` (matches `shipment_no`/`voucher_no`/
  `supplier_name`/`carrier_name`/any leg's `stop_name`, case-insensitive substring),
  `shipment_status` (exact match against the derived status), `page`/`page_size` (paginated,
  `X-Total-Count` header). Branch-scoped to `user.branch_id` unless admin (no branch → every
  branch).
- **`GET "/{shipment_id}"`** — single shipment, fully rendered.
- **`POST ""`** (201) — create (`ShipmentCreate`). `branch_id` is only honored for a branch-less
  (admin) account.
- **`PATCH "/{shipment_id}"`** — partial update (`ShipmentUpdate`, all fields optional). A
  present `legs` array replaces the whole leg set and re-runs `normalise_flow`. Requires `EDIT`
  to currently be allowed.
- **`POST "/{shipment_id}/write-off"`** (201) — body `{quantity, reason, note, leg_id?}`.
- **`POST "/{shipment_id}/split"`** (201) — returns `{original, new_shipment}`, both fully
  rendered.
- **`DELETE "/{shipment_id}"`** (204).

## Frontend

`frontend/renderer/src/components/features/wholesale/delivery/`:

- **`DeliveryPage.tsx`** — top-level screen; owns list/detail/new/split view state, fetches via
  `useQuery`, hydrates the shared `store.ts` cache, and dispatches every write to
  `shipmentsApi.ts`.
- **`ShipmentList.tsx`** — the searchable/filterable table.
- **`ShipmentDetail.tsx`** — the tracking view for one shipment (the largest file in this
  folder), including the tab that switches into `SplitShipmentPage`.
- **`NewShipmentForm.tsx`** — the create form.
- **`DestinationForm.tsx`** — the small strip for adding/renaming a leg destination, with
  suggestions drawn from prior stop names.
- **`ShipmentBadges.tsx`** — the status pill and row action menu (respects `allowed_actions`;
  delete asks for confirmation twice).
- **`SplitShipmentPage.tsx`** — the split UX described above.
- **`shipments.ts`** — pure client-side mirrors of the derived-figure functions
  (`cargoRemaining`, `legRemaining`, `maxForLeg`, `shipmentPairs`, `finalRemaining`) for instant
  feedback while typing; the server's `services/shipments.py` remains authoritative.
- **`shipmentsApi.ts`** — the wire layer (`shipmentFromWire`, `createShipment`,
  `updateShipment`, `deleteShipment`, `writeOffShipment`, `splitShipment`).

### The shared journey visualization

`wholesale/shared/journey.tsx` + `journeyVisuals.tsx` hold one drawing — a horizontal row of
colour-coded stage cards (`JourneyCard`/`JourneyArrow`/`JourneyRow`, themed via
`--color-journey-{supplier,cargo,stop,final}` CSS variables) — reused by Delivery, Receiving,
and Supplier Vouchers rather than three separate implementations. `DeliveryJourney` is the
canonical builder: given a `Shipment` plus optional `Receiving[]`, it renders supplier → cargo →
each leg → final-received, with `before`/`after` slots so Vouchers can prepend a "Voucher
taken" card and Customer Orders can bracket it with "Order created"/"Delivered to customer"
cards — one drawing, so three views of the same goods moving can't drift apart from each other.
