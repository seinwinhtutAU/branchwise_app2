import csv
import io
from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from sqlalchemy.orm import Session

from app.core.security import get_current_app_user
from app.db.session import get_db
from app.models.branch import Branch
from app.models.user import User
from app.retail.services.purchasing import get_purchasing_recommendations
from app.services.branches import list_retail_branches, resolve_branch_id

router = APIRouter(prefix="/api/purchasing", tags=["purchasing"])

PAGE_SIZE = 20


def _resolve_target_branch(user: User, branch_id: str | None, db: Session) -> tuple[str, str]:
    """Resolves branch_id and branch_name. For admin, defaults to first retail branch if not provided."""
    if user.branch_id is not None:
        b = db.get(Branch, user.branch_id)
        return user.branch_id, b.name if b else "Retail"

    if branch_id:
        resolved_id = resolve_branch_id(user, branch_id, db)
        branch = list_retail_branches(db).filter(Branch.id == resolved_id).first()
        if branch is None:
            raise HTTPException(
                status.HTTP_400_BAD_REQUEST,
                "The selected branch is not a retail branch",
            )
        return branch.id, branch.name

    # Default to first retail branch for admin if none selected
    first_retail = list_retail_branches(db).first()
    if first_retail is None:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "No retail branches exist")
    return first_retail.id, first_retail.name


@router.get("/recommendations")
def get_recommendations(
    branch_id: str | None = Query(None, description="Branch ID (admin only)"),
    target_months: float | None = Query(None, ge=0.1, le=24.0, description="Optional override for target buffer in months"),
    search: str | None = Query(None, description="Filter by stock code or description"),
    recommendation: str | None = Query(None, description="Filter by recommendation category"),
    abc_class: str | None = Query(None, description="Filter by ABC class (A, B, C, N)"),
    page: int = Query(1, ge=1),
    page_size: int = Query(PAGE_SIZE, ge=1, le=500),
    export: bool = Query(False, description="Return all matching rows without pagination"),
    user: User = Depends(get_current_app_user),
    db: Session = Depends(get_db),
) -> dict:
    resolved_id, b_name = _resolve_target_branch(user, branch_id, db)
    data = get_purchasing_recommendations(db, resolved_id, target_months=target_months)

    rows = data["rows"]

    # Filter by search
    if search:
        needle = search.strip().lower()
        rows = [
            r
            for r in rows
            if needle in r["StockCode"].lower()
            or needle in (r["Description"] or "").lower()
            or needle in (r["GroupName"] or "").lower()
        ]

    # Filter by recommendation
    if recommendation:
        rec_lower = recommendation.strip().lower()
        rows = [r for r in rows if r["Recommendation"].lower() == rec_lower]

    # Filter by abc_class
    if abc_class:
        abc_upper = abc_class.strip().upper()
        rows = [r for r in rows if r["ABC_Class"] == abc_upper]

    total = len(rows)
    page_rows = rows if export else rows[(page - 1) * page_size : (page - 1) * page_size + page_size]

    return {
        "branch_id": resolved_id,
        "branch_name": b_name,
        "summary": data["summary"],
        "total": total,
        "rows": page_rows,
    }


@router.get("/export")
def export_recommendations(
    branch_id: str | None = Query(None, description="Branch ID (admin only)"),
    target_months: float | None = Query(None, ge=0.1, le=24.0),
    reorder_only: bool = Query(True, description="If true, only export Urgent Reorder and Reorder items"),
    user: User = Depends(get_current_app_user),
    db: Session = Depends(get_db),
) -> Response:
    resolved_id, b_name = _resolve_target_branch(user, branch_id, db)
    data = get_purchasing_recommendations(db, resolved_id, target_months=target_months)

    rows = data["rows"]
    if reorder_only:
        rows = [r for r in rows if r["Recommendation"] in ("Urgent Reorder", "Reorder")]

    output = io.StringIO()
    fieldnames = [
        "StockCode",
        "Description",
        "GroupName",
        "ABC_Class",
        "PriceRange",
        "SellingPrice",
        "BuyingPrice",
        "TotalQtySold",
        "TotalSalesValue",
        "AvgMonthlySales",
        "OnHandQty",
        "TargetBufferMonths",
        "StockCoverageMonths",
        "StockStatus",
        "SuggestedReorderQty",
        "RecentPurchaseQty",
        "LastPurchaseDate",
        "PurchaseNote",
        "Recommendation",
    ]

    writer = csv.DictWriter(output, fieldnames=fieldnames, extrasaction="ignore")
    writer.writeheader()
    formula_prefixes = ("=", "+", "-", "@", "\t", "\r")
    for row in rows:
        sanitized_row = {
            k: (f"'{v}" if isinstance(v, str) and v.startswith(formula_prefixes) else v)
            for k, v in row.items()
        }
        writer.writerow(sanitized_row)

    filename_prefix = "reorder_list" if reorder_only else "purchasing_decision"
    safe_branch = "".join(c for c in b_name if c.isalnum() or c in ("-", "_")).lower()
    filename = f"{safe_branch}_{filename_prefix}.csv"

    return Response(
        content=output.getvalue(),
        media_type="text/csv",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )
