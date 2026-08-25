from typing import Literal

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.core.security import CurrentUser, get_current_user
from app.db.session import get_db
from app.services.branches import list_retail_branches, list_wholesale_branches

router = APIRouter(prefix="/api/branches", tags=["branches"])


@router.get("")
def list_branches(
    kind: Literal["retail", "wholesale"] = "retail",
    user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> list[dict]:
    branches = list_wholesale_branches(db) if kind == "wholesale" else list_retail_branches(db)
    return [{"id": b.id, "name": b.name} for b in branches.all()]
