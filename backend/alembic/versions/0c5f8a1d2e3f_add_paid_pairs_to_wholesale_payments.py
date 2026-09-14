"""add paid pair allocation to wholesale customer payments

Revision ID: 0c5f8a1d2e3f
Revises: 94f451d2b14e
Create Date: 2026-09-15 00:00:00.000000
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "0c5f8a1d2e3f"
down_revision: Union[str, Sequence[str], None] = "8d6f4c2b1a90"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("wholesale_payments", sa.Column("paid_quantity_pairs", sa.Integer(), nullable=True))


def downgrade() -> None:
    op.drop_column("wholesale_payments", "paid_quantity_pairs")
