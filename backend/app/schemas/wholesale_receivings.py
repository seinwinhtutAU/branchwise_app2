"""Request/response shapes for /api/wholesale/receivings. Out models are built by hand
in the router — see app/services/wholesale/receivings.py for the derived figures they
carry (counted_pairs, receiving_status, ...)."""

from datetime import date

from pydantic import BaseModel, Field

from app.models.wholesale import ProductGroup, WholesaleUnit


class ReceivingCreate(BaseModel):
    # Only used when the creating account has no fixed branch (admin) — ignored
    # otherwise, per app.services.branches.resolve_branch_id.
    branch_id: str | None = None
    shipment_id: str = Field(min_length=1)
    gate: str = Field(min_length=1, max_length=255)
    received_on: date
    total_packages: int = Field(ge=0)
    total_quantity_pairs: int = Field(ge=0)
    total_unit: WholesaleUnit = WholesaleUnit.SET


class ReceivingUpdate(BaseModel):
    """All-optional: a PATCH only touches what it sends. A changed total_packages
    resizes the package rows — new ones added empty, extra ones dropped from the end,
    refusing to drop one that has already been opened."""

    gate: str | None = Field(default=None, min_length=1, max_length=255)
    received_on: date | None = None
    total_packages: int | None = Field(default=None, ge=0)
    total_quantity_pairs: int | None = Field(default=None, ge=0)
    total_unit: WholesaleUnit | None = None


class ReceivingItemIn(BaseModel):
    stock_code: str = ""
    description: str = ""
    product_group: ProductGroup = ProductGroup.MAN
    color_breakdown: str = ""
    quantity: int = Field(ge=0, default=0)
    unit: WholesaleUnit = WholesaleUnit.SET
    unit_conversions: dict[str, int] = Field(default_factory=lambda: {"pair": 1, "set": 6, "dozen": 12})


class PackageUpdate(BaseModel):
    """All-optional. A present `items` replaces the whole list — the screen always edits
    a package's contents as one unit, the same way a voucher's or an order's lines are
    replaced as a set."""

    opened: bool | None = None
    received_on: date | None = None
    note: str | None = None
    items: list[ReceivingItemIn] | None = None


class ReceivingCostIn(BaseModel):
    cost_date: date
    stage: str = ""
    carrier: str = ""
    kind: str = ""
    # MMK (the default): amount is the Kyat charge, typed directly. Any other
    # currency_code: original_amount/exchange_rate are required instead, and amount (if
    # sent at all) is ignored — the server computes the Kyat amount from them. See
    # app/services/wholesale/currency.py::resolve_money.
    currency_code: str = Field(default="MMK", min_length=3, max_length=3)
    amount: float | None = Field(default=None, ge=0)
    original_amount: float | None = Field(default=None, ge=0)
    exchange_rate: float | None = Field(default=None, gt=0)
    note: str = ""
