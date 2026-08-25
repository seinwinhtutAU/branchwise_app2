from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.core.security import get_current_app_user
from app.db.session import get_db
from app.models.branch import Branch
from app.models.user import User
from app.models.wholesale import FactoryVoucher
from app.schemas.wholesale import (
    FactoryVoucherCreate,
    FactoryVoucherCreateResult,
    FactoryVoucherOut,
    FactoryVoucherUpdate,
    FactoryVoucherUpdateResult,
)
from app.services.branches import resolve_branch_id
from app.services.wholesale import apply_voucher_to_orders, next_voucher_no

router = APIRouter(prefix="/api/factory-vouchers", tags=["factory-vouchers"])


def _to_out(voucher: FactoryVoucher, branch_name: str | None) -> FactoryVoucherOut:
    return FactoryVoucherOut(
        id=voucher.id,
        voucher_no=voucher.voucher_no,
        branch_id=voucher.branch_id,
        branch_name=branch_name,
        voucher_date=voucher.voucher_date,
        factory_name=voucher.factory_name,
        product_code=voucher.product_code,
        qty=voucher.qty,
        buying_price=voucher.buying_price,
        colors=voucher.colors,
        discount_per_set=voucher.discount_per_set,
        remark=voucher.remark,
        created_at=voucher.created_at,
    )


def _get_owned_voucher(voucher_id: str, user: User, db: Session) -> FactoryVoucher:
    voucher = db.get(FactoryVoucher, voucher_id)
    if voucher is None or (user.branch_id is not None and voucher.branch_id != user.branch_id):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Factory voucher not found")
    return voucher


@router.get("")
def list_vouchers(
    user: User = Depends(get_current_app_user), db: Session = Depends(get_db)
) -> list[FactoryVoucherOut]:
    query = db.query(FactoryVoucher, Branch).outerjoin(Branch, FactoryVoucher.branch_id == Branch.id)
    if user.branch_id is not None:
        query = query.filter(FactoryVoucher.branch_id == user.branch_id)
    query = query.order_by(FactoryVoucher.voucher_no.desc())

    return [_to_out(voucher, branch.name if branch else None) for voucher, branch in query.all()]


@router.post("", status_code=status.HTTP_201_CREATED)
def create_voucher(
    payload: FactoryVoucherCreate,
    user: User = Depends(get_current_app_user),
    db: Session = Depends(get_db),
) -> FactoryVoucherCreateResult:
    branch_id = resolve_branch_id(user, payload.branch_id, db)

    voucher = FactoryVoucher(
        voucher_no=next_voucher_no(db),
        branch_id=branch_id,
        voucher_date=payload.voucher_date,
        factory_name=payload.factory_name,
        product_code=payload.product_code,
        qty=payload.qty,
        buying_price=payload.buying_price,
        colors=[c.model_dump() for c in payload.colors],
        discount_per_set=payload.discount_per_set,
        remark=payload.remark,
    )
    db.add(voucher)
    db.flush()
    updated_orders = apply_voucher_to_orders(db, voucher)
    db.commit()
    db.refresh(voucher)

    branch = db.get(Branch, branch_id) if branch_id else None
    return FactoryVoucherCreateResult(
        voucher=_to_out(voucher, branch.name if branch else None),
        updated_order_count=len(updated_orders),
    )


@router.patch("/{voucher_id}")
def update_voucher(
    voucher_id: str,
    payload: FactoryVoucherUpdate,
    user: User = Depends(get_current_app_user),
    db: Session = Depends(get_db),
) -> FactoryVoucherUpdateResult:
    voucher = _get_owned_voucher(voucher_id, user, db)
    updates = payload.model_dump(exclude_unset=True)

    if "colors" in updates:
        updates["colors"] = [c if isinstance(c, dict) else c.model_dump() for c in updates["colors"]]

    for field, value in updates.items():
        setattr(voucher, field, value)

    # Re-run matching unconditionally: cheap at this scale, and correct whether the product
    # code, the price, or both changed ("latest voucher wins" on every field, not just price).
    updated_orders = apply_voucher_to_orders(db, voucher)
    db.commit()
    db.refresh(voucher)

    branch = db.get(Branch, voucher.branch_id) if voucher.branch_id else None
    return FactoryVoucherUpdateResult(
        voucher=_to_out(voucher, branch.name if branch else None),
        updated_order_count=len(updated_orders),
    )


@router.delete("/{voucher_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_voucher(
    voucher_id: str, user: User = Depends(get_current_app_user), db: Session = Depends(get_db)
) -> None:
    voucher = _get_owned_voucher(voucher_id, user, db)
    db.delete(voucher)
    db.commit()
