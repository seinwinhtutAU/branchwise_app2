from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.core.security import get_current_app_user
from app.db.session import get_db
from app.models.user import User
from app.services.wholesale.monitoring import monitoring_snapshot
from app.routers.wholesale_common import require_wholesale

router = APIRouter(prefix="/api/wholesale/monitoring", tags=["wholesale"])


@router.get("")
def get_monitoring_snapshot(
    user: User = Depends(get_current_app_user),
    db: Session = Depends(get_db),
) -> dict:
    require_wholesale(user)
    return monitoring_snapshot(db, user.branch_id)
