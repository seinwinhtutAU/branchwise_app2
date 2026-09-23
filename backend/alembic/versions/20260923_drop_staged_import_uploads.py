"""drop staged_import_uploads

Uploads are now staged on local disk (app/retail/services/staged_uploads.py) instead of
in this table, which cost ~18s per 2.7 MB file over the remote database connection.

Revision ID: 20260923dropstaged
Revises: f9b30f9e506a
Create Date: 2026-09-23 23:30:00

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = '20260923dropstaged'
down_revision: Union[str, Sequence[str], None] = 'f9b30f9e506a'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.drop_table('staged_import_uploads')


def downgrade() -> None:
    op.create_table(
        'staged_import_uploads',
        sa.Column('id', sa.String(length=36), nullable=False),
        sa.Column('filename', sa.String(length=255), nullable=True),
        sa.Column('content', sa.LargeBinary(), nullable=False),
        sa.Column('created_at', sa.DateTime(), server_default=sa.text('now()'), nullable=False),
        sa.PrimaryKeyConstraint('id'),
    )
