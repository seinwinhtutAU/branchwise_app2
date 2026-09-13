"""Customer orders and their customer-side payments.

The quantities delivered to a customer are not written here: Inventory will own those
outgoing movements. Until that phase is connected, an order truthfully reports zero
received pairs. Payments, however, already have a real source of truth and are kept in
``wholesale_payments`` alongside supplier payments.
"""

from datetime import date

from fastapi import HTTPException, status
from sqlalchemy.orm import Session, selectinload

from app.models.wholesale import CustomerOrder, CustomerOrderLine, WholesalePayment
from app.services.wholesale.colors import color_qty_pairs, color_qty_problem, colors_as_json
from app.services.wholesale.references import allocate_reference, retry_on_reference_collision

_LOAD_OPTIONS = (selectinload(CustomerOrder.lines), selectinload(CustomerOrder.payments))


def _load(db: Session, order_id: str, branch_id: str | None) -> CustomerOrder:
    order = db.query(CustomerOrder).options(*_LOAD_OPTIONS).filter(CustomerOrder.id == order_id).first()
    if order is None or (branch_id is not None and order.branch_id != branch_id):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Customer order not found")
    return order


def list_orders(db: Session, branch_id: str | None) -> list[CustomerOrder]:
    query = db.query(CustomerOrder).options(*_LOAD_OPTIONS)
    if branch_id is not None:
        query = query.filter(CustomerOrder.branch_id == branch_id)
    return query.order_by(CustomerOrder.order_date.desc(), CustomerOrder.order_no.desc()).all()


def get_order(db: Session, order_id: str, branch_id: str | None) -> CustomerOrder:
    return _load(db, order_id, branch_id)


def _line(line_in) -> CustomerOrderLine:
    color_qty = line_in.color_qty.strip()
    problem = color_qty_problem(color_qty)
    if problem:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, problem)
    return CustomerOrderLine(
        stock_code=line_in.stock_code.strip(), description=line_in.description.strip(),
        product_group=line_in.product_group, supplier_name=line_in.supplier_name.strip(),
        color_qty=color_qty, colors=colors_as_json(color_qty), unit=line_in.unit,
        wanted_pairs=color_qty_pairs(color_qty, line_in.unit), selling_price=line_in.selling_price,
    )


def _check_no_duplicate_stock_codes(lines) -> None:
    # A delivery only records a stock code and a quantity, never which order line it
    # satisfies — two lines for the same stock code would make delivered-quantity
    # attribution ambiguous (see _out in the router). Put the extra quantity on the
    # existing line instead.
    seen = {line.stock_code.strip().lower() for line in lines}
    if len(seen) != len(lines):
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, "Each stock code can only appear on one line per order")


def create_order(db: Session, branch_id: str | None, payload) -> CustomerOrder:
    _check_no_duplicate_stock_codes(payload.lines)

    def attempt() -> CustomerOrder:
        order = CustomerOrder(
            branch_id=branch_id,
            order_no=allocate_reference(db, CustomerOrder.order_no, branch_id, "ORD", date.today()),
            customer_name=payload.customer_name.strip(), customer_phone=payload.customer_phone.strip(),
            customer_address=payload.customer_address.strip(), order_date=payload.order_date,
            lines=[_line(line) for line in payload.lines],
        )
        db.add(order)
        db.commit()
        return _load(db, order.id, branch_id)

    return retry_on_reference_collision(db, attempt)


def update_order(db: Session, order_id: str, branch_id: str | None, payload) -> CustomerOrder:
    _check_no_duplicate_stock_codes(payload.lines)
    order = _load(db, order_id, branch_id)
    order.customer_name = payload.customer_name.strip()
    order.customer_phone = payload.customer_phone.strip()
    order.customer_address = payload.customer_address.strip()
    order.order_date = payload.order_date
    order.lines = [_line(line) for line in payload.lines]
    db.commit()
    return _load(db, order_id, branch_id)


def cancel_order(db: Session, order_id: str, branch_id: str | None) -> CustomerOrder:
    order = _load(db, order_id, branch_id)
    order.cancelled = True
    db.commit()
    return _load(db, order_id, branch_id)


def delete_order(db: Session, order_id: str, branch_id: str | None) -> None:
    order = _load(db, order_id, branch_id)
    db.delete(order)
    db.commit()


def add_payment(db: Session, order_id: str, branch_id: str | None, user_id: str, payload) -> WholesalePayment:
    order = _load(db, order_id, branch_id)
    total = sum(float(line.wanted_pairs) * float(line.selling_price) for line in order.lines)
    paid = sum(float(payment.amount) for payment in order.payments)
    if paid + payload.amount > total:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, "Payment cannot exceed the order balance")
    payment = WholesalePayment(
        branch_id=order.branch_id, order_id=order.id, paid_on=payload.paid_on,
        amount=payload.amount, note=payload.note.strip(), recorded_by_user_id=user_id,
    )
    db.add(payment)
    db.commit()
    db.refresh(payment)
    return payment


def delete_payment(db: Session, order_id: str, payment_id: str, branch_id: str | None) -> None:
    order = _load(db, order_id, branch_id)
    payment = next((entry for entry in order.payments if entry.id == payment_id), None)
    if payment is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Payment not found")
    db.delete(payment)
    db.commit()
