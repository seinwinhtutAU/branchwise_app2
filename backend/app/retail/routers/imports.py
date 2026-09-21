import datetime
import io
import json
import logging
from pathlib import Path
import uuid

logger = logging.getLogger(__name__)

import pandas as pd
from fastapi import APIRouter, Depends, File, Form, HTTPException, Response, UploadFile, status
from sqlalchemy import func
from sqlalchemy.orm import Session, defer, joinedload

from app.core.security import get_current_app_user, get_current_user
from app.db.session import get_db
from app.models.branch import Branch
from app.retail.models.import_batch import ImportBatch, ImportBatchStatus, ImportType
from app.retail.models.purchase import Purchase, PurchaseLine
from app.retail.models.sale import Sale, SaleLine
from app.retail.models.stock_level import StockLevel
from app.models.user import User, UserRole
from app.services.branches import list_retail_branches
from app.retail.services.import_common import SUPPORTED_EXTENSIONS, detect_report_type, validate_rows, read_raw_grid
from app.retail.services.inventory_import import OUTPUT_COLUMNS as INVENTORY_OUTPUT_COLUMNS
from app.retail.services.inventory_import import VALIDATION_RULES as INVENTORY_VALIDATION_RULES
from app.retail.services.inventory_import import parse_inventory_upload, parse_inventory_export_from_grid
from app.retail.services.inventory_persist import persist_inventory
from app.retail.services.pos_import import OUTPUT_COLUMNS as SALES_OUTPUT_COLUMNS
from app.retail.services.pos_import import VALIDATION_RULES as SALES_VALIDATION_RULES
from app.retail.services.pos_import import parse_pos_sale_upload, parse_pos_sale_export_from_grid
from app.retail.services.purchase_import import OUTPUT_COLUMNS as PURCHASE_OUTPUT_COLUMNS
from app.retail.services.purchase_import import VALIDATION_RULES as PURCHASE_VALIDATION_RULES
from app.retail.services.purchase_import import parse_purchase_upload, parse_purchase_export_from_grid, extract_purchase_metadata
from app.retail.services.purchase_persist import persist_purchases
from app.retail.services.sales_persist import persist_sales
from app.retail.routers.common import require_retail
from app.services.storage import get_storage_service

router = APIRouter(prefix="/api/imports", tags=["imports"], dependencies=[Depends(require_retail)])

MAX_UPLOAD_BYTES = 50 * 1024 * 1024  # 50 MB


def _upload_to_storage(contents: bytes, filename: str | None, preview_data: dict | None = None) -> str | None:
    if not filename:
        return None
    storage = get_storage_service()
    if not storage.is_configured:
        return None
    batch_prefix = str(uuid.uuid4())
    key = f"imports/{batch_prefix}/{filename}"
    ext = Path(filename).suffix.lower()
    content_type = (
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        if ext == ".xlsx"
        else "application/vnd.ms-excel"
        if ext == ".xls"
        else "text/csv"
        if ext == ".csv"
        else "application/octet-stream"
    )
    uploaded_key = storage.upload_file_bytes(contents, key, content_type)
    if preview_data:
        json_key = f"imports/{batch_prefix}/preview_data.json"
        storage.upload_file_bytes(
            json.dumps(preview_data).encode("utf-8"),
            json_key,
            "application/json",
        )
    return uploaded_key


async def _read_upload(file: UploadFile, max_bytes: int = MAX_UPLOAD_BYTES) -> bytes:
    contents = await file.read(max_bytes + 1)
    if len(contents) > max_bytes:
        raise HTTPException(
            status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            f"File too large — maximum upload size is {max_bytes // (1024 * 1024)} MB",
        )
    return contents


@router.post("/general")
async def import_general_file(
    file: UploadFile = File(...),
    branch_id: str | None = Form(None),
    user: User = Depends(get_current_app_user),
    db: Session = Depends(get_db),
) -> dict:
    """Keep an arbitrary file unchanged without creating retail records."""
    if not file.filename:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Choose a file to upload")

    contents = await _read_upload(file)
    resolved_branch_id = _resolve_branch_id(user, branch_id, db)
    content_type = file.content_type or "application/octet-stream"
    batch = ImportBatch(
        import_type=ImportType.GENERAL,
        branch_id=resolved_branch_id,
        uploaded_by=user.id,
        filename=file.filename,
        summary={
            "message": "Daily operation cost file stored unchanged; no retail data was created.",
            "file_size": len(contents),
        },
        preview_data={},
        # Database storage is the reliable source of the original upload. R2 is an
        # optional mirror consistent with the existing retail import flow.
        original_file=contents,
        original_file_size=len(contents),
        original_file_content_type=content_type,
        storage_key=_upload_to_storage(contents, file.filename),
    )
    db.add(batch)
    db.commit()
    db.refresh(batch)
    return {
        "id": batch.id,
        "filename": batch.filename,
        "file_size": batch.original_file_size,
        "status": batch.status.value,
    }


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

    contents = await _read_upload(file)
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

    contents = await _read_upload(file)
    origin_rows, clean_df = _parse_or_400(
        parse_pos_sale_upload, contents, file.filename, "sale",
        branch.sale_date_format if branch else "MDY",
    )

    preview_data = _build_preview(
        file.filename, origin_rows, clean_df, SALES_OUTPUT_COLUMNS, SALES_VALIDATION_RULES
    )
    storage_key = _upload_to_storage(contents, file.filename)
    return persist_sales(
        db,
        clean_df,
        branch_id=resolved_branch_id,
        location_raw=_location_raw(clean_df),
        source_file=file.filename,
        uploaded_by=user.id,
        preview_data=preview_data,
        storage_key=storage_key,
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

    contents = await _read_upload(file)
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

    contents = await _read_upload(file)
    origin_rows, clean_df = _parse_or_400(
        parse_inventory_upload, contents, file.filename, "inventory",
        branch.inventory_date_format if branch else "MDY",
    )

    preview_data = _build_preview(
        file.filename, origin_rows, clean_df, INVENTORY_OUTPUT_COLUMNS, INVENTORY_VALIDATION_RULES
    )
    storage_key = _upload_to_storage(contents, file.filename)
    return persist_inventory(
        db,
        clean_df,
        branch_id=resolved_branch_id,
        location_raw=_location_raw(clean_df),
        source_file=file.filename,
        uploaded_by=user.id,
        preview_data=preview_data,
        storage_key=storage_key,
    )


@router.post("/purchase")
async def import_purchase_file(
    file: UploadFile = File(...),
    user: User = Depends(get_current_app_user),
) -> dict:
    _check_extension(file.filename)

    contents = await _read_upload(file)
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
    purchase_number: str | None = Form(None),
    user: User = Depends(get_current_app_user),
    db: Session = Depends(get_db),
) -> dict:
    _check_extension(file.filename)
    resolved_branch_id = _resolve_branch_id(user, branch_id, db)

    extracted_number, extracted_date = extract_purchase_metadata(file.filename or "")
    resolved_purchase_number = purchase_number or extracted_number

    resolved_purchase_date = None
    if purchase_date:
        try:
            resolved_purchase_date = datetime.date.fromisoformat(purchase_date)
        except ValueError as exc:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, "purchase_date must be YYYY-MM-DD") from exc
    elif extracted_date:
        resolved_purchase_date = extracted_date

    contents = await _read_upload(file)
    origin_rows, clean_df = _parse_or_400(
        parse_purchase_upload, contents, file.filename, "purchase"
    )

    preview_data = _build_preview(
        file.filename, origin_rows, clean_df, PURCHASE_OUTPUT_COLUMNS, PURCHASE_VALIDATION_RULES
    )
    storage_key = _upload_to_storage(contents, file.filename)
    return persist_purchases(
        db,
        clean_df,
        branch_id=resolved_branch_id,
        location_raw=_location_raw(clean_df),
        source_file=file.filename,
        uploaded_by=user.id,
        preview_data=preview_data,
        purchase_date=resolved_purchase_date,
        purchase_number=resolved_purchase_number,
        storage_key=storage_key,
    )


@router.post("/inspect")
async def inspect_import_file(
    file: UploadFile = File(...),
    expected_type: str = Form(...),
    user: User = Depends(get_current_app_user),
) -> dict:
    """Fast inspection of an import file before confirmation.

    Verifies the file format matches expected_type, extracts date(s) and
    purchase number (if applicable), and flags wrong/unrecognized files.
    """
    ext = Path(file.filename or "").suffix.lower()
    if ext not in SUPPORTED_EXTENSIONS:
        return {
            "filename": file.filename,
            "status": "invalid",
            "detected_type": "unknown",
            "expected_type": expected_type,
            "dates": [],
            "purchase_number": None,
            "row_count": 0,
            "error_message": f"Unsupported file type ({ext or 'unknown'})",
        }

    try:
        contents = await _read_upload(file)
        rows = read_raw_grid(contents, file.filename or "")
    except HTTPException as exc:
        msg = str(exc.detail)
        if exc.status_code == 413 or "too large" in msg.lower():
            err_msg = f"Too large: exceeds {MAX_UPLOAD_BYTES // (1024 * 1024)} MB limit"
        else:
            err_msg = msg
        return {
            "filename": file.filename,
            "status": "invalid",
            "detected_type": "unknown",
            "expected_type": expected_type,
            "dates": [],
            "purchase_number": None,
            "row_count": 0,
            "error_message": err_msg,
        }
    except Exception as exc:
        msg = str(exc)
        if "too large" in msg.lower() or "413" in msg:
            err_msg = f"Too large: exceeds {MAX_UPLOAD_BYTES // (1024 * 1024)} MB limit"
        else:
            err_msg = f"Could not read file: {exc}"
        return {
            "filename": file.filename,
            "status": "invalid",
            "detected_type": "unknown",
            "expected_type": expected_type,
            "dates": [],
            "purchase_number": None,
            "row_count": 0,
            "error_message": err_msg,
        }

    detected = detect_report_type(rows)
    dates: list[str] = []
    purchase_number: str | None = None
    row_count = 0

    if detected is not None and detected != expected_type:
        return {
            "filename": file.filename,
            "status": "wrong_type",
            "detected_type": detected,
            "expected_type": expected_type,
            "dates": [],
            "purchase_number": None,
            "row_count": 0,
            "error_message": f"Not a {expected_type} file",
        }

    try:
        if expected_type == "purchase":
            purchase_number, p_date = extract_purchase_metadata(file.filename or "")
            if p_date:
                dates = [p_date.isoformat()]
            clean_df = parse_purchase_export_from_grid(rows)
            row_count = len(clean_df)
            if row_count == 0 and detected is None:
                return {
                    "filename": file.filename,
                    "status": "unrecognized",
                    "detected_type": "unknown",
                    "expected_type": expected_type,
                    "dates": dates,
                    "purchase_number": purchase_number,
                    "row_count": 0,
                    "error_message": "Not a purchase file",
                }
        elif expected_type == "sale":
            clean_df = parse_pos_sale_export_from_grid(rows)
            row_count = len(clean_df)
            if row_count == 0 and detected is None:
                return {
                    "filename": file.filename,
                    "status": "unrecognized",
                    "detected_type": "unknown",
                    "expected_type": expected_type,
                    "dates": [],
                    "purchase_number": None,
                    "row_count": 0,
                    "error_message": "Not a sale file",
                }
            if not clean_df.empty and "Date" in clean_df.columns:
                unique_dates = sorted(clean_df["Date"].dropna().astype(str).unique().tolist())
                dates = unique_dates
        elif expected_type == "inventory":
            clean_df = parse_inventory_export_from_grid(rows)
            row_count = len(clean_df)
            if row_count == 0 and detected is None:
                return {
                    "filename": file.filename,
                    "status": "unrecognized",
                    "detected_type": "unknown",
                    "expected_type": expected_type,
                    "dates": [],
                    "purchase_number": None,
                    "row_count": 0,
                    "error_message": "Not an inventory file",
                }
            printed_at = clean_df.attrs.get("printed_at")
            if printed_at:
                dates = [printed_at.date().isoformat()]
            else:
                _, f_date = extract_purchase_metadata(file.filename or "")
                if f_date:
                    dates = [f_date.isoformat()]
    except Exception as exc:
        return {
            "filename": file.filename,
            "status": "invalid",
            "detected_type": detected or "unknown",
            "expected_type": expected_type,
            "dates": dates,
            "purchase_number": purchase_number,
            "row_count": 0,
            "error_message": f"Could not parse file: {exc}",
        }

    return {
        "filename": file.filename,
        "status": "valid",
        "detected_type": detected or expected_type,
        "expected_type": expected_type,
        "dates": dates,
        "purchase_number": purchase_number,
        "row_count": row_count,
        "error_message": None,
    }


@router.get("/freshness")
def get_import_freshness(
    user: User = Depends(get_current_app_user), db: Session = Depends(get_db)
) -> list[dict]:
    """Per branch, when sales/inventory/purchase were each last successfully
    confirmed — surfacing a branch that quietly stopped uploading, not just
    whether an individual import worked.

    Only the timestamps are reported; deciding how late is "late" is left to the
    caller, because it differs per type. Sales and inventory are exported daily,
    but a purchase file only appears when a branch actually restocks, so an old
    purchase import is normal rather than a gap (the UI shows it ungraded).
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
            defer(ImportBatch.original_file),
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
            "storage_key": b.storage_key,
            "has_file": bool(b.storage_key or b.original_file_size),
        }
        for b in query.all()
    ]


@router.get("/history/{batch_id}")
def get_import_history_detail(
    batch_id: str,
    user: User = Depends(get_current_app_user),
    db: Session = Depends(get_db),
) -> dict:
    batch = db.get(ImportBatch, batch_id, options=[defer(ImportBatch.original_file)])
    if batch is None or not _can_access_batch(user, batch):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Import batch not found")

    preview_data = None
    storage = get_storage_service()
    if storage.is_configured:
        try:
            preview_key = f"imports/{batch.id}/preview_data.json"
            res = storage.download_file_bytes(preview_key)
            if res is not None:
                data_bytes, _ = res
                preview_data = json.loads(data_bytes.decode("utf-8"))
        except Exception as exc:
            logger.warning("Failed to fetch preview data from R2 for batch %s: %s", batch.id, exc)

    if preview_data is None:
        preview_data = batch.preview_data or {}

    origin_data = preview_data.get("origin", {"rows": [], "row_issues": []})
    clean_data = preview_data.get("clean", {"columns": [], "rows": [], "row_issues": []})

    has_origin_rows = bool(
        isinstance(origin_data, dict)
        and origin_data.get("rows")
    )

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
        "storage_key": batch.storage_key,
        "has_file": bool(batch.storage_key or batch.original_file_size or has_origin_rows),
        "origin": origin_data,
        "clean": clean_data,
    }


@router.get("/history/{batch_id}/download")
def download_import_batch_file(
    batch_id: str,
    user: User = Depends(get_current_app_user),
    db: Session = Depends(get_db),
):
    """Download an original file, including database-backed general uploads."""
    batch = db.get(ImportBatch, batch_id)
    if batch is None or not _can_access_batch(user, batch):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Import batch not found")

    if user.role != UserRole.ADMIN and batch.import_type != ImportType.GENERAL:
        raise HTTPException(
            status.HTTP_403_FORBIDDEN,
            "Only administrators can download original import files",
        )

    storage = get_storage_service()
    if batch.storage_key and storage.is_configured:
        res = storage.download_file_bytes(batch.storage_key)
        if res is not None:
            data, content_type = res
            filename = batch.filename or f"import_{batch.id}.xlsx"
            return Response(
                content=data,
                media_type=content_type,
                headers={"Content-Disposition": f'attachment; filename="{filename}"'},
            )

    if batch.original_file is not None:
        filename = batch.filename or f"import_{batch.id}"
        return Response(
            content=batch.original_file,
            media_type=batch.original_file_content_type or "application/octet-stream",
            headers={"Content-Disposition": f'attachment; filename="{filename}"'},
        )

    # Fallback: if no R2 file exists yet, check if preview_data has origin rows to reconstruct an Excel file
    origin = (batch.preview_data or {}).get("origin", {})
    origin_rows = origin.get("rows", [])
    if origin_rows:
        output = io.BytesIO()
        df = pd.DataFrame(origin_rows)
        with pd.ExcelWriter(output, engine="openpyxl") as writer:
            df.to_excel(writer, index=False)
        output.seek(0)
        filename = batch.filename or f"import_{batch.id}.xlsx"
        if not filename.endswith((".xlsx", ".xls", ".csv")):
            filename = f"{filename}.xlsx"
        return Response(
            content=output.getvalue(),
            media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            headers={"Content-Disposition": f'attachment; filename="{filename}"'},
        )

    raise HTTPException(status.HTTP_404_NOT_FOUND, "Original file is not available for this import batch")


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
    if batch.import_type == ImportType.GENERAL:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            "Daily operation cost files are stored only and cannot be reverted or reimported",
        )
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
