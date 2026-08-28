import uuid
from datetime import date, datetime
from typing import TYPE_CHECKING

from sqlalchemy import Date, DateTime, ForeignKey, Index, Numeric, String, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base

if TYPE_CHECKING:
    from app.models.branch import Branch
    from app.models.import_batch import ImportBatch
    from app.models.product import Product


class Purchase(Base):
    __tablename__ = "purchases"
    __table_args__ = (
        # Mirrors Sale's index — serves GET /api/purchases' branch + date-range filter
        # and the reconciliation check's branch + date-range scan.
        Index("ix_purchases_branch_id_purchase_date", "branch_id", "purchase_date"),
        Index("ix_purchases_import_batch_id", "import_batch_id"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    branch_id: Mapped[str | None] = mapped_column(ForeignKey("branches.id"), nullable=True)
    import_batch_id: Mapped[str | None] = mapped_column(ForeignKey("import_batches.id"), nullable=True)
    location_raw: Mapped[str | None] = mapped_column(String(255), nullable=True)
    purchase_date: Mapped[date] = mapped_column(Date, nullable=False)
    source_file: Mapped[str | None] = mapped_column(String(255), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())

    branch: Mapped["Branch | None"] = relationship(back_populates="purchases")
    import_batch: Mapped["ImportBatch | None"] = relationship()
    lines: Mapped[list["PurchaseLine"]] = relationship(back_populates="purchase")


class PurchaseLine(Base):
    __tablename__ = "purchase_lines"
    __table_args__ = (Index("ix_purchase_lines_purchase_id", "purchase_id"),)

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    purchase_id: Mapped[str] = mapped_column(ForeignKey("purchases.id"), nullable=False)
    product_id: Mapped[str] = mapped_column(ForeignKey("products.id"), nullable=False)
    quantity: Mapped[float | None] = mapped_column(Numeric(12, 2), nullable=True)
    uom: Mapped[str | None] = mapped_column(String(30), nullable=True)
    buying_price: Mapped[float | None] = mapped_column(Numeric(14, 2), nullable=True)

    purchase: Mapped["Purchase"] = relationship(back_populates="lines")
    product: Mapped["Product"] = relationship(back_populates="purchase_lines")
