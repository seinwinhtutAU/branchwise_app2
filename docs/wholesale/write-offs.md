# Write-offs

The shared mechanism for closing an "expected vs. actual" quantity gap with a permanent,
recorded explanation — used by [Shipments](./shipments.md), [Supplier
Vouchers](./supplier-vouchers.md), and [Customer Orders](./customer-orders.md). Not mentioned
in `CLAUDE.md`'s wholesale section; documented here in full since it's genuinely shared
machinery rather than one screen's own feature.

## Model

**`WholesaleWriteOff`** (table `wholesale_write_offs`) — **polymorphic and append-only**: there
are no update or delete endpoints for it at all, only creation. It's a pure audit log of loss
explanations, not an editable record. Fields: `id`, `branch_id`, `subject_type` (`"shipment"` /
`"shipment_leg"` / `"voucher_line"` / `"order_line"`), `subject_id`, `reference` (a denormalised
human reference — the shipment_no/voucher_no/order_no), `description` (denormalised label — a
leg's stop_name, or a line's product description), `stock_code` (denormalised; for a
shipment-level write-off this is actually the `voucher_no`, a deliberate reuse of the column
rather than a new one), `quantity`, `unit`, `unit_conversions` (JSON snapshot),
`reason` (`WholesaleWriteOffReason`: `lost_in_transit`, `damaged`, `short_shipped`, `other`,
`repackaged`), `note`, `recorded_by_user_id`, `created_at`. Indexed on `(subject_type,
subject_id)` and `(branch_id, created_at)`.

## What triggers it, and what it writes (`app/wholesale/services/write_offs.py`)

- **`write_off_shipment(db, shipment_id, leg_id_or_none, quantity, reason, note, user_id, branch_id)`**
  — two sub-modes:
  - **Loss reasons** (`lost_in_transit`/`damaged`/`short_shipped`/`other`): `quantity` must be
    `> 0` and `<=` whatever's still remaining at that point (a leg: `max_for_leg - packages_sent
    - lost_packages`; the shipment overall: `final_remaining(shipment, received)`), else 422.
    Increments `leg.lost_packages` or `shipment.lost_packages` by `quantity` — this is exactly
    what feeds [Shipments](./shipments.md#stored-vs-computed)' `final_remaining`/
    `shipment_status` math. Guarded by `assert_can_perform_shipment_action(shipment,
    WRITE_OFF, ...)` — blocked on a `completed` shipment.
  - **`repackaged`** (a recount correction, shipment/leg only — rejected for voucher/order
    lines via `_loss_reason`): `quantity` can be `>= 0` (this mode bypasses the positive-only
    check). It **overwrites the actual count in place** — for a leg, both `packages_received`
    and `packages_sent` are set to `quantity`; for the shipment overall, `total_packages` is
    overwritten. The write-off's note is auto-prefixed with `"Recounted: {previous} →
    {current} packages"` (`_repackaged_note`). This is also the mechanism
    `shipments_service.update_shipment` uses when re-applying a route edit: it looks up the
    most recent `repackaged` write-off per leg (by `subject_id`) and re-applies that corrected
    count *after* `normalise_flow` runs, so a recount survives an unrelated later route edit
    instead of being silently overwritten by it.
- **`write_off_voucher_line(db, voucher_line_id, quantity, reason, note, user_id, branch_id)`** —
  `quantity` must be positive and `<= remaining` (`line.wanted_pairs - received - already_lost`,
  where `received` comes from `received_pairs_by_voucher_stock`). Increments
  `line.lost_quantity_pairs`.
- **`write_off_order_line(db, order_line_id, quantity, reason, note, user_id, branch_id)`** —
  same pattern against a `CustomerOrderLine`, using `delivered_pairs_by_order` as the
  "already accounted for" figure; also blocks (422) writing off a line on a cancelled order.

All three lock the target row with `with_for_update()` before checking the remaining quantity —
race-safety on the outstanding balance if two requests land at once — then call the shared
`_write_off()` builder, which just constructs and commits the `WholesaleWriteOff` row.

## Endpoints

- **`POST /api/wholesale/shipments/{shipment_id}/write-off`** — body `{quantity, reason, note,
  leg_id?}`.
- **`POST /api/wholesale/supplier-vouchers/lines/{line_id}/write-off`** — body `{quantity,
  reason, note}` (`reason` can't be `repackaged` here).
- **`POST /api/wholesale/orders/lines/{line_id}/write-off`** — same shape, against an order
  line.
- **`GET /api/wholesale/write-offs`** — the flat, branch-scoped audit listing. `search`
  (matches `reference`/`description`/`stock_code`/`reason`/`note`), `page`/`page_size`.

## Frontend

`WriteOffModal.tsx` (`wholesale/shared/`) — one shared modal used from Delivery, Vouchers, and
Orders, titled "Explain mismatch": *"Explain why the qty for {subject} does not match. This
stays visible in the audit trail."* Reason dropdown from the loss reasons above, plus — only
when the caller passes `allowRepackaged` (shipments only) — a "Repackaged / recounted" option.
The quantity field behaves differently per mode: for a loss reason it's capped at `remaining`
and must be `> 0`; for `repackaged` it defaults to the current count and can be `0` or more (no
client-side upper cap — the field relabels itself to "Current count" instead of "Qty"). An
optional free-text note. Submission just calls the caller-supplied `onSubmit(quantity, reason,
note)`, which each screen wires to its own `write_off_*` endpoint above.
