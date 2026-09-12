from datetime import date

from pydantic import BaseModel, Field

from app.models.wholesale import ProductGroup, WholesaleUnit


class VoucherLineIn(BaseModel):
    stock_code: str = Field(min_length=1, max_length=100)
    description: str = Field(default="", max_length=500)
    product_group: ProductGroup
    color_qty: str = Field(min_length=1, max_length=1000)
    unit: WholesaleUnit = WholesaleUnit.SET
    buying_price: float = Field(ge=0)


class SupplierVoucherIn(BaseModel):
    branch_id: str | None = None
    supplier_name: str = Field(min_length=1, max_length=255)
    voucher_date: date
    cargo_name: str = Field(default="", max_length=255)
    total_packages: int = Field(ge=0)
    lines: list[VoucherLineIn] = Field(min_length=1)


class VoucherPaymentIn(BaseModel):
    paid_on: date
    amount: float = Field(gt=0)
    note: str = Field(default="", max_length=1000)
