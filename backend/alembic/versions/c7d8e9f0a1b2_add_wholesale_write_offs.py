"""track wholesale loss, damage and short shipments

Revision ID: c7d8e9f0a1b2
Revises: 0c5f8a1d2e3f
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import ENUM as PGEnum


revision: str = "c7d8e9f0a1b2"
down_revision: Union[str, Sequence[str], None] = "0c5f8a1d2e3f"
branch_labels = None
depends_on = None


def upgrade() -> None:
    for table in ("wholesale_shipments", "wholesale_shipment_legs"):
        op.add_column(
            table,
            sa.Column("lost_packages", sa.Integer(), nullable=False, server_default="0"),
        )
        op.alter_column(table, "lost_packages", server_default=None)
    for table in ("wholesale_supplier_voucher_lines", "wholesale_customer_order_lines"):
        op.add_column(
            table,
            sa.Column("lost_quantity_pairs", sa.Integer(), nullable=False, server_default="0"),
        )
        op.alter_column(table, "lost_quantity_pairs", server_default=None)

    op.create_table(
        "wholesale_write_offs",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("branch_id", sa.String(36), sa.ForeignKey("branches.id"), nullable=True),
        sa.Column("subject_type", sa.String(30), nullable=False),
        sa.Column("subject_id", sa.String(36), nullable=False),
        sa.Column("reference", sa.String(100), nullable=False),
        sa.Column("description", sa.String(500), nullable=False),
        sa.Column("stock_code", sa.String(100), nullable=False),
        sa.Column("quantity", sa.Integer(), nullable=False),
        sa.Column("unit", sa.String(30), nullable=False),
        sa.Column(
            "reason",
            PGEnum(
                "lost_in_transit", "damaged", "short_shipped", "other",
                name="wholesale_write_off_reason",
            ),
            nullable=False,
        ),
        sa.Column("note", sa.String(1000), nullable=False, server_default=""),
        sa.Column("recorded_by_user_id", sa.String(36), nullable=False),
        sa.Column("created_at", sa.DateTime(), server_default=sa.text("now()")),
    )
    op.create_index(
        "ix_wholesale_write_offs_branch_id_created_at",
        "wholesale_write_offs",
        ["branch_id", "created_at"],
    )
    op.create_index(
        "ix_wholesale_write_offs_subject",
        "wholesale_write_offs",
        ["subject_type", "subject_id"],
    )


def downgrade() -> None:
    op.drop_index("ix_wholesale_write_offs_subject", table_name="wholesale_write_offs")
    op.drop_index("ix_wholesale_write_offs_branch_id_created_at", table_name="wholesale_write_offs")
    op.drop_table("wholesale_write_offs")
    op.drop_column("wholesale_customer_order_lines", "lost_quantity_pairs")
    op.drop_column("wholesale_supplier_voucher_lines", "lost_quantity_pairs")
    op.drop_column("wholesale_shipment_legs", "lost_packages")
    op.drop_column("wholesale_shipments", "lost_packages")
    op.execute(sa.text("DROP TYPE wholesale_write_off_reason"))
