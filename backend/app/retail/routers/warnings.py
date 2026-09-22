from datetime import date

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from app.core.security import get_current_app_user
from app.db.session import get_db
from app.models.user import User
from app.retail.services.data_quality import build_warning_sections
from app.services import response_cache
from app.services.settings import get_purchase_warning_window_days, get_sale_warning_window_days
from app.retail.routers.common import require_retail_operations

router = APIRouter(prefix="/api/warnings", tags=["warnings"], dependencies=[Depends(require_retail_operations)])


@router.get("")
def get_warnings(
    sale_days: int | None = Query(None, ge=1, le=365, description="How many days back (including today) to check Sale numeric issues — defaults to the business-wide sale_warning_window_days setting"),
    purchase_days: int | None = Query(None, ge=1, le=365, description="How many days back (including today) to check Purchase numeric issues — defaults to the business-wide purchase_warning_window_days setting"),
    user: User = Depends(get_current_app_user),
    db: Session = Depends(get_db),
) -> dict:
    if sale_days is None:
        sale_days = get_sale_warning_window_days(db)
    if purchase_days is None:
        purchase_days = get_purchase_warning_window_days(db)
    cache_key = (
        "warnings",
        user.branch_id,
        sale_days,
        purchase_days,
        date.today(),
        response_cache.import_data_version(db, user.branch_id),
    )
    return response_cache.cached(
        cache_key,
        lambda: {"sections": build_warning_sections(db, user, sale_days, purchase_days)},
    )
