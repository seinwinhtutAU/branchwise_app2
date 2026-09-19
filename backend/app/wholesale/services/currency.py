"""Foreign-currency money on wholesale order lines, voucher lines, and receiving costs.

Every stored money field in the wholesale tables (``selling_price``, ``buying_price``,
``amount``) stays a Kyat value — every downstream reader (order/voucher totals, Finance
balances, inventory valuation, cost/profit reports, monitoring) keeps summing that one
column and needs no changes, mixed-currency records included. A line entered in a
foreign currency additionally keeps the original amount and the exchange rate it was
converted at, as an immutable snapshot on that row: the rate is fixed the moment the
line is saved, never re-looked-up from Settings' "today's rate" later, so editing an old
foreign line does not silently reprice it and changing today's rate affects only new
lines created after the change.

This module is the one place that validates a currency/original/rate combination and
computes the Kyat amount actually stored — callers (the three ``_line``/cost builders)
must not compute the conversion themselves, so the server, not the browser, is
authoritative for it.
"""

from decimal import ROUND_HALF_UP, Decimal

from fastapi import HTTPException, status

DEFAULT_CURRENCY = "MMK"

# The currencies this business actually deals in. Add a code here (and to Settings'
# today_exchange_rates default in app/models/app_settings.py) when a new supplier
# currency comes up — anything else is rejected rather than silently accepted with a
# rate of who-knows-what.
SUPPORTED_CURRENCIES = {"MMK", "THB"}


def _to_decimal(value) -> Decimal:
    return value if isinstance(value, Decimal) else Decimal(str(value))


def kyat_amount(original_amount, exchange_rate) -> Decimal:
    """``original_amount`` x ``exchange_rate``, rounded to the nearest Kyat the same way
    every other money field in this app is — two decimal places, half rounds up."""
    return (_to_decimal(original_amount) * _to_decimal(exchange_rate)).quantize(
        Decimal("0.01"), rounding=ROUND_HALF_UP
    )


def resolve_money(
    currency_code: str | None,
    mmk_amount,
    original_amount,
    exchange_rate,
) -> tuple[str, Decimal, Decimal | None, Decimal | None]:
    """Validate one money field's currency/original/rate combination and return what to
    actually store: ``(currency_code, kyat_amount, original_amount, exchange_rate)``.

    MMK (the default): ``original_amount``/``exchange_rate`` must be absent, and
    ``mmk_amount`` — exactly what was typed — is stored as-is. Any other currency:
    both ``original_amount`` and a positive ``exchange_rate`` are required, and the
    Kyat amount actually stored is computed from them here rather than from whatever
    ``mmk_amount`` the client sent, since a foreign line's Kyat figure is a derived
    snapshot, not something typed directly.
    """
    code = (currency_code or DEFAULT_CURRENCY).strip().upper()
    if code not in SUPPORTED_CURRENCIES:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, f'Unsupported currency "{code}"')

    if code == DEFAULT_CURRENCY:
        if original_amount is not None or exchange_rate is not None:
            raise HTTPException(
                status.HTTP_422_UNPROCESSABLE_CONTENT,
                "An MMK amount cannot also carry an original amount or exchange rate",
            )
        if mmk_amount is None:
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, "An MMK amount is required")
        return code, _to_decimal(mmk_amount), None, None

    if original_amount is None or exchange_rate is None:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_CONTENT,
            f"A {code} amount needs both an original amount and an exchange rate",
        )
    rate = _to_decimal(exchange_rate)
    if rate <= 0:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, "Exchange rate must be greater than zero")
    original = _to_decimal(original_amount)
    if original < 0:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, "Original amount cannot be negative")
    return code, kyat_amount(original, rate), original, rate
