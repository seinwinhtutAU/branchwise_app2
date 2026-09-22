"""Paged Import Detail preview storage in Cloudflare R2.

The database keeps its existing preview snapshot as a fallback and for import-health
checks. The detail UI reads this manifest-plus-pages layout instead, so opening a
batch never requires loading the database JSON blob in full.
"""

from concurrent.futures import ThreadPoolExecutor
import json
import math
from typing import Literal

from app.services.storage import R2StorageService

PreviewTab = Literal["clean", "original"]

PREVIEW_PAGE_SIZE = 50
PREVIEW_PREFIX = "preview/v1"


def _key(batch_id: str, suffix: str) -> str:
    return f"imports/{batch_id}/{PREVIEW_PREFIX}/{suffix}"


def _tab_preview(preview_data: dict, tab: PreviewTab) -> dict:
    return preview_data.get("clean" if tab == "clean" else "origin", {})


def _tab_manifest(preview_data: dict, tab: PreviewTab) -> dict:
    data = _tab_preview(preview_data, tab)
    rows = data.get("rows", []) if isinstance(data, dict) else []
    declared_total = data.get("total_rows", len(rows)) if isinstance(data, dict) else len(rows)
    is_sampled = bool(data.get("is_sampled", False)) if isinstance(data, dict) else False
    available_rows = len(rows)
    total_rows = available_rows if is_sampled else declared_total
    issues = data.get("row_issues", []) if isinstance(data, dict) else []
    return {
        "columns": data.get("columns", []) if tab == "clean" and isinstance(data, dict) else [],
        "total_rows": total_rows,
        "source_total_rows": declared_total,
        "is_sampled": is_sampled,
        "total_pages": max(1, math.ceil(total_rows / PREVIEW_PAGE_SIZE)),
        "warning_count": sum(1 for row_issues in issues if row_issues),
    }


def _page_payload(preview_data: dict, tab: PreviewTab, page: int) -> dict:
    data = _tab_preview(preview_data, tab)
    rows = data.get("rows", []) if isinstance(data, dict) else []
    issues = data.get("row_issues", []) if isinstance(data, dict) else []
    start = (page - 1) * PREVIEW_PAGE_SIZE
    end = start + PREVIEW_PAGE_SIZE
    return {
        "rows": rows[start:end],
        "row_issues": issues[start:end] if issues else [],
        "page": page,
        "page_size": PREVIEW_PAGE_SIZE,
    }


def _warning_indices(preview_data: dict, tab: PreviewTab) -> dict:
    data = _tab_preview(preview_data, tab)
    issues = data.get("row_issues", []) if isinstance(data, dict) else []
    return {"indices": [index for index, row_issues in enumerate(issues) if row_issues]}


def upload_preview_pages(
    storage: R2StorageService, batch_id: str, preview_data: dict
) -> bool:
    """Write a manifest last, so readers never observe a partially written preview."""
    if not storage.is_configured:
        return False

    manifest = {
        "version": 1,
        "page_size": PREVIEW_PAGE_SIZE,
        "clean": _tab_manifest(preview_data, "clean"),
        "original": _tab_manifest(preview_data, "original"),
        "slip_subtotal_mismatches": preview_data.get("slip_subtotal_mismatches", []),
    }
    uploads: list[tuple[str, bytes]] = []
    for tab in ("clean", "original"):
        tab_manifest = manifest[tab]
        for page in range(1, tab_manifest["total_pages"] + 1):
            uploads.append(
                (
                    _key(batch_id, f"{tab}/pages/{page}.json"),
                    json.dumps(_page_payload(preview_data, tab, page)).encode("utf-8"),
                )
            )
        uploads.append(
            (
                _key(batch_id, f"{tab}/warnings.json"),
                json.dumps(_warning_indices(preview_data, tab)).encode("utf-8"),
            )
        )

    def upload(item: tuple[str, bytes]) -> bool:
        key, body = item
        return storage.upload_file_bytes(body, key, "application/json") is not None

    with ThreadPoolExecutor(max_workers=min(8, len(uploads))) as executor:
        if not all(executor.map(upload, uploads)):
            return False
    return (
        storage.upload_file_bytes(
            json.dumps(manifest).encode("utf-8"),
            _key(batch_id, "manifest.json"),
            "application/json",
        )
        is not None
    )


def read_preview_page(
    storage: R2StorageService, batch_id: str, tab: PreviewTab, page: int
) -> tuple[dict, dict | None] | None:
    manifest_file = storage.download_file_bytes(_key(batch_id, "manifest.json"))
    if manifest_file is None:
        return None
    try:
        manifest = json.loads(manifest_file[0])
    except (UnicodeDecodeError, json.JSONDecodeError):
        return None
    page_file = storage.download_file_bytes(_key(batch_id, f"{tab}/pages/{page}.json"))
    if page_file is None:
        return manifest, None
    try:
        return manifest, json.loads(page_file[0])
    except (UnicodeDecodeError, json.JSONDecodeError):
        return manifest, None


def read_preview_warnings(
    storage: R2StorageService, batch_id: str, tab: PreviewTab
) -> list[int] | None:
    warning_file = storage.download_file_bytes(_key(batch_id, f"{tab}/warnings.json"))
    if warning_file is None:
        return None
    try:
        data = json.loads(warning_file[0])
    except (UnicodeDecodeError, json.JSONDecodeError):
        return None
    indices = data.get("indices", [])
    return indices if isinstance(indices, list) and all(isinstance(index, int) for index in indices) else None
