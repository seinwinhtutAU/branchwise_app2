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
    """A wholesale customer's order — a header shared by every product the customer ordered
    on that occasion. Each product is its own CustomerOrderLine, priced independently once a
    matching FactoryVoucherLine exists.
    """

    __tablename__ = "customer_orders"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    order_no: Mapped[int] = mapped_column(nullable=False)
    branch_id: Mapped[str | None] = mapped_column(ForeignKey("branches.id"), nullable=True)
    order_date: Mapped[date] = mapped_column(Date, nullable=False)
    customer_name: Mapped[str] = mapped_column(String(255), nullable=False)
    remark: Mapped[str | None] = mapped_column(String(1000), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now(), onupdate=func.now())

    branch: Mapped["Branch | None"] = relationship()
    lines: Mapped[list["CustomerOrderLine"]] = relationship(
        back_populates="order", cascade="all, delete-orphan", order_by="CustomerOrderLine.created_at"
    )


class CustomerOrderLine(Base):
    """One product within a CustomerOrder.

    Wholesale runs entirely separate from retail: product_code here is free text in its own
    namespace, not a foreign key into the retail-only `products` table (which is keyed by POS
    stock_code and shared across sale/purchase/inventory imports).
    """

    __tablename__ = "customer_order_lines"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    order_id: Mapped[str] = mapped_column(ForeignKey("customer_orders.id", ondelete="CASCADE"), nullable=False)
    product_code: Mapped[str] = mapped_column(String(100), nullable=False)
    description: Mapped[str | None] = mapped_column(String(500), nullable=True)
    factory_name: Mapped[str | None] = mapped_column(String(255), nullable=True)
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
    # Which FactoryVoucherLine last priced this line, so a price/qty/color mismatch between
    # what the factory actually sent and what the customer ordered is traceable rather than
    # implicit.
    matched_voucher_id: Mapped[str | None] = mapped_column(
        ForeignKey("factory_voucher_lines.id", ondelete="SET NULL"), nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now(), onupdate=func.now())

    order: Mapped["CustomerOrder"] = relationship(back_populates="lines")
    matched_voucher_line: Mapped["FactoryVoucherLine | None"] = relationship(foreign_keys=[matched_voucher_id])


class FactoryVoucher(Base):
    """A purchase voucher from a factory — a header shared by every product on that voucher.
    Each product is its own FactoryVoucherLine, which supplies the buying price for matching
    CustomerOrderLines.

    Matched to CustomerOrderLine rows by (branch_id, product_code): a voucher line commonly
    fulfills several customer order lines for the same product at once (that's how wholesale
    MOQs work), so this is deliberately a one-to-many match, not a picked single order.
    """

    __tablename__ = "factory_vouchers"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    voucher_no: Mapped[int] = mapped_column(nullable=False)
    branch_id: Mapped[str | None] = mapped_column(ForeignKey("branches.id"), nullable=True)
    voucher_date: Mapped[date] = mapped_column(Date, nullable=False)
    factory_name: Mapped[str | None] = mapped_column(String(255), nullable=True)
    remark: Mapped[str | None] = mapped_column(String(1000), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())

    branch: Mapped["Branch | None"] = relationship()
    lines: Mapped[list["FactoryVoucherLine"]] = relationship(
        back_populates="voucher", cascade="all, delete-orphan", order_by="FactoryVoucherLine.created_at"
    )


class FactoryVoucherLine(Base):
    """One product within a FactoryVoucher."""

    __tablename__ = "factory_voucher_lines"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    voucher_id: Mapped[str] = mapped_column(ForeignKey("factory_vouchers.id", ondelete="CASCADE"), nullable=False)
    product_code: Mapped[str] = mapped_column(String(100), nullable=False)
    description: Mapped[str | None] = mapped_column(String(500), nullable=True)
    qty: Mapped[float] = mapped_column(Numeric(12, 2), nullable=False)
    # Buying qty is `qty` above. Receiving qty accumulates from WarehouseReceipt rows created
    # against this line (see record_warehouse_receipt in services/wholesale.py) — never set
    # directly by a client. Remaining qty (qty - received_qty) is derived, not stored.
    received_qty: Mapped[float] = mapped_column(Numeric(12, 2), nullable=False, default=0)
    buying_price: Mapped[float] = mapped_column(Numeric(14, 2), nullable=False)
    colors: Mapped[list] = mapped_column(JSON, nullable=False, default=list)
    discount_per_set: Mapped[float | None] = mapped_column(Numeric(14, 2), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())

    voucher: Mapped["FactoryVoucher"] = relationship(back_populates="lines")
    receipts: Mapped[list["WarehouseReceipt"]] = relationship(
        back_populates="voucher_line", cascade="all, delete-orphan"
    )


class WarehouseReceipt(Base):
    """One arrival log entry: some qty of a stock code physically showed up at a warehouse.

    Deliberately flat, not a header+lines structure — unlike FactoryVoucher/CustomerOrder,
    there's no shared header data to factor out (warehouse and date can differ row to row),
    and the warehouse floor staff recording this don't know or care which factory voucher a
    stock code belongs to. `voucher_line_id` is resolved server-side by matching product_code
    against open voucher lines (see find_voucher_line_for_arrival), never chosen by the caller.
    """

    __tablename__ = "warehouse_receipts"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    voucher_line_id: Mapped[str] = mapped_column(
        ForeignKey("factory_voucher_lines.id", ondelete="CASCADE"), nullable=False
    )
    product_code: Mapped[str] = mapped_column(String(100), nullable=False)
    warehouse: Mapped[str] = mapped_column(String(255), nullable=False)
    qty_received: Mapped[float] = mapped_column(Numeric(12, 2), nullable=False)
    received_date: Mapped[date] = mapped_column(Date, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())

    voucher_line: Mapped["FactoryVoucherLine"] = relationship(back_populates="receipts")
