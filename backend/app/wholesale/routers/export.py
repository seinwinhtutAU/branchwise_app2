"""One download with every wholesale record, for analysis outside the app.

Reads through the same list endpoints the screens use (called directly, without paging),
so the statuses, totals and balances in the file always match what the screens show.
"""

from datetime import datetime
from typing import Annotated, Literal

from fastapi import APIRouter, Depends, Query, Response
from sqlalchemy.orm import Session

from app.core.security import get_current_app_user
from app.db.session import get_db
from app.models.user import User
from app.wholesale.models.master_data import (
    WholesaleCargoCompany,
    WholesaleCarrier,
    WholesaleCustomer,
    WholesaleDestination,
    WholesaleProduct,
    WholesaleReceivingGate,
    WholesaleSupplier,
)
from app.wholesale.routers.common import require_wholesale
from app.wholesale.routers.finance import customer_finance_rows
from app.wholesale.routers.inventory import list_inventory, list_stock_records
from app.wholesale.routers.orders import list_customer_orders
from app.wholesale.routers.receivings import list_receivings_endpoint
from app.wholesale.routers.shipments import list_shipments_endpoint
from app.wholesale.routers.supplier_vouchers import list_supplier_vouchers
from app.wholesale.routers.write_offs import list_wholesale_write_offs
from app.wholesale.services.export import build_csv_zip, build_tables, build_xlsx

router = APIRouter(prefix="/api/wholesale/export", tags=["wholesale"])

EVERYTHING = 10**9  # the list endpoints page; an export wants all of it

XLSX_TYPE = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"


def _rows(db: Session, model, **fields) -> list[dict]:
    return [
        {key: getattr(row, source) for key, source in fields.items()}
        for row in db.query(model).order_by(model.name).all()
    ]


@router.get("")
def export_wholesale_data(
    format: Annotated[Literal["xlsx", "csv"], Query()] = "xlsx",
    user: User = Depends(get_current_app_user),
    db: Session = Depends(get_db),
) -> Response:
    require_wholesale(user)
    paging = {"page": 1, "page_size": EVERYTHING, "user": user, "db": db}

    def fetch(endpoint, **extra):
        return endpoint(response=Response(), **paging, **extra)

    named_lists = []
    for label, model in (
        ("Cargo company", WholesaleCargoCompany), ("Carrier", WholesaleCarrier),
        ("Destination", WholesaleDestination), ("Receiving gate", WholesaleReceivingGate),
    ):
        named_lists += [{"list": label, **row} for row in _rows(db, model, name="name", active="active")]

    data = {
        "vouchers": fetch(list_supplier_vouchers),
        "shipments": fetch(list_shipments_endpoint),
        "receivings": fetch(list_receivings_endpoint),
        "orders": fetch(list_customer_orders),
        "movements": fetch(list_inventory),
        "stock": fetch(list_stock_records),
        "finance": customer_finance_rows(user=user, db=db),
        "write_offs": fetch(list_wholesale_write_offs),
        "products": [
            {"stock_code": p.stock_code, "description": p.description, "product_group": p.product_group.value,
             "default_unit": p.default_unit.value, "active": p.active}
            for p in db.query(WholesaleProduct).order_by(WholesaleProduct.stock_code).all()
        ],
        "suppliers": _rows(db, WholesaleSupplier, name="name", phone="phone", address="address", active="active"),
        "customers": _rows(db, WholesaleCustomer, name="name", phone="phone", address="address", active="active"),
        "named_lists": named_lists,
    }

    now = datetime.now()
    scope = "every wholesale record" if user.branch_id is None else "this branch's wholesale records"
    tables = build_tables(data)
    if format == "csv":
        content, media_type, extension = build_csv_zip(tables, now, scope), "application/zip", "zip"
    else:
        content, media_type, extension = build_xlsx(tables, now, scope), XLSX_TYPE, "xlsx"
    return Response(
        content=content,
        media_type=media_type,
        headers={"Content-Disposition": f'attachment; filename="wholesale-data-{now:%Y-%m-%d}.{extension}"'},
    )
