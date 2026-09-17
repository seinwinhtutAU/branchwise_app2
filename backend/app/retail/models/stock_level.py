import uuid
from datetime import datetime
from typing import TYPE_CHECKING

from sqlalchemy import DateTime, ForeignKey, Index, Numeric, String, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base

if TYPE_CHECKING:
    from app.models.branch import Branch
    from app.retail.models.import_batch import ImportBatch
    from app.retail.models.product import Product


class StockLevel(Base):
    __tablename__ = "stock_levels"
    __table_args__ = (
        Index("ix_stock_levels_product_branch_snapshot", "product_id", "branch_id", "snapshot_at"),
        # The existing index above leads with product_id, so it doesn't help the
        # branch-only + snapshot-date lookups the reconciliation check does (finding
        # the latest/prior snapshot *timestamps* for a branch before joining back to
        # product_id). This one serves those directly.
        Index("ix_stock_levels_branch_id_snapshot_at", "branch_id", "snapshot_at"),
        Index("ix_stock_levels_import_batch_id", "import_batch_id"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    branch_id: Mapped[str | None] = mapped_column(ForeignKey("branches.id"), nullable=True)
    import_batch_id: Mapped[str | None] = mapped_column(ForeignKey("import_batches.id"), nullable=True)
    location_raw: Mapped[str | None] = mapped_column(String(255), nullable=True)
    product_id: Mapped[str] = mapped_column(ForeignKey("products.id"), nullable=False)
    on_hand_qty: Mapped[float | None] = mapped_column(Numeric(12, 2), nullable=True)
    buying_price: Mapped[float | None] = mapped_column(Numeric(14, 2), nullable=True)
    selling_price: Mapped[float | None] = mapped_column(Numeric(14, 2), nullable=True)
    snapshot_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, server_default=func.now())
    source_file: Mapped[str | None] = mapped_column(String(255), nullable=True)

    branch: Mapped["Branch | None"] = relationship(back_populates="stock_levels")
    import_batch: Mapped["ImportBatch | None"] = relationship()
    product: Mapped["Product"] = relationship(back_populates="stock_levels")
