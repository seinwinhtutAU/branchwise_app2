"""Raw uploads held on local disk between a preview/inspect call and its confirm.

The same (often multi-MB) file would otherwise cross the wire twice. It used to be
parked in a Postgres table, but the database is on the other side of the internet, so
writing a 2.7 MB export there took ~18 seconds — most of what "checking" a file cost.
The backend already holds the bytes in memory at that moment, so a local temp file is
effectively free. A missing id (server restarted, temp dir cleared, or the age sweep
below) just makes the caller resend the file, which the frontend already handles.
"""

import datetime
import tempfile
import time
import uuid
from pathlib import Path

STAGING_DIR = Path(tempfile.gettempdir()) / "branchwise_staged_uploads"
STAGED_UPLOAD_MAX_AGE = datetime.timedelta(hours=24)


def _paths(staged_id: str) -> tuple[Path, Path] | None:
    try:
        safe_id = str(uuid.UUID(staged_id))  # the id comes from the client — never a path
    except (ValueError, AttributeError):
        return None
    return STAGING_DIR / f"{safe_id}.bin", STAGING_DIR / f"{safe_id}.name"


def sweep_stale() -> None:
    if not STAGING_DIR.exists():
        return
    cutoff = time.time() - STAGED_UPLOAD_MAX_AGE.total_seconds()
    for path in STAGING_DIR.iterdir():
        try:
            if path.stat().st_mtime < cutoff:
                path.unlink()
        except OSError:
            pass


def save(contents: bytes, filename: str | None) -> str:
    STAGING_DIR.mkdir(parents=True, exist_ok=True)
    sweep_stale()
    staged_id = str(uuid.uuid4())
    data_path, name_path = _paths(staged_id)  # type: ignore[misc]
    data_path.write_bytes(contents)
    name_path.write_text(filename or "", encoding="utf-8")
    return staged_id


def load(staged_id: str) -> tuple[bytes, str | None] | None:
    paths = _paths(staged_id)
    if paths is None or not paths[0].exists():
        return None
    data_path, name_path = paths
    try:
        filename = name_path.read_text(encoding="utf-8") or None
        return data_path.read_bytes(), filename
    except OSError:
        return None


def delete(staged_id: str | None) -> None:
    paths = _paths(staged_id) if staged_id else None
    for path in paths or ():
        path.unlink(missing_ok=True)
