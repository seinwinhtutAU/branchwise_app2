import enum
import uuid
from datetime import datetime
from typing import TYPE_CHECKING

from sqlalchemy import (
    JSON,
    DateTime,
    Enum,
    ForeignKey,
    Index,
    Integer,
    LargeBinary,
    String,
    UniqueConstraint,
    func,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base

if TYPE_CHECKING:
    from app.models.branch import Branch
    from app.models.user import User


class ImportType(str, enum.Enum):
    SALES = "sales"
    INVENTORY = "inventory"
    PURCHASE = "purchase"
    # A file kept exactly as uploaded, without parsing it into retail data.
    GENERAL = "general"


class ImportBatchStatus(str, enum.Enum):
    COMPLETED = "completed"
    REVERTED = "reverted"
    # Set instead of REVERTED when the revert happened as part of picking a corrected
    # file to replace this batch (the Warning page's/Import History's "Reimport" flow),
    # rather than a standalone removal with no replacement — see confirm_purchase_file
    # and friends' `replaced` query param.
    REIMPORTED = "reimported"


class ImportBatch(Base):
    __tablename__ = "import_batches"
    __table_args__ = (
        # Serves GET /api/imports/history: filter by branch_id, order by created_at desc.
        Index("ix_import_batches_branch_id_created_at", "branch_id", "created_at"),
        # A client retains this UUID when a weak connection forces it to retry a confirm.
        # PostgreSQL allows multiple NULLs, so old imports without a key remain valid.
        UniqueConstraint("request_key", name="uq_import_batches_request_key"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    import_type: Mapped[ImportType] = mapped_column(
        Enum(ImportType, values_callable=lambda enum_cls: [member.value for member in enum_cls]),
        nullable=False,
    )
    branch_id: Mapped[str | None] = mapped_column(ForeignKey("branches.id"), nullable=True)
    uploaded_by: Mapped[str | None] = mapped_column(ForeignKey("users.id"), nullable=True)
    filename: Mapped[str | None] = mapped_column(String(255), nullable=True)
    status: Mapped[ImportBatchStatus] = mapped_column(
        Enum(ImportBatchStatus, values_callable=lambda enum_cls: [member.value for member in enum_cls]),
        nullable=False,
        default=ImportBatchStatus.COMPLETED,
    )
    summary: Mapped[dict] = mapped_column(JSON, nullable=False, default=dict)
    # Snapshot of the origin/clean grids shown at confirm time (same shape as the
    # preview endpoints' response) — the persisted Sale/PurchaseLine/StockLevel rows
    # don't preserve the original file layout or row-level validation notes, so this
    # is what backs the "view this past import" history detail page.
    preview_data: Mapped[dict] = mapped_column(JSON, nullable=False, default=dict)
    # Object storage key in Cloudflare R2 where the raw uploaded spreadsheet file is preserved
    storage_key: Mapped[str | None] = mapped_column(String(500), nullable=True)
    # The client-generated Idempotency-Key for a confirmed import.  It makes replaying
    # the same request safe after the server committed but its answer was lost in transit.
    request_key: Mapped[str | None] = mapped_column(String(64), nullable=True)
    # General uploads are retained in the database as well as optionally mirrored to
    # object storage. Keeping these bytes makes the feature useful in installations
    # that have not configured Cloudflare R2 yet.
    original_file: Mapped[bytes | None] = mapped_column(LargeBinary, nullable=True)
    original_file_size: Mapped[int | None] = mapped_column(Integer, nullable=True)
    original_file_content_type: Mapped[str | None] = mapped_column(String(255), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())
    reverted_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    reverted_by: Mapped[str | None] = mapped_column(ForeignKey("users.id"), nullable=True)
    # Set when someone marks this batch's Import Health flag as handled — e.g. the
    # batch is an old pre-fix incident whose data gap was already patched by a
    # separate later batch, so the flag is historically accurate but no longer
    # actionable. Distinct from `status`/`reverted_*`: dismissing doesn't touch the
    # batch's data or its place in Import History, it only hides it from the
    # "Batches to review" list (app/retail/services/import_health.py).
    health_dismissed_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    health_dismissed_by: Mapped[str | None] = mapped_column(ForeignKey("users.id"), nullable=True)

    branch: Mapped["Branch | None"] = relationship(
        back_populates="import_batches", foreign_keys=[branch_id]
    )
    uploaded_by_user: Mapped["User | None"] = relationship(foreign_keys=[uploaded_by])
    reverted_by_user: Mapped["User | None"] = relationship(foreign_keys=[reverted_by])
    health_dismissed_by_user: Mapped["User | None"] = relationship(foreign_keys=[health_dismissed_by])
