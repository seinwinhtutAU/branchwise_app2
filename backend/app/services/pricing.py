from sqlalchemy.orm import Session

from app.models.purchase import Purchase, PurchaseLine
from app.models.stock_level import StockLevel


def latest_purchase_buying_prices(db: Session, product_ids: set[str]) -> dict[str, float]:
    if not product_ids:
        return {}
    rows = (
        db.query(PurchaseLine.product_id, PurchaseLine.buying_price, Purchase.purchase_date)
        .join(Purchase, PurchaseLine.purchase_id == Purchase.id)
        .filter(PurchaseLine.product_id.in_(product_ids))
        .all()
    )
    latest: dict[str, tuple] = {}
    for product_id, buying_price, purchase_date in rows:
        if buying_price is None:
            continue
        if product_id not in latest or purchase_date > latest[product_id][1]:
            latest[product_id] = (buying_price, purchase_date)
    return {product_id: price for product_id, (price, _) in latest.items()}


def latest_stock_level_buying_prices(db: Session, product_ids: set[str]) -> dict[str, float]:
    if not product_ids:
        return {}
    rows = (
        db.query(StockLevel.product_id, StockLevel.buying_price, StockLevel.snapshot_at)
        .filter(StockLevel.product_id.in_(product_ids))
        .all()
    )
    latest: dict[str, tuple] = {}
    for product_id, buying_price, snapshot_at in rows:
        if buying_price is None:
            continue
        if product_id not in latest or snapshot_at > latest[product_id][1]:
            latest[product_id] = (buying_price, snapshot_at)
    return {product_id: price for product_id, (price, _) in latest.items()}


def latest_buying_prices(db: Session, product_ids: set[str]) -> dict[str, float]:
    """Prefer the latest purchase price; fall back to the latest inventory snapshot price."""
    purchase_prices = latest_purchase_buying_prices(db, product_ids)
    stock_level_prices = latest_stock_level_buying_prices(db, product_ids)
    return {product_id: purchase_prices.get(product_id, stock_level_prices.get(product_id)) for product_id in product_ids}
