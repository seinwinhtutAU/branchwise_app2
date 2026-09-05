import enum
import uuid
from typing import TYPE_CHECKING

from sqlalchemy import Enum, ForeignKey, String
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base

if TYPE_CHECKING:
    from app.models.branch import Branch


class UserRole(str, enum.Enum):
    ADMIN = "admin"
    WHOLESALE = "wholesale"
    RETAIL = "retail"


class User(Base):
    __tablename__ = "users"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    email: Mapped[str] = mapped_column(String(255), nullable=False, unique=True)
    role: Mapped[UserRole] = mapped_column(
        Enum(UserRole, values_callable=lambda enum_cls: [member.value for member in enum_cls]),
        nullable=False,
    )
    branch_id: Mapped[str | None] = mapped_column(ForeignKey("branches.id"), nullable=True)
    # The id of this person's account with whatever issues logins — Neon Auth today,
    # Supabase Auth until 2026-09-05. It is deliberately NOT the primary key any more:
    # when the auth provider changed, every user got a new id there, and a table whose
    # primary key belongs to a third party cannot survive that without rewriting every
    # row that references it. Nullable so a profile can be created before its login
    # exists (and so the pre-move rows, whose id *was* the auth id, still resolve).
    auth_user_id: Mapped[str | None] = mapped_column(String(64), nullable=True, unique=True, index=True)

    branch: Mapped["Branch | None"] = relationship(back_populates="users")
