"""add wholesale outgoing stock movements

Revision ID: 1d74e5f1b7c1
Revises: d6e8f0a3b752
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import ENUM as PGEnum

revision: str = "1d74e5f1b7c1"
down_revision: Union[str, Sequence[str], None] = "d6e8f0a3b752"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "wholesale_stock_movements",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("branch_id", sa.String(36), sa.ForeignKey("branches.id"), nullable=True),
        sa.Column(
            "order_id",
            sa.String(36),
            sa.ForeignKey("wholesale_customer_orders.id", ondelete="RESTRICT"),
            nullable=False,
        ),
        sa.Column("stock_code", sa.String(100), nullable=False),
        sa.Column("description", sa.String(500), nullable=False),
        sa.Column(
            "product_group",
            PGEnum("man", "lady", "child", name="wholesale_product_group", create_type=False),
            nullable=False,
        ),
        sa.Column("color_qty", sa.String(1000), nullable=False),
        sa.Column("colors", sa.JSON(), nullable=False),
        sa.Column("qty_pairs", sa.Integer(), nullable=False),
        sa.Column("location", sa.String(255), nullable=False),
        sa.Column("delivered_on", sa.Date(), nullable=False),
        sa.Column("note", sa.String(1000), nullable=False),
        sa.Column("recorded_by_user_id", sa.String(36), nullable=False),
        sa.Column("created_at", sa.DateTime(), server_default=sa.text("now()")),
    )
    op.create_index(
        "ix_wholesale_stock_movements_branch_stock_location",
        "wholesale_stock_movements",
        ["branch_id", "stock_code", "location"],
    )
    op.create_index("ix_wholesale_stock_movements_order_id", "wholesale_stock_movements", ["order_id"])


def downgrade() -> None:
    op.drop_index("ix_wholesale_stock_movements_order_id", table_name="wholesale_stock_movements")
    op.drop_index("ix_wholesale_stock_movements_branch_stock_location", table_name="wholesale_stock_movements")
    op.drop_table("wholesale_stock_movements")
