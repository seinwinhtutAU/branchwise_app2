"""A small in-process cache for the few read endpoints expensive enough to be worth
not recomputing on every request (Branch Health's Overview, Warnings).

This process is the only one serving requests — see backend/Dockerfile's CMD, which
starts a single `uvicorn` process with no `--workers` — so a plain dict is enough.
There is no second process with its own memory to keep in sync, which is the actual
problem a shared cache like Redis solves and this deployment doesn't have. If that ever
changes (multiple workers or instances), this module stops being correct and needs
replacing with something external; until then it would be solving a problem the app
doesn't have.

Correctness does not rely on a timer. Each cache key includes a cheap "data version"
(`import_data_version` below) computed fresh on every call — the same aggregate already
used by GET /api/imports/data-version to tell the frontend when to refetch, just scoped
to whichever branch (or "all branches", for an admin) the caller is actually asking
about. A confirmed import or a revert changes that number, so the next request for that
branch naturally misses instead of serving stale figures — nothing has to remember to
explicitly clear this cache from every place that writes sale/inventory/purchase data.

Two things that number does *not* cover, so callers still have to account for them in
their own cache key: the wall-clock date (a "today" or "last 30 days" window silently
means something different once the calendar rolls over, even with no new import — see
build_snapshot's own note that the Inventory dimension always reflects today's shelf
regardless of the period requested) and admin-tunable settings like the Branch Health
weights, which don't carry their own version — `clear()` is called directly from the
settings-write endpoint instead, since settings changes are rare and admin-only, a full
clear costs nothing.

Two requests racing to compute the same missing key can both miss and both compute —
wasted work, never wrong data, and not worth a lock for the traffic this app sees.
"""

import time
from typing import Callable, TypeVar

from sqlalchemy import func
from sqlalchemy.orm import Session

from app.retail.models.import_batch import ImportBatch

T = TypeVar("T")

# A backstop against a change this cache's version key turns out not to cover, not the
# mechanism it depends on for everyday correctness.
_TTL_SECONDS = 10 * 60
# Bounds worst-case memory if many distinct (branch, period, day) combinations get
# requested without ever being read again to let the TTL check evict them. Cleared
# wholesale rather than evicting the single oldest entry — simpler, and at this app's
# traffic the cap is not expected to be hit in practice.
_MAX_ENTRIES = 500

_store: dict[tuple, tuple[float, object]] = {}


def import_data_version(db: Session, branch_id: str | None) -> str:
    """Same aggregate as GET /api/imports/data-version, scoped to whichever branch is
    being looked at rather than the caller's own — this is what changes when *that*
    branch's imported data changes, regardless of who is asking. `branch_id=None` means
    unscoped (an admin's business-wide view), matching that endpoint's own convention."""
    query = db.query(
        func.max(ImportBatch.created_at),
        func.max(ImportBatch.reverted_at),
        func.count(ImportBatch.id),
    )
    if branch_id is not None:
        query = query.filter(ImportBatch.branch_id == branch_id)
    created_at, reverted_at, batch_count = query.one()
    return f"{created_at or ''}|{reverted_at or ''}|{batch_count}"


def cached(key: tuple, compute: Callable[[], T]) -> T:
    """Returns the cached value for `key` if present and still within the TTL backstop,
    otherwise computes it, stores it, and returns it."""
    now = time.monotonic()
    hit = _store.get(key)
    if hit is not None and now - hit[0] < _TTL_SECONDS:
        return hit[1]  # type: ignore[return-value]
    value = compute()
    if len(_store) >= _MAX_ENTRIES:
        _store.clear()
    _store[key] = (now, value)
    return value


def clear() -> None:
    """Called after a business-wide setting changes (nothing in the cache key tracks
    that), and by tests — production correctness never otherwise depends on this."""
    _store.clear()
