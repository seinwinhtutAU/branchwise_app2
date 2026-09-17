"""CRUD for global wholesale reference data."""

from typing import TypeVar

from fastapi import HTTPException, status
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.wholesale.models.master_data import (
    WholesaleCargoCompany,
    WholesaleCarrier,
    WholesaleCustomer,
    WholesaleDestination,
    WholesaleProduct,
    WholesaleReceivingGate,
    WholesaleSupplier,
)
from app.wholesale.services.colors import conversion_rates

NamedModel = TypeVar(
    "NamedModel",
    WholesaleSupplier,
    WholesaleCustomer,
    WholesaleCargoCompany,
    WholesaleCarrier,
    WholesaleDestination,
    WholesaleReceivingGate,
)


def _commit(db: Session, duplicate_message: str) -> None:
    try:
        db.commit()
    except IntegrityError as error:
        db.rollback()
        if "unique" in str(error.orig).lower() or "duplicate" in str(error.orig).lower():
            raise HTTPException(status.HTTP_409_CONFLICT, duplicate_message) from error
        raise


def list_products(db: Session, search: str, include_inactive: bool, page: int, page_size: int):
    query = db.query(WholesaleProduct)
    if not include_inactive:
        query = query.filter(WholesaleProduct.active.is_(True))
    needle = search.strip().lower()
    if needle:
        query = query.filter(
            (WholesaleProduct.stock_code.ilike(f"%{needle}%"))
            | (WholesaleProduct.description.ilike(f"%{needle}%"))
        )
    total = query.count()
    return query.order_by(WholesaleProduct.stock_code).offset((page - 1) * page_size).limit(page_size).all(), total


def get_product(db: Session, entity_id: str) -> WholesaleProduct:
    product = db.get(WholesaleProduct, entity_id)
    if product is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Product not found")
    return product


def get_or_create_product(
    db: Session,
    stock_code: str,
    description: str,
    product_group,
    unit,
    unit_conversions: dict,
) -> None:
    """Ensure Master Data has a catalog row for `stock_code`, creating one from these
    fields if it doesn't already have one — called from the customer-order, supplier-
    voucher, and receiving-item line builders so a stock code typed anywhere in the
    wholesale workflow ends up in the shared product catalog instead of only ever
    existing as free text on that one line.

    Master Data is the source of truth once a product exists: an existing row is left
    untouched here even if this line's description/group disagree with it, so one typo
    on an order can't quietly rewrite the catalog — only a stock code nobody has ever
    recorded before gets a new row. Not committed here; the caller's own commit covers
    it, the same as every other object added during line construction.
    """
    code = stock_code.strip()
    if not code:
        return
    exists = db.query(WholesaleProduct.id).filter(WholesaleProduct.stock_code == code).first()
    if exists is not None:
        return
    db.add(
        WholesaleProduct(
            stock_code=code,
            description=description.strip(),
            product_group=product_group,
            default_unit=unit,
            default_unit_conversions=unit_conversions,
        )
    )


def create_product(db: Session, payload) -> WholesaleProduct:
    product = WholesaleProduct(
        stock_code=payload.stock_code.strip(),
        description=payload.description.strip(),
        product_group=payload.product_group,
        default_unit=payload.default_unit,
        default_unit_conversions=conversion_rates(payload.default_unit_conversions),
        active=payload.active,
    )
    db.add(product)
    _commit(db, "A product with this stock code already exists")
    db.refresh(product)
    return product


def update_product(db: Session, entity_id: str, payload) -> WholesaleProduct:
    product = get_product(db, entity_id)
    for field, value in payload.model_dump(exclude_unset=True).items():
        if field == "default_unit_conversions":
            value = conversion_rates(value)
        setattr(
            product,
            field,
            value.strip()
            if isinstance(value, str) and field not in {"product_group", "default_unit"}
            else value,
        )
    _commit(db, "A product with this stock code already exists")
    db.refresh(product)
    return product


def delete_product(db: Session, entity_id: str) -> None:
    product = get_product(db, entity_id)
    product.active = False
    _commit(db, "Could not deactivate this product")


def list_named_entities(db: Session, model: type[NamedModel], search: str, include_inactive: bool, page: int, page_size: int):
    query = db.query(model)
    if not include_inactive:
        query = query.filter(model.active.is_(True))
    needle = search.strip().lower()
    if needle:
        query = query.filter(model.name.ilike(f"%{needle}%"))
    total = query.count()
    return query.order_by(model.name, model.id).offset((page - 1) * page_size).limit(page_size).all(), total


def get_named_entity(db: Session, model: type[NamedModel], entity_id: str) -> NamedModel:
    entity = db.get(model, entity_id)
    if entity is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Reference data not found")
    return entity


def create_named_entity(db: Session, model: type[NamedModel], name: str, active: bool = True) -> NamedModel:
    entity = model(name=name.strip(), active=active)
    db.add(entity)
    _commit(db, "An entry with this name already exists")
    db.refresh(entity)
    return entity


def update_named_entity(db: Session, model: type[NamedModel], entity_id: str, payload) -> NamedModel:
    entity = get_named_entity(db, model, entity_id)
    for field, value in payload.model_dump(exclude_unset=True).items():
        setattr(entity, field, value.strip() if field == "name" and isinstance(value, str) else value)
    _commit(db, "An entry with this name already exists")
    db.refresh(entity)
    return entity


def delete_named_entity(db: Session, model: type[NamedModel], entity_id: str) -> None:
    entity = get_named_entity(db, model, entity_id)
    entity.active = False
    _commit(db, "Could not deactivate this entry")
