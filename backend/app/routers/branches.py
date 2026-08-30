from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.core.security import CurrentUser, get_current_app_user, get_current_user
from app.db.session import get_db
from app.models.branch import Branch
from app.models.user import User, UserRole
from app.services.branches import list_retail_branches, list_wholesale_branches

router = APIRouter(prefix="/api/branches", tags=["branches"])


def _branch_dict(branch: Branch) -> dict:
    return {
        "id": branch.id,
        "name": branch.name,
        "sale_date_format": branch.sale_date_format,
        "inventory_date_format": branch.inventory_date_format,
    }


@router.get("")
def list_branches(
    kind: Literal["retail", "wholesale"] = "retail",
    user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> list[dict]:
    branches = list_wholesale_branches(db) if kind == "wholesale" else list_retail_branches(db)
    return [_branch_dict(b) for b in branches.all()]


class BranchDateFormatUpdate(BaseModel):
    # Both optional so a PUT can set just one of the two without resending the other.
    # "MDY" (month first, e.g. 8/21/2026) or "DMY" (day first, e.g. 21/08/2026) — see
    # Branch.sale_date_format/inventory_date_format for what each actually controls.
    sale_date_format: Literal["MDY", "DMY"] | None = None
    inventory_date_format: Literal["MDY", "DMY"] | None = None


@router.put("/{branch_id}")
def update_branch_date_formats(
    branch_id: str,
    payload: BranchDateFormatUpdate,
    user: User = Depends(get_current_app_user),
    db: Session = Depends(get_db),
) -> dict:
    # Each branch's own POS terminal can use a different date convention, but which
    # convention every branch uses is still a business-wide call, not a per-device
    # preference — same admin-only rule as the business-wide settings in
    # app.routers.settings.
    if user.role != UserRole.ADMIN:
        raise HTTPException(
            status.HTTP_403_FORBIDDEN,
            "Only an admin account can change a branch's date format",
        )

    branch = db.get(Branch, branch_id)
    if branch is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Branch not found")

    updates = payload.model_dump(exclude_none=True)
    for key, value in updates.items():
        setattr(branch, key, value)
    db.commit()

    return _branch_dict(branch)
