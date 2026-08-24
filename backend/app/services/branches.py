from sqlalchemy.orm import Query, Session

from app.models.branch import Branch
from app.models.user import User, UserRole


def list_retail_branches(db: Session) -> Query:
    """Branches with no wholesale-role user assigned, ordered by name.

    Wholesale never has sales/inventory/purchase data — it runs a different
    workflow with no UI yet — so it shouldn't appear in an import branch
    picker or an import-freshness report. Identified by the assigned user's
    role rather than by branch name, since names are just a display label
    that can be renamed freely (e.g. "Retail 1" became "AungThitSar")
    and shouldn't be relied on to mean anything structurally.
    """
    wholesale_branch_ids = db.query(User.branch_id).filter(User.role == UserRole.WHOLESALE)
    return db.query(Branch).filter(~Branch.id.in_(wholesale_branch_ids)).order_by(Branch.name)
