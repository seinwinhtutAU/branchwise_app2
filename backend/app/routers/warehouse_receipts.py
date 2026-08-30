from decimal import Decimal

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session, selectinload

from app.core.security import get_current_app_user
from app.db.session import get_db
from app.models.user import User
from app.models.wholesale import FactoryVoucher, FactoryVoucherLine, WarehouseReceipt
from app.schemas.wholesale import WarehouseReceiptCreate, WarehouseReceiptOut
from app.services.branches import resolve_branch_id
from app.services.wholesale import record_warehouse_receipt

router = APIRouter(prefix="/api/warehouse-receipts", tags=["warehouse-receipts"])


def _receipt_to_out(receipt: WarehouseReceipt) -> WarehouseReceiptOut:
    line = receipt.voucher_line
    return WarehouseReceiptOut(
        id=receipt.id,
        voucher_id=line.voucher_id,
        voucher_no=line.voucher.voucher_no,
        voucher_line_id=line.id,
        product_code=receipt.product_code,
        description=line.description,
        warehouse=receipt.warehouse,
        qty_received=receipt.qty_received,
        received_date=receipt.received_date,
        created_at=receipt.created_at,
    )


@router.get("")
def list_receipts(
    user: User = Depends(get_current_app_user), db: Session = Depends(get_db)
) -> list[WarehouseReceiptOut]:
    query = (
        db.query(WarehouseReceipt)
        .join(FactoryVoucherLine, WarehouseReceipt.voucher_line_id == FactoryVoucherLine.id)
        .join(FactoryVoucher, FactoryVoucherLine.voucher_id == FactoryVoucher.id)
        .options(selectinload(WarehouseReceipt.voucher_line).selectinload(FactoryVoucherLine.voucher))
    )
    if user.branch_id is not None:
        query = query.filter(FactoryVoucher.branch_id == user.branch_id)
    query = query.order_by(WarehouseReceipt.received_date.desc(), WarehouseReceipt.created_at.desc())

    return [_receipt_to_out(receipt) for receipt in query.all()]


@router.post("", status_code=status.HTTP_201_CREATED)
def create_receipt(
    payload: WarehouseReceiptCreate,
    user: User = Depends(get_current_app_user),
    db: Session = Depends(get_db),
) -> WarehouseReceiptOut:
    branch_id = resolve_branch_id(user, payload.branch_id, db)

    receipt = record_warehouse_receipt(
        db,
        branch_id=branch_id,
        product_code=payload.product_code,
        warehouse=payload.warehouse,
        qty_received=payload.qty_received,
        received_date=payload.received_date,
    )
    db.commit()
    db.refresh(receipt)
    return _receipt_to_out(receipt)


@router.delete("/{receipt_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_receipt(
    receipt_id: str, user: User = Depends(get_current_app_user), db: Session = Depends(get_db)
) -> None:
    receipt = (
        db.query(WarehouseReceipt)
        .join(FactoryVoucherLine, WarehouseReceipt.voucher_line_id == FactoryVoucherLine.id)
        .join(FactoryVoucher, FactoryVoucherLine.voucher_id == FactoryVoucher.id)
        .filter(WarehouseReceipt.id == receipt_id)
        .first()
    )
    if receipt is None or (user.branch_id is not None and receipt.voucher_line.voucher.branch_id != user.branch_id):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Warehouse receipt not found")

    line = receipt.voucher_line
    line.received_qty = Decimal(str(line.received_qty)) - Decimal(str(receipt.qty_received))
    db.delete(receipt)
    db.commit()
