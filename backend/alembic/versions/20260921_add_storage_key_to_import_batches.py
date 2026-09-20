"""add storage_key to import_batches

Revision ID: 20260921storagekey
Revises: 20260921purchaseno
Create Date: 2026-09-21

"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "20260921storagekey"
down_revision: Union[str, Sequence[str], None] = "20260921purchaseno"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("import_batches", sa.Column("storage_key", sa.String(length=500), nullable=True))


def downgrade() -> None:
    op.drop_column("import_batches", "storage_key")
