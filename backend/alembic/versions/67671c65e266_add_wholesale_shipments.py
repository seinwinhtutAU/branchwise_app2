"""add wholesale shipments

Phase 1 of the wholesale backend (see diagram/wholesale/erd.mmd and the phased plan it
was built against). Phases run source-first — Delivery, Receiving, Supplier Vouchers,
Customer Orders, Inventory — rather than nav order, so each screen's derived figures are
already correct the day it ships instead of reading zero until a later phase supplies
what they are derived from. This is the first phase: shipments and their destination
legs, the Delivery screen's own data.

final_received_packages is a real stored column here because Receiving doesn't exist yet
(that is phase 2) — until a receiving is raised against a shipment, this column is the
only word anyone has on what reached the gate. Once phase 2 lands, the API prefers the
count of packages actually recorded at the gate and this column becomes the fallback
before one exists, the same rule frontend/.../wholesale/store.ts::settleShipment already
follows.

voucher_no is a plain human reference for now, not a foreign key — Supplier Vouchers has
no table until phase 3, which adds the real relationship once one exists.

Revision ID: 67671c65e266
Revises: b7e4d0c91a52
Create Date: 2026-09-12 22:50:23.165022

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '67671c65e266'
down_revision: Union[str, Sequence[str], None] = 'b7e4d0c91a52'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.create_table('wholesale_shipments',
    sa.Column('id', sa.String(length=36), nullable=False),
    sa.Column('branch_id', sa.String(length=36), nullable=True),
    sa.Column('shipment_no', sa.String(length=30), nullable=False),
    sa.Column('voucher_no', sa.String(length=30), nullable=False),
    sa.Column('supplier_name', sa.String(length=255), nullable=False),
    sa.Column('cargo_name', sa.String(length=255), nullable=False),
    sa.Column('final_location', sa.String(length=255), nullable=False),
    sa.Column('sent_date', sa.Date(), nullable=False),
    sa.Column('total_packages', sa.Integer(), nullable=False),
    sa.Column('total_pairs', sa.Integer(), nullable=False),
    sa.Column('total_unit', sa.Enum('pair', 'set', 'dozen', name='wholesale_unit'), nullable=False),
    sa.Column('packages_sent_by_cargo', sa.Integer(), nullable=False),
    sa.Column('final_received_packages', sa.Integer(), nullable=False),
    sa.Column('created_at', sa.DateTime(), server_default=sa.text('now()'), nullable=False),
    sa.Column('updated_at', sa.DateTime(), server_default=sa.text('now()'), nullable=False),
    sa.ForeignKeyConstraint(['branch_id'], ['branches.id'], ),
    sa.PrimaryKeyConstraint('id'),
    sa.UniqueConstraint('branch_id', 'shipment_no', name='uq_wholesale_shipments_branch_id_shipment_no')
    )
    op.create_index('ix_wholesale_shipments_branch_id_sent_date', 'wholesale_shipments', ['branch_id', 'sent_date'], unique=False)
    op.create_index('ix_wholesale_shipments_voucher_no', 'wholesale_shipments', ['voucher_no'], unique=False)
    op.create_table('wholesale_shipment_legs',
    sa.Column('id', sa.String(length=36), nullable=False),
    sa.Column('shipment_id', sa.String(length=36), nullable=False),
    sa.Column('leg_order', sa.Integer(), nullable=False),
    sa.Column('stop_name', sa.String(length=255), nullable=False),
    sa.Column('carrier_name', sa.String(length=255), nullable=False),
    sa.Column('packages_received', sa.Integer(), nullable=False),
    sa.Column('packages_sent', sa.Integer(), nullable=False),
    sa.Column('created_at', sa.DateTime(), server_default=sa.text('now()'), nullable=False),
    sa.ForeignKeyConstraint(['shipment_id'], ['wholesale_shipments.id'], ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id'),
    sa.UniqueConstraint('shipment_id', 'leg_order', name='uq_wholesale_shipment_legs_shipment_id_leg_order')
    )
    op.create_index('ix_wholesale_shipment_legs_shipment_id', 'wholesale_shipment_legs', ['shipment_id'], unique=False)


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_index('ix_wholesale_shipment_legs_shipment_id', table_name='wholesale_shipment_legs')
    op.drop_table('wholesale_shipment_legs')
    op.drop_index('ix_wholesale_shipments_voucher_no', table_name='wholesale_shipments')
    op.drop_index('ix_wholesale_shipments_branch_id_sent_date', table_name='wholesale_shipments')
    op.drop_table('wholesale_shipments')
    # Dropping a table does not drop the enum type it used, and a leftover type would
    # collide if wholesale_unit is ever recreated (see b7e4d0c91a52's orderstatus drop).
    sa.Enum(name='wholesale_unit').drop(op.get_bind(), checkfirst=True)
