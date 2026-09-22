"""add branch closures table

Revision ID: 20260922branchclosures
Revises: 20260922importkey
Create Date: 2026-09-22

"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = "20260922branchclosures"
down_revision: Union[str, Sequence[str], None] = "20260922importkey"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    bind = op.get_bind()
    # Reuses the existing `importtype` Postgres enum (sales/inventory/purchase/general)
    # rather than creating a new type for it — create_type=False stops SQLAlchemy from
    # trying to CREATE TYPE a second time.
    closure_type = (
        postgresql.ENUM("sales", "inventory", "purchase", "general", name="importtype", create_type=False)
        if bind.dialect.name == "postgresql"
        else sa.Enum("sales", "inventory", "purchase", "general", name="importtype")
    )
    op.create_table(
        "branch_closures",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("branch_id", sa.String(length=36), nullable=False),
        sa.Column("closure_type", closure_type, nullable=False),
        sa.Column("closure_date", sa.Date(), nullable=False),
        sa.Column("note", sa.String(length=500), nullable=True),
        sa.Column("closed_at", sa.DateTime(), nullable=True),
        sa.Column("closed_by", sa.String(length=36), nullable=True),
        sa.ForeignKeyConstraint(["branch_id"], ["branches.id"]),
        sa.ForeignKeyConstraint(["closed_by"], ["users.id"]),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint(
            "branch_id", "closure_type", "closure_date", name="uq_branch_closures_branch_type_date"
        ),
    )


def downgrade() -> None:
    op.drop_table("branch_closures")
