import enum
import uuid
from datetime import date, datetime
from typing import TYPE_CHECKING

from sqlalchemy import JSON, Date, DateTime, Enum, ForeignKey, Numeric, String, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base

if TYPE_CHECKING:
    from app.models.branch import Branch


class OrderStatus(str, enum.Enum):
    NOT_START = "not_start"
    WAITING = "waiting"
    COMPLETE = "complete"


class CustomerOrder(Base):
    """A wholesale customer's order for a product, priced once a matching FactoryVoucher exists.

    Wholesale runs entirely separate from retail: product_code here is free text in its
    own namespace, not a foreign key into the retail-only `products` table (which is keyed
    by POS stock_code and shared across sale/purchase/inventory imports).
    """

    __tablename__ = "customer_orders"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    order_no: Mapped[int] = mapped_column(nullable=False)
    branch_id: Mapped[str | None] = mapped_column(ForeignKey("branches.id"), nullable=True)
    order_date: Mapped[date] = mapped_column(Date, nullable=False)
    product_code: Mapped[str] = mapped_column(String(100), nullable=False)
    factory_name: Mapped[str | None] = mapped_column(String(255), nullable=True)
    customer_name: Mapped[str] = mapped_column(String(255), nullable=False)
    # Customer's initial requested qty (first_commit_qty) vs. the internally-approved qty
    # that's cleared to actually place with the factory (second_commit_qty) — informational,
    # neither drives total_qty or the voucher match.
    first_commit_qty: Mapped[float | None] = mapped_column(Numeric(12, 2), nullable=True)
    second_commit_qty: Mapped[float | None] = mapped_column(Numeric(12, 2), nullable=True)
    # list[{"color": str, "qty": number}] — total_qty is always the sum of this, recomputed
    # server-side on every write rather than trusted from the client.
    colors: Mapped[list] = mapped_column(JSON, nullable=False, default=list)
    total_qty: Mapped[float] = mapped_column(Numeric(12, 2), nullable=False, default=0)
    received_qty: Mapped[float] = mapped_column(Numeric(12, 2), nullable=False, default=0)
    unit: Mapped[str] = mapped_column(String(30), nullable=False, default="Set")
    buying_price: Mapped[float | None] = mapped_column(Numeric(14, 2), nullable=True)
    status: Mapped[OrderStatus] = mapped_column(
        Enum(OrderStatus, values_callable=lambda enum_cls: [member.value for member in enum_cls]),
        nullable=False,
        default=OrderStatus.NOT_START,
    )
    # Which FactoryVoucher last priced this order, so a price/qty/color mismatch between what
    # the factory actually sent and what the customer ordered is traceable rather than implicit.
    matched_voucher_id: Mapped[str | None] = mapped_column(
        ForeignKey("factory_vouchers.id", ondelete="SET NULL"), nullable=True
    )
    remark: Mapped[str | None] = mapped_column(String(1000), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now(), onupdate=func.now())

    branch: Mapped["Branch | None"] = relationship()
    matched_voucher: Mapped["FactoryVoucher | None"] = relationship(foreign_keys=[matched_voucher_id])


class FactoryVoucher(Base):
    """A purchase voucher from a factory — supplies the buying price for matching CustomerOrders.

    Matched to CustomerOrder rows by (branch_id, product_code): one voucher commonly fulfills
    several customer orders for the same product at once (that's how wholesale MOQs work), so
    this is deliberately a one-to-many match, not a picked single order.
    """

    __tablename__ = "factory_vouchers"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    voucher_no: Mapped[int] = mapped_column(nullable=False)
    branch_id: Mapped[str | None] = mapped_column(ForeignKey("branches.id"), nullable=True)
    voucher_date: Mapped[date] = mapped_column(Date, nullable=False)
    factory_name: Mapped[str | None] = mapped_column(String(255), nullable=True)
    product_code: Mapped[str] = mapped_column(String(100), nullable=False)
    qty: Mapped[float] = mapped_column(Numeric(12, 2), nullable=False)
    buying_price: Mapped[float] = mapped_column(Numeric(14, 2), nullable=False)
    colors: Mapped[list] = mapped_column(JSON, nullable=False, default=list)
    discount_per_set: Mapped[float | None] = mapped_column(Numeric(14, 2), nullable=True)
    remark: Mapped[str | None] = mapped_column(String(1000), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())

    branch: Mapped["Branch | None"] = relationship()
