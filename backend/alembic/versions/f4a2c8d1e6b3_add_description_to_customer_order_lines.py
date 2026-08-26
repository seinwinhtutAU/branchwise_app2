"""add description to customer_order_lines

Revision ID: f4a2c8d1e6b3
Revises: e3f1a9c2b7d4
Create Date: 2026-08-25 16:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'f4a2c8d1e6b3'
down_revision: Union[str, Sequence[str], None] = 'e3f1a9c2b7d4'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.add_column('customer_order_lines', sa.Column('description', sa.String(length=500), nullable=True))


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_column('customer_order_lines', 'description')
