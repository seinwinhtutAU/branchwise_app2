"""add wholesale receivings

Revision ID: 9f2a8c4d1e37
Revises: 67671c65e266
Create Date: 2026-09-12 23:15:00.000000
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import ENUM as PGEnum


revision: str = "9f2a8c4d1e37"
down_revision: Union[str, Sequence[str], None] = "67671c65e266"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "wholesale_receivings",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("branch_id", sa.String(length=36), nullable=True),
        sa.Column("receiving_no", sa.String(length=30), nullable=False),
        sa.Column("shipment_id", sa.String(length=36), nullable=False),
        sa.Column("shipment_no", sa.String(length=30), nullable=False),
        sa.Column("voucher_no", sa.String(length=30), nullable=False),
        sa.Column("supplier_name", sa.String(length=255), nullable=False),
        sa.Column("gate", sa.String(length=255), nullable=False),
        sa.Column("received_date", sa.Date(), nullable=False),
        sa.Column("total_packages", sa.Integer(), nullable=False),
        sa.Column("total_pairs", sa.Integer(), nullable=False),
        sa.Column("total_unit", PGEnum("pair", "set", "dozen", name="wholesale_unit", create_type=False), nullable=False),
        sa.Column("created_at", sa.DateTime(), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(), server_default=sa.text("now()"), nullable=False),
        sa.ForeignKeyConstraint(["branch_id"], ["branches.id"]),
        sa.ForeignKeyConstraint(["shipment_id"], ["wholesale_shipments.id"], ondelete="RESTRICT"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("branch_id", "receiving_no", name="uq_wholesale_receivings_branch_id_receiving_no"),
    )
    op.create_index("ix_wholesale_receivings_branch_id_received_date", "wholesale_receivings", ["branch_id", "received_date"])
    op.create_index("ix_wholesale_receivings_shipment_id", "wholesale_receivings", ["shipment_id"])
    op.create_index("ix_wholesale_receivings_voucher_no", "wholesale_receivings", ["voucher_no"])

    op.create_table(
        "wholesale_receiving_packages",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("receiving_id", sa.String(length=36), nullable=False),
        sa.Column("package_no", sa.Integer(), nullable=False),
        sa.Column("opened", sa.Boolean(), nullable=False),
        sa.Column("received_date", sa.Date(), nullable=True),
        sa.Column("note", sa.String(length=1000), nullable=False),
        sa.Column("created_at", sa.DateTime(), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(), server_default=sa.text("now()"), nullable=False),
        sa.ForeignKeyConstraint(["receiving_id"], ["wholesale_receivings.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("receiving_id", "package_no", name="uq_wholesale_receiving_packages_receiving_id_package_no"),
    )
    op.create_index("ix_wholesale_receiving_packages_receiving_id", "wholesale_receiving_packages", ["receiving_id"])

    op.create_table(
        "wholesale_receiving_items",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("package_id", sa.String(length=36), nullable=False),
        sa.Column("stock_code", sa.String(length=100), nullable=False),
        sa.Column("description", sa.String(length=500), nullable=False),
        sa.Column("product_group", sa.Enum("man", "lady", "child", name="wholesale_product_group"), nullable=False),
        sa.Column("color_qty", sa.String(length=1000), nullable=False),
        sa.Column("colors", sa.JSON(), nullable=False),
        sa.Column("unit", PGEnum("pair", "set", "dozen", name="wholesale_unit", create_type=False), nullable=False),
        sa.Column("qty_pairs", sa.Integer(), nullable=False),
        sa.Column("created_at", sa.DateTime(), server_default=sa.text("now()"), nullable=False),
        sa.ForeignKeyConstraint(["package_id"], ["wholesale_receiving_packages.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_wholesale_receiving_items_package_id", "wholesale_receiving_items", ["package_id"])

    op.create_table(
        "wholesale_receiving_costs",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("receiving_id", sa.String(length=36), nullable=False),
        sa.Column("stage", sa.String(length=255), nullable=False),
        sa.Column("carrier", sa.String(length=255), nullable=False),
        sa.Column("kind", sa.String(length=100), nullable=False),
        sa.Column("amount", sa.Numeric(precision=14, scale=2), nullable=False),
        sa.Column("note", sa.String(length=1000), nullable=False),
        sa.Column("created_at", sa.DateTime(), server_default=sa.text("now()"), nullable=False),
        sa.ForeignKeyConstraint(["receiving_id"], ["wholesale_receivings.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_wholesale_receiving_costs_receiving_id", "wholesale_receiving_costs", ["receiving_id"])


def downgrade() -> None:
    op.drop_index("ix_wholesale_receiving_costs_receiving_id", table_name="wholesale_receiving_costs")
    op.drop_table("wholesale_receiving_costs")
    op.drop_index("ix_wholesale_receiving_items_package_id", table_name="wholesale_receiving_items")
    op.drop_table("wholesale_receiving_items")
    op.drop_index("ix_wholesale_receiving_packages_receiving_id", table_name="wholesale_receiving_packages")
    op.drop_table("wholesale_receiving_packages")
    op.drop_index("ix_wholesale_receivings_voucher_no", table_name="wholesale_receivings")
    op.drop_index("ix_wholesale_receivings_shipment_id", table_name="wholesale_receivings")
    op.drop_index("ix_wholesale_receivings_branch_id_received_date", table_name="wholesale_receivings")
    op.drop_table("wholesale_receivings")
    sa.Enum(name="wholesale_product_group").drop(op.get_bind(), checkfirst=True)
