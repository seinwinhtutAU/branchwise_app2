import csv
import io
from datetime import date, datetime
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Response, status
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.core.security import get_current_app_user
from app.db.session import get_db
from app.models.branch import Branch
from app.models.user import User
from app.retail.models.product import Product
from app.retail.models.stock_level import StockLevel
from app.retail.routers.common import require_retail
from app.retail.services.branch_health import _check_daily_import_status
from app.retail.services.data_quality import build_checking_items
from app.schemas.checking import CheckingItem, CheckingStatusResponse, CheckingVerifyResponse
from app.services.branches import list_retail_branches
from app.services.settings import (
    format_cutoff_time,
    get_daily_check_cutoff_time,
    get_purchase_warning_window_days,
    get_sale_warning_window_days,
)

router = APIRouter(prefix="/api/checking", tags=["checking"], dependencies=[Depends(require_retail)])

CurrentAppUser = Annotated[User, Depends(get_current_app_user)]
DatabaseSession = Annotated[Session, Depends(get_db)]


def _resolve_retail_branch_id(user: User, db: Session) -> str:
    if user.branch_id:
        return user.branch_id
    first = list_retail_branches(db).first()
    if not first:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "No retail branches exist")
    return first.id


@router.get("", response_model=CheckingStatusResponse)
def get_checking_status(
    user: CurrentAppUser, db: DatabaseSession
) -> CheckingStatusResponse:
    """Products to verify in the external inventory system. Only unlocked after daily cutoff time
    once today's sale and inventory files are confirmed."""
    branch_id = _resolve_retail_branch_id(user, db)
    cutoff_time = get_daily_check_cutoff_time(db)
    formatted_cutoff = format_cutoff_time(cutoff_time)
    has_today_sales, has_today_inventory, is_after_cutoff = _check_daily_import_status(
        db, branch_id, cutoff_time=cutoff_time
    )
    is_eligible = is_after_cutoff and has_today_sales and has_today_inventory

    raw_items = build_checking_items(
        db,
        user,
        sale_days=get_sale_warning_window_days(db),
        purchase_days=get_purchase_warning_window_days(db),
    )
    items = [CheckingItem(**item) for item in raw_items]

    reason = None
    if not is_eligible:
        parts = []
        if not is_after_cutoff:
            parts.append(f"it is after {formatted_cutoff} (shop close)")
        if not has_today_sales:
            parts.append("today's POS sales file is imported")
        if not has_today_inventory:
            parts.append("today's POS inventory snapshot is imported")
        reason = f"Audit sheet unlocks once {' and '.join(parts)}."

    return CheckingStatusResponse(
        is_eligible=is_eligible,
        reason=reason,
        has_today_sales=has_today_sales,
        has_today_inventory=has_today_inventory,
        is_after_8pm=is_after_cutoff,
        cutoff_time=cutoff_time,
        formatted_cutoff_time=formatted_cutoff,
        items=items if is_eligible else [],
    )


@router.get("/export")
def export_checking_csv(
    user: CurrentAppUser, db: DatabaseSession
) -> Response:
    """Download the physical stock audit sheet as a CSV file."""
    branch_id = _resolve_retail_branch_id(user, db)
    cutoff_time = get_daily_check_cutoff_time(db)
    formatted_cutoff = format_cutoff_time(cutoff_time)
    has_today_sales, has_today_inventory, is_after_cutoff = _check_daily_import_status(
        db, branch_id, cutoff_time=cutoff_time
    )
    if not (is_after_cutoff and has_today_sales and has_today_inventory):
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            f"Audit sheet cannot be generated until after {formatted_cutoff} and today's sales and inventory imports are confirmed.",
        )

    raw_items = build_checking_items(
        db,
        user,
        sale_days=get_sale_warning_window_days(db),
        purchase_days=get_purchase_warning_window_days(db),
    )

    output = io.StringIO()
    writer = csv.writer(output)
    writer.writerow(["Stock Code", "Description", "System Qty", "Actual Count (Physical)"])
    for item in raw_items:
        writer.writerow([
            item.get("stock_code", ""),
            item.get("description", ""),
            item.get("on_hand_qty", "") if item.get("on_hand_qty") is not None else "",
            "",
        ])

    csv_content = output.getvalue()
    filename = f"stock_check_{branch_id}_{date.today().isoformat()}.csv"
    return Response(
        content=csv_content,
        media_type="text/csv",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.get("/verify", response_model=CheckingVerifyResponse)
def verify_checking_resolution(
    user: CurrentAppUser, db: DatabaseSession
) -> CheckingVerifyResponse:
    """Checks whether the latest imported inventory file contains and resolves all checking items."""
    branch_id = _resolve_retail_branch_id(user, db)
    raw_items = build_checking_items(
        db,
        user,
        sale_days=get_sale_warning_window_days(db),
        purchase_days=get_purchase_warning_window_days(db),
    )
    checking_codes = [item["stock_code"] for item in raw_items if item.get("stock_code")]
    if not checking_codes:
        return CheckingVerifyResponse(
            success=True,
            message="No products currently flagged for physical stock check.",
            total_items=0,
            resolved_count=0,
            missing_stock_codes=[],
        )

    latest_snapshot = (
        db.query(func.max(StockLevel.snapshot_at))
        .filter(StockLevel.branch_id == branch_id)
        .scalar()
    )
    if not latest_snapshot:
        return CheckingVerifyResponse(
            success=False,
            message="No inventory snapshot has been imported for this branch.",
            total_items=len(checking_codes),
            resolved_count=0,
            missing_stock_codes=checking_codes,
        )

    present_codes = {
        r[0]
        for r in db.query(Product.stock_code)
        .join(StockLevel, StockLevel.product_id == Product.id)
        .filter(
            StockLevel.branch_id == branch_id,
            StockLevel.snapshot_at == latest_snapshot,
            Product.stock_code.in_(checking_codes),
        )
        .all()
    }

    missing = sorted(list(set(checking_codes) - present_codes))
    success = len(missing) == 0
    resolved_count = len(present_codes)
    message = (
        f"All {len(checking_codes)} stock items verified in the latest inventory snapshot."
        if success
        else f"{resolved_count} of {len(checking_codes)} items present in the latest inventory. {len(missing)} items still missing."
    )

    return CheckingVerifyResponse(
        success=success,
        message=message,
        total_items=len(checking_codes),
        resolved_count=resolved_count,
        missing_stock_codes=missing,
    )
