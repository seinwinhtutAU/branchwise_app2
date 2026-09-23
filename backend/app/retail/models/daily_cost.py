import uuid
from datetime import date
from typing import TYPE_CHECKING

from sqlalchemy import Date, ForeignKey, Index, Numeric, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base

if TYPE_CHECKING:
    from app.models.branch import Branch
    from app.retail.models.import_batch import ImportBatch


class DailyCostRecord(Base):
    """One branch's normalized daily operating-cost summary."""

    __tablename__ = "daily_cost_records"
    __table_args__ = (
        Index("ix_daily_cost_records_import_batch_id", "import_batch_id"),
        Index("ix_daily_cost_records_branch_id_cost_date", "branch_id", "cost_date"),
        UniqueConstraint(
            "import_batch_id", "source_sheet", name="uq_daily_cost_records_source_sheet"
        ),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    import_batch_id: Mapped[str] = mapped_column(ForeignKey("import_batches.id"), nullable=False)
    branch_id: Mapped[str | None] = mapped_column(ForeignKey("branches.id"), nullable=True)
    cost_date: Mapped[date] = mapped_column(Date, nullable=False)
    branch: Mapped[str] = mapped_column(String(255), nullable=False)
    usage: Mapped[str | None] = mapped_column(String(4000), nullable=True)
    usage_total: Mapped[float] = mapped_column(Numeric(14, 2), nullable=False, default=0)
    digital_income: Mapped[str | None] = mapped_column(String(4000), nullable=True)
    digital_income_total: Mapped[float] = mapped_column(Numeric(14, 2), nullable=False, default=0)
    return_items: Mapped[str | None] = mapped_column(String(4000), nullable=True)
    return_total: Mapped[float] = mapped_column(Numeric(14, 2), nullable=False, default=0)
    capital_expenditure: Mapped[str | None] = mapped_column(String(4000), nullable=True)
    capital_total: Mapped[float] = mapped_column(Numeric(14, 2), nullable=False, default=0)
    source_sheet: Mapped[str] = mapped_column(String(100), nullable=False)

    import_batch: Mapped["ImportBatch"] = relationship()
    branch_record: Mapped["Branch | None"] = relationship(back_populates="daily_cost_records")
