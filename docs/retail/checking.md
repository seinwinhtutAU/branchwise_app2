# Checking (physical stock audit)

> **Update (2026-09-25):** the standalone Physical Stock Audit page below (`CheckingPage.tsx`, since deleted) was no longer routed from `App.tsx`, and the short-lived "Checking" tab on the Data Quality page has been removed again. The everyday recount list now lives in the **Physical stock audit** alert on Business Alerts: it lists the products to count, has an **Excel** download (with a blank Actual Count column) and a **Verify Recount** button that calls `GET /api/checking/verify`. The Dashboard's "Open Checking" link now just opens the Data Quality page. The backend endpoints are unchanged.


**Status: the backend is live; the standalone page has been deleted.** `GET /api/checking`, `GET /api/checking/export`, `GET /api/checking/verify` (`app/retail/routers/checking.py`, `app/schemas/checking.py`) are implemented and covered by `require_retail` like every other retail route. `CheckingPage.tsx` (deleted; it lived in `frontend/renderer/src/components/features/retail/`) was already unimported, and `App.tsx` has no nav item for it (its `"checking"` section id is only a leftover label). The working screen today is the **Physical stock audit** alert on Business Alerts. Note that the alert's list comes from `snapshot.checking_items` (the Warning checks, no after-cutoff lock), while `GET /api/checking` still applies the eligibility gate below. **Verify Recount** calls `/api/checking/verify`, which checks the branch `_resolve_retail_branch_id` picks (the account's own branch, or the first retail branch for an admin), not necessarily the branch of the alert that was clicked. There is no dedicated backend test file for the endpoints (`backend/tests/test_checking.py` doesn't exist).

## Why this exists

The Warning page already tells staff *that* a product's stock figures look wrong (a missing inventory record, a reconciliation mismatch). It doesn't tell them *what to do about it* — someone still has to physically count that product on the shelf, correct the external inventory system, and re-export. Checking is that missing last step: a short, focused list of exactly which stock codes need a physical recount today, timed to when that recount can actually happen (after the shop has closed and the day's own sale/inventory files are already in, so the list reflects the day's real activity, not a half-finished one).

## Eligibility gating

The audit list only unlocks once **all** of these are true, checked by `_check_daily_import_status` (`app/retail/services/branch_health.py`). This is the audit's own helper: Business Alerts' "Daily import missing" alert no longer shares it — that alert checks *yesterday's* files (`_check_yesterday_import_status`) at any hour, while the audit needs *today's* files and the shop-close time (see [business-alerts.md](./business-alerts.md)):

1. The clock is past the business-configurable daily cutoff time (`daily_check_cutoff_time` setting, default `20:00` — Settings → Data checks; now used only by this audit).
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

What the deleted `CheckingPage.tsx` looked like — a single card: header + Refresh, a "Download Count Sheet (CSV)" button (only shown once eligible and non-empty), a "Verify Re-import" button (always available, shows a dismissible result banner), and an "Import Inventory" button that jumps straight to the Import tab (`onImportInventory`). Below that: a locked-state banner with the three eligibility badges when not yet eligible, an empty state ("All stock records reconciled") when eligible with nothing to check, and otherwise a plain table (Stock Code, Description, System Qty, and a "Count on shelf" placeholder column with no input — the actual count happens on the printed/exported sheet, not typed back into this screen).

## Why the standalone page was retired

The daily-check workflow ended up living inside Business Alerts: the alert carries the list, an Excel copy with a blank count column, and a Verify Recount button, so a separate page and its after-cutoff lock were no longer needed. Still open: `Verify Recount` is a manual button, and a later version may tie it directly into the Import confirm flow (for example, surfacing it right after a same-day inventory re-import).
