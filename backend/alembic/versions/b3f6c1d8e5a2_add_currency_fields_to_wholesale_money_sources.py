"""add currency fields to wholesale money sources

Revision ID: b3f6c1d8e5a2
Revises: a5c9d7e2f4b1
"""

from alembic import op
import sqlalchemy as sa


revision = "b3f6c1d8e5a2"
down_revision = "a5c9d7e2f4b1"
branch_labels = None
depends_on = None

# (table, kyat column, original column) — the Kyat column already exists and stays the
# authoritative amount; "original" is the same money before conversion, only present on
# a foreign-currency row.
_SOURCES = [
    ("wholesale_customer_order_lines", "selling_price", "original_selling_price"),
    ("wholesale_supplier_voucher_lines", "buying_price", "original_buying_price"),
    ("wholesale_receiving_costs", "amount", "original_amount"),
]


def upgrade() -> None:
    for table, _kyat_column, original_column in _SOURCES:
        op.add_column(table, sa.Column("currency_code", sa.String(3), nullable=False, server_default="MMK"))
        op.add_column(table, sa.Column(original_column, sa.Numeric(18, 4), nullable=True))
        op.add_column(table, sa.Column("exchange_rate", sa.Numeric(24, 12), nullable=True))
        op.alter_column(table, "currency_code", server_default=None)
        op.create_check_constraint(
            f"ck_{table}_currency_fields",
            table,
            f"""
            (currency_code = 'MMK' AND {original_column} IS NULL AND exchange_rate IS NULL)
            OR
            (currency_code <> 'MMK' AND {original_column} IS NOT NULL AND exchange_rate IS NOT NULL AND exchange_rate > 0)
            """,
        )


def downgrade() -> None:
    for table, _kyat_column, original_column in _SOURCES:
        op.drop_constraint(f"ck_{table}_currency_fields", table, type_="check")
        op.drop_column(table, "exchange_rate")
        op.drop_column(table, original_column)
        op.drop_column(table, "currency_code")
