from types import SimpleNamespace

import pytest

from app.wholesale.models.entities import WholesaleUnit
from app.wholesale.services.money import order_totals, voucher_totals
from app.wholesale.services.units import priced_amount


@pytest.mark.parametrize(
    ("unit", "quantity_pairs", "price"),
    [
        (WholesaleUnit.PAIR, 2, 10_000),
        (WholesaleUnit.SET, 12, 10_000),
        (WholesaleUnit.DOZEN, 24, 10_000),
    ],
)
def test_priced_amount_uses_the_price_unit(
    unit: WholesaleUnit, quantity_pairs: int, price: int
) -> None:
    assert priced_amount(quantity_pairs, unit, price) == 20_000


@pytest.mark.parametrize(
    ("unit", "quantity_pairs"),
    [
        (WholesaleUnit.PAIR, 2),
        (WholesaleUnit.SET, 12),
        (WholesaleUnit.DOZEN, 24),
    ],
)
def test_order_and_voucher_totals_keep_paid_overages_visible(
    unit: WholesaleUnit, quantity_pairs: int
) -> None:
    payments = [SimpleNamespace(amount=25_000)]
    order = SimpleNamespace(
        lines=[SimpleNamespace(quantity_pairs=quantity_pairs, unit=unit, selling_price=10_000)],
        payments=payments,
    )
    voucher = SimpleNamespace(
        lines=[SimpleNamespace(quantity_pairs=quantity_pairs, unit=unit, buying_price=10_000)],
        payments=payments,
    )

    assert order_totals(order) == {
        "total": 20_000,
        "paid": 25_000,
        "balance_due": -5_000,
    }
    assert voucher_totals(voucher) == {
        "total": 20_000,
        "paid": 25_000,
        "balance_due": -5_000,
    }
