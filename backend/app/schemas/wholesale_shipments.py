"""Request/response shapes for /api/wholesale/shipments. Out models are built by hand in
the router rather than via model_config/from_attributes, because they carry derived
figures (shipment_status, leg_remaining, ...) that are not columns at all — see
app/services/wholesale/shipments.py."""

from datetime import date

from pydantic import BaseModel, Field

from app.models.wholesale import WholesaleUnit, WholesaleWriteOffReason


class ShipmentLegIn(BaseModel):
    stop_name: str = Field(min_length=1, max_length=255)
    carrier_name: str = ""
    packages_received: int = Field(ge=0)
    packages_sent: int = Field(ge=0)


class ShipmentWriteOffIn(BaseModel):
    quantity: int = Field(ge=0)
    reason: WholesaleWriteOffReason
    note: str = Field(default="", max_length=1000)
    leg_id: str | None = None


class ShipmentSplitIn(BaseModel):
    """Carves part of a shipment's still-undispatched remainder into a new shipment of
    its own — e.g. the cargo company sends part of a voucher toward Yangon and holds the
    rest for Mandalay. See app/services/wholesale_shipments.py::split_shipment."""

    packages: int = Field(gt=0)
    quantity_pairs: int = Field(gt=0)
    final_destination: str = Field(min_length=1, max_length=255)
    # Defaults to the original shipment's own carrier when left blank — the split-off
    # portion often travels with a different driver/agent, but doesn't have to.
    carrier_name: str = ""


class ShipmentCreate(BaseModel):
    # Only used when the creating account has no fixed branch (admin) — ignored
    # otherwise, per app.services.branches.resolve_branch_id.
    branch_id: str | None = None
    voucher_no: str = Field(min_length=1, max_length=30)
    supplier_name: str = Field(min_length=1, max_length=255)
    carrier_name: str = ""
    final_destination: str = Field(min_length=1, max_length=255)
    sent_on: date
    total_packages: int = Field(ge=0)
    total_quantity_pairs: int = Field(ge=0)
    total_unit: WholesaleUnit = WholesaleUnit.SET
    packages_sent_by_cargo: int = Field(ge=0, default=0)
    final_received_packages: int = Field(ge=0, default=0)
    legs: list[ShipmentLegIn] = []


class ShipmentUpdate(BaseModel):
    """All-optional: a PATCH only touches what it sends. A present `legs` replaces the
    whole set of destinations rather than patching one, since the front end always edits
    the list as a unit and re-runs normalise_flow over it."""

    voucher_no: str | None = Field(default=None, min_length=1, max_length=30)
    supplier_name: str | None = Field(default=None, min_length=1, max_length=255)
    carrier_name: str | None = None
    final_destination: str | None = Field(default=None, min_length=1, max_length=255)
    sent_on: date | None = None
    total_packages: int | None = Field(default=None, ge=0)
    total_quantity_pairs: int | None = Field(default=None, ge=0)
    total_unit: WholesaleUnit | None = None
    packages_sent_by_cargo: int | None = Field(default=None, ge=0)
    final_received_packages: int | None = Field(default=None, ge=0)
    legs: list[ShipmentLegIn] | None = None
