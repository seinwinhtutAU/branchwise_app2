from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from app.core.security import get_current_app_user
from app.db.session import get_db
from app.models.user import User
from app.retail.services.import_health import build_import_health, dismiss_batch, undismiss_batch

router = APIRouter(prefix="/api/imports", tags=["imports"])


@router.get("/health")
def get_import_health(
    days: int = Query(30, ge=1, le=365, description="How many days back (including today) to check import batches"),
    user: User = Depends(get_current_app_user),
    db: Session = Depends(get_db),
) -> dict:
    return build_import_health(db, user, days)


@router.post("/health/{batch_id}/dismiss")
def post_dismiss_import_health_batch(
    batch_id: str,
    user: User = Depends(get_current_app_user),
    db: Session = Depends(get_db),
) -> dict:
    """Marks a flagged batch as handled — e.g. an old pre-fix incident whose data gap
    was already patched by a separate later batch, so the flag is historically
    accurate but no longer actionable. Hides it from "Batches to review" only; doesn't
    touch the batch's data, status, or its place in Import History."""
    dismiss_batch(db, batch_id, user)
    return {"ok": True}


@router.post("/health/{batch_id}/undismiss")
def post_undismiss_import_health_batch(
    batch_id: str,
    user: User = Depends(get_current_app_user),
    db: Session = Depends(get_db),
) -> dict:
    undismiss_batch(db, batch_id, user)
    return {"ok": True}
