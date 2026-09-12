"""add wholesale customer orders and customer payment support

Revision ID: d6e8f0a3b752
Revises: c3a7d9e2f641
"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import ENUM as PGEnum

revision: str = "d6e8f0a3b752"
down_revision: Union[str, Sequence[str], None] = "c3a7d9e2f641"
branch_labels = None
depends_on = None

def upgrade() -> None:
    op.create_table("wholesale_customer_orders", sa.Column("id", sa.String(36), primary_key=True), sa.Column("branch_id", sa.String(36), sa.ForeignKey("branches.id")), sa.Column("order_no", sa.String(30), nullable=False), sa.Column("customer_name", sa.String(255), nullable=False), sa.Column("customer_phone", sa.String(100), nullable=False), sa.Column("customer_address", sa.String(1000), nullable=False), sa.Column("order_date", sa.Date(), nullable=False), sa.Column("cancelled", sa.Boolean(), nullable=False), sa.Column("created_at", sa.DateTime(), server_default=sa.text("now()")), sa.Column("updated_at", sa.DateTime(), server_default=sa.text("now()")), sa.UniqueConstraint("branch_id", "order_no", name="uq_wholesale_customer_orders_branch_id_order_no"))
    op.create_index("ix_wholesale_customer_orders_branch_id_order_date", "wholesale_customer_orders", ["branch_id", "order_date"])
    op.create_table("wholesale_customer_order_lines", sa.Column("id", sa.String(36), primary_key=True), sa.Column("order_id", sa.String(36), sa.ForeignKey("wholesale_customer_orders.id", ondelete="CASCADE"), nullable=False), sa.Column("stock_code", sa.String(100), nullable=False), sa.Column("description", sa.String(500), nullable=False), sa.Column("product_group", PGEnum("man","lady","child", name="wholesale_product_group", create_type=False), nullable=False), sa.Column("supplier_name", sa.String(255), nullable=False), sa.Column("color_qty", sa.String(1000), nullable=False), sa.Column("colors", sa.JSON(), nullable=False), sa.Column("unit", PGEnum("pair","set","dozen", name="wholesale_unit", create_type=False), nullable=False), sa.Column("wanted_pairs", sa.Integer(), nullable=False), sa.Column("selling_price", sa.Numeric(14,2), nullable=False))
    op.create_index("ix_wholesale_customer_order_lines_order_id", "wholesale_customer_order_lines", ["order_id"])
    op.add_column("wholesale_payments", sa.Column("order_id", sa.String(36), nullable=True))
    op.create_foreign_key("fk_wholesale_payments_order_id", "wholesale_payments", "wholesale_customer_orders", ["order_id"], ["id"], ondelete="CASCADE")
    op.alter_column("wholesale_payments", "voucher_id", nullable=True)

def downgrade() -> None:
    op.drop_constraint("fk_wholesale_payments_order_id", "wholesale_payments", type_="foreignkey")
    op.drop_column("wholesale_payments", "order_id")
    op.drop_index("ix_wholesale_customer_order_lines_order_id", table_name="wholesale_customer_order_lines")
    op.drop_table("wholesale_customer_order_lines")
    op.drop_index("ix_wholesale_customer_orders_branch_id_order_date", table_name="wholesale_customer_orders")
    op.drop_table("wholesale_customer_orders")
