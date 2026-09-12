from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from sqlalchemy.orm import Session

from app.core.security import get_current_app_user
from app.db.session import get_db
from app.models.user import User, UserRole
from app.schemas.wholesale_supplier_vouchers import SupplierVoucherIn, VoucherPaymentIn
from app.services.branches import resolve_branch_id
from app.services.wholesale_supplier_vouchers import add_payment, create_voucher, delete_payment, delete_voucher, get_voucher, list_vouchers, received_pairs_by_voucher_no, update_voucher

router = APIRouter(prefix="/api/wholesale/supplier-vouchers", tags=["wholesale"])


def _require_wholesale(user: User) -> None:
    if user.role not in (UserRole.WHOLESALE, UserRole.ADMIN):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "This account cannot use the wholesale workspace")


def _out(voucher, received_pairs: int) -> dict:
    lines = [{"voucher_line_id": line.id, "stock_code": line.stock_code, "description": line.description,
              "group": line.product_group.value, "color_qty": line.color_qty, "unit": line.unit.value,
              "voucher_qty": line.wanted_pairs, "buying_price": float(line.buying_price)} for line in voucher.lines]
    payments = [{"payment_id": payment.id, "date": payment.paid_on, "amount": float(payment.amount), "note": payment.note} for payment in voucher.payments]
    total = sum(line["voucher_qty"] * line["buying_price"] for line in lines)
    paid = sum(payment["amount"] for payment in payments)
    return {"voucher_id": voucher.id, "branch_id": voucher.branch_id, "voucher_no": voucher.voucher_no,
            "supplier_name": voucher.supplier_name, "voucher_date": voucher.voucher_date,
            "cargo_name": voucher.cargo_name, "total_packages": voucher.total_packages,
            "total_qty": sum(line["voucher_qty"] for line in lines), "received_qty": received_pairs,
            "lines": lines, "payment": {"account_id": voucher.id, "payments": payments},
            "total_amount": total, "paid_amount": paid, "balance": max(0, total - paid)}


def _one(db: Session, voucher) -> dict:
    return _out(voucher, received_pairs_by_voucher_no(db, [voucher.voucher_no], voucher.branch_id).get(voucher.voucher_no, 0))


@router.get("")
def list_supplier_vouchers(
    search: Annotated[str, Query(max_length=100)] = "",
    payment_status: Annotated[str | None, Query()] = None,
    page: Annotated[int, Query(ge=1)] = 1,
    page_size: Annotated[int, Query(ge=1, le=100)] = 100,
    user: User = Depends(get_current_app_user),
    db: Session = Depends(get_db),
    response: Response = None,
) -> list[dict]:
    _require_wholesale(user)
    vouchers = list_vouchers(db, user.branch_id)
    received = received_pairs_by_voucher_no(db, [voucher.voucher_no for voucher in vouchers], user.branch_id)
    rows = [_out(voucher, received.get(voucher.voucher_no, 0)) for voucher in vouchers]
    query = search.strip().lower()
    if query:
        rows = [
            row for row in rows
            if query in row["voucher_no"].lower() or query in row["supplier_name"].lower()
            or query in row["cargo_name"].lower()
            or any(query in line["stock_code"].lower() or query in line["description"].lower() for line in row["lines"])
        ]
    if payment_status:
        rows = [
            row for row in rows
            if ("paid" if row["balance"] == 0 else "partial" if row["paid_amount"] > 0 else "unpaid") == payment_status
        ]
    response.headers["X-Total-Count"] = str(len(rows))
    start = (page - 1) * page_size
    return rows[start : start + page_size]


@router.post("", status_code=status.HTTP_201_CREATED)
def create_supplier_voucher(payload: SupplierVoucherIn, user: User = Depends(get_current_app_user), db: Session = Depends(get_db)) -> dict:
    _require_wholesale(user)
    return _one(db, create_voucher(db, resolve_branch_id(user, payload.branch_id, db), payload))


@router.put("/{voucher_id}")
def update_supplier_voucher(voucher_id: str, payload: SupplierVoucherIn, user: User = Depends(get_current_app_user), db: Session = Depends(get_db)) -> dict:
    _require_wholesale(user)
    return _one(db, update_voucher(db, voucher_id, user.branch_id, payload))


@router.delete("/{voucher_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_supplier_voucher(voucher_id: str, user: User = Depends(get_current_app_user), db: Session = Depends(get_db)) -> None:
    _require_wholesale(user)
    delete_voucher(db, voucher_id, user.branch_id)


@router.post("/{voucher_id}/payments", status_code=status.HTTP_201_CREATED)
def create_payment(voucher_id: str, payload: VoucherPaymentIn, user: User = Depends(get_current_app_user), db: Session = Depends(get_db)) -> dict:
    _require_wholesale(user)
    payment = add_payment(db, voucher_id, user.branch_id, user.id, payload)
    return {"payment_id": payment.id, "date": payment.paid_on, "amount": float(payment.amount), "note": payment.note}


@router.delete("/{voucher_id}/payments/{payment_id}", status_code=status.HTTP_204_NO_CONTENT)
def remove_payment(voucher_id: str, payment_id: str, user: User = Depends(get_current_app_user), db: Session = Depends(get_db)) -> None:
    _require_wholesale(user)
    delete_payment(db, voucher_id, payment_id, user.branch_id)
