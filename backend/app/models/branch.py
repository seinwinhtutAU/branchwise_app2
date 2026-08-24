import uuid
from typing import TYPE_CHECKING

from sqlalchemy import String
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base

if TYPE_CHECKING:
    from app.models.import_batch import ImportBatch
    from app.models.purchase import Purchase
    from app.models.sale import Sale
    from app.models.stock_level import StockLevel
    from app.models.user import User


class Branch(Base):
    __tablename__ = "branches"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    phone_number: Mapped[str] = mapped_column(String(50), nullable=False)
    address: Mapped[str] = mapped_column(String(500), nullable=False)

    users: Mapped[list["User"]] = relationship(back_populates="branch")
    sales: Mapped[list["Sale"]] = relationship(back_populates="branch")
    purchases: Mapped[list["Purchase"]] = relationship(back_populates="branch")
    stock_levels: Mapped[list["StockLevel"]] = relationship(back_populates="branch")
    import_batches: Mapped[list["ImportBatch"]] = relationship(back_populates="branch")
