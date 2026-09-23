import uuid
from datetime import datetime

from sqlalchemy import DateTime, LargeBinary, String, func
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class StagedImportUpload(Base):
    """A raw upload's bytes, held just long enough to bridge a preview/inspect call
    and the confirm that follows it, so the same (often multi-MB) file doesn't have
    to cross the wire twice — see `_stage_upload`/`_resolve_upload` in
    app.retail.routers.imports. A row is deleted once its confirm succeeds; any left
    over past STAGED_UPLOAD_MAX_AGE are swept opportunistically on the next
    preview/inspect call, so an abandoned preview never leaves the file sitting in
    the database forever."""

    __tablename__ = "staged_import_uploads"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    filename: Mapped[str | None] = mapped_column(String(255), nullable=True)
    content: Mapped[bytes] = mapped_column(LargeBinary, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())
