"""Make confirmed import retries idempotent.

Revision ID: 20260922importkey
Revises: 20260921developmentrole
Create Date: 2026-09-22
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op


revision: str = "20260922importkey"
down_revision: Union[str, Sequence[str], None] = "20260921developmentrole"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("import_batches", sa.Column("request_key", sa.String(length=64), nullable=True))
    op.create_unique_constraint(
        "uq_import_batches_request_key", "import_batches", ["request_key"]
    )


def downgrade() -> None:
    op.drop_constraint("uq_import_batches_request_key", "import_batches", type_="unique")
    op.drop_column("import_batches", "request_key")
