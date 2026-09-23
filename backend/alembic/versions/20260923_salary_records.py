"""add salary records parsed from daily operation cost uploads

Revision ID: 20260923salaryrecords
Revises: 20260923stagedupload
Create Date: 2026-09-23
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "20260923salaryrecords"
down_revision: Union[str, Sequence[str], None] = "20260923stagedupload"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "salary_records",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("import_batch_id", sa.String(length=36), nullable=False),
        sa.Column("branch_id", sa.String(length=36), nullable=True),
        sa.Column("name", sa.String(length=255), nullable=False),
        sa.Column("branch", sa.String(length=255), nullable=False),
        sa.Column("salary", sa.Numeric(precision=14, scale=2), nullable=False),
        sa.Column("bonus", sa.Numeric(precision=14, scale=2), nullable=True),
        sa.Column("source_sheet", sa.String(length=100), nullable=False),
        sa.Column("source_row", sa.Integer(), nullable=False),
        sa.ForeignKeyConstraint(["branch_id"], ["branches.id"]),
        sa.ForeignKeyConstraint(["import_batch_id"], ["import_batches.id"]),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("import_batch_id", "source_sheet", "source_row", name="uq_salary_records_source_row"),
    )
    op.create_index("ix_salary_records_branch_id", "salary_records", ["branch_id"])
    op.create_index("ix_salary_records_import_batch_id", "salary_records", ["import_batch_id"])


def downgrade() -> None:
    op.drop_index("ix_salary_records_import_batch_id", table_name="salary_records")
    op.drop_index("ix_salary_records_branch_id", table_name="salary_records")
    op.drop_table("salary_records")
