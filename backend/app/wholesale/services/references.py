"""Reference numbers in the shape the business writes them: PREFIX-YYMMDD-NNNN, as in
SHP-260827-0001. The date is part of the reference so anyone reading one knows when it
was raised without looking it up, and the four digits start again each day, scoped to one
branch — two wholesale branches can each raise a "SHP-260912-0001" on the same day, the
way two branches' own paper books would.

Ports frontend/renderer/.../wholesale/shared.ts::nextReference, but the server is now the
one place that assigns it: the client only ever displayed the front end's own guess, which
was wrong the moment two people were typing at once. The client no longer computes one at
all — it shows the number the create response returns.
"""

from datetime import date

from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import InstrumentedAttribute, Session


def next_reference(prefix: str, existing: list[str], on_date: date) -> str:
    """The pure rule: prefix, the date compressed to YYMMDD, and one past the highest
    sequence already used that day. `existing` need only contain references sharing the
    same prefix and day — the caller filters that far before calling this."""
    day = on_date.strftime("%y%m%d")
    head = f"{prefix}-{day}-"
    highest = 0
    for reference in existing:
        if not reference.startswith(head):
            continue
        suffix = reference[len(head) :]
        if suffix.isdigit():
            highest = max(highest, int(suffix))
    return f"{head}{highest + 1:04d}"


def allocate_reference(
    db: Session,
    column: InstrumentedAttribute,
    branch_id: str | None,
    prefix: str,
    on_date: date,
) -> str:
    """Reads what has already been issued today for this branch and hands back the next
    one. Called right before the row that will use it is inserted; a collision (two
    requests racing for the same number) surfaces as an IntegrityError on the unique
    constraint, and the caller is expected to retry once by calling this again — the
    retry sees the row the other request just committed and skips past it."""
    model = column.class_
    day = on_date.strftime("%y%m%d")
    head = f"{prefix}-{day}-"
    query = db.query(column).filter(column.like(f"{head}%"))
    query = query.filter(model.branch_id == branch_id) if branch_id is not None else query.filter(model.branch_id.is_(None))
    existing = [row[0] for row in query.all()]
    return next_reference(prefix, existing, on_date)


def retry_on_reference_collision(db: Session, attempt) -> object:
    """Runs `attempt()` (which allocates a reference, builds a row and commits) and, if
    the unique constraint on that reference fires, rolls back and tries exactly once
    more. Two attempts is enough at wholesale's volumes — a third collision would mean
    something else is wrong."""
    try:
        return attempt()
    except IntegrityError:
        db.rollback()
        return attempt()
