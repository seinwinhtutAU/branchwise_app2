"""add cost date to wholesale receiving costs

Revision ID: a5c9d7e2f4b1
Revises: f2a3b4c5d6e7
"""

from alembic import op
import sqlalchemy as sa


revision = "a5c9d7e2f4b1"
down_revision = "f2a3b4c5d6e7"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "wholesale_receiving_costs",
        sa.Column("cost_date", sa.Date(), nullable=True),
    )
    op.execute(
        """
        UPDATE wholesale_receiving_costs AS cost
        SET cost_date = receiving.received_date
        FROM wholesale_receivings AS receiving
        WHERE receiving.id = cost.receiving_id
        """
    )
    op.alter_column("wholesale_receiving_costs", "cost_date", nullable=False)


def downgrade() -> None:
    op.drop_column("wholesale_receiving_costs", "cost_date")
