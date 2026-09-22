from datetime import date

from fastapi import APIRouter, Body, Depends
from sqlalchemy.orm import Session

from app.core.security import get_current_app_user
from app.db.session import get_db
from app.models.user import User
from app.retail.routers.common import require_retail, require_retail_management
from app.retail.services.import_completeness import (
    build_import_completeness,
    close_missing_day,
    reopen_missing_day,
)

router = APIRouter(prefix="/api/imports", tags=["imports"], dependencies=[Depends(require_retail)])


@router.get("/completeness")
def get_import_completeness(
    user: User = Depends(get_current_app_user), db: Session = Depends(get_db)
) -> dict:
    return build_import_completeness(db, user)


@router.post("/completeness/close", dependencies=[Depends(require_retail_management)])
def post_close_missing_day(
    branch_id: str = Body(...),
    import_type: str = Body(...),
    closure_date: date = Body(...),
    note: str | None = Body(None),
    user: User = Depends(get_current_app_user),
    db: Session = Depends(get_db),
) -> dict:
    """Confirms a missing day was a genuine branch closure, not a forgotten import."""
    close_missing_day(db, branch_id, import_type, closure_date, note, user)
    return {"ok": True}


@router.post("/completeness/reopen", dependencies=[Depends(require_retail_management)])
def post_reopen_missing_day(
    branch_id: str = Body(...),
    import_type: str = Body(...),
    closure_date: date = Body(...),
    user: User = Depends(get_current_app_user),
    db: Session = Depends(get_db),
) -> dict:
    """Undoes a mistaken "closed" mark — the day goes back to needing a look."""
    reopen_missing_day(db, branch_id, import_type, closure_date, user)
    return {"ok": True}
