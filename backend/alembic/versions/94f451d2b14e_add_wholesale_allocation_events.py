"""add wholesale allocation events

Revision ID: 94f451d2b14e
Revises: 7a2c6d9e4f10
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import ENUM as PGEnum

revision: str = "94f451d2b14e"
down_revision: Union[str, Sequence[str], None] = "7a2c6d9e4f10"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "wholesale_allocation_events",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("branch_id", sa.String(36), sa.ForeignKey("branches.id"), nullable=True),
        sa.Column(
            "order_id",
            sa.String(36),
            sa.ForeignKey("wholesale_customer_orders.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "order_line_id",
            sa.String(36),
            sa.ForeignKey("wholesale_customer_order_lines.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("order_no", sa.String(30), nullable=False),
        sa.Column("customer_name", sa.String(255), nullable=False),
        sa.Column("stock_code", sa.String(100), nullable=False),
        sa.Column("description", sa.String(500), nullable=False),
        sa.Column(
            "product_group",
            PGEnum("man", "lady", "child", name="wholesale_product_group", create_type=False),
            nullable=False,
        ),
        sa.Column(
            "unit",
            PGEnum("pair", "set", "dozen", name="wholesale_unit", create_type=False),
            nullable=False,
        ),
        sa.Column("previous_color_breakdown", sa.String(1000), nullable=False),
        sa.Column("previous_quantity_pairs", sa.Integer(), nullable=False),
        sa.Column("color_breakdown", sa.String(1000), nullable=False),
        sa.Column("quantity_pairs", sa.Integer(), nullable=False),
        sa.Column("recorded_by_user_id", sa.String(36), nullable=False),
        sa.Column("created_at", sa.DateTime(), server_default=sa.text("now()")),
    )
    op.create_index(
        "ix_wholesale_allocation_events_branch_id_created_at",
        "wholesale_allocation_events",
        ["branch_id", "created_at"],
    )
    op.create_index(
        "ix_wholesale_allocation_events_order_line_id", "wholesale_allocation_events", ["order_line_id"]
    )


def downgrade() -> None:
    op.drop_index("ix_wholesale_allocation_events_order_line_id", table_name="wholesale_allocation_events")
    op.drop_index("ix_wholesale_allocation_events_branch_id_created_at", table_name="wholesale_allocation_events")
    op.drop_table("wholesale_allocation_events")
