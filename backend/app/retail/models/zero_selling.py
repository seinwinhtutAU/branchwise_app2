import uuid
from datetime import date
from typing import TYPE_CHECKING

from sqlalchemy import Date, ForeignKey, Index, Integer, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base

if TYPE_CHECKING:
    from app.models.branch import Branch
    from app.retail.models.import_batch import ImportBatch


class ZeroSellingRecord(Base):
    """A customer visit that did not become a sales slip."""

    __tablename__ = "zero_selling_records"
    __table_args__ = (
        Index("ix_zero_selling_records_import_batch_id", "import_batch_id"),
        # Serves both the branch-level record list and the Date + Branch conversion summary.
        Index("ix_zero_selling_records_branch_id_sale_date", "branch_id", "sale_date"),
        UniqueConstraint(
            "import_batch_id", "source_sheet", "source_row", name="uq_zero_selling_records_source_row"
        ),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    import_batch_id: Mapped[str] = mapped_column(ForeignKey("import_batches.id"), nullable=False)
    branch_id: Mapped[str | None] = mapped_column(ForeignKey("branches.id"), nullable=True)
    sale_date: Mapped[date] = mapped_column(Date, nullable=False)
    sale_time: Mapped[str | None] = mapped_column(String(20), nullable=True)
    branch: Mapped[str] = mapped_column(String(255), nullable=False)
    category: Mapped[str | None] = mapped_column(String(255), nullable=True)
    reason: Mapped[str | None] = mapped_column(String(2000), nullable=True)
    source_sheet: Mapped[str] = mapped_column(String(100), nullable=False)
    source_row: Mapped[int] = mapped_column(Integer, nullable=False)

    import_batch: Mapped["ImportBatch"] = relationship()
    branch_record: Mapped["Branch | None"] = relationship(back_populates="zero_selling_records")
