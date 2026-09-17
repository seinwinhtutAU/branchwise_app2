"""add version_id to wholesale_receivings

Revision ID: e6f7a8b9c0d1
Revises: d5f6a7b8c9e0
Create Date: 2026-09-18 00:12:00.000000

"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "e6f7a8b9c0d1"
down_revision: Union[str, None] = "d5f6a7b8c9e0"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "wholesale_receivings",
        sa.Column("version_id", sa.Integer(), nullable=False, server_default="1"),
    )


def downgrade() -> None:
    op.drop_column("wholesale_receivings", "version_id")
