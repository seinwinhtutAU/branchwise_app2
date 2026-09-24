"""Shared guard and pagination helper for the wholesale routers.

Every wholesale router needs the same "is this account allowed in the wholesale
workspace at all" check, and most list endpoints filter/search an already-loaded list of
rows in Python and then apply the same page/page_size/X-Total-Count convention. Both used
to be copy-pasted into each wholesale_*.py router; this is the one place that behaviour
now lives.
"""

import re
from datetime import date
from types import SimpleNamespace

from fastapi import HTTPException, Response, status

from app.models.user import User, UserRole
from app.services import dashboard as dashboard_service


def require_wholesale(user: User) -> None:
    if user.role not in (UserRole.WHOLESALE, UserRole.DEVELOPMENT, UserRole.ADMIN):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "This account cannot use the wholesale workspace")


def paginate(rows: list, page: int, page_size: int, response: Response) -> list:
    """Slices an already-filtered, in-memory list of rows to one page, and reports the
    pre-slice count via X-Total-Count so the client can render pagination controls."""
    response.headers["X-Total-Count"] = str(len(rows))
    start = (page - 1) * page_size
    return rows[start : start + page_size]


_MONTH_RE = re.compile(r"^\d{4}-(0[1-9]|1[0-2])$")


def resolve_window(
    period: str, date_from: date | None, date_to: date | None, month: str | None = None
) -> SimpleNamespace:
    """The date window a wholesale Dashboard request means, with the window right before
    it for comparison: a preset (`today`, `yesterday`, `7d`, `30d`), a calendar `month`
    (`period=monthly`), or a custom `date_from`/`date_to` pair (which wins). Shared by the
    Revenue, Customer and Summary views so all of them read the period the same way."""
    if month is not None and not _MONTH_RE.match(month):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "month must be YYYY-MM")
    if (date_from is None) != (date_to is None):
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST, "date_from and date_to must be provided together"
        )
    if period not in dashboard_service.VALID_PERIODS:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            f"period must be one of {sorted(dashboard_service.VALID_PERIODS)}",
        )
    try:
        resolved = dashboard_service.resolve_period(
            period, date_from=date_from, date_to=date_to, month=month
        )
    except ValueError as exc:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, str(exc)) from exc
    # PeriodRange is a pure date-maths value object shared with the retail dashboard; keep
    # the selected preset beside it for the response without changing that shared type.
    return SimpleNamespace(
        start=resolved.start,
        end=resolved.end,
        previous_start=resolved.previous_start,
        previous_end=resolved.previous_end,
        period="custom" if date_from is not None else period,
    )
