"""add version_id to wholesale_customer_orders

Revision ID: d5f6a7b8c9e0
Revises: c4e5f6a7b8c9
Create Date: 2026-09-17 23:36:00.000000

"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "d5f6a7b8c9e0"
down_revision: Union[str, None] = "c4e5f6a7b8c9"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "wholesale_customer_orders",
        sa.Column("version_id", sa.Integer(), nullable=False, server_default="1"),
    )


def downgrade() -> None:
    op.drop_column("wholesale_customer_orders", "version_id")
