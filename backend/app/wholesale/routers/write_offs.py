from typing import Annotated

from fastapi import APIRouter, Depends, Query, Response
from sqlalchemy.orm import Session

from app.core.security import get_current_app_user
from app.db.session import get_db
from app.models.user import User
from app.wholesale.services.write_offs import list_write_offs, write_off_to_dict
from app.wholesale.routers.common import paginate, require_wholesale

router = APIRouter(prefix="/api/wholesale", tags=["wholesale"])


@router.get("/write-offs")
def list_wholesale_write_offs(
    search: Annotated[str, Query(max_length=100)] = "",
    page: Annotated[int, Query(ge=1)] = 1,
    page_size: Annotated[int, Query(ge=1, le=100)] = 100,
    user: User = Depends(get_current_app_user),
    db: Session = Depends(get_db),
    response: Response = None,
) -> list[dict]:
    require_wholesale(user)
    entries = paginate(list_write_offs(db, user.branch_id, search), page, page_size, response)
    return [write_off_to_dict(entry) for entry in entries]
