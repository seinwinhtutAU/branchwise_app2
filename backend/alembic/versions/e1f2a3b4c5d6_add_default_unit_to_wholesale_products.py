"""add default unit to wholesale products

Revision ID: e1f2a3b4c5d6
Revises: 38279336be8e
Create Date: 2026-09-15 00:00:00.000000
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import ENUM as PGEnum


revision: str = "e1f2a3b4c5d6"
down_revision: Union[str, Sequence[str], None] = "38279336be8e"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # The server default backfills every existing product and remains the database
    # default for any product inserted outside the application.
    op.add_column(
        "wholesale_products",
        sa.Column(
            "default_unit",
            PGEnum("pair", "set", "dozen", name="wholesale_unit", create_type=False),
            nullable=False,
            server_default=sa.text("'set'"),
        ),
    )


def downgrade() -> None:
    op.drop_column("wholesale_products", "default_unit")
