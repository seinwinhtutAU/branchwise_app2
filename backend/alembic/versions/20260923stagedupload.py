"""add staged import uploads table

Revision ID: 20260923stagedupload
Revises: 20260922branchclosures
Create Date: 2026-09-23

"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "20260923stagedupload"
down_revision: Union[str, Sequence[str], None] = "20260922branchclosures"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "staged_import_uploads",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("filename", sa.String(length=255), nullable=True),
        sa.Column("content", sa.LargeBinary(), nullable=False),
        sa.Column("created_at", sa.DateTime(), server_default=sa.func.now(), nullable=False),
        sa.PrimaryKeyConstraint("id"),
    )


def downgrade() -> None:
    op.drop_table("staged_import_uploads")
