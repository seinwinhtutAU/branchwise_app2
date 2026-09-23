import uuid
from typing import TYPE_CHECKING

from sqlalchemy import ForeignKey, Index, Integer, Numeric, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base

if TYPE_CHECKING:
    from app.models.branch import Branch
    from app.retail.models.import_batch import ImportBatch


class SalaryRecord(Base):
    """One employee's salary and bonus as captured from a daily cost upload."""

    __tablename__ = "salary_records"
    __table_args__ = (
        Index("ix_salary_records_branch_id", "branch_id"),
        Index("ix_salary_records_import_batch_id", "import_batch_id"),
        UniqueConstraint(
            "import_batch_id", "source_sheet", "source_row", name="uq_salary_records_source_row"
        ),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    import_batch_id: Mapped[str] = mapped_column(ForeignKey("import_batches.id"), nullable=False)
    # A resolved id is used for branch-level access control.  Keeping the display name
    # makes the source mapping auditable even if a branch is renamed later.
    branch_id: Mapped[str | None] = mapped_column(ForeignKey("branches.id"), nullable=True)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    branch: Mapped[str] = mapped_column(String(255), nullable=False)
    salary: Mapped[float] = mapped_column(Numeric(14, 2), nullable=False)
    bonus: Mapped[float | None] = mapped_column(Numeric(14, 2), nullable=True)
    source_sheet: Mapped[str] = mapped_column(String(100), nullable=False)
    source_row: Mapped[int] = mapped_column(Integer, nullable=False)

    import_batch: Mapped["ImportBatch"] = relationship()
    branch_record: Mapped["Branch | None"] = relationship(back_populates="salary_records")
