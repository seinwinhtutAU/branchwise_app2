"""add reimported status to import batches

Revision ID: a69e3d42650e
Revises: f4a2c8d1e6b3
Create Date: 2026-08-26 22:06:22.962701

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'a69e3d42650e'
down_revision: Union[str, Sequence[str], None] = 'f4a2c8d1e6b3'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    bind = op.get_bind()
    if bind.dialect.name != "postgresql":
        return
    # Postgres forbids using a newly-added enum value in the same transaction it was
    # added in, so this must run and commit on its own before anything writes 'reimported'.
    op.execute("COMMIT")
    op.execute("ALTER TYPE importbatchstatus ADD VALUE IF NOT EXISTS 'reimported'")


def downgrade() -> None:
    """Downgrade schema."""
    # Postgres has no DROP VALUE for enums — removing one requires rebuilding the type
    # and reassigning every dependent column, which isn't warranted for this. Any rows
    # already marked 'reimported' would need a manual data migration first.
    pass
