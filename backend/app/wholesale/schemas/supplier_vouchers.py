from datetime import date

from pydantic import BaseModel, Field

from app.wholesale.models.entities import ProductGroup, WholesaleUnit


class VoucherLineIn(BaseModel):
    stock_code: str = Field(min_length=1, max_length=100)
    description: str = Field(default="", max_length=500)
    product_group: ProductGroup
    color_breakdown: str = Field(min_length=1, max_length=1000)
    unit: WholesaleUnit = WholesaleUnit.SET
    unit_conversions: dict[str, int] = Field(default_factory=lambda: {"pair": 1, "set": 6, "dozen": 12})
    # MMK (the default): buying_price is the Kyat unit price, typed directly.
    # Any other currency_code: original_buying_price/exchange_rate are required
    # instead, and buying_price (if sent at all) is ignored — the server computes the
    # Kyat unit price from them. See app/wholesale/services/currency.py::resolve_money.
    currency_code: str = Field(default="MMK", min_length=3, max_length=3)
    buying_price: float | None = Field(default=None, ge=0)
    original_buying_price: float | None = Field(default=None, ge=0)
    exchange_rate: float | None = Field(default=None, gt=0)


class SupplierVoucherIn(BaseModel):
    branch_id: str | None = None
    supplier_name: str = Field(min_length=1, max_length=255)
    voucher_date: date
    carrier_name: str = Field(default="", max_length=255)
    total_packages: int = Field(ge=0)
    lines: list[VoucherLineIn] = Field(min_length=1)


class VoucherPaymentIn(BaseModel):
    paid_on: date
    amount: float = Field(gt=0)
    note: str = Field(default="", max_length=1000)
