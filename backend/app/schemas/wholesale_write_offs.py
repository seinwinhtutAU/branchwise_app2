from pydantic import BaseModel, Field

from app.models.wholesale import WholesaleWriteOffReason


class WriteOffIn(BaseModel):
    quantity: int = Field(gt=0)
    reason: WholesaleWriteOffReason
    note: str = Field(default="", max_length=1000)

