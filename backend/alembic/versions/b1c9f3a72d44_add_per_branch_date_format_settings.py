"""add per-branch date format settings

Revision ID: b1c9f3a72d44
Revises: 0fae71bc2b91
Create Date: 2026-08-29 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'b1c9f3a72d44'
down_revision: Union[str, Sequence[str], None] = '0fae71bc2b91'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.add_column(
        'branches',
        sa.Column('sale_date_format', sa.String(length=3), nullable=False, server_default='MDY'),
    )
    op.add_column(
        'branches',
        sa.Column('inventory_date_format', sa.String(length=3), nullable=False, server_default='MDY'),
    )


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_column('branches', 'inventory_date_format')
    op.drop_column('branches', 'sale_date_format')
