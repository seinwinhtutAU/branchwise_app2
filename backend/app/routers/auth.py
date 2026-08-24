from fastapi import APIRouter, Depends

from app.core.security import get_current_app_user
from app.models.user import User

router = APIRouter(prefix="/api", tags=["auth"])


@router.get("/me")
def me(user: User = Depends(get_current_app_user)) -> dict:
    return {
        "id": user.id,
        "email": user.email,
        "name": user.name,
        "role": user.role.value,
        "branch_id": user.branch_id,
        "branch_name": user.branch.name if user.branch else None,
    }
