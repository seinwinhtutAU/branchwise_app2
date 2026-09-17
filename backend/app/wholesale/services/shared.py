"""Small figures used across more than one wholesale entity. Ports
frontend/renderer/.../wholesale/shared.ts's formatting-adjacent helpers that are actually
business rules rather than display."""


def share_pct(part: int, whole: int) -> int:
    """A part of a whole as a percentage, safe when the whole is nothing."""
    if whole <= 0:
        return 0
    return min(100, round((part / whole) * 100))
