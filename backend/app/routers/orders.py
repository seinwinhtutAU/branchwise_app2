from fastapi import APIRouter, Depends

from app.core.security import CurrentUser, get_current_user

router = APIRouter(prefix="/api/orders", tags=["orders"])


@router.get("")
def list_orders(user: CurrentUser = Depends(get_current_user)) -> list:
    return []
