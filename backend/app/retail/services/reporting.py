"""Small shared reporting primitives used by retail and wholesale reports."""

from datetime import date, timedelta


def kpi_value(value: float, previous_value: float) -> dict:
    """Return a value and its immediately preceding-period comparison."""
    return {
        "value": value,
        "previous_value": previous_value,
        "delta_pct": ((value - previous_value) / previous_value * 100)
        if previous_value
        else None,
    }


def each_day(start: date, end: date):
    """Yield every day in an inclusive range, including days with no activity."""
    current = start
    while current <= end:
        yield current
        current += timedelta(days=1)
