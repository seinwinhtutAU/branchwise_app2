from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from sqlalchemy.orm import Session

from app.core.security import get_current_app_user
from app.db.session import get_db
from app.models.user import User, UserRole
from app.models.wholesale_master_data import (
    WholesaleCargoCompany,
    WholesaleCarrier,
    WholesaleCustomer,
    WholesaleDestination,
    WholesaleProduct,
    WholesaleReceivingGate,
    WholesaleSupplier,
)
from app.schemas.wholesale_master_data import (
    NameEntityCreate,
    NameEntityUpdate,
    WholesaleCustomerCreate,
    WholesaleCustomerUpdate,
    WholesaleProductCreate,
    WholesaleProductUpdate,
    WholesaleSupplierCreate,
    WholesaleSupplierUpdate,
)
from app.services.wholesale.master_data import (
    create_named_entity,
    create_product,
    delete_named_entity,
    delete_product,
    get_named_entity,
    get_product,
    list_named_entities,
    list_products,
    update_named_entity,
    update_product,
)

router = APIRouter(prefix="/api/wholesale", tags=["wholesale"])


def _require_wholesale(user: User) -> None:
    if user.role not in (UserRole.WHOLESALE, UserRole.ADMIN):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "This account cannot use the wholesale workspace")


def _product_out(row: WholesaleProduct) -> dict:
    return {"product_id": row.id, "stock_code": row.stock_code, "description": row.description,
            "product_group": row.product_group.value, "active": row.active, "created_at": row.created_at,
            "updated_at": row.updated_at}


def _supplier_out(row: WholesaleSupplier) -> dict:
    return {"supplier_id": row.id, "name": row.name, "phone": row.phone, "address": row.address,
            "active": row.active, "created_at": row.created_at, "updated_at": row.updated_at}


def _customer_out(row: WholesaleCustomer) -> dict:
    return {"customer_id": row.id, "name": row.name, "phone": row.phone, "address": row.address,
            "active": row.active, "created_at": row.created_at, "updated_at": row.updated_at}


def _named_out(row, key: str) -> dict:
    return {key: row.id, "name": row.name, "active": row.active, "created_at": row.created_at, "updated_at": row.updated_at}


@router.get("/products")
def list_products_endpoint(search: Annotated[str, Query(max_length=100)] = "", active_only: bool = True,
                           page: Annotated[int, Query(ge=1)] = 1, page_size: Annotated[int, Query(ge=1, le=100)] = 100,
                           user: User = Depends(get_current_app_user), db: Session = Depends(get_db), response: Response = None):
    _require_wholesale(user)
    rows, total = list_products(db, search, not active_only, page, page_size)
    response.headers["X-Total-Count"] = str(total)
    return [_product_out(row) for row in rows]


@router.get("/products/{entity_id}")
def read_product(entity_id: str, user: User = Depends(get_current_app_user), db: Session = Depends(get_db)):
    _require_wholesale(user)
    return _product_out(get_product(db, entity_id))


@router.post("/products", status_code=status.HTTP_201_CREATED)
def add_product(payload: WholesaleProductCreate, user: User = Depends(get_current_app_user), db: Session = Depends(get_db)):
    _require_wholesale(user)
    return _product_out(create_product(db, payload))


@router.patch("/products/{entity_id}")
def patch_product(entity_id: str, payload: WholesaleProductUpdate, user: User = Depends(get_current_app_user), db: Session = Depends(get_db)):
    _require_wholesale(user)
    return _product_out(update_product(db, entity_id, payload))


@router.delete("/products/{entity_id}", status_code=status.HTTP_204_NO_CONTENT)
def remove_product(entity_id: str, user: User = Depends(get_current_app_user), db: Session = Depends(get_db)) -> None:
    _require_wholesale(user)
    delete_product(db, entity_id)


@router.get("/suppliers")
def list_suppliers(search: Annotated[str, Query(max_length=100)] = "", active_only: bool = True,
                   page: Annotated[int, Query(ge=1)] = 1, page_size: Annotated[int, Query(ge=1, le=100)] = 100,
                   user: User = Depends(get_current_app_user), db: Session = Depends(get_db), response: Response = None):
    _require_wholesale(user); rows, total = _list_named(db, WholesaleSupplier, search, active_only, page, page_size)
    response.headers["X-Total-Count"] = str(total); return [_supplier_out(row) for row in rows]


@router.get("/suppliers/{entity_id}")
def read_supplier(entity_id: str, user: User = Depends(get_current_app_user), db: Session = Depends(get_db)):
    _require_wholesale(user); return _supplier_out(get_named_entity(db, WholesaleSupplier, entity_id))


@router.post("/suppliers", status_code=status.HTTP_201_CREATED)
def add_supplier(payload: WholesaleSupplierCreate, user: User = Depends(get_current_app_user), db: Session = Depends(get_db)):
    _require_wholesale(user); return _supplier_out(_create_with_details(db, WholesaleSupplier, payload))


@router.patch("/suppliers/{entity_id}")
def patch_supplier(entity_id: str, payload: WholesaleSupplierUpdate, user: User = Depends(get_current_app_user), db: Session = Depends(get_db)):
    _require_wholesale(user); return _supplier_out(_update_with_details(db, WholesaleSupplier, entity_id, payload))


@router.delete("/suppliers/{entity_id}", status_code=status.HTTP_204_NO_CONTENT)
def remove_supplier(entity_id: str, user: User = Depends(get_current_app_user), db: Session = Depends(get_db)) -> None:
    _require_wholesale(user); delete_named_entity(db, WholesaleSupplier, entity_id)


@router.get("/customers")
def list_customers(search: Annotated[str, Query(max_length=100)] = "", active_only: bool = True,
                   page: Annotated[int, Query(ge=1)] = 1, page_size: Annotated[int, Query(ge=1, le=100)] = 100,
                   user: User = Depends(get_current_app_user), db: Session = Depends(get_db), response: Response = None):
    _require_wholesale(user); rows, total = _list_named(db, WholesaleCustomer, search, active_only, page, page_size)
    response.headers["X-Total-Count"] = str(total); return [_customer_out(row) for row in rows]


@router.get("/customers/{entity_id}")
def read_customer(entity_id: str, user: User = Depends(get_current_app_user), db: Session = Depends(get_db)):
    _require_wholesale(user); return _customer_out(get_named_entity(db, WholesaleCustomer, entity_id))


@router.post("/customers", status_code=status.HTTP_201_CREATED)
def add_customer(payload: WholesaleCustomerCreate, user: User = Depends(get_current_app_user), db: Session = Depends(get_db)):
    _require_wholesale(user); return _customer_out(_create_with_details(db, WholesaleCustomer, payload))


@router.patch("/customers/{entity_id}")
def patch_customer(entity_id: str, payload: WholesaleCustomerUpdate, user: User = Depends(get_current_app_user), db: Session = Depends(get_db)):
    _require_wholesale(user); return _customer_out(_update_with_details(db, WholesaleCustomer, entity_id, payload))


@router.delete("/customers/{entity_id}", status_code=status.HTTP_204_NO_CONTENT)
def remove_customer(entity_id: str, user: User = Depends(get_current_app_user), db: Session = Depends(get_db)) -> None:
    _require_wholesale(user); delete_named_entity(db, WholesaleCustomer, entity_id)


def _list_named(db, model, search, active_only, page, page_size):
    return list_named_entities(db, model, search, not active_only, page, page_size)


def _create_with_details(db, model, payload):
    row = create_named_entity(db, model, payload.name, payload.active)
    for field in ("phone", "address"):
        if hasattr(payload, field):
            setattr(row, field, getattr(payload, field))
    if hasattr(payload, "phone") or hasattr(payload, "address"):
        db.commit(); db.refresh(row)
    return row


def _update_with_details(db, model, entity_id, payload):
    row = get_named_entity(db, model, entity_id)
    for field, value in payload.model_dump(exclude_unset=True).items():
        setattr(row, field, value.strip() if isinstance(value, str) else value)
    from app.services.wholesale.master_data import _commit
    _commit(db, "An entry with this name already exists")
    db.refresh(row)
    return row


def _register_simple_entity_routes(path: str, model, response_key: str):
    @router.get(path)
    def list_entity(search: Annotated[str, Query(max_length=100)] = "", active_only: bool = True,
                    page: Annotated[int, Query(ge=1)] = 1, page_size: Annotated[int, Query(ge=1, le=100)] = 100,
                    user: User = Depends(get_current_app_user), db: Session = Depends(get_db), response: Response = None):
        _require_wholesale(user); rows, total = _list_named(db, model, search, active_only, page, page_size)
        response.headers["X-Total-Count"] = str(total); return [_named_out(row, response_key) for row in rows]

    @router.get(f"{path}/{{entity_id}}")
    def read_entity(entity_id: str, user: User = Depends(get_current_app_user), db: Session = Depends(get_db)):
        _require_wholesale(user); return _named_out(get_named_entity(db, model, entity_id), response_key)

    @router.post(path, status_code=status.HTTP_201_CREATED)
    def add_entity(payload: NameEntityCreate, user: User = Depends(get_current_app_user), db: Session = Depends(get_db)):
        _require_wholesale(user); return _named_out(create_named_entity(db, model, payload.name, payload.active), response_key)

    @router.patch(f"{path}/{{entity_id}}")
    def patch_entity(entity_id: str, payload: NameEntityUpdate, user: User = Depends(get_current_app_user), db: Session = Depends(get_db)):
        _require_wholesale(user); return _named_out(update_named_entity(db, model, entity_id, payload), response_key)

    @router.delete(f"{path}/{{entity_id}}", status_code=status.HTTP_204_NO_CONTENT)
    def remove_entity(entity_id: str, user: User = Depends(get_current_app_user), db: Session = Depends(get_db)) -> None:
        _require_wholesale(user); delete_named_entity(db, model, entity_id)


_register_simple_entity_routes("/cargo-companies", WholesaleCargoCompany, "cargo_company_id")
_register_simple_entity_routes("/carriers", WholesaleCarrier, "carrier_id")
_register_simple_entity_routes("/destinations", WholesaleDestination, "destination_id")
_register_simple_entity_routes("/receiving-gates", WholesaleReceivingGate, "receiving_gate_id")
