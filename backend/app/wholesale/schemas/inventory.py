from datetime import date

from pydantic import BaseModel, Field

from app.wholesale.models.entities import WholesaleUnit


class DeliveryIn(BaseModel):
    order_id: str = Field(min_length=1)
    stock_code: str = Field(min_length=1, max_length=100)
    location: str = Field(min_length=1, max_length=255)
    color_breakdown: str = Field(min_length=1, max_length=1000)
    unit: WholesaleUnit = WholesaleUnit.SET
    delivered_on: date
    note: str = Field(default="", max_length=1000)


class DeliveryBatchLineIn(BaseModel):
    stock_code: str = Field(min_length=1, max_length=100)
    location: str = Field(min_length=1, max_length=255)
    color_breakdown: str = Field(min_length=1, max_length=1000)
    unit: WholesaleUnit = WholesaleUnit.SET


class DeliveryBatchIn(BaseModel):
    order_id: str = Field(min_length=1)
    delivered_on: date
    delivery_address: str = Field(default="", max_length=1000)
    note: str = Field(default="", max_length=1000)
    lines: list[DeliveryBatchLineIn] = Field(min_length=1, max_length=50)


class DeliveryUpdate(BaseModel):
    location: str = Field(min_length=1, max_length=255)
    color_breakdown: str = Field(min_length=1, max_length=1000)
    unit: WholesaleUnit = WholesaleUnit.SET
    delivered_on: date
    note: str = Field(default="", max_length=1000)
