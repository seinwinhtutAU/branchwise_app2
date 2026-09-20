"""add the retail management user role

Revision ID: 20260921retailrole
Revises: f7a8b9c0d1e2
Create Date: 2026-09-21

"""

from typing import Sequence, Union

from alembic import op


revision: str = "20260921retailrole"
down_revision: Union[str, Sequence[str], None] = "f7a8b9c0d1e2"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # PostgreSQL enums cannot be altered through SQLAlchemy's model definition alone.
    # IF NOT EXISTS keeps this safe to re-run against a database where the value was
    # added manually during development.
    bind = op.get_bind()
    if bind.dialect.name == "postgresql":
        op.execute("ALTER TYPE userrole ADD VALUE IF NOT EXISTS 'retail_management'")


def downgrade() -> None:
    # PostgreSQL does not support removing one enum value safely. The application no
    # longer writes this role after a downgrade, and existing values are harmless.
    pass
