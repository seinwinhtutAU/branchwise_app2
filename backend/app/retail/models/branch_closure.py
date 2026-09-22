import uuid
from datetime import date as date_
from datetime import datetime
from typing import TYPE_CHECKING

from sqlalchemy import Date, DateTime, Enum, ForeignKey, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base
from app.retail.models.import_batch import ImportType

if TYPE_CHECKING:
    from app.models.branch import Branch
    from app.models.user import User


class BranchClosure(Base):
    """Confirms a day genuinely had no Sale or Inventory data on purpose — the branch
    was closed — rather than someone forgetting to import. A row with `closed_at` set
    is what stops app/retail/services/import_completeness.py's missing-day scan from
    listing that day as still needing attention; reopening (a mistaken mark) nulls
    `closed_at`/`closed_by` back out rather than deleting the row, the same audit-trail
    convention as ImportBatch.health_dismissed_at/health_dismissed_by.

    Reuses ImportType (only ever SALES or INVENTORY here — Purchase isn't daily, see
    import_completeness.py) rather than a new enum, so the underlying Postgres type
    doesn't need one more of its own.
    """

    __tablename__ = "branch_closures"
    __table_args__ = (
        UniqueConstraint(
            "branch_id", "closure_type", "closure_date", name="uq_branch_closures_branch_type_date"
        ),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    branch_id: Mapped[str] = mapped_column(ForeignKey("branches.id"), nullable=False)
    closure_type: Mapped[ImportType] = mapped_column(
        Enum(
            ImportType,
            name="importtype",
            values_callable=lambda enum_cls: [member.value for member in enum_cls],
        ),
        nullable=False,
    )
    closure_date: Mapped[date_] = mapped_column(Date, nullable=False)
    note: Mapped[str | None] = mapped_column(String(500), nullable=True)
    closed_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    closed_by: Mapped[str | None] = mapped_column(ForeignKey("users.id"), nullable=True)

    branch: Mapped["Branch"] = relationship()
    closed_by_user: Mapped["User | None"] = relationship(foreign_keys=[closed_by])
