"""Regression coverage for the Business Alerts rule catalogue.

Each retained rule's detection and payload is exercised in
test_business_alerts_extended.py. This test protects the deliberately small rule
set so general revenue, profit, low-stock, dead-stock, traffic, and duplicate
Warning-page alerts cannot be reintroduced accidentally.
"""

from app.retail.services import early_warning


def test_business_alerts_only_register_operational_rules():
    assert tuple(rule.__name__ for rule in early_warning.RULES) == (
        "daily_import_missing_rule",
        "sale_data_quality_rule",
        "purchase_data_quality_rule",
        "urgent_reorder_rule",
        "stock_allocation_rule",
        "footwear_aging_rule",
        "physical_stock_audit_rule",
        "seasonal_demand_spike_rule",
        "weekly_pattern_demand_rule",
    )
