from fastapi import HTTPException, status
from sqlalchemy.orm import Query, Session

from app.models.branch import Branch
from app.models.user import User, UserRole


def resolve_branch_id(user: User, branch_id: str | None, db: Session) -> str | None:
    """A branch-scoped account's own branch always wins; an account with no fixed branch
    (admin) must say explicitly which branch a write is for."""
    if user.branch_id is not None:
        return user.branch_id

    if not branch_id:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            "This account has no branch assigned — pass branch_id to say which branch this is for",
        )
    if db.get(Branch, branch_id) is None:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, f"Unknown branch_id: {branch_id}")
    return branch_id


def resolve_wholesale_branch_id(user: User, branch_id: str | None, db: Session) -> str | None:
    """Wholesale's own version of resolve_branch_id. A wholesale-role account's own
    branch still always wins, but an admin isn't forced to name a branch explicitly the
    way retail's resolve_branch_id demands: today there is normally exactly one wholesale
    branch, and requiring admin to pass branch_id for that single-branch case (which the
    front end's wholesale screens don't even collect) turned "admin can do everything"
    into "admin gets a 400 trying to create a shipment/voucher/order". Only once a second
    wholesale branch actually exists does this ask for one, the same way the retail
    import screen already does for retail."""
    if user.branch_id is not None:
        return user.branch_id
    if branch_id:
        return resolve_branch_id(user, branch_id, db)

    wholesale_branches = list_wholesale_branches(db).all()
    if len(wholesale_branches) == 1:
        return wholesale_branches[0].id
    if not wholesale_branches:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "No wholesale branch is set up yet")
    raise HTTPException(
        status.HTTP_400_BAD_REQUEST,
        "More than one wholesale branch exists — pass branch_id to say which one this is for",
    )


def branch_name(db: Session, branch_id: str | None) -> str | None:
    """Display name for a nullable branch_id — None in, None out, and None for an
    id with no Branch row (deleted/unknown) rather than an error, since callers
    only use this to label a response."""
    branch = db.get(Branch, branch_id) if branch_id else None
    return branch.name if branch else None


def list_retail_branches(db: Session) -> Query:
    """Branches with no wholesale-role user assigned, ordered by name.

    Wholesale never has sales/inventory/purchase data — it runs its own separate
    workflow (customer orders / factory vouchers) — so it shouldn't appear in an
    import branch picker or an import-freshness report. Identified by the
    assigned user's role rather than by branch name, since names are just a
    display label that can be renamed freely (e.g. "Retail 1" became
    "AungThitSar") and shouldn't be relied on to mean anything structurally.
    """
    wholesale_branch_ids = db.query(User.branch_id).filter(User.role == UserRole.WHOLESALE)
    return db.query(Branch).filter(~Branch.id.in_(wholesale_branch_ids)).order_by(Branch.name)


def list_wholesale_branches(db: Session) -> Query:
    """The mirror image of list_retail_branches — branches with a wholesale-role user
    assigned. Used for the branch picker in the customer-order/factory-voucher forms,
    which an admin account (no fixed branch_id) needs to say which branch a new record
    belongs to."""
    wholesale_branch_ids = db.query(User.branch_id).filter(User.role == UserRole.WHOLESALE)
    return db.query(Branch).filter(Branch.id.in_(wholesale_branch_ids)).order_by(Branch.name)
