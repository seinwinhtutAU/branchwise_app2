"""CRUD for global wholesale reference data."""

from typing import TypeVar

from fastapi import HTTPException, status
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.models.wholesale_master_data import (
    WholesaleCargoCompany,
    WholesaleCarrier,
    WholesaleCustomer,
    WholesaleDestination,
    WholesaleProduct,
    WholesaleReceivingGate,
    WholesaleSupplier,
)

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


def create_product(db: Session, payload) -> WholesaleProduct:
    product = WholesaleProduct(
        stock_code=payload.stock_code.strip(),
        description=payload.description.strip(),
        product_group=payload.product_group,
        active=payload.active,
    )
    db.add(product)
    _commit(db, "A product with this stock code already exists")
    db.refresh(product)
    return product


def update_product(db: Session, entity_id: str, payload) -> WholesaleProduct:
    product = get_product(db, entity_id)
    for field, value in payload.model_dump(exclude_unset=True).items():
        setattr(product, field, value.strip() if isinstance(value, str) and field != "product_group" else value)
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
