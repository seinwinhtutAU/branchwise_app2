from fastapi import APIRouter, Depends

from app.core.security import CurrentUser, get_current_user

router = APIRouter(prefix="/api/allocation", tags=["allocation"])


@router.get("")
def list_allocations(user: CurrentUser = Depends(get_current_user)) -> list:
    return []
