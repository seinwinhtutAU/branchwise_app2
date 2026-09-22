import datetime
import io
import logging
from pathlib import Path
from typing import Annotated
import uuid

logger = logging.getLogger(__name__)

import pandas as pd
from fastapi import (
    APIRouter,
    Depends,
    File,
    Form,
    Header,
    HTTPException,
    Query,
    Response,
    UploadFile,
    status,
)
from sqlalchemy import func
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, defer, joinedload

from app.core.security import get_current_app_user, get_current_user
from app.core.timestamps import utc_now, utc_timestamp
from app.db.session import get_db
from app.models.branch import Branch
from app.retail.models.import_batch import ImportBatch, ImportBatchStatus, ImportType
from app.retail.models.purchase import Purchase, PurchaseLine
from app.retail.models.sale import Sale, SaleLine
from app.retail.models.stock_level import StockLevel
from app.models.user import User, UserRole
from app.services.branches import list_retail_branches
from app.retail.services.import_common import (
    SUPPORTED_EXTENSIONS,
    detect_report_type,
    pluralize,
    read_raw_grid,
    validate_rows,
)
from app.retail.services.inventory_import import (
    OUTPUT_COLUMNS as INVENTORY_OUTPUT_COLUMNS,
)
from app.retail.services.inventory_import import (
    VALIDATION_RULES as INVENTORY_VALIDATION_RULES,
)
from app.retail.services.inventory_import import (
    parse_inventory_upload,
    parse_inventory_export_from_grid,
)
from app.retail.services.inventory_persist import persist_inventory
from app.retail.services.import_integrity import (
    latest_daily_data_dates,
    purchase_number_integrity,
)
from app.retail.services.pos_import import OUTPUT_COLUMNS as SALES_OUTPUT_COLUMNS
from app.retail.services.pos_import import VALIDATION_RULES as SALES_VALIDATION_RULES
from app.retail.services.pos_import import (
    parse_pos_sale_upload,
    parse_pos_sale_export_from_grid,
)
from app.retail.services.purchase_import import (
    OUTPUT_COLUMNS as PURCHASE_OUTPUT_COLUMNS,
)
from app.retail.services.purchase_import import (
    VALIDATION_RULES as PURCHASE_VALIDATION_RULES,
)
from app.retail.services.purchase_import import (
    parse_purchase_upload,
    parse_purchase_export_from_grid,
    extract_purchase_metadata,
)
from app.retail.services.purchase_persist import persist_purchases
from app.retail.services.preview_storage import (
    PREVIEW_PAGE_SIZE,
    read_preview_page,
    read_preview_warnings,
    upload_preview_pages,
)
from app.retail.services.sales_persist import persist_sales
from app.retail.routers.common import require_retail_operations
from app.services.storage import get_storage_service

router = APIRouter(
    prefix="/api/imports",
    tags=["imports"],
    dependencies=[Depends(require_retail_operations)],
)

MAX_UPLOAD_BYTES = 50 * 1024 * 1024  # 50 MB
IdempotencyKey = Annotated[str | None, Header(alias="Idempotency-Key", max_length=64)]


def _upload_to_storage(contents: bytes, filename: str | None) -> str | None:
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
    return uploaded_key


def _upload_preview_to_storage(batch_id: str, preview_data: dict) -> None:
    storage = get_storage_service()
    if storage.is_configured and not upload_preview_pages(
        storage, batch_id, preview_data
    ):
        logger.warning(
            "Failed to store paged preview in R2 for import batch %s", batch_id
        )


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
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST, f"Could not parse file: {exc}"
        ) from exc
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
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST, f"Unknown branch_id: {branch_id}"
        )
    return branch_id


def _resolve_branch_for_preview(
    user: User, branch_id: str | None, db: Session
) -> Branch | None:
    """Like _resolve_branch_id, but tolerates the branch being unknown rather than
    erroring — a development account's first preview call happens before it has picked a
    branch on the review screen (the picker only appears there, and its value is only
    sent once chosen; see ImportReviewPage.tsx). A retail account's own branch is
    always known already. Returns None only when neither the account nor the request
    supplies one, meaning "use the universal MDY default for this one preview" — the
    frontend re-previews with a real branch_id as soon as one is picked, so this only
    ever affects the very first render of a development account's review screen.
    """
    resolved_id = user.branch_id or branch_id
    if resolved_id is None:
        return None
    branch = db.get(Branch, resolved_id)
    if branch is None:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST, f"Unknown branch_id: {branch_id}"
        )
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


MAX_PREVIEW_ROWS = 500


def _build_preview(
    filename: str | None,
    origin_rows: list[list[str]],
    clean_df: pd.DataFrame,
    columns: list[str],
    rules: list[tuple[str, float | None]],
) -> dict:
    row_issues = validate_rows(clean_df, rules)
    total_clean_rows = len(clean_df)
    total_origin_rows = len(origin_rows)

    if total_clean_rows <= MAX_PREVIEW_ROWS:
        return {
            "filename": filename,
            "origin": {
                "rows": origin_rows,
                "row_issues": _origin_row_issues(origin_rows, clean_df, row_issues),
                "is_sampled": False,
                "total_rows": total_origin_rows,
            },
            "clean": {
                "columns": columns,
                "rows": clean_df.to_dict(orient="records"),
                "row_issues": row_issues,
                "is_sampled": False,
                "total_rows": total_clean_rows,
            },
            "is_sampled": False,
            "total_origin_rows": total_origin_rows,
            "total_clean_rows": total_clean_rows,
            "slip_subtotal_mismatches": clean_df.attrs.get("subtotal_mismatches", []),
        }

    # For large datasets (e.g. 100k rows), sample first MAX_PREVIEW_ROWS + ALL rows with validation issues
    issue_indices = {i for i, issues in enumerate(row_issues) if issues}
    sample_indices = sorted(
        set(range(min(MAX_PREVIEW_ROWS, total_clean_rows))) | issue_indices
    )

    clean_records = clean_df.to_dict(orient="records")
    sampled_clean_rows = [clean_records[i] for i in sample_indices]
    sampled_clean_issues = [row_issues[i] for i in sample_indices]

    origin_indices = clean_df.attrs.get("origin_indices", [])
    mapped_origin_issues = _origin_row_issues(origin_rows, clean_df, row_issues)

    sampled_origin_idx_set = set(range(min(MAX_PREVIEW_ROWS, total_origin_rows)))
    if origin_indices:
        for ci in sample_indices:
            if ci < len(origin_indices):
                sampled_origin_idx_set.add(origin_indices[ci])
    sorted_origin_indices = sorted(sampled_origin_idx_set)
    sampled_origin_rows = [origin_rows[i] for i in sorted_origin_indices]
    sampled_origin_issues = [mapped_origin_issues[i] for i in sorted_origin_indices]

    return {
        "filename": filename,
        "origin": {
            "rows": sampled_origin_rows,
            "row_issues": sampled_origin_issues,
            "is_sampled": True,
            "total_rows": total_origin_rows,
            "sample_count": len(sampled_origin_rows),
        },
        "clean": {
            "columns": columns,
            "rows": sampled_clean_rows,
            "row_issues": sampled_clean_issues,
            "is_sampled": True,
            "total_rows": total_clean_rows,
            "sample_count": len(sampled_clean_rows),
        },
        "is_sampled": True,
        "total_origin_rows": total_origin_rows,
        "total_clean_rows": total_clean_rows,
        "slip_subtotal_mismatches": clean_df.attrs.get("subtotal_mismatches", []),
    }


def _can_access_batch(user: User, batch: ImportBatch) -> bool:
    """An account with no branch can see/revert any batch;
    everyone else only their own branch's — same rule as import confirmation."""
    return user.branch_id is None or batch.branch_id == user.branch_id


def _confirmed_import_for_key(
    db: Session, user: User, request_key: str | None
) -> dict | None:
    """Return the original result for a repeated confirm request.

    A dropped mobile connection can lose the response after the database committed.
    The client deliberately reuses its Idempotency-Key in that case, so returning the
    already stored batch summary is both faster and, crucially, avoids duplicate
    purchase or inventory records.
    """
    if not request_key:
        return None
    batch = (
        db.query(ImportBatch)
        .filter(
            ImportBatch.request_key == request_key,
            ImportBatch.uploaded_by == user.id,
        )
        .one_or_none()
    )
    return dict(batch.summary) if batch is not None else None


def _replay_after_request_key_conflict(
    db: Session, user: User, request_key: str | None
) -> dict | None:
    """Recover the first commit when two retries overlap on a weak connection."""
    db.rollback()
    return _confirmed_import_for_key(db, user, request_key)


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
        parse_pos_sale_upload,
        contents,
        file.filename,
        "sale",
        branch.sale_date_format if branch else "MDY",
    )

    return _build_preview(
        file.filename,
        origin_rows,
        clean_df,
        SALES_OUTPUT_COLUMNS,
        SALES_VALIDATION_RULES,
    )


@router.post("/sales/confirm")
async def confirm_sales_file(
    file: UploadFile = File(...),
    branch_id: str | None = Form(None),
    idempotency_key: IdempotencyKey = None,
    user: User = Depends(get_current_app_user),
    db: Session = Depends(get_db),
) -> dict:
    previous = _confirmed_import_for_key(db, user, idempotency_key)
    if previous is not None:
        return previous
    _check_extension(file.filename)
    resolved_branch_id = _resolve_branch_id(user, branch_id, db)
    branch = db.get(Branch, resolved_branch_id)

    contents = await _read_upload(file)
    origin_rows, clean_df = _parse_or_400(
        parse_pos_sale_upload,
        contents,
        file.filename,
        "sale",
        branch.sale_date_format if branch else "MDY",
    )

    preview_data = _build_preview(
        file.filename,
        origin_rows,
        clean_df,
        SALES_OUTPUT_COLUMNS,
        SALES_VALIDATION_RULES,
    )
    storage_key = _upload_to_storage(contents, file.filename)
    try:
        summary = persist_sales(
            db,
            clean_df,
            branch_id=resolved_branch_id,
            location_raw=_location_raw(clean_df),
            source_file=file.filename,
            uploaded_by=user.id,
            preview_data=preview_data,
            storage_key=storage_key,
            request_key=idempotency_key,
        )
    except IntegrityError:
        summary = _replay_after_request_key_conflict(db, user, idempotency_key)
        if summary is None:
            raise
    _upload_preview_to_storage(summary["batch_id"], preview_data)
    return summary


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
        parse_inventory_upload,
        contents,
        file.filename,
        "inventory",
        branch.inventory_date_format if branch else "MDY",
    )

    return _build_preview(
        file.filename,
        origin_rows,
        clean_df,
        INVENTORY_OUTPUT_COLUMNS,
        INVENTORY_VALIDATION_RULES,
    )


@router.post("/inventory/confirm")
async def confirm_inventory_file(
    file: UploadFile = File(...),
    branch_id: str | None = Form(None),
    idempotency_key: IdempotencyKey = None,
    user: User = Depends(get_current_app_user),
    db: Session = Depends(get_db),
) -> dict:
    previous = _confirmed_import_for_key(db, user, idempotency_key)
    if previous is not None:
        return previous
    _check_extension(file.filename)
    resolved_branch_id = _resolve_branch_id(user, branch_id, db)
    branch = db.get(Branch, resolved_branch_id)

    contents = await _read_upload(file)
    origin_rows, clean_df = _parse_or_400(
        parse_inventory_upload,
        contents,
        file.filename,
        "inventory",
        branch.inventory_date_format if branch else "MDY",
    )

    preview_data = _build_preview(
        file.filename,
        origin_rows,
        clean_df,
        INVENTORY_OUTPUT_COLUMNS,
        INVENTORY_VALIDATION_RULES,
    )
    storage_key = _upload_to_storage(contents, file.filename)
    try:
        summary = persist_inventory(
            db,
            clean_df,
            branch_id=resolved_branch_id,
            location_raw=_location_raw(clean_df),
            source_file=file.filename,
            uploaded_by=user.id,
            preview_data=preview_data,
            storage_key=storage_key,
            request_key=idempotency_key,
        )
    except IntegrityError:
        summary = _replay_after_request_key_conflict(db, user, idempotency_key)
        if summary is None:
            raise
    _upload_preview_to_storage(summary["batch_id"], preview_data)
    return summary


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
        file.filename,
        origin_rows,
        clean_df,
        PURCHASE_OUTPUT_COLUMNS,
        PURCHASE_VALIDATION_RULES,
    )


@router.post("/purchase/confirm")
async def confirm_purchase_file(
    file: UploadFile = File(...),
    branch_id: str | None = Form(None),
    purchase_date: str | None = Form(None),
    purchase_number: str | None = Form(None),
    idempotency_key: IdempotencyKey = None,
    user: User = Depends(get_current_app_user),
    db: Session = Depends(get_db),
) -> dict:
    previous = _confirmed_import_for_key(db, user, idempotency_key)
    if previous is not None:
        return previous
    _check_extension(file.filename)
    resolved_branch_id = _resolve_branch_id(user, branch_id, db)

    extracted_number, extracted_date = extract_purchase_metadata(file.filename or "")
    resolved_purchase_number = purchase_number or extracted_number

    resolved_purchase_date = None
    if purchase_date:
        try:
            resolved_purchase_date = datetime.date.fromisoformat(purchase_date)
        except ValueError as exc:
            raise HTTPException(
                status.HTTP_400_BAD_REQUEST, "purchase_date must be YYYY-MM-DD"
            ) from exc
    elif extracted_date:
        resolved_purchase_date = extracted_date

    contents = await _read_upload(file)
    origin_rows, clean_df = _parse_or_400(
        parse_purchase_upload, contents, file.filename, "purchase"
    )

    preview_data = _build_preview(
        file.filename,
        origin_rows,
        clean_df,
        PURCHASE_OUTPUT_COLUMNS,
        PURCHASE_VALIDATION_RULES,
    )
    storage_key = _upload_to_storage(contents, file.filename)
    try:
        summary = persist_purchases(
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
            request_key=idempotency_key,
        )
    except IntegrityError:
        summary = _replay_after_request_key_conflict(db, user, idempotency_key)
        if summary is None:
            raise
    _upload_preview_to_storage(summary["batch_id"], preview_data)
    return summary


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
                unique_dates = sorted(
                    clean_df["Date"].dropna().astype(str).unique().tolist()
                )
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
            "zero_count": None,
            "nonzero_count": None,
            "error_message": f"Could not parse file: {exc}",
        }

    zero_count = None
    nonzero_count = None
    if expected_type == "inventory" and "clean_df" in locals():
        zero_count = int(clean_df.attrs.get("zero_rows", 0))
        nonzero_count = int(
            clean_df.attrs.get("positive_rows", 0)
            + clean_df.attrs.get("negative_rows", 0)
        )

    return {
        "filename": file.filename,
        "status": "valid",
        "detected_type": detected or expected_type,
        "expected_type": expected_type,
        "dates": dates,
        "purchase_number": purchase_number,
        "row_count": row_count,
        "zero_count": zero_count,
        "nonzero_count": nonzero_count,
        "error_message": None,
    }


@router.get("/freshness")
def get_import_freshness(
    user: User = Depends(get_current_app_user), db: Session = Depends(get_db)
) -> list[dict]:
    """Per-branch upload recency and the completeness of its imported data.

    Sale and inventory records expose their own business date in addition to the
    confirmation timestamp. Purchase numbers are checked for internal serial gaps.
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
        (branch_id, import_type.value): utc_timestamp(last_imported_at)
        for branch_id, import_type, last_imported_at in latest_rows
        if branch_id is not None
    }

    response: list[dict] = []
    for branch in branches:
        sales_data_date, inventory_data_date = latest_daily_data_dates(db, branch.id)
        purchase_integrity = purchase_number_integrity(db, branch.id)
        response.append(
            {
                "branch_id": branch.id,
                "branch_name": branch.name,
                "sales_last_imported_at": last_by_branch_and_type.get(
                    (branch.id, ImportType.SALES.value)
                ),
                "inventory_last_imported_at": last_by_branch_and_type.get(
                    (branch.id, ImportType.INVENTORY.value)
                ),
                "purchase_last_imported_at": last_by_branch_and_type.get(
                    (branch.id, ImportType.PURCHASE.value)
                ),
                "sales_data_date": sales_data_date.isoformat()
                if sales_data_date
                else None,
                "inventory_data_date": inventory_data_date.isoformat()
                if inventory_data_date
                else None,
                "purchase_number_integrity": purchase_integrity,
            }
        )
    return response


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
            "created_at": utc_timestamp(b.created_at),
            "reverted_at": utc_timestamp(b.reverted_at) if b.reverted_at else None,
            "storage_key": b.storage_key,
            "has_file": bool(b.storage_key or b.original_file_size),
        }
        for b in query.all()
    ]


def _legacy_preview_result(preview_data: dict, tab: str, page: int) -> dict:
    data = preview_data.get("clean" if tab == "clean" else "origin", {})
    rows = data.get("rows", []) if isinstance(data, dict) else []
    row_issues = data.get("row_issues", []) if isinstance(data, dict) else []
    declared_total = (
        data.get("total_rows", len(rows)) if isinstance(data, dict) else len(rows)
    )
    is_sampled = (
        bool(data.get("is_sampled", False)) if isinstance(data, dict) else False
    )
    total_rows = len(rows) if is_sampled else declared_total
    start = (page - 1) * PREVIEW_PAGE_SIZE
    end = start + PREVIEW_PAGE_SIZE
    return {
        "columns": data.get("columns", [])
        if tab == "clean" and isinstance(data, dict)
        else [],
        "rows": rows[start:end],
        "row_issues": row_issues[start:end] if row_issues else [],
        "page": page,
        "page_size": PREVIEW_PAGE_SIZE,
        "total_rows": total_rows,
        "source_total_rows": declared_total,
        "total_pages": max(
            1, (total_rows + PREVIEW_PAGE_SIZE - 1) // PREVIEW_PAGE_SIZE
        ),
        "is_sampled": is_sampled,
        "warning_count": sum(1 for issues in row_issues if issues),
    }


def _r2_preview_result(
    manifest: dict, tab: str, page_data: dict | None, page: int
) -> dict:
    metadata = manifest.get(tab, {})
    return {
        "columns": metadata.get("columns", []) if tab == "clean" else [],
        "rows": page_data.get("rows", []) if page_data else [],
        "row_issues": page_data.get("row_issues", []) if page_data else [],
        "page": page,
        "page_size": metadata.get("page_size", PREVIEW_PAGE_SIZE),
        "total_rows": metadata.get("total_rows", 0),
        "source_total_rows": metadata.get("source_total_rows", 0),
        "total_pages": metadata.get("total_pages", 1),
        "is_sampled": bool(metadata.get("is_sampled", False)),
        "warning_count": metadata.get("warning_count", 0),
    }


def _inactive_preview_result(manifest: dict, tab: str) -> dict:
    return _r2_preview_result(manifest, tab, None, 1)


def _format_history_summary_messages(batch: ImportBatch, total_rows: int = 0) -> list[str]:
    summary = batch.summary or {}
    messages = []

    if batch.import_type == ImportType.INVENTORY:
        created = summary.get("stock_levels_created", 0)
        zero_skipped = summary.get("zero_stock_skipped", 0)
        total = summary.get("total_rows") or total_rows or (created + zero_skipped) or (summary.get("products_created", 0) + summary.get("products_updated", 0))

        messages.append(f"{total:,} total products in file")
        messages.append(f"{created:,} product stocks recorded")
        if zero_skipped > 0:
            messages.append(f"{zero_skipped:,} products with 0 stock")

        issue_count = max(summary.get("negative_stock_count", 0), summary.get("issue_count", 0))
        if issue_count > 0:
            messages.append(f"⚠️ Alert: {pluralize(issue_count, 'product')} recorded with invalid values")

    elif batch.import_type == ImportType.SALES:
        sales_created = summary.get("sales_created", 0)
        lines_created = summary.get("sale_lines_created", 0)
        total = summary.get("total_rows") or total_rows or lines_created

        messages.append(f"{total:,} total sale lines in file")
        messages.append(f"{sales_created:,} sales recorded ({lines_created:,} items)")
        skipped = summary.get("sales_skipped_duplicate", 0)
        if skipped > 0:
            messages.append(f"{pluralize(skipped, 'sale')} skipped — already imported earlier")
        issue_count = summary.get("issue_count", 0)
        if issue_count > 0:
            messages.append(f"⚠️ Alert: {pluralize(issue_count, 'sale item')} recorded with invalid values")

    elif batch.import_type == ImportType.PURCHASE:
        lines_created = summary.get("purchase_lines_created", 0)
        total = summary.get("total_rows") or total_rows or lines_created

        messages.append(f"{total:,} total purchase items in file")
        messages.append(f"{lines_created:,} purchase items recorded")
        issue_count = summary.get("issue_count", 0)
        if issue_count > 0:
            messages.append(f"⚠️ Alert: {pluralize(issue_count, 'item')} recorded with invalid values")

    return messages if messages else summary.get("messages", [])


@router.get("/history/{batch_id}")
def get_import_history_detail(
    batch_id: str,
    page: int = Query(1, ge=1),
    tab: str = Query("clean", pattern="^(clean|original)$"),
    user: User = Depends(get_current_app_user),
    db: Session = Depends(get_db),
) -> dict:
    batch = db.get(
        ImportBatch,
        batch_id,
        options=[
            defer(ImportBatch.preview_data),
            defer(ImportBatch.original_file),
            joinedload(ImportBatch.branch),
            joinedload(ImportBatch.uploaded_by_user),
        ],
    )
    if batch is None or not _can_access_batch(user, batch):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Import batch not found")

    storage = get_storage_service()
    r2_preview = (
        read_preview_page(storage, batch.id, tab, page)
        if storage.is_configured
        else None
    )
    if r2_preview is not None:
        manifest, page_data = r2_preview
        selected_result = _r2_preview_result(manifest, tab, page_data, page)
        other_tab = "original" if tab == "clean" else "clean"
        other_result = _inactive_preview_result(manifest, other_tab)
        clean_result = selected_result if tab == "clean" else other_result
        origin_result = selected_result if tab == "original" else other_result
    else:
        # Pre-R2 batches retain their database snapshot as a compatibility fallback.
        preview_data = batch.preview_data or {}
        selected_result = _legacy_preview_result(preview_data, tab, page)
        other_tab = "original" if tab == "clean" else "clean"
        other_result = _legacy_preview_result(preview_data, other_tab, 1)
        other_result["rows"] = []
        other_result["row_issues"] = []
        clean_result = selected_result if tab == "clean" else other_result
        origin_result = selected_result if tab == "original" else other_result

    has_origin_rows = bool(origin_result["total_rows"] > 0)
    total_file_rows = origin_result.get("total_rows") or clean_result.get("total_rows") or 0

    detail_summary = dict(batch.summary or {})
    detail_summary["messages"] = _format_history_summary_messages(batch, total_file_rows)

    return {
        "id": batch.id,
        "import_type": batch.import_type.value,
        "filename": batch.filename,
        "branch_name": batch.branch.name if batch.branch else None,
        "uploaded_by_name": batch.uploaded_by_user.name
        if batch.uploaded_by_user
        else None,
        "status": batch.status.value,
        "summary": detail_summary,
        "created_at": utc_timestamp(batch.created_at),
        "reverted_at": utc_timestamp(batch.reverted_at) if batch.reverted_at else None,
        "storage_key": batch.storage_key,
        "has_file": bool(
            batch.storage_key or batch.original_file_size or has_origin_rows
        ),
        "origin": origin_result,
        "clean": clean_result,
    }


@router.get("/history/{batch_id}/warnings")
def get_import_history_warnings(
    batch_id: str,
    tab: str = Query("clean", pattern="^(clean|original)$"),
    user: User = Depends(get_current_app_user),
    db: Session = Depends(get_db),
) -> dict:
    batch = db.get(
        ImportBatch,
        batch_id,
        options=[defer(ImportBatch.preview_data), defer(ImportBatch.original_file)],
    )
    if batch is None or not _can_access_batch(user, batch):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Import batch not found")

    storage = get_storage_service()
    warning_indices = (
        read_preview_warnings(storage, batch.id, tab) if storage.is_configured else None
    )
    if warning_indices is None:
        data = (batch.preview_data or {}).get(
            "clean" if tab == "clean" else "origin", {}
        )
        row_issues = data.get("row_issues", []) if isinstance(data, dict) else []
        warning_indices = [index for index, issues in enumerate(row_issues) if issues]
    return {"indices": warning_indices}


@router.get("/history/{batch_id}/download-clean")
def download_clean_import_file(
    batch_id: str,
    user: User = Depends(get_current_app_user),
    db: Session = Depends(get_db),
):
    """Download cleaned CSV data for any confirmed import batch."""
    batch = db.get(ImportBatch, batch_id)
    if batch is None or not _can_access_batch(user, batch):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Import batch not found")

    output = io.StringIO()
    writer = csv.writer(output)

    if batch.import_type == ImportType.INVENTORY:
        writer.writerow(
            [
                "StockCode",
                "Description",
                "Location",
                "Group",
                "On_Hand_Qty",
                "Buying_Price",
                "Selling_Price",
            ]
        )
        levels = (
            db.query(StockLevel, Product)
            .join(Product, StockLevel.product_id == Product.id)
            .filter(StockLevel.import_batch_id == batch.id)
            .order_by(Product.stock_code)
            .all()
        )
        for level, product in levels:
            writer.writerow(
                [
                    product.stock_code,
                    product.description or "",
                    level.location_raw or "",
                    product.group_name or "",
                    float(level.on_hand_qty) if level.on_hand_qty is not None else "",
                    float(level.buying_price) if level.buying_price is not None else "",
                    float(level.selling_price)
                    if level.selling_price is not None
                    else "",
                ]
            )
    elif batch.import_type == ImportType.SALES:
        writer.writerow(
            [
                "Date",
                "Time",
                "Slip_ID",
                "StockCode",
                "Description",
                "Qty",
                "Selling_Price",
                "Discount_Amount",
                "Net_Amount",
            ]
        )
        lines = (
            db.query(SaleLine, Sale, Product)
            .join(Sale, SaleLine.sale_id == Sale.id)
            .join(Product, SaleLine.product_id == Product.id)
            .filter(Sale.import_batch_id == batch.id)
            .order_by(Sale.sale_date, Sale.slip_id, SaleLine.line_id)
            .all()
        )
        for line, sale, product in lines:
            writer.writerow(
                [
                    sale.sale_date.isoformat() if sale.sale_date else "",
                    sale.sale_time or "",
                    sale.slip_id,
                    product.stock_code,
                    product.description or "",
                    float(line.qty) if line.qty is not None else "",
                    float(line.selling_price) if line.selling_price is not None else "",
                    float(line.discount_amount)
                    if line.discount_amount is not None
                    else "",
                    float(line.net_amount) if line.net_amount is not None else "",
                ]
            )
    elif batch.import_type == ImportType.PURCHASE:
        writer.writerow(
            ["StockCode", "Description", "Qty", "Buying_Price", "Total_Amount"]
        )
        lines = (
            db.query(PurchaseLine, Purchase, Product)
            .join(Purchase, PurchaseLine.purchase_id == Purchase.id)
            .join(Product, PurchaseLine.product_id == Product.id)
            .filter(Purchase.import_batch_id == batch.id)
            .order_by(PurchaseLine.id)
            .all()
        )
        for line, purchase, product in lines:
            writer.writerow(
                [
                    product.stock_code,
                    product.description or "",
                    float(line.qty) if line.qty is not None else "",
                    float(line.buying_price) if line.buying_price is not None else "",
                    float(line.total_amount) if line.total_amount is not None else "",
                ]
            )
    else:
        return download_import_batch_file(batch_id, user, db)

    csv_data = output.getvalue().encode("utf-8-sig")
    stem = Path(batch.filename or "import").stem
    clean_filename = f"{stem}_clean.csv"
    return Response(
        content=csv_data,
        media_type="text/csv",
        headers={"Content-Disposition": f'attachment; filename="{clean_filename}"'},
    )


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

    if (
        user.role not in (UserRole.ADMIN, UserRole.DEVELOPMENT)
        and batch.import_type != ImportType.GENERAL
    ):
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

    raise HTTPException(
        status.HTTP_404_NOT_FOUND,
        "Original file is not available for this import batch",
    )


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
        raise HTTPException(
            status.HTTP_409_CONFLICT, "This import was already removed or reimported"
        )
    if batch.import_type == ImportType.GENERAL:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            "Daily operation cost files are stored only and cannot be reverted or reimported",
        )
    if (
        user.role == UserRole.RETAIL
        and utc_now() - batch.created_at > datetime.timedelta(days=1)
    ):
        raise HTTPException(
            status.HTTP_403_FORBIDDEN,
            "Retail accounts can only revert an import within 1 day of importing it.",
        )

    if batch.import_type.value == "sales":
        sale_ids = [
            s.id for s in db.query(Sale.id).filter(Sale.import_batch_id == batch_id)
        ]
        db.query(SaleLine).filter(SaleLine.sale_id.in_(sale_ids)).delete(
            synchronize_session=False
        )
        db.query(Sale).filter(Sale.import_batch_id == batch_id).delete(
            synchronize_session=False
        )
    elif batch.import_type.value == "purchase":
        purchase_ids = [
            p.id
            for p in db.query(Purchase.id).filter(Purchase.import_batch_id == batch_id)
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

    batch.status = (
        ImportBatchStatus.REIMPORTED if replaced else ImportBatchStatus.REVERTED
    )
    batch.reverted_at = utc_now()
    batch.reverted_by = user.id
    db.commit()

    return {
        "id": batch.id,
        "status": batch.status.value,
        "reverted_at": utc_timestamp(batch.reverted_at),
    }
