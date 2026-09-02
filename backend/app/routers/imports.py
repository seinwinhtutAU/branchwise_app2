import datetime
from pathlib import Path

import pandas as pd
from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile, status
from sqlalchemy import func
from sqlalchemy.orm import Session, defer, joinedload

from app.core.security import get_current_app_user, get_current_user
from app.db.session import get_db
from app.models.branch import Branch
from app.models.import_batch import ImportBatch, ImportBatchStatus, ImportType
from app.models.purchase import Purchase, PurchaseLine
from app.models.sale import Sale, SaleLine
from app.models.stock_level import StockLevel
from app.models.user import User, UserRole
from app.services.branches import list_retail_branches
from app.services.import_common import SUPPORTED_EXTENSIONS, detect_report_type, validate_rows
from app.services.inventory_import import OUTPUT_COLUMNS as INVENTORY_OUTPUT_COLUMNS
from app.services.inventory_import import VALIDATION_RULES as INVENTORY_VALIDATION_RULES
from app.services.inventory_import import parse_inventory_upload
from app.services.inventory_persist import persist_inventory
from app.services.pos_import import OUTPUT_COLUMNS as SALES_OUTPUT_COLUMNS
from app.services.pos_import import VALIDATION_RULES as SALES_VALIDATION_RULES
from app.services.pos_import import parse_pos_sale_upload
from app.services.purchase_import import OUTPUT_COLUMNS as PURCHASE_OUTPUT_COLUMNS
from app.services.purchase_import import VALIDATION_RULES as PURCHASE_VALIDATION_RULES
from app.services.purchase_import import parse_purchase_upload
from app.services.purchase_persist import persist_purchases
from app.services.sales_persist import persist_sales

router = APIRouter(prefix="/api/imports", tags=["imports"])


def _check_extension(filename: str | None) -> None:
    ext = Path(filename or "").suffix.lower()
    if ext not in SUPPORTED_EXTENSIONS:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            f"Unsupported file type '{ext or 'unknown'}' — expected .csv, .xls, or .xlsx",
        )


_REPORT_TYPE_LABELS = {"sale": "Sale", "inventory": "Inventory", "purchase": "Purchase"}


def _check_report_type(origin_rows: list[list[str]], expected: str) -> None:
    """Catch an obviously wrong file (e.g. a purchase export uploaded to the
    sale importer) by its column-header row, before it silently produces an
    empty or nonsensical preview. Only blocks on a confident mismatch — a
    grid that doesn't match any known header is let through unchanged."""
    detected = detect_report_type(origin_rows)
    if detected is not None and detected != expected:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            f"This looks like a {_REPORT_TYPE_LABELS[detected]} file, not a "
            f"{_REPORT_TYPE_LABELS[expected]} file — check you picked the right one.",
        )


def _parse_or_400(
    parser, contents: bytes, filename: str | None, expected_type: str, *parser_args
) -> tuple[list[list[str]], pd.DataFrame]:
    """The shared front half of every preview/confirm endpoint: run one import
    type's parser, translating any parse failure into a 400, then reject an
    obviously wrong file (see _check_report_type)."""
    try:
        origin_rows, clean_df = parser(contents, filename or "", *parser_args)
    except Exception as exc:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, f"Could not parse file: {exc}") from exc
    _check_report_type(origin_rows, expected_type)
    return origin_rows, clean_df


def _resolve_branch_id(user: User, branch_id: str | None, db: Session) -> str | None:
    if user.branch_id is not None:
        return user.branch_id

    if not branch_id:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            "This account has no branch assigned — pass branch_id to say which branch this import is for",
        )
    if db.get(Branch, branch_id) is None:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, f"Unknown branch_id: {branch_id}")
    return branch_id


def _resolve_branch_for_preview(user: User, branch_id: str | None, db: Session) -> Branch | None:
    """Like _resolve_branch_id, but tolerates the branch being unknown rather than
    erroring — an admin's very first preview call happens before they've picked a
    branch on the review screen (the picker only appears there, and its value is only
    sent once chosen; see ImportReviewPage.tsx). A retail account's own branch is
    always known already. Returns None only when neither the account nor the request
    supplies one, meaning "use the universal MDY default for this one preview" — the
    frontend re-previews with a real branch_id as soon as one is picked, so this only
    ever affects the very first render of an admin's review screen.
    """
    resolved_id = user.branch_id or branch_id
    if resolved_id is None:
        return None
    branch = db.get(Branch, resolved_id)
    if branch is None:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, f"Unknown branch_id: {branch_id}")
    return branch


def _location_raw(df: pd.DataFrame) -> str | None:
    if "Location" not in df.columns or df.empty:
        return None
    values = df["Location"].dropna()
    return str(values.iloc[0]) if not values.empty else None


def _origin_row_issues(
    origin_rows: list[list[str]], clean_df: pd.DataFrame, row_issues: list[list[dict]]
) -> list[list[dict]]:
    """Map each clean row's issues back to its raw line, so the Original data
    table can highlight the same rows — with the same plain-English reasons —
    as the Cleaned data table."""
    mapped: list[list[dict]] = [[] for _ in origin_rows]
    origin_indices = clean_df.attrs.get("origin_indices", [])
    for clean_idx, issues in enumerate(row_issues):
        if issues and clean_idx < len(origin_indices):
            mapped[origin_indices[clean_idx]] = issues
    return mapped


def _build_preview(
    filename: str | None,
    origin_rows: list[list[str]],
    clean_df: pd.DataFrame,
    columns: list[str],
    rules: list[tuple[str, float | None]],
) -> dict:
    row_issues = validate_rows(clean_df, rules)
    return {
        "filename": filename,
        "origin": {"rows": origin_rows, "row_issues": _origin_row_issues(origin_rows, clean_df, row_issues)},
        "clean": {
            "columns": columns,
            "rows": clean_df.to_dict(orient="records"),
            "row_issues": row_issues,
        },
        # Sales-only (empty for Inventory/Purchase) — see pos_import.py's subtotal_mismatches
        # attr. Surfaced by Import Health's "slip-total mismatches" check rather than only
        # reaching a server log, since it's already computed here and otherwise discarded.
        "slip_subtotal_mismatches": clean_df.attrs.get("subtotal_mismatches", []),
    }


def _can_access_batch(user: User, batch: ImportBatch) -> bool:
    """An account with no branch (e.g. admin) can see/revert any batch;
    everyone else only their own branch's — same rule as import confirmation."""
    return user.branch_id is None or batch.branch_id == user.branch_id


@router.post("/sales")
async def import_sales_file(
    file: UploadFile = File(...),
    branch_id: str | None = Form(None),
    user: User = Depends(get_current_app_user),
    db: Session = Depends(get_db),
) -> dict:
    _check_extension(file.filename)
    branch = _resolve_branch_for_preview(user, branch_id, db)

    contents = await file.read()
    origin_rows, clean_df = _parse_or_400(
        parse_pos_sale_upload, contents, file.filename, "sale",
        branch.sale_date_format if branch else "MDY",
    )

    return _build_preview(file.filename, origin_rows, clean_df, SALES_OUTPUT_COLUMNS, SALES_VALIDATION_RULES)


@router.post("/sales/confirm")
async def confirm_sales_file(
    file: UploadFile = File(...),
    branch_id: str | None = Form(None),
    user: User = Depends(get_current_app_user),
    db: Session = Depends(get_db),
) -> dict:
    _check_extension(file.filename)
    resolved_branch_id = _resolve_branch_id(user, branch_id, db)
    branch = db.get(Branch, resolved_branch_id)

    contents = await file.read()
    origin_rows, clean_df = _parse_or_400(
        parse_pos_sale_upload, contents, file.filename, "sale",
        branch.sale_date_format if branch else "MDY",
    )

    preview_data = _build_preview(
        file.filename, origin_rows, clean_df, SALES_OUTPUT_COLUMNS, SALES_VALIDATION_RULES
    )
    return persist_sales(
        db,
        clean_df,
        branch_id=resolved_branch_id,
        location_raw=_location_raw(clean_df),
        source_file=file.filename,
        uploaded_by=user.id,
        preview_data=preview_data,
    )


@router.post("/inventory")
async def import_inventory_file(
    file: UploadFile = File(...),
    branch_id: str | None = Form(None),
    user: User = Depends(get_current_app_user),
    db: Session = Depends(get_db),
) -> dict:
    _check_extension(file.filename)
    branch = _resolve_branch_for_preview(user, branch_id, db)

    contents = await file.read()
    origin_rows, clean_df = _parse_or_400(
        parse_inventory_upload, contents, file.filename, "inventory",
        branch.inventory_date_format if branch else "MDY",
    )

    return _build_preview(
        file.filename, origin_rows, clean_df, INVENTORY_OUTPUT_COLUMNS, INVENTORY_VALIDATION_RULES
    )


@router.post("/inventory/confirm")
async def confirm_inventory_file(
    file: UploadFile = File(...),
    branch_id: str | None = Form(None),
    user: User = Depends(get_current_app_user),
    db: Session = Depends(get_db),
) -> dict:
    _check_extension(file.filename)
    resolved_branch_id = _resolve_branch_id(user, branch_id, db)
    branch = db.get(Branch, resolved_branch_id)

    contents = await file.read()
    origin_rows, clean_df = _parse_or_400(
        parse_inventory_upload, contents, file.filename, "inventory",
        branch.inventory_date_format if branch else "MDY",
    )

    preview_data = _build_preview(
        file.filename, origin_rows, clean_df, INVENTORY_OUTPUT_COLUMNS, INVENTORY_VALIDATION_RULES
    )
    return persist_inventory(
        db,
        clean_df,
        branch_id=resolved_branch_id,
        location_raw=_location_raw(clean_df),
        source_file=file.filename,
        uploaded_by=user.id,
        preview_data=preview_data,
    )


@router.post("/purchase")
async def import_purchase_file(
    file: UploadFile = File(...), user=Depends(get_current_user)
) -> dict:
    _check_extension(file.filename)

    contents = await file.read()
    origin_rows, clean_df = _parse_or_400(
        parse_purchase_upload, contents, file.filename, "purchase"
    )

    return _build_preview(
        file.filename, origin_rows, clean_df, PURCHASE_OUTPUT_COLUMNS, PURCHASE_VALIDATION_RULES
    )


@router.post("/purchase/confirm")
async def confirm_purchase_file(
    file: UploadFile = File(...),
    branch_id: str | None = Form(None),
    purchase_date: str | None = Form(None),
    user: User = Depends(get_current_app_user),
    db: Session = Depends(get_db),
) -> dict:
    _check_extension(file.filename)
    resolved_branch_id = _resolve_branch_id(user, branch_id, db)

    resolved_purchase_date = None
    if purchase_date:
        try:
            resolved_purchase_date = datetime.date.fromisoformat(purchase_date)
        except ValueError as exc:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, "purchase_date must be YYYY-MM-DD") from exc

    contents = await file.read()
    origin_rows, clean_df = _parse_or_400(
        parse_purchase_upload, contents, file.filename, "purchase"
    )

    preview_data = _build_preview(
        file.filename, origin_rows, clean_df, PURCHASE_OUTPUT_COLUMNS, PURCHASE_VALIDATION_RULES
    )
    return persist_purchases(
        db,
        clean_df,
        branch_id=resolved_branch_id,
        location_raw=_location_raw(clean_df),
        source_file=file.filename,
        uploaded_by=user.id,
        preview_data=preview_data,
        purchase_date=resolved_purchase_date,
    )


@router.get("/freshness")
def get_import_freshness(
    user: User = Depends(get_current_app_user), db: Session = Depends(get_db)
) -> list[dict]:
    """Per branch, when sales/inventory/purchase were each last successfully
    confirmed — since files are expected daily, this surfaces a branch that
    quietly stopped uploading, not just whether an individual import worked.
    """
    branches_query = list_retail_branches(db)
    if user.branch_id is not None:
        branches_query = branches_query.filter(Branch.id == user.branch_id)
    branches = branches_query.all()

    latest_rows = (
        db.query(
            ImportBatch.branch_id,
            ImportBatch.import_type,
            func.max(ImportBatch.created_at).label("last_imported_at"),
        )
        .filter(ImportBatch.status == ImportBatchStatus.COMPLETED)
        .group_by(ImportBatch.branch_id, ImportBatch.import_type)
        .all()
    )
    last_by_branch_and_type = {
        (branch_id, import_type.value): last_imported_at.isoformat()
        for branch_id, import_type, last_imported_at in latest_rows
        if branch_id is not None
    }

    return [
        {
            "branch_id": branch.id,
            "branch_name": branch.name,
            "sales_last_imported_at": last_by_branch_and_type.get((branch.id, ImportType.SALES.value)),
            "inventory_last_imported_at": last_by_branch_and_type.get(
                (branch.id, ImportType.INVENTORY.value)
            ),
            "purchase_last_imported_at": last_by_branch_and_type.get(
                (branch.id, ImportType.PURCHASE.value)
            ),
        }
        for branch in branches
    ]


@router.get("/data-version")
def get_import_data_version(
    user: User = Depends(get_current_app_user),
    db: Session = Depends(get_db),
) -> dict:
    """A cheap token that changes whenever this account's imported data changes.

    The frontend caches the dashboard and Warning pages until something makes them
    stale, and it can see its *own* imports and reverts — but not one done by another
    account on another machine, which is the normal case for a business with several
    branches. Polling this is how it finds out: three aggregates over one indexed table,
    cheap enough to call every minute, versus re-running a two-second dashboard query to
    discover nothing changed.

    `reverted_at` is in the token as well as `created_at` because reverting deletes rows
    without creating a batch — the newest-created timestamp alone would not move.
    """
    query = db.query(
        func.max(ImportBatch.created_at),
        func.max(ImportBatch.reverted_at),
        func.count(ImportBatch.id),
    )
    # Same visibility rule as the history list: a branch account sees its own branch.
    if user.branch_id is not None:
        query = query.filter(ImportBatch.branch_id == user.branch_id)
    created_at, reverted_at, batch_count = query.one()
    return {"version": f"{created_at or ''}|{reverted_at or ''}|{batch_count}"}


@router.get("/history")
def list_import_history(
    limit: int | None = None,
    offset: int = 0,
    user: User = Depends(get_current_app_user),
    db: Session = Depends(get_db),
) -> list[dict]:
    # preview_data holds the full origin/clean row grids from the original import (same
    # shape as the preview endpoints) — often the single biggest column on this table.
    # The list view never needs it (only GET /history/{batch_id} does), so it's deferred
    # here to avoid transferring and JSON-parsing every batch's full grid on every load.
    query = (
        db.query(ImportBatch)
        .options(
            joinedload(ImportBatch.branch),
            joinedload(ImportBatch.uploaded_by_user),
            defer(ImportBatch.preview_data),
        )
        .order_by(ImportBatch.created_at.desc())
    )
    if user.branch_id is not None:
        query = query.filter(ImportBatch.branch_id == user.branch_id)
    if limit is not None:
        query = query.limit(limit).offset(offset)

    return [
        {
            "id": b.id,
            "import_type": b.import_type.value,
            "filename": b.filename,
            "branch_name": b.branch.name if b.branch else None,
            "uploaded_by_name": b.uploaded_by_user.name if b.uploaded_by_user else None,
            "status": b.status.value,
            "summary": b.summary,
            "created_at": b.created_at.isoformat(),
            "reverted_at": b.reverted_at.isoformat() if b.reverted_at else None,
        }
        for b in query.all()
    ]


@router.get("/history/{batch_id}")
def get_import_history_detail(
    batch_id: str,
    user: User = Depends(get_current_app_user),
    db: Session = Depends(get_db),
) -> dict:
    batch = db.get(ImportBatch, batch_id)
    if batch is None or not _can_access_batch(user, batch):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Import batch not found")

    return {
        "id": batch.id,
        "import_type": batch.import_type.value,
        "filename": batch.filename,
        "branch_name": batch.branch.name if batch.branch else None,
        "uploaded_by_name": batch.uploaded_by_user.name if batch.uploaded_by_user else None,
        "status": batch.status.value,
        "summary": batch.summary,
        "created_at": batch.created_at.isoformat(),
        "reverted_at": batch.reverted_at.isoformat() if batch.reverted_at else None,
        "origin": batch.preview_data.get("origin", {"rows": [], "row_issues": []}),
        "clean": batch.preview_data.get("clean", {"columns": [], "rows": [], "row_issues": []}),
    }


@router.post("/history/{batch_id}/revert")
def revert_import_batch(
    batch_id: str,
    # True when this revert is the first half of a "Reimport" (a corrected file is about
    # to be confirmed for the same slot) rather than a standalone removal — determines
    # whether the batch ends up marked REVERTED ("Removed") or REIMPORTED.
    replaced: bool = False,
    user: User = Depends(get_current_app_user),
    db: Session = Depends(get_db),
) -> dict:
    batch = db.get(ImportBatch, batch_id)
    if batch is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Import batch not found")
    if not _can_access_batch(user, batch):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Import batch not found")
    if batch.status != ImportBatchStatus.COMPLETED:
        raise HTTPException(status.HTTP_409_CONFLICT, "This import was already removed or reimported")
    if user.role == UserRole.RETAIL and datetime.datetime.now() - batch.created_at > datetime.timedelta(
        days=1
    ):
        raise HTTPException(
            status.HTTP_403_FORBIDDEN,
            "Retail accounts can only revert an import within 1 day of importing it.",
        )

    if batch.import_type.value == "sales":
        sale_ids = [s.id for s in db.query(Sale.id).filter(Sale.import_batch_id == batch_id)]
        db.query(SaleLine).filter(SaleLine.sale_id.in_(sale_ids)).delete(synchronize_session=False)
        db.query(Sale).filter(Sale.import_batch_id == batch_id).delete(synchronize_session=False)
    elif batch.import_type.value == "purchase":
        purchase_ids = [
            p.id for p in db.query(Purchase.id).filter(Purchase.import_batch_id == batch_id)
        ]
        db.query(PurchaseLine).filter(
            PurchaseLine.purchase_id.in_(purchase_ids)
        ).delete(synchronize_session=False)
        db.query(Purchase).filter(Purchase.import_batch_id == batch_id).delete(
            synchronize_session=False
        )
    else:
        db.query(StockLevel).filter(StockLevel.import_batch_id == batch_id).delete(
            synchronize_session=False
        )

    batch.status = ImportBatchStatus.REIMPORTED if replaced else ImportBatchStatus.REVERTED
    batch.reverted_at = datetime.datetime.now()
    batch.reverted_by = user.id
    db.commit()

    return {
        "id": batch.id,
        "status": batch.status.value,
        "reverted_at": batch.reverted_at.isoformat(),
    }
