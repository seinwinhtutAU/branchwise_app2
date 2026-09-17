"""Global reference data used by the wholesale workspace."""

import uuid
from datetime import datetime

from sqlalchemy import JSON, DateTime, Enum, String, UniqueConstraint, func
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base
from app.wholesale.models.entities import ProductGroup, WholesaleUnit


class _NamedMasterData(Base):
    __abstract__ = True

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    active: Mapped[bool] = mapped_column(nullable=False, default=True, server_default="1")
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now(), onupdate=func.now())


class WholesaleProduct(Base):
    __tablename__ = "wholesale_products"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    stock_code: Mapped[str] = mapped_column(String(100), nullable=False, unique=True)
    description: Mapped[str] = mapped_column(String(500), nullable=False, default="", server_default="")
    product_group: Mapped[ProductGroup] = mapped_column(
        Enum(ProductGroup, name="wholesale_product_group", values_callable=lambda enum_cls: [m.value for m in enum_cls]),
        nullable=False,
        default=ProductGroup.MAN,
    )
    default_unit: Mapped[WholesaleUnit] = mapped_column(
        Enum(WholesaleUnit, name="wholesale_unit", values_callable=lambda enum_cls: [m.value for m in enum_cls]),
        nullable=False,
        default=WholesaleUnit.SET,
        server_default=WholesaleUnit.SET.value,
    )
    default_unit_conversions: Mapped[dict] = mapped_column(
        JSON,
        nullable=False,
        default=lambda: {"pair": 1, "set": 6, "dozen": 12},
        server_default='{"pair": 1, "set": 6, "dozen": 12}',
    )
    active: Mapped[bool] = mapped_column(nullable=False, default=True, server_default="1")
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now(), onupdate=func.now())


class WholesaleSupplier(_NamedMasterData):
    __tablename__ = "wholesale_suppliers"
    __table_args__ = (UniqueConstraint("name", name="uq_wholesale_suppliers_name"),)

    phone: Mapped[str] = mapped_column(String(100), nullable=False, default="", server_default="")
    address: Mapped[str] = mapped_column(String(1000), nullable=False, default="", server_default="")


class WholesaleCustomer(_NamedMasterData):
    __tablename__ = "wholesale_customers"

    phone: Mapped[str] = mapped_column(String(100), nullable=False, default="", server_default="")
    address: Mapped[str] = mapped_column(String(1000), nullable=False, default="", server_default="")


class WholesaleCargoCompany(_NamedMasterData):
    __tablename__ = "wholesale_cargo_companies"
    __table_args__ = (UniqueConstraint("name", name="uq_wholesale_cargo_companies_name"),)


class WholesaleCarrier(_NamedMasterData):
    __tablename__ = "wholesale_carriers"
    __table_args__ = (UniqueConstraint("name", name="uq_wholesale_carriers_name"),)


class WholesaleDestination(_NamedMasterData):
    __tablename__ = "wholesale_destinations"
    __table_args__ = (UniqueConstraint("name", name="uq_wholesale_destinations_name"),)


class WholesaleReceivingGate(_NamedMasterData):
    __tablename__ = "wholesale_receiving_gates"
    __table_args__ = (UniqueConstraint("name", name="uq_wholesale_receiving_gates_name"),)
