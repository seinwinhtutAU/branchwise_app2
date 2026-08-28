import uuid
from datetime import date, datetime
from typing import TYPE_CHECKING

from sqlalchemy import Date, DateTime, ForeignKey, Index, Integer, Numeric, String, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base

if TYPE_CHECKING:
    from app.models.branch import Branch
    from app.models.import_batch import ImportBatch
    from app.models.product import Product


class Sale(Base):
    __tablename__ = "sales"
    __table_args__ = (
        # Serves GET /api/sales' branch + date-range filter and the reconciliation
        # check's branch + date-range scan — both filter on this pair together.
        Index("ix_sales_branch_id_sale_date", "branch_id", "sale_date"),
        Index("ix_sales_import_batch_id", "import_batch_id"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    branch_id: Mapped[str | None] = mapped_column(ForeignKey("branches.id"), nullable=True)
    import_batch_id: Mapped[str | None] = mapped_column(ForeignKey("import_batches.id"), nullable=True)
    location_raw: Mapped[str | None] = mapped_column(String(255), nullable=True)
    slip_id: Mapped[str] = mapped_column(String(50), nullable=False, unique=True)
    slip_number: Mapped[str] = mapped_column(String(20), nullable=False)
    sale_date: Mapped[date] = mapped_column(Date, nullable=False)
    sale_time: Mapped[str | None] = mapped_column(String(20), nullable=True)
    source_file: Mapped[str | None] = mapped_column(String(255), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())

    branch: Mapped["Branch | None"] = relationship(back_populates="sales")
    import_batch: Mapped["ImportBatch | None"] = relationship()
    lines: Mapped[list["SaleLine"]] = relationship(back_populates="sale")


class SaleLine(Base):
    __tablename__ = "sale_lines"
    __table_args__ = (Index("ix_sale_lines_sale_id", "sale_id"),)

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    sale_id: Mapped[str] = mapped_column(ForeignKey("sales.id"), nullable=False)
    line_id: Mapped[str] = mapped_column(String(60), nullable=False, unique=True)
    line_no: Mapped[int] = mapped_column(Integer, nullable=False)
    product_id: Mapped[str] = mapped_column(ForeignKey("products.id"), nullable=False)
    selling_price: Mapped[float | None] = mapped_column(Numeric(14, 2), nullable=True)
    qty: Mapped[float | None] = mapped_column(Numeric(12, 2), nullable=True)
    uom: Mapped[str | None] = mapped_column(String(30), nullable=True)
    discount_amount: Mapped[float | None] = mapped_column(Numeric(14, 2), nullable=True)
    amount: Mapped[float | None] = mapped_column(Numeric(14, 2), nullable=True)
    net_amount: Mapped[float | None] = mapped_column(Numeric(14, 2), nullable=True)

    sale: Mapped["Sale"] = relationship(back_populates="lines")
    product: Mapped["Product"] = relationship(back_populates="sale_lines")
