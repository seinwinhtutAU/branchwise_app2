"""add delivery address to wholesale stock movements

Revision ID: 4b9d3c0e6a12
Revises: 1d74e5f1b7c1
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op


revision: str = "4b9d3c0e6a12"
down_revision: Union[str, Sequence[str], None] = "1d74e5f1b7c1"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "wholesale_stock_movements",
        sa.Column("delivery_address", sa.String(length=1000), nullable=False, server_default=""),
    )
    op.alter_column("wholesale_stock_movements", "delivery_address", server_default=None)


def downgrade() -> None:
    op.drop_column("wholesale_stock_movements", "delivery_address")
