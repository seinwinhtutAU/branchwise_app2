from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.core.security import CurrentUser, get_current_user
from app.db.session import get_db
from app.services.branches import list_retail_branches

router = APIRouter(prefix="/api/branches", tags=["branches"])


@router.get("")
def list_branches(
    user: CurrentUser = Depends(get_current_user), db: Session = Depends(get_db)
) -> list[dict]:
    return [{"id": b.id, "name": b.name} for b in list_retail_branches(db).all()]
