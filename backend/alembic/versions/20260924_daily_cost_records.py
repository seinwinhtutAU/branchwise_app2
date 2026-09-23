"""add daily cost summaries from General File uploads

Revision ID: 20260924dailycost
Revises: 20260923zeroselling
Create Date: 2026-09-24
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "20260924dailycost"
down_revision: Union[str, Sequence[str], None] = "20260923zeroselling"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "daily_cost_records",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("import_batch_id", sa.String(length=36), nullable=False),
        sa.Column("branch_id", sa.String(length=36), nullable=True),
        sa.Column("cost_date", sa.Date(), nullable=False),
        sa.Column("branch", sa.String(length=255), nullable=False),
        sa.Column("usage", sa.String(length=4000), nullable=True),
        sa.Column("usage_total", sa.Numeric(precision=14, scale=2), nullable=False),
        sa.Column("digital_income", sa.String(length=4000), nullable=True),
        sa.Column("digital_income_total", sa.Numeric(precision=14, scale=2), nullable=False),
        sa.Column("return_items", sa.String(length=4000), nullable=True),
        sa.Column("return_total", sa.Numeric(precision=14, scale=2), nullable=False),
        sa.Column("capital_expenditure", sa.String(length=4000), nullable=True),
        sa.Column("capital_total", sa.Numeric(precision=14, scale=2), nullable=False),
        sa.Column("source_sheet", sa.String(length=100), nullable=False),
        sa.ForeignKeyConstraint(["branch_id"], ["branches.id"]),
        sa.ForeignKeyConstraint(["import_batch_id"], ["import_batches.id"]),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("import_batch_id", "source_sheet", name="uq_daily_cost_records_source_sheet"),
    )
    op.create_index("ix_daily_cost_records_import_batch_id", "daily_cost_records", ["import_batch_id"])
    op.create_index("ix_daily_cost_records_branch_id_cost_date", "daily_cost_records", ["branch_id", "cost_date"])


def downgrade() -> None:
    op.drop_index("ix_daily_cost_records_branch_id_cost_date", table_name="daily_cost_records")
    op.drop_index("ix_daily_cost_records_import_batch_id", table_name="daily_cost_records")
    op.drop_table("daily_cost_records")
