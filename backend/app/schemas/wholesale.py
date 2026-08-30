from datetime import date, datetime

from pydantic import BaseModel

from app.models.wholesale import OrderStatus


class ColorQty(BaseModel):
    color: str
    qty: float


class CustomerOrderLineCreate(BaseModel):
    product_code: str
    description: str | None = None
    factory_name: str | None = None
    first_commit_qty: float | None = None
    second_commit_qty: float | None = None
    colors: list[ColorQty] = []
    received_qty: float = 0
    unit: str = "Set"
    status: OrderStatus = OrderStatus.NOT_START


class CustomerOrderLineUpdate(BaseModel):
    product_code: str | None = None
    description: str | None = None
    factory_name: str | None = None
    first_commit_qty: float | None = None
    second_commit_qty: float | None = None
    colors: list[ColorQty] | None = None
    received_qty: float | None = None
    unit: str | None = None
    buying_price: float | None = None
    status: OrderStatus | None = None


class CustomerOrderLineOut(BaseModel):
    id: str
    order_id: str
    product_code: str
    description: str | None
    factory_name: str | None
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


class CustomerOrderCreate(BaseModel):
    order_date: date
    customer_name: str
    remark: str | None = None
    line: CustomerOrderLineCreate
    # Only used when the creating account has no fixed branch (admin) — ignored otherwise.
    branch_id: str | None = None


class CustomerOrderUpdate(BaseModel):
    order_date: date | None = None
    customer_name: str | None = None
    remark: str | None = None


class CustomerOrderOut(BaseModel):
    id: str
    order_no: int
    branch_id: str | None
    branch_name: str | None
    order_date: date
    customer_name: str
    remark: str | None
    created_at: datetime
    lines: list[CustomerOrderLineOut]


class FactoryVoucherLineCreate(BaseModel):
    product_code: str
    description: str | None = None
    buying_price: float
    colors: list[ColorQty] = []
    discount_per_set: float | None = None


class FactoryVoucherLineUpdate(BaseModel):
    product_code: str | None = None
    description: str | None = None
    buying_price: float | None = None
    colors: list[ColorQty] | None = None
    discount_per_set: float | None = None


class FactoryVoucherLineOut(BaseModel):
    id: str
    voucher_id: str
    product_code: str
    description: str | None
    qty: float
    received_qty: float
    buying_price: float
    colors: list[ColorQty]
    discount_per_set: float | None


class FactoryVoucherCreate(BaseModel):
    voucher_date: date
    factory_name: str | None = None
    remark: str | None = None
    line: FactoryVoucherLineCreate
    branch_id: str | None = None


class FactoryVoucherUpdate(BaseModel):
    voucher_date: date | None = None
    factory_name: str | None = None
    remark: str | None = None


class FactoryVoucherOut(BaseModel):
    id: str
    voucher_no: int
    branch_id: str | None
    branch_name: str | None
    voucher_date: date
    factory_name: str | None
    remark: str | None
    created_at: datetime
    lines: list[FactoryVoucherLineOut]


class FactoryVoucherCreateResult(BaseModel):
    voucher: FactoryVoucherOut
    updated_order_count: int


class FactoryVoucherUpdateResult(BaseModel):
    voucher: FactoryVoucherOut
    updated_order_count: int


class WarehouseReceiptCreate(BaseModel):
    product_code: str
    warehouse: str
    qty_received: float
    received_date: date
    # Only used when the creating account has no fixed branch (admin) — ignored otherwise.
    branch_id: str | None = None


class WarehouseReceiptOut(BaseModel):
    id: str
    voucher_id: str
    voucher_no: int
    voucher_line_id: str
    product_code: str
    description: str | None
    warehouse: str
    qty_received: float
    received_date: date
    created_at: datetime
