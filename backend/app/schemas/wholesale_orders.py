from datetime import date
from pydantic import BaseModel, Field
from app.models.wholesale import ProductGroup, WholesaleUnit

class OrderLineIn(BaseModel):
    stock_code: str = Field(min_length=1, max_length=100)
    description: str = Field(default="", max_length=500)
    product_group: ProductGroup
    supplier_name: str = Field(default="", max_length=255)
    color_breakdown: str = Field(min_length=1, max_length=1000)
    unit: WholesaleUnit = WholesaleUnit.SET
    selling_price: float = Field(ge=0)

class OrderIn(BaseModel):
    branch_id: str | None = None
    customer_name: str = Field(min_length=1, max_length=255)
    customer_phone: str = Field(default="", max_length=100)
    customer_address: str = Field(default="", max_length=1000)
    order_date: date
    lines: list[OrderLineIn] = Field(min_length=1)


class OrderPaymentIn(BaseModel):
    paid_on: date
    amount: float = Field(gt=0)
    paid_quantity_pairs: int | None = Field(default=None, ge=0)
    note: str = Field(default="", max_length=1000)


class OrderLineAllocationIn(BaseModel):
    """The colour quantities reserved for one open customer-order line.

    An empty value deliberately clears an existing allocation. Quantities are parsed
    and converted to pairs on the server from the order line's unit.
    """

    color_breakdown: str = Field(default="", max_length=1000)
