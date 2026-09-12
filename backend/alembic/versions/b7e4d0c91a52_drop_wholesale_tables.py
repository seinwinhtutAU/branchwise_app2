"""drop the wholesale tables

The wholesale workflow (customer orders, factory vouchers, warehouse receipts) was
removed from the app on 2026-09-11 while it is redesigned around a much larger one —
shipping, receiving and counting at a location, allocating arrived goods to customers,
stock, and payments (see diagram/wholesale/erd.mmd). Its models, schemas, services,
routers, tests and screens are already gone; this drops the tables they left behind so
`alembic revision --autogenerate` stops proposing the drop on its own.

The rows held only test data. `downgrade()` recreates the structure exactly as it was,
but the rows themselves are not recoverable from this migration.

Revision ID: b7e4d0c91a52
Revises: 12c659f4ad88
Create Date: 2026-09-11 01:15:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


# revision identifiers, used by Alembic.
revision: str = 'b7e4d0c91a52'
down_revision: Union[str, Sequence[str], None] = '12c659f4ad88'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    # Child tables first — customer_order_lines and warehouse_receipts both point at
    # factory_voucher_lines, which points at factory_vouchers.
    op.drop_table('warehouse_receipts')
    op.drop_table('customer_order_lines')
    op.drop_table('customer_orders')
    op.drop_table('factory_voucher_lines')
    op.drop_table('factory_vouchers')
    # Dropping a table does not drop the enum type it used, and a leftover type would
    # collide if the name is ever reused.
    sa.Enum(name='orderstatus').drop(op.get_bind(), checkfirst=True)


def downgrade() -> None:
    """Downgrade schema."""
    op.create_table(
        'customer_orders',
        sa.Column('id', sa.String(length=36), nullable=False),
        sa.Column('order_no', sa.Integer(), nullable=False),
        sa.Column('branch_id', sa.String(length=36), nullable=True),
        sa.Column('order_date', sa.Date(), nullable=False),
        sa.Column('customer_name', sa.String(length=255), nullable=False),
        sa.Column('remark', sa.String(length=1000), nullable=True),
        sa.Column('created_at', sa.DateTime(), server_default=sa.text('now()'), nullable=False),
        sa.Column('updated_at', sa.DateTime(), server_default=sa.text('now()'), nullable=False),
        sa.ForeignKeyConstraint(['branch_id'], ['branches.id']),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_table(
        'factory_vouchers',
        sa.Column('id', sa.String(length=36), nullable=False),
        sa.Column('voucher_no', sa.Integer(), nullable=False),
        sa.Column('branch_id', sa.String(length=36), nullable=True),
        sa.Column('voucher_date', sa.Date(), nullable=False),
        sa.Column('factory_name', sa.String(length=255), nullable=True),
        sa.Column('remark', sa.String(length=1000), nullable=True),
        sa.Column('created_at', sa.DateTime(), server_default=sa.text('now()'), nullable=False),
        sa.ForeignKeyConstraint(['branch_id'], ['branches.id']),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_table(
        'factory_voucher_lines',
        sa.Column('id', sa.String(length=36), nullable=False),
        sa.Column('voucher_id', sa.String(length=36), nullable=False),
        sa.Column('product_code', sa.String(length=100), nullable=False),
        sa.Column('description', sa.String(length=500), nullable=True),
        sa.Column('qty', sa.Numeric(precision=12, scale=2), nullable=False),
        sa.Column('received_qty', sa.Numeric(precision=12, scale=2), nullable=False),
        sa.Column('buying_price', sa.Numeric(precision=14, scale=2), nullable=False),
        sa.Column('colors', postgresql.JSON(astext_type=sa.Text()), nullable=False),
        sa.Column('discount_per_set', sa.Numeric(precision=14, scale=2), nullable=True),
        sa.Column('created_at', sa.DateTime(), server_default=sa.text('now()'), nullable=False),
        sa.ForeignKeyConstraint(['voucher_id'], ['factory_vouchers.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_table(
        'customer_order_lines',
        sa.Column('id', sa.String(length=36), nullable=False),
        sa.Column('order_id', sa.String(length=36), nullable=False),
        sa.Column('product_code', sa.String(length=100), nullable=False),
        sa.Column('description', sa.String(length=500), nullable=True),
        sa.Column('factory_name', sa.String(length=255), nullable=True),
        sa.Column('first_commit_qty', sa.Numeric(precision=12, scale=2), nullable=True),
        sa.Column('second_commit_qty', sa.Numeric(precision=12, scale=2), nullable=True),
        sa.Column('colors', postgresql.JSON(astext_type=sa.Text()), nullable=False),
        sa.Column('total_qty', sa.Numeric(precision=12, scale=2), nullable=False),
        sa.Column('received_qty', sa.Numeric(precision=12, scale=2), nullable=False),
        sa.Column('unit', sa.String(length=30), nullable=False),
        sa.Column('buying_price', sa.Numeric(precision=14, scale=2), nullable=True),
        sa.Column(
            'status',
            sa.Enum('not_start', 'waiting', 'complete', name='orderstatus'),
            nullable=False,
        ),
        sa.Column('matched_voucher_id', sa.String(length=36), nullable=True),
        sa.Column('created_at', sa.DateTime(), server_default=sa.text('now()'), nullable=False),
        sa.Column('updated_at', sa.DateTime(), server_default=sa.text('now()'), nullable=False),
        sa.ForeignKeyConstraint(['order_id'], ['customer_orders.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(
            ['matched_voucher_id'], ['factory_voucher_lines.id'], ondelete='SET NULL'
        ),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_table(
        'warehouse_receipts',
        sa.Column('id', sa.String(length=36), nullable=False),
        sa.Column('voucher_line_id', sa.String(length=36), nullable=False),
        sa.Column('product_code', sa.String(length=100), nullable=False),
        sa.Column('warehouse', sa.String(length=255), nullable=False),
        sa.Column('qty_received', sa.Numeric(precision=12, scale=2), nullable=False),
        sa.Column('received_date', sa.Date(), nullable=False),
        sa.Column('created_at', sa.DateTime(), server_default=sa.text('now()'), nullable=False),
        sa.ForeignKeyConstraint(
            ['voucher_line_id'], ['factory_voucher_lines.id'], ondelete='CASCADE'
        ),
        sa.PrimaryKeyConstraint('id'),
    )
