"""add wholesale supplier vouchers and payments

Revision ID: c3a7d9e2f641
Revises: 9f2a8c4d1e37
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import ENUM as PGEnum


revision: str = "c3a7d9e2f641"
down_revision: Union[str, Sequence[str], None] = "9f2a8c4d1e37"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "wholesale_supplier_vouchers",
        sa.Column("id", sa.String(36), nullable=False),
        sa.Column("branch_id", sa.String(36), nullable=True),
        sa.Column("voucher_no", sa.String(30), nullable=False),
        sa.Column("supplier_name", sa.String(255), nullable=False),
        sa.Column("voucher_date", sa.Date(), nullable=False),
        sa.Column("cargo_name", sa.String(255), nullable=False),
        sa.Column("total_packages", sa.Integer(), nullable=False),
        sa.Column("created_at", sa.DateTime(), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(), server_default=sa.text("now()"), nullable=False),
        sa.ForeignKeyConstraint(["branch_id"], ["branches.id"]),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("branch_id", "voucher_no", name="uq_wholesale_supplier_vouchers_branch_id_voucher_no"),
    )
    op.create_index("ix_wholesale_supplier_vouchers_branch_id_voucher_date", "wholesale_supplier_vouchers", ["branch_id", "voucher_date"])
    op.create_table(
        "wholesale_supplier_voucher_lines",
        sa.Column("id", sa.String(36), nullable=False),
        sa.Column("voucher_id", sa.String(36), nullable=False),
        sa.Column("stock_code", sa.String(100), nullable=False),
        sa.Column("description", sa.String(500), nullable=False),
        sa.Column("product_group", PGEnum("man", "lady", "child", name="wholesale_product_group", create_type=False), nullable=False),
        sa.Column("color_qty", sa.String(1000), nullable=False),
        sa.Column("colors", sa.JSON(), nullable=False),
        sa.Column("unit", PGEnum("pair", "set", "dozen", name="wholesale_unit", create_type=False), nullable=False),
        sa.Column("wanted_pairs", sa.Integer(), nullable=False),
        sa.Column("buying_price", sa.Numeric(14, 2), nullable=False),
        sa.Column("created_at", sa.DateTime(), server_default=sa.text("now()"), nullable=False),
        sa.ForeignKeyConstraint(["voucher_id"], ["wholesale_supplier_vouchers.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_wholesale_supplier_voucher_lines_voucher_id", "wholesale_supplier_voucher_lines", ["voucher_id"])
    op.create_table(
        "wholesale_payments",
        sa.Column("id", sa.String(36), nullable=False),
        sa.Column("branch_id", sa.String(36), nullable=True),
        sa.Column("voucher_id", sa.String(36), nullable=False),
        sa.Column("paid_on", sa.Date(), nullable=False),
        sa.Column("amount", sa.Numeric(14, 2), nullable=False),
        sa.Column("note", sa.String(1000), nullable=False),
        sa.Column("recorded_by_user_id", sa.String(36), nullable=False),
        sa.Column("created_at", sa.DateTime(), server_default=sa.text("now()"), nullable=False),
        sa.ForeignKeyConstraint(["branch_id"], ["branches.id"]),
        sa.ForeignKeyConstraint(["voucher_id"], ["wholesale_supplier_vouchers.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_wholesale_payments_voucher_id_paid_on", "wholesale_payments", ["voucher_id", "paid_on"])


def downgrade() -> None:
    op.drop_index("ix_wholesale_payments_voucher_id_paid_on", table_name="wholesale_payments")
    op.drop_table("wholesale_payments")
    op.drop_index("ix_wholesale_supplier_voucher_lines_voucher_id", table_name="wholesale_supplier_voucher_lines")
    op.drop_table("wholesale_supplier_voucher_lines")
    op.drop_index("ix_wholesale_supplier_vouchers_branch_id_voucher_date", table_name="wholesale_supplier_vouchers")
    op.drop_table("wholesale_supplier_vouchers")
