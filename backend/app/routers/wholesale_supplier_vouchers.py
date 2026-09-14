from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from sqlalchemy.orm import Session

from app.core.security import get_current_app_user
from app.db.session import get_db
from app.models.user import User, UserRole
from app.schemas.wholesale_supplier_vouchers import SupplierVoucherIn, VoucherPaymentIn
from app.services.branches import resolve_branch_id
from app.services.wholesale_supplier_vouchers import add_payment, create_voucher, delete_payment, delete_voucher, get_voucher, list_vouchers, received_pairs_by_voucher_no, received_pairs_by_voucher_stock, update_voucher

router = APIRouter(prefix="/api/wholesale/supplier-vouchers", tags=["wholesale"])


def _require_wholesale(user: User) -> None:
    if user.role not in (UserRole.WHOLESALE, UserRole.ADMIN):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "This account cannot use the wholesale workspace")


def _out(voucher, received_pairs: int, received_by_stock: dict[str, int] | None = None) -> dict:
    remaining_by_stock = dict(received_by_stock or {})
    lines = []
    for line in voucher.lines:
        received = min(remaining_by_stock.get(line.stock_code, 0), line.quantity_pairs)
        remaining_by_stock[line.stock_code] = max(
            0, remaining_by_stock.get(line.stock_code, 0) - received
        )
        lines.append({"voucher_line_id": line.id, "stock_code": line.stock_code, "description": line.description,
                      "product_group": line.product_group.value, "color_breakdown": line.color_breakdown, "unit": line.unit.value,
                      "quantity_pairs": line.quantity_pairs, "received_quantity_pairs": received,
                      "buying_price": float(line.buying_price)})
    payments = [{"payment_id": payment.id, "paid_on": payment.paid_on, "amount": float(payment.amount), "note": payment.note} for payment in voucher.payments]
    total = sum(line["quantity_pairs"] * line["buying_price"] for line in lines)
    paid = sum(payment["amount"] for payment in payments)
    return {"voucher_id": voucher.id, "branch_id": voucher.branch_id, "voucher_no": voucher.voucher_no,
            "supplier_name": voucher.supplier_name, "voucher_date": voucher.voucher_date,
            "carrier_name": voucher.carrier_name, "total_packages": voucher.total_packages,
            "total_quantity_pairs": sum(line["quantity_pairs"] for line in lines),
            "received_quantity_pairs": sum(line["received_quantity_pairs"] for line in lines),
            "lines": lines, "payment": {"account_id": voucher.id, "payments": payments},
            "total_amount": total, "paid_amount": paid, "balance_due": max(0, total - paid)}


def _one(db: Session, voucher) -> dict:
    received_pairs = received_pairs_by_voucher_no(
        db, [voucher.voucher_no], voucher.branch_id
    ).get(voucher.voucher_no, 0)
    received_by_stock = received_pairs_by_voucher_stock(
        db, [voucher.voucher_no], voucher.branch_id
    )
    return _out(
        voucher,
        received_pairs,
        {
            stock_code: pairs
            for (voucher_no, stock_code), pairs in received_by_stock.items()
            if voucher_no == voucher.voucher_no
        },
    )


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
    received_by_stock = received_pairs_by_voucher_stock(
        db, [voucher.voucher_no for voucher in vouchers], user.branch_id
    )
    rows = [
        _out(
            voucher,
            received.get(voucher.voucher_no, 0),
            {
                stock_code: pairs
                for (voucher_no, stock_code), pairs in received_by_stock.items()
                if voucher_no == voucher.voucher_no
            },
        )
        for voucher in vouchers
    ]
    query = search.strip().lower()
    if query:
        rows = [
            row for row in rows
            if query in row["voucher_no"].lower() or query in row["supplier_name"].lower()
            or query in row["carrier_name"].lower()
            or any(query in line["stock_code"].lower() or query in line["description"].lower() for line in row["lines"])
        ]
    if payment_status:
        rows = [
            row for row in rows
            if ("paid" if row["balance_due"] == 0 else "partial" if row["paid_amount"] > 0 else "unpaid") == payment_status
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
    return {"payment_id": payment.id, "paid_on": payment.paid_on, "amount": float(payment.amount), "note": payment.note}


@router.delete("/{voucher_id}/payments/{payment_id}", status_code=status.HTTP_204_NO_CONTENT)
def remove_payment(voucher_id: str, payment_id: str, user: User = Depends(get_current_app_user), db: Session = Depends(get_db)) -> None:
    _require_wholesale(user)
    delete_payment(db, voucher_id, payment_id, user.branch_id)
