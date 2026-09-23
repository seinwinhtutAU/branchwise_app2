"""Reconstructs a confirmed import's "Clean" rows live from the real business tables.

Every parsed row from a confirmed sales/inventory/purchase import gets written to the
real Sale/SaleLine, StockLevel, or Purchase/PurchaseLine tables (persist never filters
rows out for having a validation issue — issues are purely informational). So there is
no need to separately store a "clean data" snapshot anywhere: the persisted rows
themselves, joined back through `import_batch_id`, ARE the clean data. This is the
single source of truth for that reconstruction, shared by the paginated JSON "Clean"
tab (Import History detail) and the "download cleaned CSV" endpoint's query, so the two
can't drift apart.

Note: a batch whose rows were skipped at persist time (a reverted import, a duplicate
sales slip, a zero-stock inventory row) has no row here to reconstruct — same
limitation the CSV download already had before this module existed.
"""

from dataclasses import dataclass
from typing import Callable

from sqlalchemy.orm import Query, Session

from app.retail.models.import_batch import ImportType
from app.retail.models.product import Product
from app.retail.models.purchase import Purchase, PurchaseLine
from app.retail.models.sale import Sale, SaleLine
from app.retail.models.stock_level import StockLevel
from app.retail.services.import_common import NumericRule, numeric_failures
from app.retail.services.inventory_import import (
    OUTPUT_COLUMNS as INVENTORY_OUTPUT_COLUMNS,
)
from app.retail.services.inventory_import import (
    VALIDATION_RULES as INVENTORY_VALIDATION_RULES,
)
from app.retail.services.pos_import import OUTPUT_COLUMNS as SALES_OUTPUT_COLUMNS
from app.retail.services.pos_import import VALIDATION_RULES as SALES_VALIDATION_RULES
from app.retail.services.purchase_import import (
    OUTPUT_COLUMNS as PURCHASE_OUTPUT_COLUMNS,
)
from app.retail.services.purchase_import import (
    VALIDATION_RULES as PURCHASE_VALIDATION_RULES,
)


@dataclass(frozen=True)
class CleanRowSpec:
    columns: list[str]
    rules: list[NumericRule]
    build_query: Callable[[Session, str], Query]
    row_to_dict: Callable[..., dict]


def _inventory_query(db: Session, batch_id: str) -> Query:
    return (
        db.query(StockLevel, Product)
        .join(Product, StockLevel.product_id == Product.id)
        .filter(StockLevel.import_batch_id == batch_id)
        .order_by(Product.stock_code)
    )


def _inventory_row(level: StockLevel, product: Product) -> dict:
    return {
        "StockCode": product.stock_code,
        "Description": product.description or "",
        "Location": level.location_raw or "",
        "Group": product.group_name or "",
        "On_Hand_Qty": float(level.on_hand_qty) if level.on_hand_qty is not None else None,
        "Buying_Price": float(level.buying_price) if level.buying_price is not None else None,
        "Selling_Price": float(level.selling_price) if level.selling_price is not None else None,
    }


def _sales_query(db: Session, batch_id: str) -> Query:
    return (
        db.query(SaleLine, Sale, Product)
        .join(Sale, SaleLine.sale_id == Sale.id)
        .join(Product, SaleLine.product_id == Product.id)
        .filter(Sale.import_batch_id == batch_id)
        .order_by(Sale.sale_date, Sale.slip_id, SaleLine.line_id)
    )


def _sales_row(line: SaleLine, sale: Sale, product: Product) -> dict:
    return {
        "Date": sale.sale_date.isoformat() if sale.sale_date else None,
        "SlipID": sale.slip_id,
        "SlipNumber": sale.slip_number,
        "LineNo": line.line_no,
        "LineID": line.line_id,
        "StockCode": product.stock_code,
        "Description": product.description or "",
        "Location": sale.location_raw or "",
        "Selling_Price": float(line.selling_price) if line.selling_price is not None else None,
        "Qty": float(line.qty) if line.qty is not None else None,
        "UOM": line.uom or "",
        "Discount_Amount": float(line.discount_amount) if line.discount_amount is not None else None,
        "Amount": float(line.amount) if line.amount is not None else None,
        "Net_Amount": float(line.net_amount) if line.net_amount is not None else None,
        "Time": sale.sale_time or "",
    }


def _purchase_query(db: Session, batch_id: str) -> Query:
    return (
        db.query(PurchaseLine, Purchase, Product)
        .join(Purchase, PurchaseLine.purchase_id == Purchase.id)
        .join(Product, PurchaseLine.product_id == Product.id)
        .filter(Purchase.import_batch_id == batch_id)
        .order_by(PurchaseLine.id)
    )


def _purchase_row(line: PurchaseLine, purchase: Purchase, product: Product) -> dict:
    return {
        "StockCode": product.stock_code,
        "Description": product.description or "",
        "Location": purchase.location_raw or "",
        "Quantity": float(line.quantity) if line.quantity is not None else None,
        "UOM": line.uom or "",
        "Buying_Price": float(line.buying_price) if line.buying_price is not None else None,
    }


CLEAN_ROW_SPECS: dict[ImportType, CleanRowSpec] = {
    ImportType.INVENTORY: CleanRowSpec(
        INVENTORY_OUTPUT_COLUMNS, INVENTORY_VALIDATION_RULES, _inventory_query, _inventory_row
    ),
    ImportType.SALES: CleanRowSpec(
        SALES_OUTPUT_COLUMNS, SALES_VALIDATION_RULES, _sales_query, _sales_row
    ),
    ImportType.PURCHASE: CleanRowSpec(
        PURCHASE_OUTPUT_COLUMNS, PURCHASE_VALIDATION_RULES, _purchase_query, _purchase_row
    ),
}


def clean_row_count(db: Session, import_type: ImportType, batch_id: str) -> int:
    return CLEAN_ROW_SPECS[import_type].build_query(db, batch_id).count()


def clean_rows_page(
    db: Session, import_type: ImportType, batch_id: str, offset: int, limit: int
) -> list[dict]:
    spec = CLEAN_ROW_SPECS[import_type]
    return [
        spec.row_to_dict(*row)
        for row in spec.build_query(db, batch_id).offset(offset).limit(limit).all()
    ]


def clean_rows_all(db: Session, import_type: ImportType, batch_id: str) -> list[dict]:
    """Unpaginated fetch, same ordering as clean_rows_page — used only for the
    whole-batch warning scan below."""
    spec = CLEAN_ROW_SPECS[import_type]
    return [spec.row_to_dict(*row) for row in spec.build_query(db, batch_id).all()]


def clean_warning_scan(
    db: Session, import_type: ImportType, batch_id: str
) -> tuple[int, list[int]]:
    """Whole-batch validation for warning_count / GET .../warnings — every row of the
    batch, in the exact order clean_rows_page paginates by, so the returned indices
    line up with page N = index // page_size."""
    rows = clean_rows_all(db, import_type, batch_id)
    failures = numeric_failures(rows, CLEAN_ROW_SPECS[import_type].rules)
    return len(failures), [index for index, _ in failures]
