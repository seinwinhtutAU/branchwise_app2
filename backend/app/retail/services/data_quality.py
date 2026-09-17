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
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.models.branch import Branch
from app.retail.models.import_batch import ImportBatch
from app.retail.models.product import Product
from app.retail.models.purchase import Purchase, PurchaseLine
from app.retail.models.sale import Sale, SaleLine
from app.retail.models.stock_level import StockLevel
from app.models.user import User
from app.services.branches import list_retail_branches
from app.retail.services.import_common import NumericRule, validate_rows
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
        "_ImportBatchDate": import_batch.created_at.isoformat() if import_batch else None,
    }


def _numeric_failures(
    validation_records: list[dict], rules: list[NumericRule]
) -> list[tuple[int, list[dict]]]:
    """`(row index, issues)` for the rows that failed, and nothing for the rows that
    passed.

    Split out from building the warning rows so a caller can validate a *cheap
    projection* — just the numeric columns the rules actually read — and then pay for
    the expensive display enrichment (point-in-time pricing, the source import batch)
    only on the handful of rows that failed. That ordering matters a lot in practice:
    on a real branch this check reads a few hundred sale lines and finds zero problems,
    and enriching all of them first meant ~750ms of prefetching whose entire output was
    then thrown away.

    The projection must contain every column the rules name — validate_rows treats a
    missing column as an unparseable value, so an incomplete projection would flag
    every row rather than fail loudly.
    """
    if not validation_records:
        return []
    row_issues = validate_rows(pd.DataFrame.from_records(validation_records), rules)
    return [(index, issues) for index, issues in enumerate(row_issues) if issues]


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
    # _numeric_failures.
    failures = _numeric_failures(
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

    failures = _numeric_failures(
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

    failures = _numeric_failures(
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
    """
    branches_query = list_retail_branches(db)
    if user.branch_id is not None:
        branches_query = branches_query.filter(Branch.id == user.branch_id)
    branches = branches_query.all()

    mismatch_rows: list[dict] = []
    uom_rows: list[dict] = []

    for branch in branches:
        latest_ts = (
            db.query(func.max(StockLevel.snapshot_at))
            .filter(StockLevel.branch_id == branch.id)
            .scalar()
        )
        if latest_ts is None:
            continue
        prior_ts = (
            db.query(func.max(StockLevel.snapshot_at))
            .filter(
                StockLevel.branch_id == branch.id, StockLevel.snapshot_at < latest_ts
            )
            .scalar()
        )
        if prior_ts is None:
            continue

        latest_snapshot = {
            sl.product_id: sl
            for sl in db.query(StockLevel).filter(
                StockLevel.branch_id == branch.id, StockLevel.snapshot_at == latest_ts
            )
        }
        prior_snapshot = {
            sl.product_id: sl.on_hand_qty
            for sl in db.query(StockLevel).filter(
                StockLevel.branch_id == branch.id, StockLevel.snapshot_at == prior_ts
            )
        }

        window_start = prior_ts.date()
        window_end = latest_ts.date()

        # A mismatch or unit-mix warning is about the *latest* snapshot being wrong —
        # that's the one import worth pointing at, even though the check itself also
        # reads the prior snapshot and the purchases/sales in between.
        batches_by_id = _fetch_import_batches(
            db, {sl.import_batch_id for sl in latest_snapshot.values()}
        )

        purchased: dict[str, Decimal] = defaultdict(lambda: Decimal("0"))
        for product_id, qty in (
            db.query(PurchaseLine.product_id, func.sum(PurchaseLine.quantity))
            .join(Purchase, PurchaseLine.purchase_id == Purchase.id)
            .filter(
                Purchase.branch_id == branch.id,
                Purchase.purchase_date > window_start,
                Purchase.purchase_date <= window_end,
            )
            .group_by(PurchaseLine.product_id)
        ):
            purchased[product_id] = Decimal(str(qty or 0))

        sold: dict[str, Decimal] = defaultdict(lambda: Decimal("0"))
        for product_id, qty in (
            db.query(SaleLine.product_id, func.sum(SaleLine.qty))
            .join(Sale, SaleLine.sale_id == Sale.id)
            .filter(
                Sale.branch_id == branch.id,
                Sale.sale_date > window_start,
                Sale.sale_date <= window_end,
            )
            .group_by(SaleLine.product_id)
        ):
            sold[product_id] = Decimal(str(qty or 0))

        uoms_seen: dict[str, set[str]] = defaultdict(set)
        for product_id, uom in (
            db.query(SaleLine.product_id, SaleLine.uom)
            .join(Sale, SaleLine.sale_id == Sale.id)
            .filter(
                Sale.branch_id == branch.id,
                Sale.sale_date > window_start,
                Sale.sale_date <= window_end,
            )
        ):
            if uom:
                uoms_seen[product_id].add(uom)
        for product_id, uom in (
            db.query(PurchaseLine.product_id, PurchaseLine.uom)
            .join(Purchase, PurchaseLine.purchase_id == Purchase.id)
            .filter(
                Purchase.branch_id == branch.id,
                Purchase.purchase_date > window_start,
                Purchase.purchase_date <= window_end,
            )
        ):
            if uom:
                uoms_seen[product_id].add(uom)

        products_by_id = _fetch_products(db, set(latest_snapshot.keys()))
        for product_id, stock_level in latest_snapshot.items():
            product = products_by_id[product_id]
            prior_qty = Decimal(str(prior_snapshot.get(product_id) or 0))
            purchased_qty = purchased[product_id]
            sold_qty = sold[product_id]
            expected = round(prior_qty + purchased_qty - sold_qty, 2)
            actual = round(Decimal(str(stock_level.on_hand_qty or 0)), 2)

            source_batch = batches_by_id.get(stock_level.import_batch_id)
            source_import = (
                _source_import(
                    source_batch.id,
                    source_batch.filename,
                    source_batch.created_at.isoformat(),
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
