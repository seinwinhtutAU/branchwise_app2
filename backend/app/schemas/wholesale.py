from datetime import date, datetime

from pydantic import BaseModel

from app.models.wholesale import OrderStatus


class ColorQty(BaseModel):
    color: str
    qty: float


class CustomerOrderCreate(BaseModel):
    order_date: date
    product_code: str
    factory_name: str | None = None
    customer_name: str
    first_commit_qty: float | None = None
    second_commit_qty: float | None = None
    colors: list[ColorQty] = []
    received_qty: float = 0
    unit: str = "Set"
    remark: str | None = None
    # Only used when the creating account has no fixed branch (admin) — ignored otherwise.
    branch_id: str | None = None


class CustomerOrderUpdate(BaseModel):
    order_date: date | None = None
    product_code: str | None = None
    factory_name: str | None = None
    customer_name: str | None = None
    first_commit_qty: float | None = None
    second_commit_qty: float | None = None
    colors: list[ColorQty] | None = None
    received_qty: float | None = None
    unit: str | None = None
    buying_price: float | None = None
    status: OrderStatus | None = None
    remark: str | None = None


class CustomerOrderOut(BaseModel):
    id: str
    order_no: int
    branch_id: str | None
    branch_name: str | None
    order_date: date
    product_code: str
    factory_name: str | None
    customer_name: str
    first_commit_qty: float | None
    second_commit_qty: float | None
    colors: list[ColorQty]
    total_qty: float
    received_qty: float
    unit: str
    buying_price: float | None
    status: OrderStatus
    matched_voucher_id: str | None
    matched_voucher_no: int | None
    remark: str | None
    created_at: datetime


class FactoryVoucherCreate(BaseModel):
    voucher_date: date
    factory_name: str | None = None
    product_code: str
    qty: float
    buying_price: float
    colors: list[ColorQty] = []
    discount_per_set: float | None = None
    remark: str | None = None
    branch_id: str | None = None


class FactoryVoucherUpdate(BaseModel):
    voucher_date: date | None = None
    factory_name: str | None = None
    product_code: str | None = None
    qty: float | None = None
    buying_price: float | None = None
    colors: list[ColorQty] | None = None
    discount_per_set: float | None = None
    remark: str | None = None


class FactoryVoucherOut(BaseModel):
    id: str
    voucher_no: int
    branch_id: str | None
    branch_name: str | None
    voucher_date: date
    factory_name: str | None
    product_code: str
    qty: float
    buying_price: float
    colors: list[ColorQty]
    discount_per_set: float | None
    remark: str | None
    created_at: datetime


class FactoryVoucherCreateResult(BaseModel):
    voucher: FactoryVoucherOut
    updated_order_count: int


class FactoryVoucherUpdateResult(BaseModel):
    voucher: FactoryVoucherOut
    updated_order_count: int
