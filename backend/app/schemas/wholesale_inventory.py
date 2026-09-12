from datetime import date

from pydantic import BaseModel, Field

from app.models.wholesale import WholesaleUnit


class DeliveryIn(BaseModel):
    order_id: str = Field(min_length=1)
    stock_code: str = Field(min_length=1, max_length=100)
    location: str = Field(min_length=1, max_length=255)
    color_qty: str = Field(min_length=1, max_length=1000)
    unit: WholesaleUnit = WholesaleUnit.SET
    delivered_on: date
    note: str = Field(default="", max_length=1000)


class DeliveryUpdate(BaseModel):
    location: str = Field(min_length=1, max_length=255)
    color_qty: str = Field(min_length=1, max_length=1000)
    unit: WholesaleUnit = WholesaleUnit.SET
    delivered_on: date
    note: str = Field(default="", max_length=1000)
