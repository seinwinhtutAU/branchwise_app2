import uuid
from datetime import datetime
from typing import TYPE_CHECKING

from sqlalchemy import DateTime, String, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base

if TYPE_CHECKING:
    from app.retail.models.purchase import PurchaseLine
    from app.retail.models.sale import SaleLine
    from app.retail.models.stock_level import StockLevel


class Product(Base):
    __tablename__ = "products"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    stock_code: Mapped[str] = mapped_column(String(100), nullable=False, unique=True)
    description: Mapped[str] = mapped_column(String(500), nullable=False)
    group_name: Mapped[str | None] = mapped_column(String(100), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now(), onupdate=func.now())

    sale_lines: Mapped[list["SaleLine"]] = relationship(back_populates="product")
    purchase_lines: Mapped[list["PurchaseLine"]] = relationship(back_populates="product")
    stock_levels: Mapped[list["StockLevel"]] = relationship(back_populates="product")
