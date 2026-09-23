"""drop import_batches preview_data

Revision ID: f9b30f9e506a
Revises: 20260923zeroselling
Create Date: 2026-09-23 22:27:39.365075

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = 'f9b30f9e506a'
down_revision: Union[str, Sequence[str], None] = '20260923zeroselling'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    # Import History's "Clean" tab is now reconstructed live from the persisted
    # Sale/StockLevel/Purchase rows, and its "Original" tab is re-parsed on demand
    # from the R2-stored original file — this snapshot column is no longer read or
    # written anywhere (see app/retail/services/clean_rows.py).
    op.drop_column('import_batches', 'preview_data')


def downgrade() -> None:
    """Downgrade schema."""
    op.add_column('import_batches', sa.Column('preview_data', postgresql.JSON(astext_type=sa.Text()), server_default=sa.text("'{}'::json"), autoincrement=False, nullable=False))
