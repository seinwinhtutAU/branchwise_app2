"""add wholesale_audit_logs and version_id to wholesale_shipments

Revision ID: c4e5f6a7b8c9
Revises: b3f6c1d8e5a2
"""

from alembic import op
import sqlalchemy as sa


revision = "c4e5f6a7b8c9"
down_revision = "b3f6c1d8e5a2"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "wholesale_shipments",
        sa.Column("version_id", sa.Integer(), nullable=False, server_default="1"),
    )
    op.alter_column("wholesale_shipments", "version_id", server_default=None)

    op.create_table(
        "wholesale_audit_logs",
        sa.Column("id", sa.String(length=36), primary_key=True),
        sa.Column("branch_id", sa.String(length=36), sa.ForeignKey("branches.id"), nullable=True),
        sa.Column("entity_type", sa.String(length=50), nullable=False),
        sa.Column("entity_id", sa.String(length=36), nullable=False),
        sa.Column("action", sa.String(length=50), nullable=False),
        sa.Column("operator_id", sa.String(length=36), nullable=True),
        sa.Column("summary", sa.String(length=500), nullable=False, server_default=""),
        sa.Column("payload", sa.JSON(), nullable=False),
        sa.Column("created_at", sa.DateTime(), server_default=sa.func.now(), nullable=False),
    )
    op.create_index(
        "ix_wholesale_audit_logs_branch_id_created_at",
        "wholesale_audit_logs",
        ["branch_id", "created_at"],
    )
    op.create_index(
        "ix_wholesale_audit_logs_entity",
        "wholesale_audit_logs",
        ["entity_type", "entity_id"],
    )


def downgrade() -> None:
    op.drop_index("ix_wholesale_audit_logs_entity", table_name="wholesale_audit_logs")
    op.drop_index("ix_wholesale_audit_logs_branch_id_created_at", table_name="wholesale_audit_logs")
    op.drop_table("wholesale_audit_logs")
    op.drop_column("wholesale_shipments", "version_id")
