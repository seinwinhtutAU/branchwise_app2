"""add split_from_shipment_id to wholesale shipments

Revision ID: 38279336be8e
Revises: d9e0f1a2b3c4
Create Date: 2026-09-15 16:51:01.391722

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '38279336be8e'
down_revision: Union[str, Sequence[str], None] = 'd9e0f1a2b3c4'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "wholesale_shipments",
        sa.Column("split_from_shipment_id", sa.String(length=36), nullable=True),
    )
    op.create_foreign_key(
        "fk_wholesale_shipments_split_from_shipment_id",
        "wholesale_shipments",
        "wholesale_shipments",
        ["split_from_shipment_id"],
        ["id"],
        ondelete="SET NULL",
    )


def downgrade() -> None:
    op.drop_constraint(
        "fk_wholesale_shipments_split_from_shipment_id",
        "wholesale_shipments",
        type_="foreignkey",
    )
    op.drop_column("wholesale_shipments", "split_from_shipment_id")
