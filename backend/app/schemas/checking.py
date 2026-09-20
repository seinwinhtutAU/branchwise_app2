from pydantic import BaseModel


class CheckingItem(BaseModel):
    """A product that staff must verify in the external inventory system."""

    stock_code: str
    description: str
    on_hand_qty: float | None = None


class CheckingStatusResponse(BaseModel):
    is_eligible: bool
    reason: str | None = None
    has_today_sales: bool
    has_today_inventory: bool
    is_after_8pm: bool
    items: list[CheckingItem]


class CheckingVerifyResponse(BaseModel):
    success: bool
    message: str
    total_items: int
    resolved_count: int
    missing_stock_codes: list[str]
