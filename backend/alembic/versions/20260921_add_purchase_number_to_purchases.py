"""add purchase_number to purchases

Revision ID: 20260921purchaseno
Revises: 20260921retailrole
Create Date: 2026-09-21

"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "20260921purchaseno"
down_revision: Union[str, Sequence[str], None] = "20260921retailrole"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("purchases", sa.Column("purchase_number", sa.String(length=50), nullable=True))
    op.create_index("ix_purchases_purchase_number", "purchases", ["purchase_number"], unique=False)


def downgrade() -> None:
    op.drop_index("ix_purchases_purchase_number", table_name="purchases")
    op.drop_column("purchases", "purchase_number")
