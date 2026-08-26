"""split customer_orders and factory_vouchers into header + line tables

Revision ID: e3f1a9c2b7d4
Revises: 86d94eee9a44
Create Date: 2026-08-25 15:30:00.000000

"""
import uuid
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import ENUM as PGEnum


# revision identifiers, used by Alembic.
revision: str = 'e3f1a9c2b7d4'
down_revision: Union[str, Sequence[str], None] = '86d94eee9a44'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    bind = op.get_bind()

    order_status_enum = PGEnum(
        'not_start', 'waiting', 'complete', name='orderstatus', create_type=False
    )

    op.create_table(
        'factory_voucher_lines',
        sa.Column('id', sa.String(length=36), nullable=False),
        sa.Column('voucher_id', sa.String(length=36), nullable=False),
        sa.Column('product_code', sa.String(length=100), nullable=False),
        sa.Column('qty', sa.Numeric(precision=12, scale=2), nullable=False),
        sa.Column('buying_price', sa.Numeric(precision=14, scale=2), nullable=False),
        sa.Column('colors', sa.JSON(), nullable=False),
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
        sa.Column('factory_name', sa.String(length=255), nullable=True),
        sa.Column('first_commit_qty', sa.Numeric(precision=12, scale=2), nullable=True),
        sa.Column('second_commit_qty', sa.Numeric(precision=12, scale=2), nullable=True),
        sa.Column('colors', sa.JSON(), nullable=False),
        sa.Column('total_qty', sa.Numeric(precision=12, scale=2), nullable=False),
        sa.Column('received_qty', sa.Numeric(precision=12, scale=2), nullable=False),
        sa.Column('unit', sa.String(length=30), nullable=False),
        sa.Column('buying_price', sa.Numeric(precision=14, scale=2), nullable=True),
        sa.Column('status', order_status_enum, nullable=False),
        sa.Column('matched_voucher_id', sa.String(length=36), nullable=True),
        sa.Column('created_at', sa.DateTime(), server_default=sa.text('now()'), nullable=False),
        sa.Column('updated_at', sa.DateTime(), server_default=sa.text('now()'), nullable=False),
        sa.ForeignKeyConstraint(['order_id'], ['customer_orders.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['matched_voucher_id'], ['factory_voucher_lines.id'], ondelete='SET NULL'),
        sa.PrimaryKeyConstraint('id'),
    )

    # --- migrate existing single-product rows into the new line tables ---
    old_vouchers = sa.table(
        'factory_vouchers',
        sa.column('id', sa.String),
        sa.column('product_code', sa.String),
        sa.column('qty', sa.Numeric),
        sa.column('buying_price', sa.Numeric),
        sa.column('colors', sa.JSON),
        sa.column('discount_per_set', sa.Numeric),
        sa.column('created_at', sa.DateTime),
    )
    voucher_lines = sa.table(
        'factory_voucher_lines',
        sa.column('id', sa.String),
        sa.column('voucher_id', sa.String),
        sa.column('product_code', sa.String),
        sa.column('qty', sa.Numeric),
        sa.column('buying_price', sa.Numeric),
        sa.column('colors', sa.JSON),
        sa.column('discount_per_set', sa.Numeric),
        sa.column('created_at', sa.DateTime),
    )
    old_orders = sa.table(
        'customer_orders',
        sa.column('id', sa.String),
        sa.column('product_code', sa.String),
        sa.column('factory_name', sa.String),
        sa.column('first_commit_qty', sa.Numeric),
        sa.column('second_commit_qty', sa.Numeric),
        sa.column('colors', sa.JSON),
        sa.column('total_qty', sa.Numeric),
        sa.column('received_qty', sa.Numeric),
        sa.column('unit', sa.String),
        sa.column('buying_price', sa.Numeric),
        sa.column('status', order_status_enum),
        sa.column('matched_voucher_id', sa.String),
        sa.column('created_at', sa.DateTime),
        sa.column('updated_at', sa.DateTime),
    )
    order_lines = sa.table(
        'customer_order_lines',
        sa.column('id', sa.String),
        sa.column('order_id', sa.String),
        sa.column('product_code', sa.String),
        sa.column('factory_name', sa.String),
        sa.column('first_commit_qty', sa.Numeric),
        sa.column('second_commit_qty', sa.Numeric),
        sa.column('colors', sa.JSON),
        sa.column('total_qty', sa.Numeric),
        sa.column('received_qty', sa.Numeric),
        sa.column('unit', sa.String),
        sa.column('buying_price', sa.Numeric),
        sa.column('status', order_status_enum),
        sa.column('matched_voucher_id', sa.String),
        sa.column('created_at', sa.DateTime),
        sa.column('updated_at', sa.DateTime),
    )

    voucher_line_id_by_old_voucher_id = {}
    for row in bind.execute(sa.select(old_vouchers)).fetchall():
        new_line_id = str(uuid.uuid4())
        voucher_line_id_by_old_voucher_id[row.id] = new_line_id
        bind.execute(
            sa.insert(voucher_lines).values(
                id=new_line_id,
                voucher_id=row.id,
                product_code=row.product_code,
                qty=row.qty,
                buying_price=row.buying_price,
                colors=row.colors,
                discount_per_set=row.discount_per_set,
                created_at=row.created_at,
            )
        )

    for row in bind.execute(sa.select(old_orders)).fetchall():
        bind.execute(
            sa.insert(order_lines).values(
                id=str(uuid.uuid4()),
                order_id=row.id,
                product_code=row.product_code,
                factory_name=row.factory_name,
                first_commit_qty=row.first_commit_qty,
                second_commit_qty=row.second_commit_qty,
                colors=row.colors,
                total_qty=row.total_qty,
                received_qty=row.received_qty,
                unit=row.unit,
                buying_price=row.buying_price,
                status=row.status,
                matched_voucher_id=voucher_line_id_by_old_voucher_id.get(row.matched_voucher_id),
                created_at=row.created_at,
                updated_at=row.updated_at,
            )
        )

    # --- drop the now-relocated columns from the header tables ---
    op.drop_constraint('customer_orders_matched_voucher_id_fkey', 'customer_orders', type_='foreignkey')
    op.drop_column('customer_orders', 'product_code')
    op.drop_column('customer_orders', 'factory_name')
    op.drop_column('customer_orders', 'first_commit_qty')
    op.drop_column('customer_orders', 'second_commit_qty')
    op.drop_column('customer_orders', 'colors')
    op.drop_column('customer_orders', 'total_qty')
    op.drop_column('customer_orders', 'received_qty')
    op.drop_column('customer_orders', 'unit')
    op.drop_column('customer_orders', 'buying_price')
    op.drop_column('customer_orders', 'status')
    op.drop_column('customer_orders', 'matched_voucher_id')

    op.drop_column('factory_vouchers', 'product_code')
    op.drop_column('factory_vouchers', 'qty')
    op.drop_column('factory_vouchers', 'buying_price')
    op.drop_column('factory_vouchers', 'colors')
    op.drop_column('factory_vouchers', 'discount_per_set')


def downgrade() -> None:
    """Downgrade schema."""
    order_status_enum = PGEnum(
        'not_start', 'waiting', 'complete', name='orderstatus', create_type=False
    )

    op.add_column('factory_vouchers', sa.Column('discount_per_set', sa.Numeric(precision=14, scale=2), nullable=True))
    op.add_column('factory_vouchers', sa.Column('colors', sa.JSON(), nullable=True))
    op.add_column('factory_vouchers', sa.Column('buying_price', sa.Numeric(precision=14, scale=2), nullable=True))
    op.add_column('factory_vouchers', sa.Column('qty', sa.Numeric(precision=12, scale=2), nullable=True))
    op.add_column('factory_vouchers', sa.Column('product_code', sa.String(length=100), nullable=True))

    op.add_column('customer_orders', sa.Column('matched_voucher_id', sa.String(length=36), nullable=True))
    op.add_column('customer_orders', sa.Column('status', order_status_enum, nullable=True))
    op.add_column('customer_orders', sa.Column('buying_price', sa.Numeric(precision=14, scale=2), nullable=True))
    op.add_column('customer_orders', sa.Column('unit', sa.String(length=30), nullable=True))
    op.add_column('customer_orders', sa.Column('received_qty', sa.Numeric(precision=12, scale=2), nullable=True))
    op.add_column('customer_orders', sa.Column('total_qty', sa.Numeric(precision=12, scale=2), nullable=True))
    op.add_column('customer_orders', sa.Column('colors', sa.JSON(), nullable=True))
    op.add_column('customer_orders', sa.Column('second_commit_qty', sa.Numeric(precision=12, scale=2), nullable=True))
    op.add_column('customer_orders', sa.Column('first_commit_qty', sa.Numeric(precision=12, scale=2), nullable=True))
    op.add_column('customer_orders', sa.Column('factory_name', sa.String(length=255), nullable=True))
    op.add_column('customer_orders', sa.Column('product_code', sa.String(length=100), nullable=True))

    bind = op.get_bind()

    order_lines = sa.table(
        'customer_order_lines',
        sa.column('id', sa.String),
        sa.column('order_id', sa.String),
        sa.column('product_code', sa.String),
        sa.column('factory_name', sa.String),
        sa.column('first_commit_qty', sa.Numeric),
        sa.column('second_commit_qty', sa.Numeric),
        sa.column('colors', sa.JSON),
        sa.column('total_qty', sa.Numeric),
        sa.column('received_qty', sa.Numeric),
        sa.column('unit', sa.String),
        sa.column('buying_price', sa.Numeric),
        sa.column('status', order_status_enum),
        sa.column('created_at', sa.DateTime),
    )
    old_orders = sa.table(
        'customer_orders',
        sa.column('id', sa.String),
        sa.column('product_code', sa.String),
        sa.column('factory_name', sa.String),
        sa.column('first_commit_qty', sa.Numeric),
        sa.column('second_commit_qty', sa.Numeric),
        sa.column('colors', sa.JSON),
        sa.column('total_qty', sa.Numeric),
        sa.column('received_qty', sa.Numeric),
        sa.column('unit', sa.String),
        sa.column('buying_price', sa.Numeric),
        sa.column('status', order_status_enum),
    )
    voucher_lines = sa.table(
        'factory_voucher_lines',
        sa.column('id', sa.String),
        sa.column('voucher_id', sa.String),
        sa.column('product_code', sa.String),
        sa.column('qty', sa.Numeric),
        sa.column('buying_price', sa.Numeric),
        sa.column('colors', sa.JSON),
        sa.column('discount_per_set', sa.Numeric),
    )
    old_vouchers = sa.table(
        'factory_vouchers',
        sa.column('id', sa.String),
        sa.column('product_code', sa.String),
        sa.column('qty', sa.Numeric),
        sa.column('buying_price', sa.Numeric),
        sa.column('colors', sa.JSON),
        sa.column('discount_per_set', sa.Numeric),
    )

    # Only the first line of each header survives the downgrade — this schema never supported
    # more than one product per header, so extra lines have nowhere to go back to.
    seen_orders = set()
    for row in bind.execute(sa.select(order_lines).order_by(order_lines.c.created_at)).fetchall():
        if row.order_id in seen_orders:
            continue
        seen_orders.add(row.order_id)
        bind.execute(
            sa.update(old_orders)
            .where(old_orders.c.id == row.order_id)
            .values(
                product_code=row.product_code,
                factory_name=row.factory_name,
                first_commit_qty=row.first_commit_qty,
                second_commit_qty=row.second_commit_qty,
                colors=row.colors,
                total_qty=row.total_qty,
                received_qty=row.received_qty,
                unit=row.unit,
                buying_price=row.buying_price,
                status=row.status,
                matched_voucher_id=None,
            )
        )

    seen_vouchers = set()
    for row in bind.execute(sa.select(voucher_lines)).fetchall():
        if row.voucher_id in seen_vouchers:
            continue
        seen_vouchers.add(row.voucher_id)
        bind.execute(
            sa.update(old_vouchers)
            .where(old_vouchers.c.id == row.voucher_id)
            .values(
                product_code=row.product_code,
                qty=row.qty,
                buying_price=row.buying_price,
                colors=row.colors,
                discount_per_set=row.discount_per_set,
            )
        )

    op.alter_column('customer_orders', 'product_code', nullable=False)
    op.alter_column('customer_orders', 'colors', nullable=False)
    op.alter_column('customer_orders', 'total_qty', nullable=False)
    op.alter_column('customer_orders', 'received_qty', nullable=False)
    op.alter_column('customer_orders', 'unit', nullable=False)
    op.alter_column('customer_orders', 'status', nullable=False)
    op.create_foreign_key(
        'customer_orders_matched_voucher_id_fkey',
        'customer_orders',
        'factory_vouchers',
        ['matched_voucher_id'],
        ['id'],
        ondelete='SET NULL',
    )

    op.alter_column('factory_vouchers', 'product_code', nullable=False)
    op.alter_column('factory_vouchers', 'qty', nullable=False)
    op.alter_column('factory_vouchers', 'buying_price', nullable=False)
    op.alter_column('factory_vouchers', 'colors', nullable=False)

    op.drop_table('customer_order_lines')
    op.drop_table('factory_voucher_lines')
