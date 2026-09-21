# Supplier Vouchers

The commercial document behind a shipment: what was actually ordered from a supplier, at what
price, in what quantities — the thing a [Shipment](./shipments.md) carries and a
[Receiving](./receiving.md) fulfills.

## Models (`app/wholesale/models/entities.py`)

**`SupplierVoucher`** (table `wholesale_supplier_vouchers`): `id`, `branch_id`, `voucher_no`
(`VCH-YYMMDD-NNNN`), `supplier_name`, `voucher_date`, `cargo_name` (carrier), `total_packages`,
`version_id`. Totals, received quantity, and payment status are deliberately **never stored** —
computed fresh from lines/receivings/payments on every read.

**`SupplierVoucherLine`** (table `wholesale_supplier_voucher_lines`, cascade): `id`,
`voucher_id`, `stock_code`, `description`, `product_group`, `color_qty` (colour breakdown),
`colors` (JSON cache), `unit`, `unit_conversions`, `wanted_pairs` (quantity, always pairs),
`lost_quantity_pairs`, `buying_price` (always Kyat), `currency_code`, `original_buying_price`/
`exchange_rate` (nullable, currency-constrained the same way a receiving cost is).

**`WholesalePayment`** (table `wholesale_payments`) — shared with Customer Orders: `id`,
`branch_id`, `voucher_id` **or** `order_id` (exactly one set), `paid_on`, `amount`,
`paid_quantity_pairs` (nullable — only meaningful on a customer payment), `note`,
`recorded_by_user_id`.

## Received quantity is computed from Receiving, matched by voucher number

`supplier_vouchers_service.py`'s `received_pairs_by_voucher_no` and
`received_pairs_by_voucher_stock` both join `Receiving → ReceivingPackage → ReceivingItem`,
filtering to **opened** packages only, and sum `ReceivingItem.qty_pairs` grouped by
`Receiving.voucher_no` (and, for the per-stock version, also by `ReceivingItem.stock_code`).
This is the *only* source for "how much of this voucher has arrived" — matched by the plain
`voucher_no` string, not a real foreign key, since a receiving item records a stock code and a
quantity but never which voucher *line* it's satisfying. The response builder (`_out()`) then
walks each line, taking `min(remaining_by_stock[stock_code], line.wanted_pairs)` from a running
pool as it goes.

This string-matching, plus the fact that a receiving item can't say which line it belongs to,
is exactly why **duplicate stock codes on one voucher are rejected** —
`_check_no_duplicate_stock_codes` raises 422 ("Each stock code can only appear on one line per
voucher"): extra quantity for a stock code already on the voucher has to go onto the existing
line, not a second one, or there'd be no way to know which line a later receiving satisfies.

## Colour validation and pricing

Every line's colour breakdown is checked with
[`color_qty_problem`](./README.md#colours-one-shorthand-validated-identically-on-both-ends)
before save; `wanted_pairs` is computed server-side from that text, never typed as a separate
total. `buying_price` is resolved through
[`resolve_money`](./README.md#money-everything-stored-in-kyat-foreign-currency-snapshotted-once)
exactly like a receiving cost.

## Supplier balance

`app/wholesale/services/money.py::voucher_totals(voucher)`:

```
total        = Σ priced_amount(line.wanted_pairs, line.unit, line.buying_price, line.unit_conversions)
paid         = Σ payment.amount
balance_due  = total - paid
```

## Status (computed, never stored)

`lifecycle.py::voucher_status`, in order: **`draft`** (nothing received, no shipments yet) →
**`in_transit`** (has shipments, nothing received) → **`partly_received`** (`accounted =
received + lost` is `> 0` but `< total`) → **`received`** (`accounted >= total` but
`balance_due > 0`) → **`settled`** (`accounted >= total` and `balance_due <= 0`).

## What's allowed when

`VoucherAction` = `EDIT`, `ADD_PAYMENT`, `DELETE_PAYMENT`, `WRITE_OFF`, `DELETE`. Only `settled`
restricts to `WRITE_OFF` alone. `DELETE` is additionally always blocked (409, naming which) if
the voucher already has shipments, gate receivings, or payments recorded — there's no undoing a
voucher that real activity has already happened against.

**Editing lines is guarded against reducing quantity below what's already received**:
`update_voucher` checks, per stock code, that `new_quantity >= already_received_pairs`, else 422
naming the exact shortfall — a line can't retroactively claim less was ordered than has
physically already shown up.

## Endpoints

All under `/api/wholesale/supplier-vouchers`:

- **`GET ""`** — `search` (`voucher_no`/`supplier_name`/`carrier_name`/line `stock_code`/
  `description`), `payment_status` (`paid`/`partial`/`unpaid`, derived from `balance_due`/
  `paid_amount`), `page`/`page_size`.
- **`POST ""`** (201) — body `SupplierVoucherIn` (`supplier_name`, `voucher_date`,
  `carrier_name`, `total_packages`, `lines: list[VoucherLineIn]`, minimum 1 line).
- **`PUT "/{voucher_id}"`** — full replace, same shape as create.
- **`DELETE "/{voucher_id}"`** (204).
- **`POST "/{voucher_id}/payments"`** (201) — `{paid_on, amount, note}`; rejects (422) if
  `paid + amount > total`.
- **`DELETE "/{voucher_id}/payments/{payment_id}"`** (204).
- **`POST "/lines/{line_id}/write-off"`** (201) — `{quantity, reason, note}`; `reason` can't be
  `repackaged` here (that's shipment/leg-only — see [Write-offs](./write-offs.md)).

Response (`_out`) per line includes `received_quantity_pairs`, `lost_quantity_pairs`,
`remaining_quantity_pairs = max(0, wanted - received - lost)`; voucher-level `total_amount`/
`paid_amount`/`balance_due`/`status`/`allowed_actions`.

## Migration

`c3a7d9e2f641_add_wholesale_supplier_vouchers.py` creates vouchers, their colour-validated
lines, and supplier payments.

## Frontend

`frontend/renderer/src/components/features/wholesale/vouchers/`:

- **`SupplierVouchersPage.tsx`** — top-level screen.
- **`VoucherList.tsx`** — searchable/filterable table.
- **`VoucherDetail.tsx`** — the full voucher view: lines, received/lost quantities, payments,
  journey (the largest file here).
- **`NewVoucherForm.tsx`** — the create form, including per-line colour/unit/price entry.
- **`VoucherJourneyView.tsx`** — `WaitingList`/`VoucherJourney`, the same shared journey
  visualization [Shipments](./shipments.md#the-shared-journey-visualization) uses, anchored to
  a voucher rather than a shipment and prepending a "Voucher taken" lead-in card.
- **`VoucherBadges.tsx`** — `ReceivingBadge`, `PaymentBadge`, a received-vs-total progress bar,
  `RowMenu`.
- **`ToOrderView.tsx`** — the "which customer orders drove this voucher / what still needs
  ordering" cross-reference view.
- **`voucherOrderUtils.ts`**, **`supplierVouchers.ts`**, **`supplierVouchersApi.ts`** — client
  derived-figure mirrors and the wire layer.
