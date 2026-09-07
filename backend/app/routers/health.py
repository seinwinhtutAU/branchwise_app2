from fastapi import APIRouter
from sqlalchemy import text

from app.db.session import engine

router = APIRouter(tags=["health"])


@router.get("/api/health")
def health() -> dict:
    return {"status": "ok"}


@router.get("/api/health/db")
def health_db() -> dict:
    """Whether the *database* is reachable, not just this process.

    The backend runs on the same machine as the app, so /api/health above answers "is
    the backend running?" and always says yes. What actually breaks on a weak branch
    connection is the hop from here to Neon, and that is what this checks — it's the
    probe the app polls while it believes it is offline, to notice the moment the
    connection comes back.
    """
    try:
        with engine.connect() as connection:
            connection.execute(text("SELECT 1"))
        return {"status": "ok", "database": "ok"}
    except Exception as exc:  # noqa: BLE001 — any failure here means "not reachable"
        return {"status": "degraded", "database": "unreachable", "detail": str(exc)[:200]}
