from pydantic import BaseModel, Field

from app.models.wholesale import ProductGroup


class WholesaleProductCreate(BaseModel):
    stock_code: str = Field(min_length=1, max_length=100)
    description: str = Field(default="", max_length=500)
    product_group: ProductGroup = ProductGroup.MAN
    active: bool = True


class WholesaleProductUpdate(BaseModel):
    stock_code: str | None = Field(default=None, min_length=1, max_length=100)
    description: str | None = Field(default=None, max_length=500)
    product_group: ProductGroup | None = None
    active: bool | None = None


class WholesaleSupplierCreate(BaseModel):
    name: str = Field(min_length=1, max_length=255)
    phone: str = Field(default="", max_length=100)
    address: str = Field(default="", max_length=1000)
    active: bool = True


class WholesaleSupplierUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=255)
    phone: str | None = Field(default=None, max_length=100)
    address: str | None = Field(default=None, max_length=1000)
    active: bool | None = None


class WholesaleCustomerCreate(BaseModel):
    name: str = Field(min_length=1, max_length=255)
    phone: str = Field(default="", max_length=100)
    address: str = Field(default="", max_length=1000)
    active: bool = True


class WholesaleCustomerUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=255)
    phone: str | None = Field(default=None, max_length=100)
    address: str | None = Field(default=None, max_length=1000)
    active: bool | None = None


class NameEntityCreate(BaseModel):
    name: str = Field(min_length=1, max_length=255)
    active: bool = True


class NameEntityUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=255)
    active: bool | None = None
