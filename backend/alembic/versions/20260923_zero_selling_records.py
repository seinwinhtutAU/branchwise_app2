"""add zero selling records from general file uploads

Revision ID: 20260923zeroselling
Revises: 20260923salaryrecords
Create Date: 2026-09-23
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "20260923zeroselling"
down_revision: Union[str, Sequence[str], None] = "20260923salaryrecords"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "zero_selling_records",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("import_batch_id", sa.String(length=36), nullable=False),
        sa.Column("branch_id", sa.String(length=36), nullable=True),
        sa.Column("sale_date", sa.Date(), nullable=False),
        sa.Column("sale_time", sa.String(length=20), nullable=True),
        sa.Column("branch", sa.String(length=255), nullable=False),
        sa.Column("category", sa.String(length=255), nullable=True),
        sa.Column("reason", sa.String(length=2000), nullable=True),
        sa.Column("source_sheet", sa.String(length=100), nullable=False),
        sa.Column("source_row", sa.Integer(), nullable=False),
        sa.ForeignKeyConstraint(["branch_id"], ["branches.id"]),
        sa.ForeignKeyConstraint(["import_batch_id"], ["import_batches.id"]),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("import_batch_id", "source_sheet", "source_row", name="uq_zero_selling_records_source_row"),
    )
    op.create_index("ix_zero_selling_records_import_batch_id", "zero_selling_records", ["import_batch_id"])
    op.create_index("ix_zero_selling_records_branch_id_sale_date", "zero_selling_records", ["branch_id", "sale_date"])


def downgrade() -> None:
    op.drop_index("ix_zero_selling_records_branch_id_sale_date", table_name="zero_selling_records")
    op.drop_index("ix_zero_selling_records_import_batch_id", table_name="zero_selling_records")
    op.drop_table("zero_selling_records")
