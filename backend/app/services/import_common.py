import csv
import functools
import io
import re
import uuid
from pathlib import Path

import pandas as pd
import pyidaungsu as pds
from sqlalchemy.orm import Session

from app.models.product import Product

SUPPORTED_EXTENSIONS = {".csv", ".xls", ".xlsx"}

_MYANMAR_RANGE = re.compile(r"[က-႟]")


def parse_number(value: str) -> float | None:
    value = value.strip().replace(",", "")
    if not value:
        return None
    try:
        return float(value)
    except ValueError:
        return None


def is_zawgyi(text: str) -> bool:
    """Classify Myanmar text as Zawgyi vs. standard Unicode.

    pyidaungsu bundles a fasttext classifier for this, but its public
    detect()/predict() wrapper crashes under numpy>=2 (`np.array(x,
    copy=False)` raises ValueError). Call the underlying pybind model
    directly to bypass that broken wrapper.
    """
    label = pds.f.f.predict(text, 1, 0.0, "strict")[0][1]
    return label == "__label__zg"


@functools.lru_cache(maxsize=50_000)
def clean_text(value: str) -> str:
    """Collapse whitespace and normalize Zawgyi-encoded Myanmar text to Unicode.

    POS exports from Myanmar retail software commonly mix standard Unicode
    Myanmar text with legacy Zawgyi encoding (a non-Unicode-compliant font
    hack that was near universal before Myanmar's 2019 switch to Unicode).
    Chromium/Electron only render standard Unicode Myanmar correctly, so
    Zawgyi text displays garbled unless converted — but converting text
    that's already proper Unicode corrupts it, so only convert when the
    text is actually detected as Zawgyi.

    Cached because is_zawgyi() runs a fasttext model inference per call, and
    the same Description/Location strings repeat across many rows of a
    single import (e.g. Location is often identical on every row) — without
    memoizing, a large file re-runs the model on identical text hundreds of
    times. The result is a pure function of the input text, so caching is
    safe; capped well above any realistic number of distinct strings seen
    across the process's lifetime so it can't grow unbounded.
    """
    text = " ".join(value.split())
    if _MYANMAR_RANGE.search(text) and is_zawgyi(text):
        text = pds.cvt2uni(text)
    return text


def read_raw_grid(file_bytes: bytes, filename: str) -> list[list[str]]:
    """Read a raw POS export (csv/xls/xlsx) into a grid of string cells, unmodified."""
    ext = Path(filename).suffix.lower()

    if ext == ".csv":
        text = file_bytes.decode("utf-8-sig")
        return [row for row in csv.reader(io.StringIO(text, newline=""))]

    if ext in (".xls", ".xlsx"):
        df = pd.read_excel(io.BytesIO(file_bytes), header=None, dtype=str)
        return df.fillna("").astype(str).values.tolist()

    raise ValueError(f"Unsupported file type: {ext or 'unknown'}")


# Each report type's column-header row starts with a distinct label, e.g. a
# sale export's header is "Other Code,Stock Code,Description,...", inventory's
# is "Stk. Code,Other Code,...", and purchase's (which has no metadata line
# before it) is "Stock Code,Description,...". Checked against the first few
# rows of the raw grid, this tells a sale file apart from an inventory or
# purchase file structurally, without needing the row to parse cleanly.
_REPORT_TYPE_SIGNATURES: dict[str, str] = {
    "Other Code": "sale",
    "Stk. Code": "inventory",
    "Stock Code": "purchase",
}


def detect_report_type(rows: list[list[str]]) -> str | None:
    """Best-effort guess of which POS export type a raw grid is, from its
    column-header row's first cell. Returns None when nothing in the first
    few rows matches a known header, so unfamiliar files aren't blocked —
    this is only meant to catch an obvious wrong-file upload (e.g. a
    purchase export sent to the sale importer), not to validate the file.
    """
    for row in rows[:5]:
        if not row:
            continue
        first = row[0].strip()
        if first in _REPORT_TYPE_SIGNATURES:
            return _REPORT_TYPE_SIGNATURES[first]
    return None


NumericRule = tuple[str, float | None]

# Plain-English names for the columns validation can flag, since these
# messages are read by shop staff, not developers.
_FRIENDLY_LABELS: dict[str, str] = {
    "Qty": "Quantity",
    "Quantity": "Quantity",
    "Selling_Price": "Selling Price",
    "Buying_Price": "Buying Price",
    "On_Hand_Qty": "Stock Quantity",
    "Discount_Amount": "Discount Amount",
    "Amount": "Amount",
    "Net_Amount": "Net Amount",
}


def _friendly_label(column: str) -> str:
    return _FRIENDLY_LABELS.get(column, column.replace("_", " "))


def _describe_failure(column: str, minimum: float | None, *, unparseable: bool) -> str:
    label = _friendly_label(column)
    if unparseable:
        return f"{label} doesn't look like a valid number"
    if minimum == 0:
        return f"{label} can't be a negative number"
    if minimum == 1:
        return f"{label} can't be zero — enter at least 1"
    return f"{label} must be at least {minimum:g}"


def validate_rows(df: pd.DataFrame, rules: list[NumericRule]) -> list[list[dict]]:
    """Check each row against a list of (column, minimum) numeric rules.

    A column fails if its value isn't a real number (already None/NaN from
    parse_number during cleaning), or — when a minimum is given — is below
    it. `minimum=None` means "just must be a real number," no threshold.

    Returns one list of issues per row, in row order; an empty list means
    the row passed everything. Each issue is `{"column": ..., "message":
    ...}` — `column` for matching the cell to highlight, `message` a
    plain-English explanation for non-technical users (e.g. "Quantity
    can't be zero — enter at least 1"), not just the raw column name.
    """
    issues: list[list[dict]] = []
    # Plain dicts rather than df.iterrows() — iterrows materializes a Series per
    # row, which is several times slower across the thousands of rows a Warning
    # page load or import preview can push through here.
    for row in df.to_dict(orient="records"):
        failed: list[dict] = []
        for column, minimum in rules:
            value = row.get(column)
            unparseable = value is None or pd.isna(value)
            if unparseable or (minimum is not None and value < minimum):
                failed.append(
                    {
                        "column": column,
                        "message": _describe_failure(column, minimum, unparseable=unparseable),
                    }
                )
        issues.append(failed)
    return issues


def pluralize(count: int, noun: str) -> str:
    return f"{count} {noun}" if count == 1 else f"{count} {noun}s"


def product_summary_messages(created: int, updated: int) -> list[str]:
    """Plain-English lines describing product upsert counts for an import summary.

    Shared across all three import types since they all upsert products the
    same way (see get_or_create_products) — these lines are read by shop
    staff, not developers, so they name what happened rather than exposing
    raw "created"/"updated" counters.
    """
    messages = []
    if created:
        messages.append(f"{pluralize(created, 'new product')} added")
    if updated:
        messages.append(f"{pluralize(updated, 'existing product')} updated")
    return messages


def get_or_create_products(
    db: Session, items: list[tuple[str, str, str | None]]
) -> tuple[dict[str, Product], int, int]:
    """Batch upsert products keyed by stock_code, in one round trip.

    `items` is a list of (stock_code, description, group_name) — typically
    one per row of an import, and may contain duplicate stock_codes (last
    one wins). Looking each one up individually doesn't scale: a 900-row
    inventory import would need ~900 sequential round trips to a remote
    Postgres pooler. Instead this does a single batch SELECT for all codes,
    then creates/updates the rest in memory (flushed together at the
    caller's final commit). New products get a client-generated id so
    callers can use product.id immediately without an extra flush.

    Returns (stock_code -> Product map, created_count, updated_count).
    """
    by_code: dict[str, tuple[str, str | None]] = {}
    for stock_code, description, group_name in items:
        by_code[stock_code] = (description, group_name)

    existing = {
        p.stock_code: p
        for p in db.query(Product).filter(Product.stock_code.in_(by_code.keys())).all()
    }

    products: dict[str, Product] = {}
    created = 0
    updated = 0

    for stock_code, (description, group_name) in by_code.items():
        product = existing.get(stock_code)
        if product is None:
            product = Product(
                id=str(uuid.uuid4()),
                stock_code=stock_code,
                description=description,
                group_name=group_name,
            )
            db.add(product)
            created += 1
        else:
            product.description = description
            if group_name is not None:
                product.group_name = group_name
            updated += 1
        products[stock_code] = product

    return products, created, updated
