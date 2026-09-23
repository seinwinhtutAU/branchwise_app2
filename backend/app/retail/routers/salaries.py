from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from app.core.security import get_current_app_user
from app.db.session import get_db
from app.models.user import User
from app.retail.models.salary import SalaryRecord
from app.retail.routers.common import require_retail_operations

router = APIRouter(prefix="/api/salaries", tags=["salaries"], dependencies=[Depends(require_retail_operations)])

PAGE_SIZE = 20


@router.get("")
def list_salaries(
    search: str | None = Query(None, description="Matches employee name"),
    branch: str | None = Query(None, description="Branch name"),
    page: int = Query(1, ge=1),
    page_size: int = Query(PAGE_SIZE, ge=1, le=500),
    export: bool = Query(False, description="Ignore paging and return all matching rows"),
    user: User = Depends(get_current_app_user),
    db: Session = Depends(get_db),
) -> dict:
    query = db.query(SalaryRecord)
    if user.branch_id is not None:
        query = query.filter(SalaryRecord.branch_id == user.branch_id)
    if search:
        query = query.filter(SalaryRecord.name.ilike(f"%{search}%"))
    if branch:
        query = query.filter(SalaryRecord.branch == branch)

    total = query.count()
    query = query.order_by(SalaryRecord.branch, SalaryRecord.name, SalaryRecord.import_batch_id)
    if not export:
        query = query.offset((page - 1) * page_size).limit(page_size)
    rows = [
        {
            "Month": record.source_sheet,
            "Name": record.name,
            "Branch": record.branch,
            "Salary": float(record.salary),
            "Bonus": float(record.bonus) if record.bonus is not None else None,
        }
        for record in query.all()
    ]
    return {"rows": rows, "total": total}
