from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from sqlalchemy.orm import Session

from app.core.security import get_current_app_user
from app.db.session import get_db
from app.models.user import User, UserRole
from app.services.wholesale.write_offs import list_write_offs, write_off_to_dict

router = APIRouter(prefix="/api/wholesale", tags=["wholesale"])


def _require_wholesale(user: User) -> None:
    if user.role not in (UserRole.WHOLESALE, UserRole.ADMIN):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "This account cannot use the wholesale workspace")


@router.get("/write-offs")
def list_wholesale_write_offs(
    search: Annotated[str, Query(max_length=100)] = "",
    page: Annotated[int, Query(ge=1)] = 1,
    page_size: Annotated[int, Query(ge=1, le=100)] = 100,
    user: User = Depends(get_current_app_user),
    db: Session = Depends(get_db),
    response: Response = None,
) -> list[dict]:
    _require_wholesale(user)
    entries = list_write_offs(db, user.branch_id, search)
    response.headers["X-Total-Count"] = str(len(entries))
    start = (page - 1) * page_size
    return [write_off_to_dict(entry) for entry in entries[start : start + page_size]]
