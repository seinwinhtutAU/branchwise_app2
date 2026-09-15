"""add repackaged to the wholesale write-off reason enum

Revision ID: d9e0f1a2b3c4
Revises: c7d8e9f0a1b2
"""

from typing import Sequence, Union

from alembic import op


revision: str = "d9e0f1a2b3c4"
down_revision: Union[str, Sequence[str], None] = "c7d8e9f0a1b2"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # PostgreSQL requires this enum value addition to be its own migration step.
    with op.get_context().autocommit_block():
        op.execute(
            "ALTER TYPE wholesale_write_off_reason "
            "ADD VALUE IF NOT EXISTS 'repackaged'"
        )


def downgrade() -> None:
    # PostgreSQL does not safely support removing an enum value in place. Existing
    # repackaged audit rows must remain readable if this revision is downgraded.
    pass
