"""lowercase userrole enum values

Revision ID: 81393732eaaa
Revises: abce66eec391
Create Date: 2026-08-22 22:07:28.859154

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '81393732eaaa'
down_revision: Union[str, Sequence[str], None] = 'abce66eec391'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    bind = op.get_bind()
    if bind.dialect.name != "postgresql":
        return
    op.execute("ALTER TYPE userrole RENAME VALUE 'ADMIN' TO 'admin'")
    op.execute("ALTER TYPE userrole RENAME VALUE 'WHOLESALE' TO 'wholesale'")
    op.execute("ALTER TYPE userrole RENAME VALUE 'RETAIL' TO 'retail'")


def downgrade() -> None:
    """Downgrade schema."""
    bind = op.get_bind()
    if bind.dialect.name != "postgresql":
        return
    op.execute("ALTER TYPE userrole RENAME VALUE 'admin' TO 'ADMIN'")
    op.execute("ALTER TYPE userrole RENAME VALUE 'wholesale' TO 'WHOLESALE'")
    op.execute("ALTER TYPE userrole RENAME VALUE 'retail' TO 'RETAIL'")
