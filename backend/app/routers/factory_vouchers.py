from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session, selectinload

from app.core.security import get_current_app_user
from app.db.session import get_db
from app.models.branch import Branch
from app.models.user import User
from app.models.wholesale import FactoryVoucher, FactoryVoucherLine
from app.schemas.wholesale import (
    FactoryVoucherCreate,
    FactoryVoucherCreateResult,
    FactoryVoucherLineCreate,
    FactoryVoucherLineOut,
    FactoryVoucherLineUpdate,
    FactoryVoucherOut,
    FactoryVoucherUpdate,
    FactoryVoucherUpdateResult,
)
from app.services.branches import branch_name, resolve_branch_id
from app.services.wholesale import apply_voucher_line_to_orders, colors_total, next_voucher_no

router = APIRouter(prefix="/api/factory-vouchers", tags=["factory-vouchers"])


def _line_to_out(line: FactoryVoucherLine) -> FactoryVoucherLineOut:
    return FactoryVoucherLineOut(
        id=line.id,
        voucher_id=line.voucher_id,
        product_code=line.product_code,
        description=line.description,
        qty=line.qty,
        received_qty=line.received_qty,
        buying_price=line.buying_price,
        colors=line.colors,
        discount_per_set=line.discount_per_set,
    )


def _voucher_to_out(voucher: FactoryVoucher, branch_name: str | None) -> FactoryVoucherOut:
    return FactoryVoucherOut(
        id=voucher.id,
        voucher_no=voucher.voucher_no,
        branch_id=voucher.branch_id,
        branch_name=branch_name,
        voucher_date=voucher.voucher_date,
        factory_name=voucher.factory_name,
        remark=voucher.remark,
        created_at=voucher.created_at,
        lines=[_line_to_out(line) for line in voucher.lines],
    )


def _get_owned_voucher(voucher_id: str, user: User, db: Session) -> FactoryVoucher:
    voucher = db.get(FactoryVoucher, voucher_id)
    if voucher is None or (user.branch_id is not None and voucher.branch_id != user.branch_id):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Factory voucher not found")
    return voucher


def _get_owned_line(voucher_id: str, line_id: str, user: User, db: Session) -> tuple[FactoryVoucher, FactoryVoucherLine]:
    voucher = _get_owned_voucher(voucher_id, user, db)
    line = db.get(FactoryVoucherLine, line_id)
    if line is None or line.voucher_id != voucher.id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Voucher line not found")
    return voucher, line


def _new_line(payload: FactoryVoucherLineCreate) -> FactoryVoucherLine:
    colors = [c.model_dump() for c in payload.colors]
    return FactoryVoucherLine(
        product_code=payload.product_code,
        description=payload.description,
        qty=colors_total(colors),
        buying_price=payload.buying_price,
        colors=colors,
        discount_per_set=payload.discount_per_set,
    )


@router.get("")
def list_vouchers(
    user: User = Depends(get_current_app_user), db: Session = Depends(get_db)
) -> list[FactoryVoucherOut]:
    query = (
        db.query(FactoryVoucher, Branch)
        .outerjoin(Branch, FactoryVoucher.branch_id == Branch.id)
        .options(selectinload(FactoryVoucher.lines))
    )
    if user.branch_id is not None:
        query = query.filter(FactoryVoucher.branch_id == user.branch_id)
    query = query.order_by(FactoryVoucher.voucher_no.desc())

    return [_voucher_to_out(voucher, branch.name if branch else None) for voucher, branch in query.all()]


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
        remark=payload.remark,
    )
    line = _new_line(payload.line)
    voucher.lines.append(line)
    db.add(voucher)
    db.flush()
    updated_lines = apply_voucher_line_to_orders(db, line, branch_id)
    db.commit()
    db.refresh(voucher)

    return FactoryVoucherCreateResult(
        voucher=_voucher_to_out(voucher, branch_name(db, branch_id)),
        updated_order_count=len(updated_lines),
    )


@router.patch("/{voucher_id}")
def update_voucher(
    voucher_id: str,
    payload: FactoryVoucherUpdate,
    user: User = Depends(get_current_app_user),
    db: Session = Depends(get_db),
) -> FactoryVoucherOut:
    voucher = _get_owned_voucher(voucher_id, user, db)
    updates = payload.model_dump(exclude_unset=True)
    for field, value in updates.items():
        setattr(voucher, field, value)

    db.commit()
    db.refresh(voucher)

    return _voucher_to_out(voucher, branch_name(db, voucher.branch_id))


@router.delete("/{voucher_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_voucher(
    voucher_id: str, user: User = Depends(get_current_app_user), db: Session = Depends(get_db)
) -> None:
    voucher = _get_owned_voucher(voucher_id, user, db)
    db.delete(voucher)
    db.commit()


@router.post("/{voucher_id}/lines", status_code=status.HTTP_201_CREATED)
def add_voucher_line(
    voucher_id: str,
    payload: FactoryVoucherLineCreate,
    user: User = Depends(get_current_app_user),
    db: Session = Depends(get_db),
) -> FactoryVoucherCreateResult:
    voucher = _get_owned_voucher(voucher_id, user, db)
    line = _new_line(payload)
    voucher.lines.append(line)
    db.flush()
    updated_lines = apply_voucher_line_to_orders(db, line, voucher.branch_id)
    db.commit()
    db.refresh(voucher)

    return FactoryVoucherCreateResult(
        voucher=_voucher_to_out(voucher, branch_name(db, voucher.branch_id)),
        updated_order_count=len(updated_lines),
    )


@router.patch("/{voucher_id}/lines/{line_id}")
def update_voucher_line(
    voucher_id: str,
    line_id: str,
    payload: FactoryVoucherLineUpdate,
    user: User = Depends(get_current_app_user),
    db: Session = Depends(get_db),
) -> FactoryVoucherUpdateResult:
    voucher, line = _get_owned_line(voucher_id, line_id, user, db)
    updates = payload.model_dump(exclude_unset=True)

    if "colors" in updates:
        colors = [c if isinstance(c, dict) else c.model_dump() for c in updates.pop("colors")]
        line.colors = colors
        line.qty = colors_total(colors)

    for field, value in updates.items():
        setattr(line, field, value)

    # Re-run matching unconditionally: cheap at this scale, and correct whether the product
    # code, the price, or both changed ("latest voucher wins" on every field, not just price).
    updated_lines = apply_voucher_line_to_orders(db, line, voucher.branch_id)
    db.commit()
    db.refresh(voucher)

    return FactoryVoucherUpdateResult(
        voucher=_voucher_to_out(voucher, branch_name(db, voucher.branch_id)),
        updated_order_count=len(updated_lines),
    )


@router.delete("/{voucher_id}/lines/{line_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_voucher_line(
    voucher_id: str,
    line_id: str,
    user: User = Depends(get_current_app_user),
    db: Session = Depends(get_db),
) -> None:
    voucher, line = _get_owned_line(voucher_id, line_id, user, db)
    db.delete(line)
    db.flush()
    # A product line is the unit of a voucher — a voucher with none left behind has nothing to show.
    remaining = db.query(FactoryVoucherLine).filter(FactoryVoucherLine.voucher_id == voucher.id).count()
    if remaining == 0:
        db.delete(voucher)
    db.commit()
