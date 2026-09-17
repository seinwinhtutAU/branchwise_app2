import uuid
from typing import TYPE_CHECKING

from sqlalchemy import String
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base

if TYPE_CHECKING:
    from app.retail.models.import_batch import ImportBatch
    from app.retail.models.purchase import Purchase
    from app.retail.models.sale import Sale
    from app.retail.models.stock_level import StockLevel
    from app.models.user import User


class Branch(Base):
    __tablename__ = "branches"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    phone_number: Mapped[str] = mapped_column(String(50), nullable=False)
    address: Mapped[str] = mapped_column(String(500), nullable=False)
    # "MDY" (month first) or "DMY" (day first) — each branch's own POS terminal can use
    # a different date convention (confirmed in practice: one branch's Sale export is
    # unambiguously day-first while the reference sample is unambiguously month-first),
    # so this is per-branch rather than a single business-wide setting. Sale still
    # auto-detects per file first (app.retail.services.pos_import._detect_slash_date_order) —
    # this only decides a file with no decisive date of its own. Inventory has no
    # per-file detection (a single, rarely-decisive "Printed" timestamp), so this is
    # authoritative for it.
    sale_date_format: Mapped[str] = mapped_column(String(3), nullable=False, default="MDY")
    inventory_date_format: Mapped[str] = mapped_column(String(3), nullable=False, default="MDY")

    users: Mapped[list["User"]] = relationship(back_populates="branch")
    sales: Mapped[list["Sale"]] = relationship(back_populates="branch")
    purchases: Mapped[list["Purchase"]] = relationship(back_populates="branch")
    stock_levels: Mapped[list["StockLevel"]] = relationship(back_populates="branch")
    import_batches: Mapped[list["ImportBatch"]] = relationship(back_populates="branch")
