"""persist customer stock allocations on order lines

Revision ID: 7a2c6d9e4f10
Revises: 4b9d3c0e6a12
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op


revision: str = "7a2c6d9e4f10"
down_revision: Union[str, Sequence[str], None] = "4b9d3c0e6a12"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "wholesale_customer_order_lines",
        sa.Column("allocated_quantity_pairs", sa.Integer(), nullable=False, server_default="0"),
    )
    op.add_column(
        "wholesale_customer_order_lines",
        sa.Column("allocated_color_breakdown", sa.String(length=1000), nullable=False, server_default=""),
    )
    op.alter_column("wholesale_customer_order_lines", "allocated_quantity_pairs", server_default=None)
    op.alter_column("wholesale_customer_order_lines", "allocated_color_breakdown", server_default=None)


def downgrade() -> None:
    op.drop_column("wholesale_customer_order_lines", "allocated_color_breakdown")
    op.drop_column("wholesale_customer_order_lines", "allocated_quantity_pairs")
