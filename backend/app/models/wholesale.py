"""The wholesale workflow's data model, rebuilt around the front-end's finished screens
rather than the original ERD (see diagram/wholesale/erd.mmd and its erd-notes.md
companion). The front-end moved on while the screens were built — quantities are stored
in pairs, colours carry their own unit letter, most "status" and "total" fields are
worked out on read rather than typed or stored — and this module follows the code that
actually ships, not the diagram.

The old wholesale tables (customer_orders, customer_order_lines, factory_vouchers,
factory_voucher_lines, warehouse_receipts) were dropped on 2026-09-11 by migration
b7e4d0c91a52; this is a fresh start, phased in screen by screen. The phases run
source-first rather than in nav order — Delivery, Receiving, Supplier Vouchers, Customer
Orders, Inventory — so each screen's derived figures (a voucher's received quantity, a
shipment's finally-received packages) are already correct the day it ships, rather than
reading zero until a later phase supplies what they are derived from. Each phase adds its
own tables to this module rather than opening a new file, so the whole wholesale schema
stays in one place.

Quantities here are always whole pairs (Integer, never Numeric). Each product supplies a
rate map for new lines, and every quantity-bearing line retains that map as an immutable
snapshot so its historic meaning cannot be changed by a later product update.

Phase 1: Delivery — wholesale_shipments and wholesale_shipment_legs.
Phase 2 (this revision): Receiving — wholesale_receivings, wholesale_receiving_packages,
wholesale_receiving_items, wholesale_receiving_costs. Once a receiving exists for a
shipment, the shipment's final_received_packages column becomes a fallback: the API
prefers the count of packages actually recorded at the gate (see
app/services/wholesale_receivings.py::final_received_by_shipment and its use in
app/routers/wholesale_shipments.py), the same rule store.ts::settleShipment already
follows on the front end.
"""

import enum
import uuid
from datetime import date, datetime
from typing import TYPE_CHECKING

from sqlalchemy import (
    Date,
    JSON,
    DateTime,
    Enum,
    ForeignKey,
    Index,
    Integer,
    Numeric,
    String,
    UniqueConstraint,
    func,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base

if TYPE_CHECKING:
    from app.models.branch import Branch


class ProductGroup(str, enum.Enum):
    """Man, lady or child — the range the business thinks in, not a retail category.
    Kept on every line rather than looked up, so a line still reads correctly after a
    product is renamed (see wholesale/products.ts's comment on the same choice)."""

    MAN = "man"
    LADY = "lady"
    CHILD = "child"


class WholesaleUnit(str, enum.Enum):
    """A pair is the thing itself; a set is 6 pairs, a dozen is 12. Every quantity in the
    wholesale tables is *stored* in pairs, whatever unit it was typed in — see
    app/services/wholesale/units.py::PAIRS_PER, the single source for the conversion.
    This column only ever says what unit a figure was written in, for display."""

    PAIR = "pair"
    SET = "set"
    DOZEN = "dozen"


class WholesaleWriteOffReason(str, enum.Enum):
    """Why a shipment quantity does not match the expected count."""

    LOST_IN_TRANSIT = "lost_in_transit"
    DAMAGED = "damaged"
    SHORT_SHIPPED = "short_shipped"
    OTHER = "other"
    REPACKAGED = "repackaged"


class Shipment(Base):
    """One supplier voucher travelling here as freight, and the stops it passes through
    on the way — the ERD's SHIPMENT, renamed to match the screen. `voucher_no` is a plain
    human reference for now (Supplier Vouchers doesn't have a table until phase 3); the
    real FK is added once one exists.

    `final_received_packages` is stored here because Receiving doesn't exist yet (phase
    2): until a receiving is raised against this shipment, this column is the only word
    anyone has on what reached the gate. Once a receiving exists, the API prefers the
    count of packages actually recorded at the gate — the same fallback rule
    store.ts::settleShipment already follows."""

    __tablename__ = "wholesale_shipments"
    __table_args__ = (
        UniqueConstraint("branch_id", "shipment_no", name="uq_wholesale_shipments_branch_id_shipment_no"),
        Index("ix_wholesale_shipments_branch_id_sent_date", "branch_id", "sent_date"),
        Index("ix_wholesale_shipments_voucher_no", "voucher_no"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    branch_id: Mapped[str | None] = mapped_column(ForeignKey("branches.id"), nullable=True)
    # PREFIX-YYMMDD-NNNN, e.g. SHP-260827-0001 — see app/services/wholesale/references.py.
    # Server-assigned on create, never accepted from the client.
    shipment_no: Mapped[str] = mapped_column(String(30), nullable=False)
    # The supplier voucher this shipment carries, by its human reference — no FK until
    # Supplier Vouchers exists (phase 3).
    voucher_no: Mapped[str] = mapped_column(String(30), nullable=False)
    supplier_name: Mapped[str] = mapped_column(String(255), nullable=False)
    carrier_name: Mapped[str] = mapped_column("cargo_name", String(255), nullable=False)
    # The receiving gate this shipment lands at, as its short address — gate and
    # warehouse are the same building, so this one string is the whole of a place's
    # identity (see wholesale/shipments.ts's RECEIVING_GATES comment).
    final_destination: Mapped[str] = mapped_column("final_location", String(255), nullable=False)
    sent_on: Mapped[date] = mapped_column("sent_date", Date, nullable=False)
    total_packages: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    # What is inside those packages — the supplier's own count of the goods, in pairs.
    total_quantity_pairs: Mapped[int] = mapped_column("total_pairs", Integer, nullable=False, default=0)
    total_unit: Mapped[WholesaleUnit] = mapped_column(
        Enum(WholesaleUnit, name="wholesale_unit", values_callable=lambda enum_cls: [m.value for m in enum_cls]),
        nullable=False,
        default=WholesaleUnit.SET,
    )
    packages_sent_by_cargo: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    # Stored today; becomes a fallback once a receiving exists (phase 2). See class
    # docstring.
    final_received_packages: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    # Packages that will never reach the final destination. This is deliberately a
    # running total; WholesaleWriteOff is the append-only explanation for each change.
    lost_packages: Mapped[int] = mapped_column(Integer, nullable=False, default=0, server_default="0")
    # Set only when this shipment was carved out of another one's still-undispatched
    # remainder (see app/services/wholesale_shipments.py::split_shipment) — e.g. the
    # cargo company sends part of a voucher toward Yangon and holds the rest for
    # Mandalay. NULL for an ordinary shipment. SET NULL on delete rather than CASCADE:
    # removing the parent shouldn't take a since-independent split down with it.
    split_from_shipment_id: Mapped[str | None] = mapped_column(
        ForeignKey("wholesale_shipments.id", ondelete="SET NULL"), nullable=True
    )
    version_id: Mapped[int] = mapped_column(Integer, nullable=False, default=1, server_default="1")
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now(), onupdate=func.now())

    __mapper_args__ = {"version_id_col": version_id}

    branch: Mapped["Branch | None"] = relationship()
    legs: Mapped[list["ShipmentLeg"]] = relationship(
        back_populates="shipment", cascade="all, delete-orphan", order_by="ShipmentLeg.leg_order"
    )


class ShipmentLeg(Base):
    """One stop on the way here — the ERD's shipment_leg. `leg_order` is rewritten
    whenever legs are added or removed, so it always reads 1..N with no gaps; the flow
    figures (packages_received/packages_sent) are re-clamped by
    app/services/wholesale/shipments.py::normalise_flow on every write so a leg can never
    hold more than the stop before it actually sent."""

    __tablename__ = "wholesale_shipment_legs"
    __table_args__ = (
        UniqueConstraint("shipment_id", "leg_order", name="uq_wholesale_shipment_legs_shipment_id_leg_order"),
        Index("ix_wholesale_shipment_legs_shipment_id", "shipment_id"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    shipment_id: Mapped[str] = mapped_column(ForeignKey("wholesale_shipments.id", ondelete="CASCADE"), nullable=False)
    leg_order: Mapped[int] = mapped_column(Integer, nullable=False)
    stop_name: Mapped[str] = mapped_column(String(255), nullable=False)
    carrier_name: Mapped[str] = mapped_column(String(255), nullable=False)
    packages_received: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    packages_sent: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    # Packages lost after this stop received them and before it could send them on.
    lost_packages: Mapped[int] = mapped_column(Integer, nullable=False, default=0, server_default="0")
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())

    shipment: Mapped["Shipment"] = relationship(back_populates="legs")


class Receiving(Base):
    """One delivery landing at one of our gates, and what was actually inside its
    packages — the ERD's ARRIVAL, renamed to match the screen (RCV-YYMMDD-NNNN, not
    the ERD's plain arrival_id). shipment_id/voucher_no/supplier_name are copied onto the
    row at creation time from the shipment picked, the same denormalisation
    CustomerOrderLine and SupplierVoucherLine already use for description/product_group: a
    receiving still reads correctly if the shipment it came off is edited afterwards.

    total_quantity_pairs is what the voucher says is coming; what was actually found is
    counted_pairs, computed from the packages that have been opened (see
    app/services/wholesale/receivings.py) — never stored, so it can never disagree with
    the packages themselves."""

    __tablename__ = "wholesale_receivings"
    __table_args__ = (
        UniqueConstraint("branch_id", "receiving_no", name="uq_wholesale_receivings_branch_id_receiving_no"),
        Index("ix_wholesale_receivings_branch_id_received_date", "branch_id", "received_date"),
        Index("ix_wholesale_receivings_shipment_id", "shipment_id"),
        Index("ix_wholesale_receivings_voucher_no", "voucher_no"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    branch_id: Mapped[str | None] = mapped_column(ForeignKey("branches.id"), nullable=True)
    # PREFIX-YYMMDD-NNNN, e.g. RCV-260908-0001 — see app/services/wholesale/references.py.
    receiving_no: Mapped[str] = mapped_column(String(30), nullable=False)
    # RESTRICT, not CASCADE: a shipment with a receiving against it cannot be deleted
    # (the router returns 409 before it ever reaches the database, but this is the
    # backstop) — see app/services/wholesale_shipments.py::delete_shipment.
    shipment_id: Mapped[str] = mapped_column(ForeignKey("wholesale_shipments.id", ondelete="RESTRICT"), nullable=False)
    shipment_no: Mapped[str] = mapped_column(String(30), nullable=False)
    voucher_no: Mapped[str] = mapped_column(String(30), nullable=False)
    supplier_name: Mapped[str] = mapped_column(String(255), nullable=False)
    # The gate this delivery landed at, as its short address.
    gate: Mapped[str] = mapped_column(String(255), nullable=False)
    received_on: Mapped[date] = mapped_column("received_date", Date, nullable=False)
    total_packages: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    total_quantity_pairs: Mapped[int] = mapped_column("total_pairs", Integer, nullable=False, default=0)
    total_unit: Mapped[WholesaleUnit] = mapped_column(
        Enum(WholesaleUnit, name="wholesale_unit", values_callable=lambda enum_cls: [m.value for m in enum_cls]),
        nullable=False,
        default=WholesaleUnit.SET,
    )
    version_id: Mapped[int] = mapped_column(Integer, nullable=False, server_default="1", default=1)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now(), onupdate=func.now())

    __mapper_args__ = {"version_id_col": version_id}

    branch: Mapped["Branch | None"] = relationship()
    packages: Mapped[list["ReceivingPackage"]] = relationship(
        back_populates="receiving", cascade="all, delete-orphan", order_by="ReceivingPackage.package_no"
    )
    costs: Mapped[list["ReceivingCost"]] = relationship(
        back_populates="receiving", cascade="all, delete-orphan", order_by="ReceivingCost.created_at"
    )


class ReceivingPackage(Base):
    """One physical box. A package nobody has opened yet has no contents recorded at
    all (opened=False, items empty) — not the same as a package that turned out to hold
    nothing. received_on is nullable rather than an empty string, since packages of one
    delivery do not all arrive together — a few can follow a week later — and the date
    belongs to the package once it does."""

    __tablename__ = "wholesale_receiving_packages"
    __table_args__ = (
        UniqueConstraint("receiving_id", "package_no", name="uq_wholesale_receiving_packages_receiving_id_package_no"),
        Index("ix_wholesale_receiving_packages_receiving_id", "receiving_id"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    receiving_id: Mapped[str] = mapped_column(
        ForeignKey("wholesale_receivings.id", ondelete="CASCADE"), nullable=False
    )
    package_no: Mapped[int] = mapped_column(Integer, nullable=False)
    opened: Mapped[bool] = mapped_column(nullable=False, default=False)
    received_on: Mapped[date | None] = mapped_column("received_date", Date, nullable=True)
    note: Mapped[str] = mapped_column(String(1000), nullable=False, default="")
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now(), onupdate=func.now())

    receiving: Mapped["Receiving"] = relationship(back_populates="packages")
    items: Mapped[list["ReceivingItem"]] = relationship(
        back_populates="package", cascade="all, delete-orphan", order_by="ReceivingItem.created_at"
    )


class ReceivingItem(Base):
    """One product found inside a package. A package rarely holds just one: a box
    packed at the factory can carry several stock codes together. quantity_pairs is computed
    server-side from the quantity and unit typed in — the same "stored in pairs, shown in
    whatever unit it was typed in" rule every other quantity here follows. color_breakdown is
    kept as free text (checked for format, not cross-checked against quantity_pairs): staff
    fill in how many and what colours as two separate facts about the same box, the way
    the Receiving screen's two inputs already work."""

    __tablename__ = "wholesale_receiving_items"
    __table_args__ = (Index("ix_wholesale_receiving_items_package_id", "package_id"),)

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    package_id: Mapped[str] = mapped_column(
        ForeignKey("wholesale_receiving_packages.id", ondelete="CASCADE"), nullable=False
    )
    stock_code: Mapped[str] = mapped_column(String(100), nullable=False)
    description: Mapped[str] = mapped_column(String(500), nullable=False, default="")
    product_group: Mapped[ProductGroup] = mapped_column(
        Enum(ProductGroup, name="wholesale_product_group", values_callable=lambda enum_cls: [m.value for m in enum_cls]),
        nullable=False,
        default=ProductGroup.MAN,
    )
    color_breakdown: Mapped[str] = mapped_column("color_qty", String(1000), nullable=False, default="")
    # Parsed from color_breakdown on every write — a cache of the parse, not a second source of
    # truth, exactly as CustomerOrderLine.colors already works.
    colors: Mapped[list] = mapped_column(JSON, nullable=False, default=list)
    unit: Mapped[WholesaleUnit] = mapped_column(
        Enum(WholesaleUnit, name="wholesale_unit", values_callable=lambda enum_cls: [m.value for m in enum_cls]),
        nullable=False,
        default=WholesaleUnit.SET,
    )
    unit_conversions: Mapped[dict] = mapped_column(JSON, nullable=False, default=lambda: {"pair": 1, "set": 6, "dozen": 12})
    quantity_pairs: Mapped[int] = mapped_column("qty_pairs", Integer, nullable=False, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())

    package: Mapped["ReceivingPackage"] = relationship(back_populates="items")


class ReceivingCost(Base):
    """One charge against a delivery. Transport is not a single fee paid once — the
    cargo company's own fee, a carrier between two towns, porters unloading at the gate
    — so each charge is written down on its own and says where it was spent, letting the
    cost of a route be read stage by stage. A charge belongs to the delivery as a whole,
    never to one package inside it."""

    __tablename__ = "wholesale_receiving_costs"
    __table_args__ = (Index("ix_wholesale_receiving_costs_receiving_id", "receiving_id"),)

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    receiving_id: Mapped[str] = mapped_column(
        ForeignKey("wholesale_receivings.id", ondelete="CASCADE"), nullable=False
    )
    cost_date: Mapped[date] = mapped_column(Date, nullable=False)
    # Where it was spent — the cargo company, one of the destinations, or the gate.
    # Blank reads as "Not said where" (see cost_by_stage).
    stage: Mapped[str] = mapped_column(String(255), nullable=False, default="")
    carrier: Mapped[str] = mapped_column(String(255), nullable=False, default="")
    kind: Mapped[str] = mapped_column(String(100), nullable=False, default="")
    # Always the Kyat amount, whatever currency this charge was actually paid in — see
    # app/services/wholesale/currency.py. A non-MMK currency_code additionally carries
    # original_amount/exchange_rate, the immutable snapshot this figure was computed
    # from; a `ck_wholesale_receiving_costs_currency_fields` check constraint enforces
    # that MMK rows never carry them and foreign rows always do.
    amount: Mapped[float] = mapped_column(Numeric(14, 2), nullable=False, default=0)
    currency_code: Mapped[str] = mapped_column(String(3), nullable=False, default="MMK")
    original_amount: Mapped[float | None] = mapped_column(Numeric(18, 4), nullable=True)
    exchange_rate: Mapped[float | None] = mapped_column(Numeric(24, 12), nullable=True)
    note: Mapped[str] = mapped_column(String(1000), nullable=False, default="")
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())

    receiving: Mapped["Receiving"] = relationship(back_populates="costs")


class SupplierVoucher(Base):
    """A supplier's document for one batch of goods. Totals, received quantity and
    payment status are read from its lines, receivings and payments — never copied here."""

    __tablename__ = "wholesale_supplier_vouchers"
    __table_args__ = (
        UniqueConstraint("branch_id", "voucher_no", name="uq_wholesale_supplier_vouchers_branch_id_voucher_no"),
        Index("ix_wholesale_supplier_vouchers_branch_id_voucher_date", "branch_id", "voucher_date"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    branch_id: Mapped[str | None] = mapped_column(ForeignKey("branches.id"), nullable=True)
    voucher_no: Mapped[str] = mapped_column(String(30), nullable=False)
    supplier_name: Mapped[str] = mapped_column(String(255), nullable=False)
    voucher_date: Mapped[date] = mapped_column(Date, nullable=False)
    carrier_name: Mapped[str] = mapped_column("cargo_name", String(255), nullable=False, default="")
    total_packages: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    version_id: Mapped[int] = mapped_column(Integer, nullable=False, server_default="1", default=1)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now(), onupdate=func.now())

    __mapper_args__ = {"version_id_col": version_id}

    branch: Mapped["Branch | None"] = relationship()
    lines: Mapped[list["SupplierVoucherLine"]] = relationship(
        back_populates="voucher", cascade="all, delete-orphan", order_by="SupplierVoucherLine.created_at"
    )
    payments: Mapped[list["WholesalePayment"]] = relationship(
        back_populates="voucher", cascade="all, delete-orphan", order_by="WholesalePayment.paid_on"
    )


class SupplierVoucherLine(Base):
    __tablename__ = "wholesale_supplier_voucher_lines"
    __table_args__ = (Index("ix_wholesale_supplier_voucher_lines_voucher_id", "voucher_id"),)

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    voucher_id: Mapped[str] = mapped_column(
        ForeignKey("wholesale_supplier_vouchers.id", ondelete="CASCADE"), nullable=False
    )
    stock_code: Mapped[str] = mapped_column(String(100), nullable=False)
    description: Mapped[str] = mapped_column(String(500), nullable=False, default="")
    product_group: Mapped[ProductGroup] = mapped_column(
        Enum(ProductGroup, name="wholesale_product_group", values_callable=lambda enum_cls: [m.value for m in enum_cls]),
        nullable=False,
    )
    color_breakdown: Mapped[str] = mapped_column("color_qty", String(1000), nullable=False)
    colors: Mapped[list] = mapped_column(JSON, nullable=False, default=list)
    unit: Mapped[WholesaleUnit] = mapped_column(
        Enum(WholesaleUnit, name="wholesale_unit", values_callable=lambda enum_cls: [m.value for m in enum_cls]),
        nullable=False,
    )
    unit_conversions: Mapped[dict] = mapped_column(JSON, nullable=False, default=lambda: {"pair": 1, "set": 6, "dozen": 12})
    quantity_pairs: Mapped[int] = mapped_column("wanted_pairs", Integer, nullable=False)
    lost_quantity_pairs: Mapped[int] = mapped_column(Integer, nullable=False, default=0, server_default="0")
    # Always the Kyat unit price, whatever currency this line was actually priced in —
    # see app/services/wholesale/currency.py. A non-MMK currency_code additionally
    # carries original_buying_price/exchange_rate, the immutable snapshot this figure
    # was computed from; a `ck_wholesale_supplier_voucher_lines_currency_fields` check
    # constraint enforces that MMK rows never carry them and foreign rows always do.
    buying_price: Mapped[float] = mapped_column(Numeric(14, 2), nullable=False, default=0)
    currency_code: Mapped[str] = mapped_column(String(3), nullable=False, default="MMK")
    original_buying_price: Mapped[float | None] = mapped_column(Numeric(18, 4), nullable=True)
    exchange_rate: Mapped[float | None] = mapped_column(Numeric(24, 12), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())

    voucher: Mapped["SupplierVoucher"] = relationship(back_populates="lines")


class WholesalePayment(Base):
    """One payment against either a supplier voucher or a customer order.

    The two accounts have the same shape, so they deliberately share this table. Their
    totals and payment statuses are calculated from these rows by the endpoint that
    reads the parent document.
    """

    __tablename__ = "wholesale_payments"
    __table_args__ = (Index("ix_wholesale_payments_voucher_id_paid_on", "voucher_id", "paid_on"),)

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    branch_id: Mapped[str | None] = mapped_column(ForeignKey("branches.id"), nullable=True)
    voucher_id: Mapped[str | None] = mapped_column(ForeignKey("wholesale_supplier_vouchers.id", ondelete="CASCADE"))
    order_id: Mapped[str | None] = mapped_column(ForeignKey("wholesale_customer_orders.id", ondelete="CASCADE"))
    paid_on: Mapped[date] = mapped_column(Date, nullable=False)
    amount: Mapped[float] = mapped_column(Numeric(14, 2), nullable=False)
    # Customer payments may be assigned to delivered pairs. Supplier voucher
    # payments leave this empty because package payment logic does not apply there.
    paid_quantity_pairs: Mapped[int | None] = mapped_column(Integer, nullable=True)
    note: Mapped[str] = mapped_column(String(1000), nullable=False, default="")
    recorded_by_user_id: Mapped[str] = mapped_column(String(36), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())

    branch: Mapped["Branch | None"] = relationship()
    voucher: Mapped["SupplierVoucher | None"] = relationship(back_populates="payments")
    order: Mapped["CustomerOrder | None"] = relationship(back_populates="payments")


class CustomerOrder(Base):
    __tablename__ = "wholesale_customer_orders"
    __table_args__ = (UniqueConstraint("branch_id", "order_no", name="uq_wholesale_customer_orders_branch_id_order_no"), Index("ix_wholesale_customer_orders_branch_id_order_date", "branch_id", "order_date"))
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    branch_id: Mapped[str | None] = mapped_column(ForeignKey("branches.id"))
    order_no: Mapped[str] = mapped_column(String(30), nullable=False)
    customer_name: Mapped[str] = mapped_column(String(255), nullable=False)
    customer_phone: Mapped[str] = mapped_column(String(100), nullable=False, default="")
    customer_address: Mapped[str] = mapped_column(String(1000), nullable=False, default="")
    order_date: Mapped[date] = mapped_column(Date, nullable=False)
    cancelled: Mapped[bool] = mapped_column(nullable=False, default=False)
    version_id: Mapped[int] = mapped_column(Integer, nullable=False, default=1, server_default="1")
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now(), onupdate=func.now())

    __mapper_args__ = {"version_id_col": version_id}

    lines: Mapped[list["CustomerOrderLine"]] = relationship(
        back_populates="order", cascade="all, delete-orphan", order_by="CustomerOrderLine.id"
    )
    payments: Mapped[list["WholesalePayment"]] = relationship(
        back_populates="order", foreign_keys="WholesalePayment.order_id", cascade="all, delete-orphan",
        order_by="WholesalePayment.paid_on",
    )


class CustomerOrderLine(Base):
    __tablename__ = "wholesale_customer_order_lines"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    order_id: Mapped[str] = mapped_column(ForeignKey("wholesale_customer_orders.id", ondelete="CASCADE"), nullable=False, index=True)
    stock_code: Mapped[str] = mapped_column(String(100), nullable=False)
    description: Mapped[str] = mapped_column(String(500), nullable=False, default="")
    product_group: Mapped[ProductGroup] = mapped_column(Enum(ProductGroup, name="wholesale_product_group", values_callable=lambda e: [m.value for m in e]), nullable=False)
    supplier_name: Mapped[str] = mapped_column(String(255), nullable=False, default="")
    color_breakdown: Mapped[str] = mapped_column("color_qty", String(1000), nullable=False)
    colors: Mapped[list] = mapped_column(JSON, nullable=False, default=list)
    unit: Mapped[WholesaleUnit] = mapped_column(Enum(WholesaleUnit, name="wholesale_unit", values_callable=lambda e: [m.value for m in e]), nullable=False)
    unit_conversions: Mapped[dict] = mapped_column(JSON, nullable=False, default=lambda: {"pair": 1, "set": 6, "dozen": 12})
    quantity_pairs: Mapped[int] = mapped_column("wanted_pairs", Integer, nullable=False)
    allocated_quantity_pairs: Mapped[int] = mapped_column(Integer, nullable=False, default=0, server_default="0")
    allocated_color_breakdown: Mapped[str] = mapped_column(String(1000), nullable=False, default="", server_default="")
    lost_quantity_pairs: Mapped[int] = mapped_column(Integer, nullable=False, default=0, server_default="0")
    # Always the Kyat unit price, whatever currency this line was actually priced in —
    # see app/services/wholesale/currency.py. A non-MMK currency_code additionally
    # carries original_selling_price/exchange_rate, the immutable snapshot this figure
    # was computed from; a `ck_wholesale_customer_order_lines_currency_fields` check
    # constraint enforces that MMK rows never carry them and foreign rows always do.
    selling_price: Mapped[float] = mapped_column(Numeric(14, 2), nullable=False)
    currency_code: Mapped[str] = mapped_column(String(3), nullable=False, default="MMK")
    original_selling_price: Mapped[float | None] = mapped_column(Numeric(18, 4), nullable=True)
    exchange_rate: Mapped[float | None] = mapped_column(Numeric(24, 12), nullable=True)
    order: Mapped["CustomerOrder"] = relationship(back_populates="lines")


class WholesaleStockMovement(Base):
    """One confirmed delivery to a customer.

    Only outgoing movement rows exist. Incoming stock is the set of opened Receiving
    package items, calculated whenever stock is read. That keeps the gate's count as the
    one source of truth for goods that arrived.
    """

    __tablename__ = "wholesale_stock_movements"
    __table_args__ = (
        Index("ix_wholesale_stock_movements_branch_stock_location", "branch_id", "stock_code", "location"),
        Index("ix_wholesale_stock_movements_order_id", "order_id"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    branch_id: Mapped[str | None] = mapped_column(ForeignKey("branches.id"), nullable=True)
    order_id: Mapped[str] = mapped_column(
        ForeignKey("wholesale_customer_orders.id", ondelete="RESTRICT"), nullable=False
    )
    stock_code: Mapped[str] = mapped_column(String(100), nullable=False)
    description: Mapped[str] = mapped_column(String(500), nullable=False, default="")
    product_group: Mapped[ProductGroup] = mapped_column(
        Enum(ProductGroup, name="wholesale_product_group", values_callable=lambda e: [m.value for m in e]),
        nullable=False,
    )
    color_breakdown: Mapped[str] = mapped_column("color_qty", String(1000), nullable=False)
    colors: Mapped[list] = mapped_column(JSON, nullable=False, default=list)
    # The source order line's rates at delivery time.  Colour shorthand remains readable
    # even if the product's set size changes after stock leaves the gate.
    unit_conversions: Mapped[dict] = mapped_column(JSON, nullable=False, default=lambda: {"pair": 1, "set": 6, "dozen": 12})
    quantity_pairs: Mapped[int] = mapped_column("qty_pairs", Integer, nullable=False)
    location: Mapped[str] = mapped_column(String(255), nullable=False)
    delivery_address: Mapped[str] = mapped_column(String(1000), nullable=False, default="")
    delivered_on: Mapped[date] = mapped_column("moved_on", Date, nullable=False)
    note: Mapped[str] = mapped_column(String(1000), nullable=False, default="")
    recorded_by_user_id: Mapped[str] = mapped_column(String(36), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())

    branch: Mapped["Branch | None"] = relationship()
    order: Mapped["CustomerOrder"] = relationship()


class AllocationEvent(Base):
    """One reservation of arrived stock against a customer-order line.

    `allocate_order_line` (app/services/wholesale/orders.py) overwrites the line's
    `allocated_quantity_pairs`/`allocated_color_breakdown` in place — those columns only
    ever hold the current state, the way a stock count does. This table is the append-only
    log of each time that state changed, so the Allocation Record screen has something to
    list: who allocated what, to which order, and when. Written whenever the resulting
    value differs from what was there before; a save that leaves the allocation unchanged
    writes no row.
    """

    __tablename__ = "wholesale_allocation_events"
    __table_args__ = (
        Index("ix_wholesale_allocation_events_branch_id_created_at", "branch_id", "created_at"),
        Index("ix_wholesale_allocation_events_order_line_id", "order_line_id"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    branch_id: Mapped[str | None] = mapped_column(ForeignKey("branches.id"), nullable=True)
    order_id: Mapped[str] = mapped_column(
        ForeignKey("wholesale_customer_orders.id", ondelete="CASCADE"), nullable=False
    )
    order_line_id: Mapped[str] = mapped_column(
        ForeignKey("wholesale_customer_order_lines.id", ondelete="CASCADE"), nullable=False
    )
    order_no: Mapped[str] = mapped_column(String(30), nullable=False)
    customer_name: Mapped[str] = mapped_column(String(255), nullable=False)
    stock_code: Mapped[str] = mapped_column(String(100), nullable=False)
    description: Mapped[str] = mapped_column(String(500), nullable=False, default="")
    product_group: Mapped[ProductGroup] = mapped_column(
        Enum(ProductGroup, name="wholesale_product_group", values_callable=lambda e: [m.value for m in e]),
        nullable=False,
    )
    unit: Mapped[WholesaleUnit] = mapped_column(
        Enum(WholesaleUnit, name="wholesale_unit", values_callable=lambda e: [m.value for m in e]),
        nullable=False,
    )
    unit_conversions: Mapped[dict] = mapped_column(JSON, nullable=False, default=lambda: {"pair": 1, "set": 6, "dozen": 12})
    previous_color_breakdown: Mapped[str] = mapped_column(String(1000), nullable=False, default="")
    previous_quantity_pairs: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    color_breakdown: Mapped[str] = mapped_column(String(1000), nullable=False, default="")
    quantity_pairs: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    recorded_by_user_id: Mapped[str] = mapped_column(String(36), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())

    branch: Mapped["Branch | None"] = relationship()
    order: Mapped["CustomerOrder"] = relationship()


class WholesaleWriteOff(Base):
    """An append-only explanation for a quantity that will not arrive or be delivered.

    The subject is polymorphic because the same action applies to a shipment, a route
    leg, a supplier-voucher line, and a customer-order line. The denormalised labels
    keep the audit trail readable even if the source row is later edited.
    """

    __tablename__ = "wholesale_write_offs"
    __table_args__ = (
        Index("ix_wholesale_write_offs_branch_id_created_at", "branch_id", "created_at"),
        Index("ix_wholesale_write_offs_subject", "subject_type", "subject_id"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    branch_id: Mapped[str | None] = mapped_column(ForeignKey("branches.id"), nullable=True)
    subject_type: Mapped[str] = mapped_column(String(30), nullable=False)
    subject_id: Mapped[str] = mapped_column(String(36), nullable=False)
    reference: Mapped[str] = mapped_column(String(100), nullable=False, default="")
    description: Mapped[str] = mapped_column(String(500), nullable=False, default="")
    stock_code: Mapped[str] = mapped_column(String(100), nullable=False, default="")
    quantity: Mapped[int] = mapped_column(Integer, nullable=False)
    unit: Mapped[str] = mapped_column(String(30), nullable=False)
    unit_conversions: Mapped[dict] = mapped_column(JSON, nullable=False, default=lambda: {"pair": 1, "set": 6, "dozen": 12})
    reason: Mapped[WholesaleWriteOffReason] = mapped_column(
        Enum(
            WholesaleWriteOffReason,
            name="wholesale_write_off_reason",
            values_callable=lambda enum_cls: [m.value for m in enum_cls],
        ),
        nullable=False,
    )
    note: Mapped[str] = mapped_column(String(1000), nullable=False, default="")
    recorded_by_user_id: Mapped[str] = mapped_column(String(36), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())

    branch: Mapped["Branch | None"] = relationship()


class WholesaleAuditLog(Base):
    """An append-only audit trail for wholesale domain events and state transitions."""

    __tablename__ = "wholesale_audit_logs"
    __table_args__ = (
        Index("ix_wholesale_audit_logs_branch_id_created_at", "branch_id", "created_at"),
        Index("ix_wholesale_audit_logs_entity", "entity_type", "entity_id"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    branch_id: Mapped[str | None] = mapped_column(ForeignKey("branches.id"), nullable=True)
    entity_type: Mapped[str] = mapped_column(String(50), nullable=False)
    entity_id: Mapped[str] = mapped_column(String(36), nullable=False)
    action: Mapped[str] = mapped_column(String(50), nullable=False)
    operator_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    summary: Mapped[str] = mapped_column(String(500), nullable=False, default="")
    payload: Mapped[dict] = mapped_column(JSON, nullable=False, default=dict)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())

    branch: Mapped["Branch | None"] = relationship()

