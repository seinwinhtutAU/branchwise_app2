"""Local copy of each confirmed import's original file, for the Import Detail page's
Original tab.

R2 is the durable copy, but pulling a multi-MB file back from it costs several seconds
on every page turn of that tab. The backend already holds the bytes when the import is
confirmed, so it keeps a copy here; a miss (server restarted, temp dir cleared, an old
batch) just falls back to R2 and refills the cache.
"""

import tempfile
import time
import uuid
from pathlib import Path

CACHE_DIR = Path(tempfile.gettempdir()) / "branchwise_original_files"
MAX_AGE_SECONDS = 7 * 24 * 60 * 60


def _path(batch_id: str) -> Path | None:
    try:
        return CACHE_DIR / f"{uuid.UUID(batch_id)}.bin"
    except (ValueError, AttributeError):
        return None


def _sweep() -> None:
    cutoff = time.time() - MAX_AGE_SECONDS
    for path in CACHE_DIR.iterdir():
        try:
            if path.stat().st_mtime < cutoff:
                path.unlink()
        except OSError:
            pass


def save(batch_id: str, contents: bytes) -> None:
    path = _path(batch_id)
    if path is None:
        return
    try:
        CACHE_DIR.mkdir(parents=True, exist_ok=True)
        _sweep()
        path.write_bytes(contents)
    except OSError:
        pass  # a cache: failing to write it must never fail an import


def load(batch_id: str) -> bytes | None:
    path = _path(batch_id)
    try:
        return path.read_bytes() if path is not None else None
    except OSError:
        return None
