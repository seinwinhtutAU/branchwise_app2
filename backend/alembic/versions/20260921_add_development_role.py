"""Add the development application role.

Revision ID: 20260921developmentrole
Revises: 20260921generalfiles
Create Date: 2026-09-21
"""

from typing import Sequence, Union

from alembic import op


revision: str = "20260921developmentrole"
down_revision: Union[str, Sequence[str], None] = "20260921generalfiles"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # PostgreSQL enums can only gain values safely. IF NOT EXISTS also makes deployment
    # retry-safe if a release applies this transaction before the service restarts.
    op.execute("ALTER TYPE userrole ADD VALUE IF NOT EXISTS 'development'")


def downgrade() -> None:
    # PostgreSQL cannot remove an enum value without rebuilding the type. Keeping this
    # migration forward-only avoids data loss for accounts already assigned this role.
    pass
