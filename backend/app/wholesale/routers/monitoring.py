from datetime import date

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.core.security import get_current_app_user
from app.db.session import get_db
from app.models.user import User
from app.services import response_cache
from app.wholesale.services.monitoring import monitoring_snapshot, wholesale_summary_snapshot
from app.wholesale.services.response_cache import wholesale_data_version
from app.wholesale.routers.common import require_wholesale, resolve_window

router = APIRouter(prefix="/api/wholesale/monitoring", tags=["wholesale"])


@router.get("")
def get_monitoring_snapshot(
    user: User = Depends(get_current_app_user),
    db: Session = Depends(get_db),
) -> dict:
    require_wholesale(user)
    cache_key = (
        "wholesale_monitoring",
        user.branch_id,
        date.today(),
        wholesale_data_version(db, user.branch_id),
    )
    return response_cache.cached(cache_key, lambda: monitoring_snapshot(db, user.branch_id))


@router.get("/summary")
def get_wholesale_summary(
    location: str | None = None,
    period: str = "30d",
    date_from: date | None = None,
    date_to: date | None = None,
    month: str | None = None,
    user: User = Depends(get_current_app_user),
    db: Session = Depends(get_db),
) -> dict:
    require_wholesale(user)
    window = resolve_window(period, date_from, date_to, month)
    cache_key = (
        "wholesale_summary",
        user.branch_id,
        location,
        window.start,
        window.end,
        wholesale_data_version(db, user.branch_id),
    )
    return response_cache.cached(
        cache_key,
        lambda: wholesale_summary_snapshot(db, user.branch_id, location=location, window=window),
    )
