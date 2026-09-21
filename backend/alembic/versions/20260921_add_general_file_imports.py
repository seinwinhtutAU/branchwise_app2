"""support general files stored unchanged

Revision ID: 20260921generalfiles
Revises: 20260921storagekey
Create Date: 2026-09-21

"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op


revision: str = "20260921generalfiles"
down_revision: Union[str, Sequence[str], None] = "20260921storagekey"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    bind = op.get_bind()
    # PostgreSQL's native enum needs its new value registered separately. SQLite
    # uses the model's CHECK constraint in development and needs no equivalent step.
    if bind.dialect.name == "postgresql":
        op.execute("ALTER TYPE importtype ADD VALUE IF NOT EXISTS 'general'")

    op.add_column("import_batches", sa.Column("original_file", sa.LargeBinary(), nullable=True))
    op.add_column("import_batches", sa.Column("original_file_size", sa.Integer(), nullable=True))
    op.add_column(
        "import_batches",
        sa.Column("original_file_content_type", sa.String(length=255), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("import_batches", "original_file_content_type")
    op.drop_column("import_batches", "original_file_size")
    op.drop_column("import_batches", "original_file")
    # PostgreSQL enums cannot remove a value safely in place, so `general` remains
    # registered even after the columns are removed.
