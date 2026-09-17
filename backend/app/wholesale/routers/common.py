"""Shared guard and pagination helper for the wholesale routers.

Every wholesale router needs the same "is this account allowed in the wholesale
workspace at all" check, and most list endpoints filter/search an already-loaded list of
rows in Python and then apply the same page/page_size/X-Total-Count convention. Both used
to be copy-pasted into each wholesale_*.py router; this is the one place that behaviour
now lives.
"""

from fastapi import HTTPException, Response, status

from app.models.user import User, UserRole


def require_wholesale(user: User) -> None:
    if user.role not in (UserRole.WHOLESALE, UserRole.ADMIN):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "This account cannot use the wholesale workspace")


def paginate(rows: list, page: int, page_size: int, response: Response) -> list:
    """Slices an already-filtered, in-memory list of rows to one page, and reports the
    pre-slice count via X-Total-Count so the client can render pagination controls."""
    response.headers["X-Total-Count"] = str(len(rows))
    start = (page - 1) * page_size
    return rows[start : start + page_size]
