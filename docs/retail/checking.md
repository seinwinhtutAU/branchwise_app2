# Checking (physical stock audit)

**Status: built, but intentionally hidden from the nav.** `GET /api/checking`, `GET /api/checking/export`, `GET /api/checking/verify` (`app/retail/routers/checking.py`, `app/schemas/checking.py`) plus `frontend/renderer/src/components/features/retail/CheckingPage.tsx` are fully implemented and covered by `require_retail` the same as every other retail route. `App.tsx`'s `RETAIL_ROLE_NAV_ITEMS` leaves it out on purpose — the comment there says why: "Checking is implemented but intentionally hidden until the daily check workflow and its verified-inventory-import handoff are ready to be released." Today the only way to reach it is a "Checking" link the Dashboard page can call (`onViewChecking`); it has no entry in the left sidebar for any role. There is no dedicated backend test file for it yet (`backend/tests/test_checking.py` doesn't exist) — worth adding before this ships.

## Why this exists

The Warning page already tells staff *that* a product's stock figures look wrong (a missing inventory record, a reconciliation mismatch). It doesn't tell them *what to do about it* — someone still has to physically count that product on the shelf, correct the external inventory system, and re-export. Checking is that missing last step: a short, focused list of exactly which stock codes need a physical recount today, timed to when that recount can actually happen (after the shop has closed and the day's own sale/inventory files are already in, so the list reflects the day's real activity, not a half-finished one).

## Eligibility gating

The audit list only unlocks once **all** of these are true, checked by `_check_daily_import_status` (`app/retail/services/branch_health.py`) — the exact same helper that gates Business Alerts' Rule 8, "Daily import missing" (`daily_import_missing_rule` in `app/retail/services/early_warning.py`; see [business-alerts.md](./business-alerts.md)):

1. The clock is past the business-configurable daily cutoff time (`daily_check_cutoff_time` setting, default `20:00` — Settings → Data checks, same setting Rule 8 uses).
2. Today's Sale file has been imported for this branch.
3. Today's Inventory file has been imported for this branch.

Before all three are true, `GET /api/checking` returns `is_eligible: false`, an empty `items` list, and a plain-English `reason` string built from whichever of the three is still missing ("Audit sheet unlocks once it is after 8:00 PM (shop close) and today's POS sales file is imported and ..."). The frontend shows this as a locked-state banner with a badge per condition rather than the table.

## What's on the list

`build_checking_items` (`app/retail/services/data_quality.py`) is the actual source of the list, and it deliberately **reuses** the Warning page's own check machinery rather than computing anything new — it calls `build_warning_sections` scoped to a fixed subset, `CHECKING_SECTION_IDS = {"missing_product", "reconciliation_uom", "reconciliation_mismatch"}`. That subset is a deliberate choice: these three are the checks a person resolves by *physically finding and counting a product*, whereas the numeric-validation warnings (bad prices/quantities on sale, inventory, or purchase rows) need a source-file correction instead — counting a shelf can't fix a typo in an export. A product flagged by more than one of the three checks is only listed once (`items_by_code` de-dupes by `stock_code`), and each item carries its latest known `on_hand_qty` from the branch's newest `stock_levels` snapshot (`null` if the product has never been counted at all) so staff have a starting number to compare their physical count against.

## Endpoints

- **`GET /api/checking`** — the eligibility check above plus, when eligible, the `items` list (`stock_code`, `description`, `on_hand_qty`). Backs the page's table.
- **`GET /api/checking/export`** — a CSV download of the same list (`Stock Code, Description, System Qty, Actual Count (Physical)`, the last column left blank for staff to fill in by hand) — 400s with the same eligibility explanation if called before the list has unlocked. This is the sheet staff actually use on the floor.
- **`GET /api/checking/verify`** — run *after* a corrected inventory file has been re-imported, to confirm the fix actually worked: it re-computes the current checking list's stock codes and checks whether the branch's *latest* inventory snapshot now contains every one of them. Returns `success`, a plain-English `message`, and which codes (if any) are still `missing_stock_codes`. This is what closes the loop — without it, there'd be no way to tell "I re-imported" from "I re-imported and it actually fixed what was flagged."

All three resolve the branch the same way (`_resolve_retail_branch_id`): a branch-scoped account uses its own `users.branch_id`; an unscoped account (`admin`, `development`, or `retail_management`) falls back to the first retail branch found, since — unlike the Dashboard — Checking has no branch picker of its own yet.

## Frontend

`CheckingPage.tsx` — a single card: header + Refresh, a "Download Count Sheet (CSV)" button (only shown once eligible and non-empty), a "Verify Re-import" button (always available, shows a dismissible result banner), and an "Import Inventory" button that jumps straight to the Import tab (`onImportInventory`). Below that: a locked-state banner with the three eligibility badges when not yet eligible, an empty state ("All stock records reconciled") when eligible with nothing to check, and otherwise a plain table (Stock Code, Description, System Qty, and a "Count on shelf" placeholder column with no input — the actual count happens on the printed/exported sheet, not typed back into this screen).

## What would still be needed to un-hide this

Per the hiding comment in `App.tsx`, two things: the daily check workflow itself needs to be settled operationally (when exactly staff are expected to run it, on what cadence), and the "verified-inventory-import handoff" — right now `Verify Re-import` is a manual button staff have to remember to click; a released version likely wants this tied more directly into the Import confirm flow itself (e.g. surfaced automatically right after a same-day inventory re-import) rather than living as a separate step.
