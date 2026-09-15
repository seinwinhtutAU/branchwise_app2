"""snapshot wholesale unit conversions on products and quantity lines

Revision ID: f2a3b4c5d6e7
Revises: e1f2a3b4c5d6
"""

from alembic import op
import sqlalchemy as sa


revision = "f2a3b4c5d6e7"
down_revision = "e1f2a3b4c5d6"
branch_labels = None
depends_on = None

_LEGACY = sa.text("'{\"pair\": 1, \"set\": 6, \"dozen\": 12}'::json")


def upgrade() -> None:
    for table, column in (
        ("wholesale_products", "default_unit_conversions"),
        ("wholesale_supplier_voucher_lines", "unit_conversions"),
        ("wholesale_customer_order_lines", "unit_conversions"),
        ("wholesale_receiving_items", "unit_conversions"),
        ("wholesale_stock_movements", "unit_conversions"),
        ("wholesale_allocation_events", "unit_conversions"),
        ("wholesale_write_offs", "unit_conversions"),
    ):
        op.add_column(table, sa.Column(column, sa.JSON(), nullable=False, server_default=_LEGACY))


def downgrade() -> None:
    for table, column in reversed((
        ("wholesale_products", "default_unit_conversions"),
        ("wholesale_supplier_voucher_lines", "unit_conversions"),
        ("wholesale_customer_order_lines", "unit_conversions"),
        ("wholesale_receiving_items", "unit_conversions"),
        ("wholesale_stock_movements", "unit_conversions"),
        ("wholesale_allocation_events", "unit_conversions"),
        ("wholesale_write_offs", "unit_conversions"),
    )):
        op.drop_column(table, column)
