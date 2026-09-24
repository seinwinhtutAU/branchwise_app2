"""Data-quality checks surfaced on the "Warning" tab.

Each check returns a list of
`{"note": str, "fields": [...], "highlight": [...], "source_import": {...} | None}`
rows — a plain-English explanation of what's wrong, the identifying fields of the
record it's about, which of those fields' labels are the actual culprit (so the
frontend can pick that one out visually instead of showing every field with equal
weight), and which confirmed import (if any) the bad value came from — the fix for
most of these checks is reverting that one import and re-confirming a corrected
file, so pointing straight at it saves hunting through Import History. `highlight`
is empty when nothing single field is "the" problem — e.g. a missing inventory
record isn't a bad value, it's an absence. `source_import` is None for checks that
aren't tied to one confirmed import — a missing-product warning can span several
imports (it's "add this to inventory", not "fix this one file"), so there's no
single batch to point at.
"""

from collections import defaultdict
from datetime import date, timedelta
from decimal import Decimal

import pandas as pd
from sqlalchemy import func, or_
from sqlalchemy.orm import Session

from app.models.branch import Branch
from app.core.timestamps import utc_timestamp
from app.retail.models.import_batch import ImportBatch
from app.retail.models.product import Product
from app.retail.models.purchase import Purchase, PurchaseLine
from app.retail.models.sale import Sale, SaleLine
from app.retail.models.stock_level import StockLevel
from app.models.user import User
from app.services.branches import list_retail_branches
from app.retail.services.import_common import numeric_failures
from app.retail.services.stock import latest_stock_query
from app.retail.services.inventory_import import VALIDATION_RULES as INVENTORY_VALIDATION_RULES
from app.retail.services.pos_import import VALIDATION_RULES as SALES_VALIDATION_RULES
from app.retail.services.pricing import compute_profit, sale_line_pricer
from app.retail.services.purchase_import import VALIDATION_RULES as PURCHASE_VALIDATION_RULES

# Below this many units of difference, treat it as routine noise (breakage, a
# one-off miscount) rather than something worth interrupting staff over — the
# reconciliation math is only ever an estimate (see inventory_reconciliation_warnings),
# so flagging every nonzero gap produces far more noise than signal.
RECONCILIATION_MISMATCH_THRESHOLD = Decimal("2")


def _field(label: str, value: object) -> dict:
    return {"label": label, "value": "—" if value is None else str(value)}


def _source_import(
    batch_id: str | None, filename: str | None, created_at_iso: str | None
) -> dict | None:
    if batch_id is None:
        return None
    return {"id": batch_id, "filename": filename, "date": created_at_iso}


def _branch_filter(query, user: User, branch_column):
    if user.branch_id is not None:
        return query.filter(branch_column == user.branch_id)
    return query


def _fetch_import_batches(
    db: Session, batch_ids: set[str | None]
) -> dict[str, ImportBatch]:
    """Batch-fetch by id rather than joining ImportBatch into the main query — on this
    dataset that join badly confuses the query planner (a ~900-row inventory query
    went from ~1.5s to 90+s once ImportBatch was joined in), the same class of problem
    CLAUDE.md already documents for per-row product lookups during import."""
    ids = {b for b in batch_ids if b}
    if not ids:
        return {}
    return {b.id: b for b in db.query(ImportBatch).filter(ImportBatch.id.in_(ids))}


def _fetch_products(db: Session, product_ids: set[str]) -> dict[str, Product]:
    """Batch-fetch by id rather than one `db.get(Product, ...)` per row — the same
    per-row-round-trip mistake CLAUDE.md documents for import product lookups, which
    turns into hundreds of remote-Postgres round trips once there are hundreds of
    distinct products (e.g. a shop with 1000+ inventory rows)."""
    if not product_ids:
        return {}
    return {p.id: p for p in db.query(Product).filter(Product.id.in_(product_ids))}


def _fetch_branches(db: Session, branch_ids: set[str | None]) -> dict[str, Branch]:
    """Batch-fetch by id — see _fetch_products."""
    ids = {b for b in branch_ids if b}
    if not ids:
        return {}
    return {b.id: b for b in db.query(Branch).filter(Branch.id.in_(ids))}


def _import_batch_meta(import_batch: ImportBatch | None) -> dict:
    """The three _ImportBatch* record keys _numeric_warning_rows reads back out via
    _source_import — shared by every numeric check's record builder."""
    return {
        "_ImportBatchId": import_batch.id if import_batch else None,
        "_ImportBatchFilename": import_batch.filename if import_batch else None,
        "_ImportBatchDate": utc_timestamp(import_batch.created_at) if import_batch else None,
    }


def _numeric_warning_row(
    record: dict, issues: list[dict], field_builder, column_labels: dict[str, str]
) -> dict:
    parts = []
    highlight = []
    for issue in issues:
        value = record.get(issue["column"])
        unparseable = value is None or (isinstance(value, float) and pd.isna(value))
        # Name the actual value so the one-liner is self-contained — "Buying Price
        # can't be a negative number (currently -500.00)" — rather than making
        # someone go find it themselves in the row's data.
        parts.append(
            issue["message"] if unparseable else f"{issue['message']} (currently {value})"
        )
        highlight.append(column_labels[issue["column"]])
    return {
        "note": "; ".join(parts),
        "fields": field_builder(record),
        "highlight": highlight,
        "source_import": _source_import(
            record.get("_ImportBatchId"),
            record.get("_ImportBatchFilename"),
            record.get("_ImportBatchDate"),
        ),
    }


def sale_numeric_warnings(
    db: Session, user: User, since: date | None = None
) -> list[dict]:
    query = (
        db.query(SaleLine, Sale, Product, Branch)
        .join(Sale, SaleLine.sale_id == Sale.id)
        .join(Product, SaleLine.product_id == Product.id)
        .outerjoin(Branch, Sale.branch_id == Branch.id)
    )
    query = _branch_filter(query, user, Sale.branch_id)
    if since is not None:
        query = query.filter(Sale.sale_date >= since)
    line_rows = query.all()

    # Validate the five numeric columns first — everything below is display detail for
    # rows that turn out to be wrong, and on clean data there are none. See
    # numeric_failures (app.retail.services.import_common).
    failures = numeric_failures(
        [
            {
                "Selling_Price": sale_line.selling_price,
                "Qty": sale_line.qty,
                "Discount_Amount": sale_line.discount_amount,
                "Amount": sale_line.amount,
                "Net_Amount": sale_line.net_amount,
            }
            for sale_line, _, _, _ in line_rows
        ],
        SALES_VALIDATION_RULES,
    )
    if not failures:
        return []
    failing_rows = [line_rows[index] for index, _ in failures]

    # Same buying-price/profit lookup as GET /api/sales, so the detail view here matches
    # the Sale tab exactly rather than a trimmed-down version of it — now over just the
    # failing rows' products rather than every product in the window.
    price_for = sale_line_pricer(db, {product.id for _, _, product, _ in failing_rows})
    import_batches = _fetch_import_batches(
        db, {sale.import_batch_id for _, sale, _, _ in failing_rows}
    )

    records = []
    for sale_line, sale, product, branch in failing_rows:
        import_batch = import_batches.get(sale.import_batch_id)
        buying_price, buying_price_source = price_for(product.id, sale.sale_date)
        profit, profit_margin_pct = compute_profit(
            buying_price, sale_line.qty, sale_line.net_amount
        )

        records.append(
            {
                "Selling_Price": sale_line.selling_price,
                "Qty": sale_line.qty,
                "Discount_Amount": sale_line.discount_amount,
                "Amount": sale_line.amount,
                "Net_Amount": sale_line.net_amount,
                "_Branch": branch.name if branch else None,
                "_Date": sale.sale_date.isoformat(),
                "_Time": sale.sale_time,
                "_SlipID": sale.slip_id,
                "_SlipNumber": sale.slip_number,
                "_LineNo": sale_line.line_no,
                "_LineID": sale_line.line_id,
                "_StockCode": product.stock_code,
                "_Description": product.description,
                "_UOM": sale_line.uom,
                "_Location": sale.location_raw,
                "_BuyingPrice": buying_price,
                "_BuyingPriceSource": buying_price_source,
                "_Profit": profit,
                "_ProfitMarginPct": profit_margin_pct,
                **_import_batch_meta(import_batch),
            }
        )

    # The exact same column set as the Sale list page (GET /api/sales).
    def fields(record: dict) -> list[dict]:
        return [
            _field("Branch", record["_Branch"]),
            _field("Date", record["_Date"]),
            _field("Time", record["_Time"]),
            _field("Slip ID", record["_SlipID"]),
            _field("Slip Number", record["_SlipNumber"]),
            _field("Line No", record["_LineNo"]),
            _field("Line ID", record["_LineID"]),
            _field("Stock Code", record["_StockCode"]),
            _field("Description", record["_Description"]),
            _field("Selling Price", record["Selling_Price"]),
            _field("Qty", record["Qty"]),
            _field("UOM", record["_UOM"]),
            _field("Discount Amount", record["Discount_Amount"]),
            _field("Amount", record["Amount"]),
            _field("Net Amount", record["Net_Amount"]),
            _field("Location", record["_Location"]),
            _field("Buying Price", record["_BuyingPrice"]),
            _field("Buying Price Source", record["_BuyingPriceSource"]),
            _field("Profit", record["_Profit"]),
            _field("Profit Margin Pct", record["_ProfitMarginPct"]),
        ]

    column_labels = {
        "Selling_Price": "Selling Price",
        "Qty": "Qty",
        "Discount_Amount": "Discount Amount",
        "Amount": "Amount",
        "Net_Amount": "Net Amount",
    }
    return [
        _numeric_warning_row(record, issues, fields, column_labels)
        for record, (_, issues) in zip(records, failures)
    ]


def inventory_numeric_warnings(db: Session, user: User) -> list[dict]:
    """Validates only the latest snapshot per branch+product (same "current
    stock" definition as GET /api/inventory), not full history — a
    since-superseded snapshot shouldn't show up as a standing warning."""
    query = _branch_filter(latest_stock_query(db), user, StockLevel.branch_id)
    query_rows = query.all()

    failures = numeric_failures(
        [
            {
                "On_Hand_Qty": stock_level.on_hand_qty,
                "Buying_Price": stock_level.buying_price,
                "Selling_Price": stock_level.selling_price,
            }
            for stock_level, _, _ in query_rows
        ],
        INVENTORY_VALIDATION_RULES,
    )
    if not failures:
        return []
    failing_rows = [query_rows[index] for index, _ in failures]
    import_batches = _fetch_import_batches(
        db, {sl.import_batch_id for sl, _, _ in failing_rows}
    )

    records = []
    for stock_level, product, branch in failing_rows:
        import_batch = import_batches.get(stock_level.import_batch_id)
        records.append(
            {
                "On_Hand_Qty": stock_level.on_hand_qty,
                "Buying_Price": stock_level.buying_price,
                "Selling_Price": stock_level.selling_price,
                "_Branch": branch.name if branch else None,
                "_Snapshot_At": stock_level.snapshot_at.isoformat(),
                "_StockCode": product.stock_code,
                "_Description": product.description,
                "_Group": product.group_name,
                "_Location": stock_level.location_raw,
                **_import_batch_meta(import_batch),
            }
        )

    # Same column set as the Inventory list page (GET /api/inventory).
    def fields(record: dict) -> list[dict]:
        return [
            _field("Branch", record["_Branch"]),
            _field("Last Updated", record["_Snapshot_At"]),
            _field("Stock Code", record["_StockCode"]),
            _field("Description", record["_Description"]),
            _field("Group", record["_Group"]),
            _field("On Hand Qty", record["On_Hand_Qty"]),
            _field("Buying Price", record["Buying_Price"]),
            _field("Selling Price", record["Selling_Price"]),
            _field("Location", record["_Location"]),
        ]

    column_labels = {
        "On_Hand_Qty": "On Hand Qty",
        "Buying_Price": "Buying Price",
        "Selling_Price": "Selling Price",
    }
    return [
        _numeric_warning_row(record, issues, fields, column_labels)
        for record, (_, issues) in zip(records, failures)
    ]


def purchase_numeric_warnings(
    db: Session, user: User, since: date | None = None
) -> list[dict]:
    query = (
        db.query(PurchaseLine, Purchase, Product, Branch)
        .join(Purchase, PurchaseLine.purchase_id == Purchase.id)
        .join(Product, PurchaseLine.product_id == Product.id)
        .outerjoin(Branch, Purchase.branch_id == Branch.id)
    )
    query = _branch_filter(query, user, Purchase.branch_id)
    if since is not None:
        query = query.filter(Purchase.purchase_date >= since)
    query_rows = query.all()

    failures = numeric_failures(
        [
            {"Quantity": purchase_line.quantity, "Buying_Price": purchase_line.buying_price}
            for purchase_line, _, _, _ in query_rows
        ],
        PURCHASE_VALIDATION_RULES,
    )
    if not failures:
        return []
    failing_rows = [query_rows[index] for index, _ in failures]
    import_batches = _fetch_import_batches(
        db, {purchase.import_batch_id for _, purchase, _, _ in failing_rows}
    )

    records = []
    for purchase_line, purchase, product, branch in failing_rows:
        import_batch = import_batches.get(purchase.import_batch_id)
        records.append(
            {
                "Quantity": purchase_line.quantity,
                "Buying_Price": purchase_line.buying_price,
                "_Branch": branch.name if branch else None,
                "_Date": purchase.purchase_date.isoformat(),
                "_StockCode": product.stock_code,
                "_Description": product.description,
                "_UOM": purchase_line.uom,
                "_Location": purchase.location_raw,
                **_import_batch_meta(import_batch),
            }
        )

    # Same column set as the Purchase list page (GET /api/purchases).
    def fields(record: dict) -> list[dict]:
        return [
            _field("Branch", record["_Branch"]),
            _field("Date", record["_Date"]),
            _field("Stock Code", record["_StockCode"]),
            _field("Description", record["_Description"]),
            _field("Quantity", record["Quantity"]),
            _field("UOM", record["_UOM"]),
            _field("Buying Price", record["Buying_Price"]),
            _field("Location", record["_Location"]),
        ]

    column_labels = {"Quantity": "Quantity", "Buying_Price": "Buying Price"}
    return [
        _numeric_warning_row(record, issues, fields, column_labels)
        for record, (_, issues) in zip(records, failures)
    ]


MissingProductOccurrence = tuple[
    int, date, date
]  # (occurrences, first_date, last_date)


def _missing_product_pairs(
    db: Session,
    user: User,
    *,
    line_model,
    header_model,
    header_id_fk,
    branch_column,
    date_column,
    since: date | None = None,
) -> dict[tuple[str | None, str], MissingProductOccurrence]:
    """Distinct (branch, product) pairs that appear in `line_model`/`header_model`
    but have zero StockLevel rows ever for that same branch+product.

    `since`, when given, bounds which sale/purchase rows count toward this — the same
    scoping the numeric checks apply, to keep this aggregate query from re-scanning
    every sale/purchase line ever imported on every Warning-page load. This does mean
    a product missing an inventory record whose only sale/purchase activity is older
    than `since` stops being flagged until it's sold/purchased again — a real
    trade-off for staying fast, not a correctness improvement.
    """
    inventory_pairs = (
        db.query(StockLevel.branch_id, StockLevel.product_id).distinct().subquery()
    )

    query = (
        db.query(
            branch_column,
            line_model.product_id,
            func.count(line_model.id).label("occurrences"),
            func.min(date_column).label("first_date"),
            func.max(date_column).label("last_date"),
        )
        .join(header_model, header_id_fk == header_model.id)
        .outerjoin(
            inventory_pairs,
            branch_column.is_not_distinct_from(inventory_pairs.c.branch_id)
            & (line_model.product_id == inventory_pairs.c.product_id),
        )
        .filter(inventory_pairs.c.product_id.is_(None))
        .group_by(branch_column, line_model.product_id)
    )
    if since is not None:
        query = query.filter(date_column >= since)
    query = _branch_filter(query, user, branch_column)

    return {
        (branch_id, product_id): (occurrences, first_date, last_date)
        for branch_id, product_id, occurrences, first_date, last_date in query.all()
    }


def _occurrence_phrase(verb: str, occurrence: MissingProductOccurrence) -> str:
    occurrences, _first_date, last_date = occurrence
    if occurrences == 1:
        return f"{verb} 1 time on {last_date.isoformat()}"
    return f"{verb} {occurrences} times (last on {last_date.isoformat()})"


def blank_description_condition():
    """A product with no usable description — empty, whitespace, or a placeholder. Shared
    with the Branch Health alerts so they count exactly what the Warning page lists."""
    trimmed = func.trim(Product.description)
    return or_(
        Product.description.is_(None),
        trimmed == "",
        trimmed.in_(("—", "-", "?", "None", "NULL")),
    )


_MISSING_DESCRIPTION_NOTE = "Product description is missing"


def sale_description_warnings(
    db: Session, user: User, since: date | None = None
) -> list[dict]:
    query = (
        db.query(SaleLine, Sale, Product, Branch)
        .join(Sale, SaleLine.sale_id == Sale.id)
        .join(Product, SaleLine.product_id == Product.id)
        .outerjoin(Branch, Sale.branch_id == Branch.id)
        .filter(blank_description_condition())
    )
    query = _branch_filter(query, user, Sale.branch_id)
    if since is not None:
        query = query.filter(Sale.sale_date >= since)
    rows = query.order_by(Sale.sale_date.desc(), Sale.slip_id, SaleLine.line_no).all()
    import_batches = _fetch_import_batches(db, {sale.import_batch_id for _, sale, _, _ in rows})
    return [
        {
            "note": _MISSING_DESCRIPTION_NOTE,
            "fields": [
                _field("Branch", branch.name if branch else None),
                _field("Date", sale.sale_date.isoformat()),
                _field("Slip ID", sale.slip_id),
                _field("Slip Number", sale.slip_number),
                _field("Line No", sale_line.line_no),
                _field("Stock Code", product.stock_code),
                _field("Description", product.description),
                _field("Selling Price", sale_line.selling_price),
                _field("Qty", sale_line.qty),
                _field("Net Amount", sale_line.net_amount),
            ],
            "highlight": ["Description"],
            "source_import": _batch_source(import_batches.get(sale.import_batch_id)),
        }
        for sale_line, sale, product, branch in rows
    ]


def purchase_description_warnings(
    db: Session, user: User, since: date | None = None
) -> list[dict]:
    query = (
        db.query(PurchaseLine, Purchase, Product, Branch)
        .join(Purchase, PurchaseLine.purchase_id == Purchase.id)
        .join(Product, PurchaseLine.product_id == Product.id)
        .outerjoin(Branch, Purchase.branch_id == Branch.id)
        .filter(blank_description_condition())
    )
    query = _branch_filter(query, user, Purchase.branch_id)
    if since is not None:
        query = query.filter(Purchase.purchase_date >= since)
    rows = query.order_by(Purchase.purchase_date.desc(), PurchaseLine.id).all()
    import_batches = _fetch_import_batches(
        db, {purchase.import_batch_id for _, purchase, _, _ in rows}
    )
    return [
        {
            "note": _MISSING_DESCRIPTION_NOTE,
            "fields": [
                _field("Branch", branch.name if branch else None),
                _field("Date", purchase.purchase_date.isoformat()),
                _field("Stock Code", product.stock_code),
                _field("Description", product.description),
                _field("Quantity", purchase_line.quantity),
                _field("Buying Price", purchase_line.buying_price),
            ],
            "highlight": ["Description"],
            "source_import": _batch_source(import_batches.get(purchase.import_batch_id)),
        }
        for purchase_line, purchase, product, branch in rows
    ]


def _batch_source(import_batch: ImportBatch | None) -> dict | None:
    meta = _import_batch_meta(import_batch)
    return _source_import(
        meta["_ImportBatchId"], meta["_ImportBatchFilename"], meta["_ImportBatchDate"]
    )


def missing_product_warnings(
    db: Session,
    user: User,
    *,
    sale_since: date | None = None,
    purchase_since: date | None = None,
) -> list[dict]:
    """Stock codes sold and/or purchased at a branch with zero StockLevel rows there —
    one row per (branch, product), even when it shows up in both Sale and Purchase
    lines, so the fix ("add it to inventory") isn't duplicated across two rows.
    `sale_since`/`purchase_since` reuse the same Sale/Purchase check windows as the
    numeric checks — see _missing_product_pairs for the trade-off that bounding
    implies."""
    sale_pairs = _missing_product_pairs(
        db,
        user,
        line_model=SaleLine,
        header_model=Sale,
        header_id_fk=SaleLine.sale_id,
        branch_column=Sale.branch_id,
        date_column=Sale.sale_date,
        since=sale_since,
    )
    purchase_pairs = _missing_product_pairs(
        db,
        user,
        line_model=PurchaseLine,
        header_model=Purchase,
        header_id_fk=PurchaseLine.purchase_id,
        branch_column=Purchase.branch_id,
        date_column=Purchase.purchase_date,
        since=purchase_since,
    )

    keys = sale_pairs.keys() | purchase_pairs.keys()
    products = _fetch_products(db, {product_id for _, product_id in keys})
    branches = _fetch_branches(db, {branch_id for branch_id, _ in keys})

    rows = []
    for key in keys:
        branch_id, product_id = key
        product = products[product_id]
        branch = branches.get(branch_id) if branch_id else None
        sale = sale_pairs.get(key)
        purchase = purchase_pairs.get(key)

        fields = [
            _field("Branch", branch.name if branch else None),
            _field("Stock Code", product.stock_code),
            _field("Description", product.description),
        ]
        if sale and purchase:
            # No dates here — sale and purchase activity have separate date ranges,
            # and squeezing both into one line reads worse than just naming the counts.
            note = (
                f"Sold {sale[0]} time{'s' if sale[0] != 1 else ''} and purchased "
                f"{purchase[0]} time{'s' if purchase[0] != 1 else ''} but no inventory "
                f"record — add this stock code to your inventory system."
            )
            fields += [
                _field("Times Sold", sale[0]),
                _field("Times Purchased", purchase[0]),
            ]
        elif sale:
            note = f"{_occurrence_phrase('Sold', sale)} but no inventory record — add this stock code to your inventory system."
            fields += [
                _field("Times Sold", sale[0]),
                _field("First Date", sale[1].isoformat()),
                _field("Last Date", sale[2].isoformat()),
            ]
        else:
            assert purchase is not None
            note = f"{_occurrence_phrase('Purchased', purchase)} but no inventory record — add this stock code to your inventory system."
            fields += [
                _field("Times Purchased", purchase[0]),
                _field("First Date", purchase[1].isoformat()),
                _field("Last Date", purchase[2].isoformat()),
            ]

        rows.append(
            {
                "note": note,
                "fields": fields,
                # Nothing to highlight — the problem is an absence, not a bad value.
                "highlight": [],
                # This can span several imports (it's "add this product to inventory",
                # not "fix this one file"), so there's no single batch to point at.
                "source_import": None,
            }
        )
    return rows


def inventory_reconciliation_warnings(
    db: Session, user: User
) -> tuple[list[dict], list[dict]]:
    """For each branch's latest inventory snapshot, compare it against what it
    should be: the previous snapshot plus purchases minus sales in between.
    Returns (mismatch_rows, uom_notice_rows). Only retail branches are
    checked — wholesale never has sale/inventory/purchase data. A branch with
    no snapshot, or no *prior* snapshot to compare against, is skipped rather
    than treated as a mismatch.

    Every step below is batched across all branches in one query rather than one
    query per branch — each branch used to pay for its own round trip to Neon for the
    same handful of lookups (latest/prior snapshot timestamp, the two snapshots
    themselves, purchases, sales, and the two UOM checks), which only matters more as
    branches are added. The one thing that can't be a plain GROUP BY is the "prior"
    (second-most-recent) snapshot timestamp, so distinct timestamps are fetched once
    for every branch and the top two per branch are picked out in Python. Each
    branch keeps its own (window_start, window_end] — the purchases/sales/UOM
    queries below fetch a superset bounded by the widest window across all branches,
    then filter each row against its own branch's actual window before summing, so a
    branch with a narrower window never picks up another branch's purchases or sales.
    """
    branches_query = list_retail_branches(db)
    if user.branch_id is not None:
        branches_query = branches_query.filter(Branch.id == user.branch_id)
    branches = branches_query.all()
    if not branches:
        return [], []

    branch_ids = [branch.id for branch in branches]

    timestamps_by_branch: dict[str, list] = defaultdict(list)
    for branch_id, snapshot_at in (
        db.query(StockLevel.branch_id, StockLevel.snapshot_at)
        .filter(StockLevel.branch_id.in_(branch_ids))
        .distinct()
        .order_by(StockLevel.branch_id, StockLevel.snapshot_at.desc())
    ):
        timestamps_by_branch[branch_id].append(snapshot_at)

    # branch_id -> (latest_ts, prior_ts). A branch with no snapshot, or no prior
    # snapshot to compare against, is dropped here — same skip as the original
    # per-branch early-continue.
    windows: dict[str, tuple] = {
        branch.id: (timestamps_by_branch[branch.id][0], timestamps_by_branch[branch.id][1])
        for branch in branches
        if len(timestamps_by_branch.get(branch.id, [])) >= 2
    }
    if not windows:
        return [], []

    active_branch_ids = list(windows.keys())
    window_start_by_branch = {bid: prior_ts.date() for bid, (_, prior_ts) in windows.items()}
    window_end_by_branch = {bid: latest_ts.date() for bid, (latest_ts, _) in windows.items()}
    overall_start = min(window_start_by_branch.values())
    overall_end = max(window_end_by_branch.values())

    def in_branch_window(branch_id: str, day: date) -> bool:
        return window_start_by_branch[branch_id] < day <= window_end_by_branch[branch_id]

    latest_snapshot_by_branch: dict[str, dict[str, StockLevel]] = defaultdict(dict)
    prior_snapshot_by_branch: dict[str, dict[str, object]] = defaultdict(dict)
    all_relevant_ts = {ts for pair in windows.values() for ts in pair}
    for sl in (
        db.query(StockLevel)
        .filter(
            StockLevel.branch_id.in_(active_branch_ids),
            StockLevel.snapshot_at.in_(all_relevant_ts),
        )
    ):
        latest_ts, prior_ts = windows[sl.branch_id]
        if sl.snapshot_at == latest_ts:
            latest_snapshot_by_branch[sl.branch_id][sl.product_id] = sl
        elif sl.snapshot_at == prior_ts:
            prior_snapshot_by_branch[sl.branch_id][sl.product_id] = sl.on_hand_qty

    purchased_by_branch: dict[str, dict[str, Decimal]] = defaultdict(lambda: defaultdict(lambda: Decimal("0")))
    for branch_id, product_id, purchase_date, qty in (
        db.query(Purchase.branch_id, PurchaseLine.product_id, Purchase.purchase_date, PurchaseLine.quantity)
        .join(Purchase, PurchaseLine.purchase_id == Purchase.id)
        .filter(
            Purchase.branch_id.in_(active_branch_ids),
            Purchase.purchase_date > overall_start,
            Purchase.purchase_date <= overall_end,
        )
    ):
        if in_branch_window(branch_id, purchase_date):
            purchased_by_branch[branch_id][product_id] += Decimal(str(qty or 0))

    sold_by_branch: dict[str, dict[str, Decimal]] = defaultdict(lambda: defaultdict(lambda: Decimal("0")))
    for branch_id, product_id, sale_date, qty in (
        db.query(Sale.branch_id, SaleLine.product_id, Sale.sale_date, SaleLine.qty)
        .join(Sale, SaleLine.sale_id == Sale.id)
        .filter(
            Sale.branch_id.in_(active_branch_ids),
            Sale.sale_date > overall_start,
            Sale.sale_date <= overall_end,
        )
    ):
        if in_branch_window(branch_id, sale_date):
            sold_by_branch[branch_id][product_id] += Decimal(str(qty or 0))

    uoms_seen_by_branch: dict[str, dict[str, set[str]]] = defaultdict(lambda: defaultdict(set))
    for branch_id, product_id, sale_date, uom in (
        db.query(Sale.branch_id, SaleLine.product_id, Sale.sale_date, SaleLine.uom)
        .join(Sale, SaleLine.sale_id == Sale.id)
        .filter(
            Sale.branch_id.in_(active_branch_ids),
            Sale.sale_date > overall_start,
            Sale.sale_date <= overall_end,
        )
    ):
        if uom and in_branch_window(branch_id, sale_date):
            uoms_seen_by_branch[branch_id][product_id].add(uom)
    for branch_id, product_id, purchase_date, uom in (
        db.query(Purchase.branch_id, PurchaseLine.product_id, Purchase.purchase_date, PurchaseLine.uom)
        .join(Purchase, PurchaseLine.purchase_id == Purchase.id)
        .filter(
            Purchase.branch_id.in_(active_branch_ids),
            Purchase.purchase_date > overall_start,
            Purchase.purchase_date <= overall_end,
        )
    ):
        if uom and in_branch_window(branch_id, purchase_date):
            uoms_seen_by_branch[branch_id][product_id].add(uom)

    all_stock_level_ids = {
        sl.import_batch_id
        for snapshot in latest_snapshot_by_branch.values()
        for sl in snapshot.values()
    }
    batches_by_id = _fetch_import_batches(db, all_stock_level_ids)
    all_product_ids = {
        product_id
        for snapshot in latest_snapshot_by_branch.values()
        for product_id in snapshot.keys()
    }
    products_by_id = _fetch_products(db, all_product_ids)

    mismatch_rows: list[dict] = []
    uom_rows: list[dict] = []

    for branch in branches:
        if branch.id not in windows:
            continue
        latest_snapshot = latest_snapshot_by_branch.get(branch.id, {})
        prior_snapshot = prior_snapshot_by_branch.get(branch.id, {})
        purchased = purchased_by_branch.get(branch.id, {})
        sold = sold_by_branch.get(branch.id, {})
        uoms_seen = uoms_seen_by_branch.get(branch.id, {})
        window_start = window_start_by_branch[branch.id]
        window_end = window_end_by_branch[branch.id]

        for product_id, stock_level in latest_snapshot.items():
            product = products_by_id[product_id]
            prior_qty = Decimal(str(prior_snapshot.get(product_id) or 0))
            purchased_qty = purchased.get(product_id, Decimal("0"))
            sold_qty = sold.get(product_id, Decimal("0"))
            expected = round(prior_qty + purchased_qty - sold_qty, 2)
            actual = round(Decimal(str(stock_level.on_hand_qty or 0)), 2)

            source_batch = batches_by_id.get(stock_level.import_batch_id)
            source_import = (
                _source_import(
                    source_batch.id,
                    source_batch.filename,
                    utc_timestamp(source_batch.created_at),
                )
                if source_batch
                else None
            )

            distinct_uoms = uoms_seen.get(product_id, set())
            if len(distinct_uoms) > 1:
                uom_rows.append(
                    {
                        "note": (
                            f"Sold or bought in more than one unit "
                            f"({', '.join(sorted(distinct_uoms))}) recently — worth a manual check."
                        ),
                        "fields": [
                            _field("Branch", branch.name),
                            _field("Stock Code", product.stock_code),
                            _field("Description", product.description),
                            _field("Units Seen", ", ".join(sorted(distinct_uoms))),
                            _field("Since", window_start.isoformat()),
                            _field("Until", window_end.isoformat()),
                        ],
                        "highlight": ["Units Seen"],
                        "source_import": source_import,
                    }
                )

            difference = actual - expected
            if abs(difference) >= RECONCILIATION_MISMATCH_THRESHOLD:
                # "Expected" is only as good as three inputs: the prior count, and every
                # purchase/sale actually imported since — if any of those is wrong or
                # missing, so is this number. Rather than always blaming the physical
                # count, point at the most likely real cause:
                had_activity = purchased_qty != 0 or sold_qty != 0
                if not had_activity:
                    # No purchases or sales at all in the window is the strongest signal
                    # that a file is simply missing, not that the count itself is wrong.
                    note = "No purchases or sales recorded for this item — check if a file's missing before recounting."
                elif expected < 0:
                    # A negative "expected" can never be a real stock count — showing it
                    # as a target ("should be about -5") would only confuse non-technical
                    # staff, so explain what it actually means instead.
                    note = "Records show more sold than was in stock — check for a missing purchase import."
                else:
                    note = (
                        f"Inventory shows {actual}, should be about {expected} — recount, "
                        f"or check your imports if it's still off."
                    )
                mismatch_rows.append(
                    {
                        "note": note,
                        "fields": [
                            _field("Branch", branch.name),
                            _field("Since", window_start.isoformat()),
                            _field("Until", window_end.isoformat()),
                            _field("Stock Code", product.stock_code),
                            _field("Description", product.description),
                            _field("Prior Qty", prior_qty),
                            _field("Purchased", purchased_qty),
                            _field("Sold", sold_qty),
                            _field("Expected Qty", expected),
                            _field("Actual Qty", actual),
                            _field("Difference", difference),
                        ],
                        "highlight": ["Expected Qty", "Actual Qty", "Difference"],
                        "source_import": source_import,
                    }
                )

    return mismatch_rows, uom_rows


def build_warning_sections(
    db: Session, user: User, sale_days: int, purchase_days: int, section_ids: set[str] | None = None
) -> list[dict]:
    """Assembles every check above into the section list GET /api/warnings returns —
    shared with the chatbot's get_data_quality_warnings tool so both surface identical
    results. `sale_days`/`purchase_days` are independent — Sale and Purchase numeric
    checks each look back their own number of days — since the two imports run on
    separate cadences and a mismatch in one shouldn't force widening the other's window.
    The missing-product check reuses these same two windows (see missing_product_warnings)
    so it doesn't have to re-scan every sale/purchase line ever imported on every page
    load. Inventory-numeric has no equivalent window: it always validates only the latest
    snapshot per branch+product (see inventory_numeric_warnings), so there's nothing to
    widen.

    `section_ids` restricts which checks actually run. The Warning page wants all of
    them, but a dashboard tab showing a single tile does not: the Cost tab used to
    compute all six to display `purchase_numeric` alone, which is a 34ms check behind
    1.5s of work. Each check is independent, so the ones nobody asked for are simply
    never called, and the returned list keeps its usual order minus the omitted ones.
    """
    sale_since = date.today() - timedelta(days=sale_days - 1)
    purchase_since = date.today() - timedelta(days=purchase_days - 1)

    def wanted(section_id: str) -> bool:
        return section_ids is None or section_id in section_ids

    # The two reconciliation sections come out of one pass, so it runs if either is
    # wanted and is skipped entirely when neither is.
    if wanted("reconciliation_mismatch") or wanted("reconciliation_uom"):
        reconciliation_mismatch, reconciliation_uom = inventory_reconciliation_warnings(db, user)
    else:
        reconciliation_mismatch, reconciliation_uom = [], []

    sections = [
        {
            "id": "sale_numeric",
            "title": "Sale — fix these numbers",
            "description": "A price, quantity, or amount looks wrong on these sale lines — check the slip and re-import if needed.",
            "severity": "warning",
            "rows": sale_numeric_warnings(db, user, since=sale_since) if wanted("sale_numeric") else [],
        },
        {
            "id": "sale_description",
            "title": "Sale — add missing descriptions",
            "description": "These sale lines are for a product that has no name — fix it in the sales file and re-import so reports show what was sold.",
            "severity": "warning",
            "rows": sale_description_warnings(db, user, since=sale_since) if wanted("sale_description") else [],
        },
        {
            "id": "inventory_numeric",
            "title": "Inventory — fix these numbers",
            "description": (
                "A quantity or price looks wrong on the latest stock snapshot for these — recount or re-import the corrected file."
            ),
            "severity": "warning",
            "rows": inventory_numeric_warnings(db, user) if wanted("inventory_numeric") else [],
        },
        {
            "id": "purchase_numeric",
            "title": "Purchase — fix these numbers",
            "description": "A quantity or price looks wrong on these purchase lines — check the invoice and re-import if needed.",
            "severity": "warning",
            "rows": (
                purchase_numeric_warnings(db, user, since=purchase_since)
                if wanted("purchase_numeric")
                else []
            ),
        },
        {
            "id": "purchase_description",
            "title": "Purchase — add missing descriptions",
            "description": "These purchase lines are for a product that has no name — fix it in the purchase file and re-import.",
            "severity": "warning",
            "rows": (
                purchase_description_warnings(db, user, since=purchase_since)
                if wanted("purchase_description")
                else []
            ),
        },
        {
            "id": "missing_product",
            "title": "Inventory — add missing records",
            "description": "These stock codes were sold and/or purchased within the Sale/Purchase check windows above but have no inventory record yet — add one so stock levels stay accurate.",
            "severity": "warning",
            "rows": (
                missing_product_warnings(db, user, sale_since=sale_since, purchase_since=purchase_since)
                if wanted("missing_product")
                else []
            ),
        },
        {
            "id": "reconciliation_uom",
            "title": "Daily inventory check — verify by hand",
            "description": (
                "These were sold or purchased in more than one unit since the last inventory snapshot, "
                "so the automatic mismatch check may not be reliable for them — worth a manual look."
            ),
            "severity": "warning",
            "rows": reconciliation_uom,
        },
        {
            "id": "reconciliation_mismatch",
            "title": "Daily inventory check — recount these",
            "description": (
                "The latest inventory snapshot doesn't match what it should be (previous snapshot + "
                "purchases − sales since then) — recount the stock or check for a missing import."
            ),
            "severity": "critical",
            "rows": reconciliation_mismatch,
        },
    ]
    return [section for section in sections if wanted(section["id"])]


# These checks all require a person to inspect or add a product in the external
# inventory system. The Checking screen deliberately excludes price and transaction
# validation warnings: those need a source-file correction, not a shelf count.
CHECKING_SECTION_IDS = frozenset(
    {"missing_product", "reconciliation_uom", "reconciliation_mismatch"}
)


def build_checking_items(
    db: Session, user: User, sale_days: int, purchase_days: int
) -> list[dict[str, object]]:
    """Return the unique products a retail user needs to check in inventory.

    This reuses the Warning calculations rather than reimplementing reconciliation.
    The external inventory system remains the source of truth, so the screen exposes
    the product identity and latest on-hand count needed to find and verify it there.
    """
    sections = build_warning_sections(
        db,
        user,
        sale_days,
        purchase_days,
        section_ids=set(CHECKING_SECTION_IDS),
    )
    items_by_code: dict[str, dict[str, object]] = {}
    for section in sections:
        for row in section["rows"]:
            fields = {field["label"]: field["value"] for field in row["fields"]}
            stock_code = fields.get("Stock Code", "")
            description = fields.get("Description", "")
            if not stock_code or stock_code == "—":
                continue
            # A product can trigger more than one check; list it only once.
            items_by_code.setdefault(
                stock_code,
                {"stock_code": stock_code, "description": description, "on_hand_qty": None},
            )

    if user.branch_id and items_by_code:
        latest_subq = (
            db.query(func.max(StockLevel.snapshot_at))
            .filter(StockLevel.branch_id == user.branch_id)
            .scalar()
        )
        if latest_subq:
            stocks = (
                db.query(Product.stock_code, StockLevel.on_hand_qty)
                .join(StockLevel, StockLevel.product_id == Product.id)
                .filter(
                    StockLevel.branch_id == user.branch_id,
                    StockLevel.snapshot_at == latest_subq,
                    Product.stock_code.in_(list(items_by_code.keys())),
                )
                .all()
            )
            for code, qty in stocks:
                if code in items_by_code:
                    items_by_code[code]["on_hand_qty"] = float(qty) if qty is not None else None

    return sorted(items_by_code.values(), key=lambda item: str(item["stock_code"]).casefold())
