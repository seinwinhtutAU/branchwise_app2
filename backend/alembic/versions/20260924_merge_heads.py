"""merge the staged-uploads drop and the daily-cost branch

Revision ID: 20260924merge
Revises: 20260923dropstaged, 20260924dailycost
Create Date: 2026-09-24
"""

from typing import Sequence, Union

revision: str = "20260924merge"
down_revision: Union[str, Sequence[str], None] = ("20260923dropstaged", "20260924dailycost")
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    pass


def downgrade() -> None:
    pass
