from datetime import datetime, timezone


def utc_now() -> datetime:
    """Return a naive UTC value for the existing timestamp-without-time-zone columns."""
    return datetime.now(timezone.utc).replace(tzinfo=None)


def utc_timestamp(value: datetime) -> str:
    """Serialize a database timestamp as an unambiguous UTC API value.

    Retail's existing timestamp columns are `timestamp without time zone`; their
    database defaults use the UTC database clock. Marking that fact in the API lets
    each branch's desktop app convert the same instant to its own local time.
    """
    if value.tzinfo is None:
        value = value.replace(tzinfo=timezone.utc)
    return value.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")
