from datetime import date

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.core.security import get_current_app_user
from app.db.session import get_db
from app.models.user import User
from app.services import response_cache
from app.wholesale.services.monitoring import monitoring_snapshot
from app.wholesale.services.response_cache import wholesale_data_version
from app.wholesale.routers.common import require_wholesale

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
