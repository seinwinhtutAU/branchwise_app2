from datetime import date

from pydantic import BaseModel

from app.wholesale.models.entities import ProductGroup


class StockRecordLocation(BaseModel):
    location: str
    on_hand_pairs: int
    colors: str
    last_moved_on: date | None = None


class StockRecord(BaseModel):
    stock_code: str
    description: str
    product_group: ProductGroup
    on_hand_pairs: int
    allocated_pairs: int
    available_pairs: int
    at_supplier_pairs: int
    in_transit_pairs: int
    incoming_pairs: int
    customer_ordered_pairs: int
    owed_to_customers_pairs: int
    delivered_pairs: int
    lost_pairs: int
    received_today_pairs: int = 0
    delivered_today_pairs: int = 0
    colors: str
    color_quantities_pairs: dict[str, int]
    locations: list[StockRecordLocation]
    sources: list[str]
    voucher_nos: list[str]
    shipment_nos: list[str]
    order_nos: list[str]
    receiving_nos: list[str]
    status: str
    last_activity_on: date | None = None
    has_receiving_history: bool
