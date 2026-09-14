"""add global wholesale master data tables and seed autocomplete values

Revision ID: 8d6f4c2b1a90
Revises: 94f451d2b14e
"""

from typing import Sequence, Union
import uuid

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import ENUM as PGEnum


revision: str = "8d6f4c2b1a90"
down_revision: Union[str, Sequence[str], None] = "94f451d2b14e"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _id() -> str:
    return str(uuid.uuid4())


def upgrade() -> None:
    op.create_table(
        "wholesale_products",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("stock_code", sa.String(length=100), nullable=False),
        sa.Column("description", sa.String(length=500), server_default="", nullable=False),
        sa.Column("product_group", PGEnum("man", "lady", "child", name="wholesale_product_group", create_type=False), nullable=False),
        sa.Column("active", sa.Boolean(), server_default="1", nullable=False),
        sa.Column("created_at", sa.DateTime(), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(), server_default=sa.text("now()"), nullable=False),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("stock_code"),
    )
    for table, constraint in (
        ("wholesale_suppliers", "uq_wholesale_suppliers_name"),
        ("wholesale_cargo_companies", "uq_wholesale_cargo_companies_name"),
        ("wholesale_carriers", "uq_wholesale_carriers_name"),
        ("wholesale_destinations", "uq_wholesale_destinations_name"),
        ("wholesale_receiving_gates", "uq_wholesale_receiving_gates_name"),
    ):
        columns = [
            sa.Column("id", sa.String(length=36), nullable=False),
            sa.Column("name", sa.String(length=255), nullable=False),
        ]
        if table == "wholesale_suppliers":
            columns.extend([
                sa.Column("phone", sa.String(length=100), server_default="", nullable=False),
                sa.Column("address", sa.String(length=1000), server_default="", nullable=False),
            ])
        columns.extend([
            sa.Column("active", sa.Boolean(), server_default="1", nullable=False),
            sa.Column("created_at", sa.DateTime(), server_default=sa.text("now()"), nullable=False),
            sa.Column("updated_at", sa.DateTime(), server_default=sa.text("now()"), nullable=False),
        ])
        op.create_table(table, *columns, sa.PrimaryKeyConstraint("id"), sa.UniqueConstraint("name", name=constraint))
    op.create_table(
        "wholesale_customers",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("name", sa.String(length=255), nullable=False),
        sa.Column("phone", sa.String(length=100), server_default="", nullable=False),
        sa.Column("address", sa.String(length=1000), server_default="", nullable=False),
        sa.Column("active", sa.Boolean(), server_default="1", nullable=False),
        sa.Column("created_at", sa.DateTime(), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(), server_default=sa.text("now()"), nullable=False),
        sa.PrimaryKeyConstraint("id"),
    )

    products = [
        ("A1001", "Men's leather sandal", "man"), ("A1002", "Men's slipper", "man"),
        ("A1003", "Men's sport sandal", "man"), ("B2001", "Ladies' flat sandal", "lady"),
        ("B2002", "Ladies' heel sandal", "lady"), ("C3001", "Kids' school shoe", "child"),
        ("C3002", "Kids' sandal", "child"), ("D4001", "Ladies' rubber slipper", "lady"),
    ]
    op.bulk_insert(
        sa.table("wholesale_products", sa.column("id", sa.String), sa.column("stock_code", sa.String),
                 sa.column("description", sa.String), sa.column("product_group", sa.String), sa.column("active", sa.Boolean)),
        [{"id": _id(), "stock_code": code, "description": description, "product_group": group, "active": True}
         for code, description, group in products],
    )
    op.bulk_insert(
        sa.table("wholesale_suppliers", sa.column("id", sa.String), sa.column("name", sa.String),
                 sa.column("phone", sa.String), sa.column("address", sa.String), sa.column("active", sa.Boolean)),
        [{"id": _id(), "name": name, "phone": "", "address": "", "active": True}
         for name in ["Goody Factory", "Lek", "Nilin", "Maldini", "Panda Shoes"]],
    )
    op.bulk_insert(
        sa.table("wholesale_customers", sa.column("id", sa.String), sa.column("name", sa.String),
                 sa.column("phone", sa.String), sa.column("address", sa.String), sa.column("active", sa.Boolean)),
        [{"id": _id(), "name": name, "phone": phone, "address": address, "active": True} for name, phone, address in [
            ("Ma Su Su Hlaing", "09-4500-12345", "No. 24, Bogyoke Rd, Mawlamyine"),
            ("Pone Pone", "09-9600-23456", "112 Anawrahta Rd, Yangon"),
            ("Ko Kaung Htet", "09-7800-34567", "Zay Gyi Market, Magway"),
            ("KKNN", "09-4500-45678", "Shwe Taung St, Mawlamyine"),
            ("Ma Kyi Phyu", "09-9600-56789", "5 Ward, Insein, Yangon"),
            ("MPPA", "09-7800-67890", "78th St, Mandalay"),
        ]],
    )
    for table, names in (
        ("wholesale_cargo_companies", ["Shwe Moe Cargo", "Ayar Cargo", "Tiger Cargo", "Golden Sea Cargo"]),
        ("wholesale_carriers", ["U Hla Myint", "Ko Zaw Lin", "Ma Khin Khin", "U Kyaw Thu"]),
        ("wholesale_destinations", ["Yangon", "Mandalay", "Magway", "Mawlamyine", "Bago"]),
        ("wholesale_receiving_gates", ["Bogyoke Rd, Mawlamyine", "Zay Gyi St, Magway", "Anawrahta Rd, Yangon"]),
    ):
        op.bulk_insert(sa.table(table, sa.column("id", sa.String), sa.column("name", sa.String), sa.column("active", sa.Boolean)),
                       [{"id": _id(), "name": name, "active": True} for name in names])


def downgrade() -> None:
    for table in ("wholesale_receiving_gates", "wholesale_destinations", "wholesale_carriers", "wholesale_cargo_companies", "wholesale_customers", "wholesale_suppliers", "wholesale_products"):
        op.drop_table(table)
