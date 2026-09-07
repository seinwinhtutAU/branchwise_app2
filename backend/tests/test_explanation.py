import pytest

from app.services import early_warning, explanation
from tests.test_early_warning import _by_id, _snapshot


# --- the decomposition itself ---------------------------------------------------------


@pytest.mark.parametrize(
    "revenue,previous_revenue,transactions,previous_transactions",
    [
        (88_694.0, 100_000.0, 82, 100),  # fewer visits, bigger baskets
        (81_000.0, 100_000.0, 90, 100),  # both down
        (140_000.0, 100_000.0, 120, 100),  # both up
        (95_000.0, 100_000.0, 130, 100),  # more visits, much smaller baskets
    ],
)
def test_the_three_effects_sum_exactly_to_the_actual_change(
    revenue, previous_revenue, transactions, previous_transactions
):
    """The property the whole explanation layer rests on. If the terms didn't add up to
    the real movement there would be an unexplained residual, and "which term is
    biggest" would stop being a statement about what actually happened."""
    change = explanation.decompose_revenue_change(
        revenue, previous_revenue, transactions, previous_transactions
    )
    assert change is not None
    total = change.transaction_effect + change.basket_effect + change.interaction_effect
    assert total == pytest.approx(revenue - previous_revenue)
    assert change.revenue_change == pytest.approx(revenue - previous_revenue)


def test_a_fall_carried_by_lost_transactions_is_attributed_to_transactions():
    """The worked example this layer was designed around: revenue down ~11%, but
    transactions down far more and the average sale actually up."""
    change = explanation.decompose_revenue_change(88_694.0, 100_000.0, 82, 100)
    assert change is not None
    assert change.revenue_growth_pct == pytest.approx(-11.3, abs=0.05)
    assert change.transaction_growth_pct == pytest.approx(-18.0)
    assert change.basket_growth_pct > 0
    assert change.dominant == "transactions"

    driver, interpretation = explanation.describe_revenue_change(change)
    assert "Transactions are down 18.0%" in driver
    assert "average sale is up" in driver
    assert "fewer transactions" in interpretation
    assert "partly offset" in interpretation


def test_a_fall_carried_by_smaller_baskets_is_attributed_to_baskets():
    change = explanation.decompose_revenue_change(78_400.0, 100_000.0, 98, 100)
    assert change is not None
    assert change.dominant == "basket"
    _driver, interpretation = explanation.describe_revenue_change(change)
    assert "smaller average sale" in interpretation


def test_two_effects_of_similar_size_are_reported_as_both_not_as_a_winner():
    """Picking a driver by a nose would read as a finding when it isn't one."""
    change = explanation.decompose_revenue_change(81_000.0, 100_000.0, 90, 100)
    assert change is not None
    assert change.transaction_effect == pytest.approx(change.basket_effect)
    assert change.dominant == "both"
    _driver, interpretation = explanation.describe_revenue_change(change)
    assert "roughly equally" in interpretation


def test_revenue_that_held_up_despite_lost_visits_is_not_called_a_fall():
    """Transactions down, baskets up enough to more than cover it. Calling this "the
    fall" would describe the opposite of what the revenue line did."""
    change = explanation.decompose_revenue_change(110_000.0, 100_000.0, 80, 100)
    assert change is not None
    assert change.revenue_change > 0
    assert change.transaction_effect < 0
    _driver, interpretation = explanation.describe_revenue_change(change)
    assert "held up" in interpretation
    assert "fall" not in interpretation


def test_nothing_is_decomposed_without_a_previous_period():
    assert explanation.decompose_revenue_change(100_000.0, 0.0, 100, 0) is None
    assert explanation.decompose_revenue_change(100_000.0, 100_000.0, 100, 0) is None
    assert explanation.decompose_revenue_change(0.0, 100_000.0, 0, 100) is None


# --- margin ---------------------------------------------------------------------------


def test_margin_change_separates_a_cost_side_move_from_a_price_side_one():
    # Revenue up 10%, costs up 30% — the branch sold more without keeping more of it.
    cost_side = explanation.decompose_margin_change(
        18.0, 30.0, 110_000.0, 100_000.0, 91_000.0, 70_000.0
    )
    assert cost_side is not None
    assert cost_side.cause == "costs_outpaced_sales"
    driver, interpretation = explanation.describe_margin_change(cost_side)
    assert "Revenue is up 10.0%" in driver and "cost of goods is up 30.0%" in driver
    assert "buying prices" in interpretation

    # Revenue down 20%, costs down only 5% — a selling-price or mix move, not suppliers.
    price_side = explanation.decompose_margin_change(
        16.5, 30.0, 80_000.0, 100_000.0, 66_500.0, 70_000.0
    )
    assert price_side is not None
    assert price_side.cause == "sales_fell_faster_than_costs"
    assert "selling prices" in explanation.describe_margin_change(price_side)[1]

    # Costs up while sales fell — both sides moved against the margin.
    both_sides = explanation.decompose_margin_change(
        10.0, 30.0, 90_000.0, 100_000.0, 81_000.0, 70_000.0
    )
    assert both_sides is not None
    assert both_sides.cause == "costs_rose_while_sales_fell"
    assert "Both sides" in explanation.describe_margin_change(both_sides)[1]


def test_margin_change_needs_both_periods_costed():
    assert explanation.decompose_margin_change(20.0, None, 1.0, 1.0, 1.0, 1.0) is None
    assert explanation.decompose_margin_change(20.0, 30.0, 1.0, 0.0, 1.0, 1.0) is None


def test_a_low_margin_level_says_whether_it_is_new():
    """The distinction that changes what a manager does: a long-standing thin margin is
    a pricing decision to revisit, a fresh one is an event to investigate."""
    standing_driver, standing = explanation.describe_margin_level(7.0, 7.4)
    assert "as well" in standing_driver
    assert "standing level" in standing

    new_driver, new = explanation.describe_margin_level(7.0, 22.0)
    assert "fell 15.0 percentage points" in new_driver
    assert "recent move" in new

    improving_driver, improving = explanation.describe_margin_level(9.0, 4.0)
    assert "risen 5.0" in improving_driver
    assert "still below" in improving

    assert explanation.describe_margin_level(7.0, None) == (None, None)


# --- how the alerts use it ------------------------------------------------------------


def test_revenue_alert_carries_the_decomposition():
    alerts = early_warning.evaluate(
        _snapshot(net_revenue=80_000.0, transaction_count=75, avg_basket=1066.67)
    )
    alert = _by_id(alerts, "revenue_decline")
    assert alert.driver is not None and "Transactions are down" in alert.driver
    assert alert.interpretation is not None


def test_traffic_alert_explains_rather_than_repeats_itself():
    """Its headline is the net effect on revenue; the two opposing movements live in
    the driver line, so the card doesn't say the same thing twice."""
    alert = _by_id(
        early_warning.evaluate(_snapshot(transaction_count=85, avg_basket=1300.0, net_revenue=110_500.0)),
        "traffic_decline",
    )
    assert "doesn't look alarming" in alert.what_happened
    assert alert.driver is not None and "Transactions are down" in alert.driver
    assert alert.driver not in alert.what_happened


def test_no_two_alerts_tell_the_same_story():
    """A branch losing footfall *and* visibly losing revenue gets one explanation of
    that, not two cards carrying identical driver and interpretation text."""
    alerts = early_warning.evaluate(
        _snapshot(net_revenue=88_694.0, transaction_count=82, avg_basket=1081.6)
    )
    ids = [alert.id for alert in alerts]
    assert "revenue_decline" in ids
    assert "traffic_decline" not in ids
    explanations = [(a.driver, a.interpretation) for a in alerts if a.driver]
    assert len(explanations) == len(set(explanations))


def test_low_margin_alert_explains_whether_the_level_is_new():
    alert = _by_id(
        early_warning.evaluate(_snapshot(gross_margin_pct=6.0, previous_gross_margin_pct=6.2)),
        "low_margin",
    )
    assert alert.driver is not None and "as well" in alert.driver
    assert alert.interpretation is not None and "standing level" in alert.interpretation


def test_alerts_with_nothing_to_decompose_name_no_cause():
    """Better an empty field than an invented cause — a dead-stock count has no two
    components to split it into, so nothing here says *why* those products stopped
    selling. The line it does carry says what the count means for the business, which is
    a judgement about money, not a claim about a cause."""
    alert = _by_id(early_warning.evaluate(_snapshot(dead_stock_count=40)), "dead_stock")
    assert alert.interpretation is None
    assert alert.driver is not None and "money sitting still" in alert.driver


# --- stock risk -----------------------------------------------------------------------


def _at_risk_item(stock_code="SKU-1", description="Widget", days_left=2.0, demand_ratio=2.0):
    return {
        "stock_code": stock_code,
        "description": description,
        "days_left": days_left,
        "status": "Critical",
        "demand_ratio": demand_ratio,
    }


def test_stock_risk_separates_demand_speeding_up_from_stock_running_down():
    """Days left = on hand ÷ recent selling rate, so a product hits the threshold for
    one of two reasons — and they call for different responses: reorder more, versus
    reorder sooner."""
    demand = explanation.classify_stock_risk(4, 4, _at_risk_item(demand_ratio=2.4))
    assert demand is not None and demand.cause == "demand"
    assert "larger quantities" in explanation.describe_stock_risk(demand)[1]

    drawdown = explanation.classify_stock_risk(4, 0, _at_risk_item(demand_ratio=0.9))
    assert drawdown is not None and drawdown.cause == "drawdown"
    assert "reorder-timing" in explanation.describe_stock_risk(drawdown)[1]

    mixed = explanation.classify_stock_risk(4, 2, _at_risk_item())
    assert mixed is not None and mixed.cause == "mixed"
    assert "product by product" in explanation.describe_stock_risk(mixed)[1]


def test_stock_risk_names_the_most_urgent_product():
    risk = explanation.classify_stock_risk(
        3, 3, _at_risk_item("BEV-014", "Coffee Mix 3-in-1", 1.8, 2.4)
    )
    assert risk is not None
    driver, _ = explanation.describe_stock_risk(risk)
    assert "BEV-014" in driver and "Coffee Mix 3-in-1" in driver
    assert "1.8 days left" in driver
    assert "2.4×" in driver


def test_a_product_with_no_earlier_sales_counts_as_new_demand_not_a_ratio():
    """Nothing sold in the earlier window means demand that is entirely new. A ratio
    would divide by zero, and "new" is the stronger signal of the two anyway."""
    risk = explanation.classify_stock_risk(1, 1, _at_risk_item(demand_ratio=None))
    assert risk is not None
    driver, _ = explanation.describe_stock_risk(risk)
    assert "nothing sold at all" in driver
    assert "×" not in driver


def test_a_single_at_risk_product_is_not_described_as_a_tally():
    """"0 of the 1 at-risk products are" is the right count and the wrong sentence —
    with one product there is no tally worth stating and nothing to be more urgent
    than."""
    risk = explanation.classify_stock_risk(1, 0, _at_risk_item("SNK-201", "Biscuit Pack", 5.4, 0.9))
    assert risk is not None
    driver, _ = explanation.describe_stock_risk(risk)
    assert driver.startswith("SNK-201 (Biscuit Pack) has 5.4 days left")
    assert "of the 1" not in driver
    assert "most urgent" not in driver


def test_nothing_at_risk_means_nothing_to_explain():
    assert explanation.classify_stock_risk(0, 0, None) is None
    assert explanation.classify_stock_risk(3, 1, None) is None


def test_stock_alert_explains_itself_by_how_long_the_stock_lasts():
    alert = _by_id(
        early_warning.evaluate(
            _snapshot(
                critical_count=1,
                at_risk_count=1,
                at_risk_demand_driven_count=1,
                at_risk_leading_item=_at_risk_item("BEV-014", "Coffee Mix", 1.8, 2.4),
            )
        ),
        "stockout_risk",
    )
    # The "why" stays with what is solidly measured — how long the stock lasts — rather
    # than naming a cause behind it; see early_warning._stock_why.
    assert alert.driver is not None and "days of stock left" in alert.driver
    assert alert.interpretation is None
    # And the headline reads as a sentence, not a form letter.
    assert "1 product has" in alert.what_happened
    assert "product(s)" not in alert.what_happened
    assert "its recent selling rate" in alert.what_happened


# --- basket composition ---------------------------------------------------------------


def test_a_high_single_item_share_says_whether_it_is_new():
    """The distinction that changes the decision: a branch that has always sold this way
    has a layout question, one that jumped has an event to find."""
    standing_driver, standing = explanation.describe_basket_composition(72.0, 70.0)
    assert "as well" in standing_driver
    assert "normally sells" in standing

    risen_driver, risen = explanation.describe_basket_composition(78.0, 45.0)
    assert "rose 33 percentage points" in risen_driver
    assert "recent shift" in risen

    falling_driver, falling = explanation.describe_basket_composition(72.0, 85.0)
    assert "fallen 13 percentage points" in falling_driver
    assert "right way" in falling

    assert explanation.describe_basket_composition(72.0, None) == (None, None)


def test_single_item_alert_carries_that_context():
    alert = _by_id(
        early_warning.evaluate(
            _snapshot(single_item_basket_share_pct=78.0, previous_single_item_basket_share_pct=45.0)
        ),
        "single_item_baskets",
    )
    assert alert.driver is not None and "rose 33 percentage points" in alert.driver
    assert alert.interpretation is not None and "recent shift" in alert.interpretation


def test_single_item_alert_has_no_context_without_a_previous_period():
    alert = _by_id(
        early_warning.evaluate(
            _snapshot(
                single_item_basket_share_pct=78.0,
                previous_transaction_count=0,
                previous_net_revenue=0.0,
            )
        ),
        "single_item_baskets",
    )
    assert alert.driver is None
