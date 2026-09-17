"""Transactions for closing an outstanding wholesale shortfall with an explanation."""

from fastapi import HTTPException, status
from sqlalchemy import func
from sqlalchemy.orm import Session, selectinload

from app.models.wholesale import (
    CustomerOrderLine,
    Shipment,
    SupplierVoucherLine,
    WholesaleWriteOff,
    WholesaleWriteOffReason,
)
from app.services.wholesale.lifecycle import (
    ShipmentAction,
    assert_can_perform_shipment_action,
)
from app.services.wholesale.shipments import final_remaining, max_for_leg
from app.services.wholesale.supplier_vouchers_service import received_pairs_by_voucher_stock
from app.services.wholesale.receivings_service import final_received_by_shipment
from app.services.wholesale.inventory import delivered_pairs_by_order


def _validate_reason(reason: WholesaleWriteOffReason | str) -> WholesaleWriteOffReason:
    try:
        return reason if isinstance(reason, WholesaleWriteOffReason) else WholesaleWriteOffReason(reason)
    except ValueError as error:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, "Choose a valid write-off reason") from error


def _positive(quantity: int) -> None:
    if quantity <= 0:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, "Write-off quantity must be greater than zero")


def _loss_reason(reason: WholesaleWriteOffReason) -> None:
    if reason is WholesaleWriteOffReason.REPACKAGED:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_CONTENT,
            "Repackaging can only be recorded for shipment packages",
        )


def _repackaged_note(previous: int, current: int, note: str) -> str:
    summary = f"Recounted: {previous} → {current} packages"
    extra = note.strip()
    return f"{summary} — {extra}" if extra else summary


def _exceeding(quantity: int, remaining: int) -> None:
    if quantity > remaining:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_CONTENT,
            f"Write-off cannot exceed the {remaining} still outstanding",
        )


def _write_off(
    db: Session,
    *,
    branch_id: str | None,
    subject_type: str,
    subject_id: str,
    reference: str,
    description: str,
    stock_code: str,
    quantity: int,
    unit: str,
    unit_conversions: dict[str, int] | None = None,
    reason: WholesaleWriteOffReason | str,
    note: str,
    user_id: str,
) -> WholesaleWriteOff:
    entry = WholesaleWriteOff(
        branch_id=branch_id,
        subject_type=subject_type,
        subject_id=subject_id,
        reference=reference,
        description=description,
        stock_code=stock_code,
        quantity=quantity,
        unit=unit,
        unit_conversions=unit_conversions or {"pair": 1, "set": 6, "dozen": 12},
        reason=_validate_reason(reason),
        note=note.strip(),
        recorded_by_user_id=user_id,
    )
    db.add(entry)
    db.commit()
    db.refresh(entry)
    return entry


def write_off_shipment(
    db: Session,
    shipment_id: str,
    leg_id_or_none: str | None,
    quantity: int,
    reason: WholesaleWriteOffReason | str,
    note: str,
    user_id: str,
    branch_id: str | None = None,
) -> WholesaleWriteOff:
    validated_reason = _validate_reason(reason)
    if validated_reason is not WholesaleWriteOffReason.REPACKAGED:
        _positive(quantity)
    shipment = (
        db.query(Shipment)
        .options(selectinload(Shipment.legs))
        .filter(Shipment.id == shipment_id)
        .with_for_update()
        .first()
    )
    if shipment is None or (branch_id is not None and shipment.branch_id != branch_id):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Shipment not found")

    received = final_received_by_shipment(db, [shipment.id]).get(
        shipment.id, shipment.final_received_packages
    )
    assert_can_perform_shipment_action(shipment, ShipmentAction.WRITE_OFF, received)
    shipment.updated_at = func.now()

    if leg_id_or_none is not None:
        leg = next((candidate for candidate in shipment.legs if candidate.id == leg_id_or_none), None)
        if leg is None:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "Shipment leg not found")
        if validated_reason is WholesaleWriteOffReason.REPACKAGED:
            previous = leg.packages_sent
            leg.packages_received = quantity
            leg.packages_sent = quantity
            return _write_off(
                db,
                branch_id=shipment.branch_id,
                subject_type="shipment_leg",
                subject_id=leg.id,
                reference=shipment.shipment_no,
                description=leg.stop_name,
                stock_code=shipment.voucher_no,
                quantity=quantity,
                unit="package",
                reason=validated_reason,
                note=_repackaged_note(previous, quantity, note),
                user_id=user_id,
            )
        remaining = max(0, max_for_leg(shipment, shipment.legs.index(leg)) - leg.packages_sent - leg.lost_packages)
        _exceeding(quantity, remaining)
        leg.lost_packages += quantity
        return _write_off(
            db,
            branch_id=shipment.branch_id,
            subject_type="shipment_leg",
            subject_id=leg.id,
            reference=shipment.shipment_no,
            description=leg.stop_name,
            stock_code=shipment.voucher_no,
            quantity=quantity,
            unit="package",
            reason=validated_reason,
            note=note,
            user_id=user_id,
        )

    received = final_received_by_shipment(db, [shipment.id]).get(
        shipment.id, shipment.final_received_packages
    )
    if validated_reason is WholesaleWriteOffReason.REPACKAGED:
        previous = shipment.total_packages
        shipment.total_packages = quantity
        return _write_off(
            db,
            branch_id=shipment.branch_id,
            subject_type="shipment",
            subject_id=shipment.id,
            reference=shipment.shipment_no,
            description=shipment.final_destination,
            stock_code=shipment.voucher_no,
            quantity=quantity,
            unit="package",
            reason=validated_reason,
            note=_repackaged_note(previous, quantity, note),
            user_id=user_id,
        )
    remaining = final_remaining(shipment, received)
    _exceeding(quantity, remaining)
    shipment.lost_packages += quantity
    return _write_off(
        db,
        branch_id=shipment.branch_id,
        subject_type="shipment",
        subject_id=shipment.id,
        reference=shipment.shipment_no,
        description=shipment.final_destination,
        stock_code=shipment.voucher_no,
        quantity=quantity,
        unit="package",
        reason=validated_reason,
        note=note,
        user_id=user_id,
    )


def write_off_voucher_line(
    db: Session,
    voucher_line_id: str,
    quantity: int,
    reason: WholesaleWriteOffReason | str,
    note: str,
    user_id: str,
    branch_id: str | None = None,
) -> WholesaleWriteOff:
    validated_reason = _validate_reason(reason)
    _loss_reason(validated_reason)
    _positive(quantity)
    line = (
        db.query(SupplierVoucherLine)
        .options(selectinload(SupplierVoucherLine.voucher))
        .filter(SupplierVoucherLine.id == voucher_line_id)
        .with_for_update()
        .first()
    )
    if line is None or (branch_id is not None and line.voucher.branch_id != branch_id):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Supplier voucher line not found")
    received = received_pairs_by_voucher_stock(
        db, [line.voucher.voucher_no], line.voucher.branch_id
    ).get((line.voucher.voucher_no, line.stock_code), 0)
    remaining = max(0, line.quantity_pairs - received - line.lost_quantity_pairs)
    _exceeding(quantity, remaining)
    line.lost_quantity_pairs += quantity
    if line.voucher is not None:
        line.voucher.updated_at = func.now()
    return _write_off(
        db,
        branch_id=line.voucher.branch_id,
        subject_type="voucher_line",
        subject_id=line.id,
        reference=line.voucher.voucher_no,
        description=line.description,
        stock_code=line.stock_code,
        quantity=quantity,
        unit=line.unit.value,
        unit_conversions=line.unit_conversions,
        reason=validated_reason,
        note=note,
        user_id=user_id,
    )


def write_off_order_line(
    db: Session,
    order_line_id: str,
    quantity: int,
    reason: WholesaleWriteOffReason | str,
    note: str,
    user_id: str,
    branch_id: str | None = None,
) -> WholesaleWriteOff:
    validated_reason = _validate_reason(reason)
    _loss_reason(validated_reason)
    _positive(quantity)
    line = (
        db.query(CustomerOrderLine)
        .options(selectinload(CustomerOrderLine.order))
        .filter(CustomerOrderLine.id == order_line_id)
        .with_for_update()
        .first()
    )
    if line is None or (branch_id is not None and line.order.branch_id != branch_id):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Customer order line not found")
    if line.order.cancelled:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, "A cancelled order cannot be written off")
    delivered = delivered_pairs_by_order(db, [line.order_id], line.order.branch_id).get(
        line.order_id, {}
    ).get(line.stock_code, 0)
    remaining = max(0, line.quantity_pairs - delivered - line.lost_quantity_pairs)
    _exceeding(quantity, remaining)
    line.lost_quantity_pairs += quantity
    return _write_off(
        db,
        branch_id=line.order.branch_id,
        subject_type="order_line",
        subject_id=line.id,
        reference=line.order.order_no,
        description=line.description,
        stock_code=line.stock_code,
        quantity=quantity,
        unit=line.unit.value,
        unit_conversions=line.unit_conversions,
        reason=validated_reason,
        note=note,
        user_id=user_id,
    )


def list_write_offs(db: Session, branch_id: str | None, search: str = "") -> list[WholesaleWriteOff]:
    query = db.query(WholesaleWriteOff)
    if branch_id is not None:
        query = query.filter(WholesaleWriteOff.branch_id == branch_id)
    entries = query.order_by(WholesaleWriteOff.created_at.desc()).all()
    query_text = search.strip().lower()
    if not query_text:
        return entries
    return [
        entry
        for entry in entries
        if query_text in entry.reference.lower()
        or query_text in entry.description.lower()
        or query_text in entry.stock_code.lower()
        or query_text in entry.reason.value.lower()
        or query_text in entry.note.lower()
    ]


def write_off_to_dict(entry: WholesaleWriteOff) -> dict:
    return {
        "write_off_id": entry.id,
        "branch_id": entry.branch_id,
        "subject_type": entry.subject_type,
        "subject_id": entry.subject_id,
        "reference": entry.reference,
        "description": entry.description,
        "stock_code": entry.stock_code,
        "quantity": entry.quantity,
        "unit": entry.unit,
        "unit_conversions": entry.unit_conversions,
        "reason": entry.reason.value,
        "note": entry.note,
        "recorded_by_user_id": entry.recorded_by_user_id,
        "created_at": entry.created_at,
    }
