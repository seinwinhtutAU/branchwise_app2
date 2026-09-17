"""Wholesale audit logging service."""

from typing import Any
from sqlalchemy.orm import Session
from app.wholesale.models.entities import WholesaleAuditLog


def record_audit_log(
    db: Session,
    *,
    branch_id: str | None,
    entity_type: str,
    entity_id: str,
    action: str,
    operator_id: str | None = None,
    summary: str = "",
    payload: dict[str, Any] | None = None,
) -> WholesaleAuditLog:
    """Records an immutable audit event for a wholesale operation."""
    entry = WholesaleAuditLog(
        branch_id=branch_id,
        entity_type=entity_type,
        entity_id=entity_id,
        action=action,
        operator_id=operator_id,
        summary=summary,
        payload=payload or {},
    )
    db.add(entry)
    return entry
