"""Operational Business Alerts derived from a branch health snapshot.

Only alerts that lead to a defined retail operation belong here: importing daily data,
fixing invalid sale or purchase data, purchasing/reordering, checking stock, allocating
stock between branches, managing aging inventory, and preparing for known demand.
"""

from dataclasses import asdict, dataclass
from typing import Callable

from app.retail.services.branch_health import BranchSnapshot

CRITICAL = "critical"
WARNING = "warning"
NORMAL = "normal"

_SEVERITY_RANK = {CRITICAL: 0, WARNING: 1, NORMAL: 2}


@dataclass(frozen=True)
class Alert:
    id: str
    severity: str
    dimension: str
    title: str
    summary: str
    what_happened: str
    recommended_action: str
    link: str
    measure: str
    driver: str | None = None
    interpretation: str | None = None
    context: str | None = None
    facts: tuple[dict, ...] = ()
    table: dict | None = None


def _count_products(count: int) -> str:
    return "1 product" if count == 1 else f"{count} products"


def _fact(label: str, value: str | None) -> dict | None:
    return None if value is None else {"label": label, "value": value}


def _facts(*facts: dict | None) -> tuple[dict, ...]:
    return tuple(fact for fact in facts if fact is not None)


def _format_time(cutoff: str) -> str:
    try:
        parts = cutoff.split(":")
        hour = int(parts[0])
        minute = int(parts[1]) if len(parts) > 1 else 0
        suffix = "AM" if hour < 12 else "PM"
        display_hour = 12 if hour in (0, 12) else hour % 12
        return (
            f"{display_hour}:00 {suffix}"
            if minute == 0
            else f"{display_hour}:{minute:02d} {suffix}"
        )
    except (TypeError, ValueError):
        return cutoff


def daily_import_missing_rule(snapshot: BranchSnapshot) -> list[Alert]:
    """After the daily cutoff, require today's Sale and Inventory imports only."""
    if not snapshot.is_after_8pm:
        return []

    missing = []
    if not snapshot.has_today_sales:
        missing.append("Sale")
    if not snapshot.has_today_inventory:
        missing.append("Inventory")
    if not missing:
        return []

    cutoff = _format_time(snapshot.daily_check_cutoff_time)
    missing_label = " and ".join(missing)
    return [
        Alert(
            id="daily_import_missing",
            severity=CRITICAL,
            dimension="sales" if not snapshot.has_today_sales else "inventory",
            title=f"Daily {missing_label} import missing for today",
            summary=f"Today's {', '.join(missing)} not imported after {cutoff}",
            what_happened=(
                f"The shop closed at {cutoff}, but today's {missing_label} export from "
                "the POS terminal has not been imported. Store performance, stock counts, "
                "and daily reconciliations cannot reflect today's trade until confirmed."
            ),
            recommended_action="Upload and confirm today's POS export file immediately.",
            link="import",
            measure="daily_import",
            facts=_facts(
                _fact("Shop Status", f"Closed (after {cutoff})"),
                _fact(
                    "Today's Sales",
                    "Imported" if snapshot.has_today_sales else "Missing",
                ),
                _fact(
                    "Today's Inventory",
                    "Imported" if snapshot.has_today_inventory else "Missing",
                ),
            ),
        )
    ]


def physical_stock_audit_rule(snapshot: BranchSnapshot) -> list[Alert]:
    """Request a physical stock check when inventory discrepancies need verification."""
    if snapshot.data_issue_count == 0:
        return []

    cutoff = _format_time(snapshot.daily_check_cutoff_time)
    can_generate = (
        snapshot.is_after_8pm
        and snapshot.has_today_sales
        and snapshot.has_today_inventory
    )
    status_note = (
        f"Audit sheet ready — daily imports completed after {cutoff}."
        if can_generate
        else (
            f"Audit sheet locked until {cutoff} and today's sales and inventory "
            "imports are confirmed."
        )
    )
    return [
        Alert(
            id="physical_stock_audit",
            severity=WARNING,
            dimension="inventory",
            title="Physical stock audit required",
            summary=(
                f"{snapshot.data_issue_count} inventory discrepancies to verify physically"
            ),
            what_happened=(
                f"The system detected {snapshot.data_issue_count} data quality issues in "
                "inventory (reconciliation mismatches, unlinked products, or negative "
                "stock). Staff must perform a physical shelf count and update the "
                f"external inventory system. {status_note}"
            ),
            recommended_action=(
                "Download checking stock file, conduct physical stock count in shop, "
                "update external POS, and re-import inventory file."
            ),
            link="checking",
            measure="physical_stock_audit",
            facts=_facts(
                _fact("Discrepancy Count", str(snapshot.data_issue_count)),
                _fact("Critical Issues", str(snapshot.critical_data_issue_count)),
                _fact(
                    "Audit Sheet Status",
                    "Ready for download"
                    if can_generate
                    else f"Locked (pending {cutoff} & daily imports)",
                ),
            ),
        )
    ]


def stock_allocation_rule(snapshot: BranchSnapshot) -> list[Alert]:
    """Move 90-day dead stock to branches where the same stock code sells."""
    if not snapshot.stock_allocations:
        return []

    count = len(snapshot.stock_allocations)
    target_branches = sorted(
        {item["target_branch_name"] for item in snapshot.stock_allocations}
    )
    rows = [
        [
            f"{item['stock_code']} · {item['description']}",
            f"{item['on_hand_qty']:,.0f}",
            item["target_branch_name"],
            f"{item['target_sales_90d']:,.0f} sold",
            f"Transfer {item['recommended_transfer_qty']:,.0f}",
        ]
        for item in snapshot.stock_allocations[:5]
    ]
    return [
        Alert(
            id="stock_allocation",
            severity=WARNING,
            dimension="inventory",
            title=(
                f"Stock allocation: {_count_products(count)} dead locally have sales elsewhere"
            ),
            summary=f"Rebalance {count} dead products to {', '.join(target_branches[:2])}",
            what_happened=(
                f"{_count_products(count)} have sat with zero sales in the last 90 days "
                "at this branch while stock remains on hand. Other retail branches "
                f"({', '.join(target_branches)}) are actively selling these exact stock "
                "codes. Transferring these pairs rebalances inventory and frees up tied capital."
            ),
            recommended_action=(
                f"Initiate inter-branch transfer to {', '.join(target_branches)} instead "
                "of ordering new units."
            ),
            link="inventory",
            measure="stock_allocation",
            table={
                "columns": [
                    {"label": "Product", "align": "left"},
                    {"label": "On hand here", "align": "right"},
                    {"label": "Selling branch", "align": "left"},
                    {"label": "Sales (90d)", "align": "right"},
                    {"label": "Recommendation", "align": "right"},
                ],
                "rows": rows,
                "note": (
                    f"Showing top {len(rows)} of {count} transfer opportunities."
                    if count > len(rows)
                    else None
                ),
            },
        )
    ]


def urgent_reorder_rule(snapshot: BranchSnapshot) -> list[Alert]:
    """Flag items with three or fewer days of stock cover for urgent purchasing."""
    if not snapshot.urgent_reorders:
        return []

    count = len(snapshot.urgent_reorders)
    rows = [
        [
            f"{item['stock_code']} · {item['description']}",
            f"{item['on_hand_qty']:,.0f}",
            f"{item['days_left']} days",
            f"Order {item['recommended_reorder_qty']:,.0f}",
        ]
        for item in snapshot.urgent_reorders[:5]
    ]
    return [
        Alert(
            id="urgent_reorder",
            severity=CRITICAL,
            dimension="inventory",
            title=f"Urgent stock reorder required: {_count_products(count)} critical",
            summary=f"{count} products have ≤ 3 days of stock left",
            what_happened=(
                f"{_count_products(count)} are at immediate risk of stocking out based "
                "on recent daily sales run-rates. Immediate supplier replenishment is "
                "required to prevent lost sales."
            ),
            recommended_action=(
                "Create urgent purchase orders for the recommended replenishment quantities."
            ),
            link="inventory",
            measure="urgent_reorder",
            table={
                "columns": [
                    {"label": "Product", "align": "left"},
                    {"label": "In shop", "align": "right"},
                    {"label": "Cover left", "align": "right"},
                    {"label": "Recommended Order", "align": "right"},
                ],
                "rows": rows,
                "note": (
                    f"Showing top {len(rows)} of {count} urgent reorder items."
                    if count > len(rows)
                    else None
                ),
            },
        )
    ]


def footwear_aging_rule(snapshot: BranchSnapshot) -> list[Alert]:
    """Flag footwear held longer than six months for markdown or clearance action."""
    if not snapshot.aged_footwear:
        return []

    count = len(snapshot.aged_footwear)
    oldest = snapshot.aged_footwear[0]
    rows = [
        [
            f"{item['stock_code']} · {item['description']}",
            f"{item['on_hand_qty']:,.0f}",
            f"{item['age_days']} days",
            item["batch_label"],
        ]
        for item in snapshot.aged_footwear[:5]
    ]
    return [
        Alert(
            id="footwear_aging",
            severity=WARNING,
            dimension="inventory",
            title=f"Footwear stock aging > 6 months: {_count_products(count)} at risk",
            summary=f"{count} products held > 180 days without turning over",
            what_happened=(
                f"{_count_products(count)} have been held in inventory for over 180 "
                "days (6 months). In footwear retail, older stock suffers from sole "
                "hydrolysis, glue drying, and fashion obsolescence. "
                f"Oldest item ({oldest['stock_code']}) has been held for "
                f"{oldest['age_days']} days."
            ),
            recommended_action=(
                "Inspect batch receipts, review aging items, and launch clearance "
                "discounts or promotional bundles."
            ),
            link="inventory",
            measure="aging_stock",
            table={
                "columns": [
                    {"label": "Product", "align": "left"},
                    {"label": "In shop", "align": "right"},
                    {"label": "Age", "align": "right"},
                    {"label": "Purchase Origin", "align": "left"},
                ],
                "rows": rows,
                "note": (
                    f"Showing top {len(rows)} of {count} aged items."
                    if count > len(rows)
                    else None
                ),
            },
        )
    ]


def seasonal_demand_spike_rule(snapshot: BranchSnapshot) -> list[Alert]:
    """Highlight products that sold strongly in the equivalent month last year."""
    if not snapshot.seasonal_spikes:
        return []

    count = len(snapshot.seasonal_spikes)
    month_name = snapshot.seasonal_spikes[0]["month_name"]
    rows = [
        [
            f"{item['stock_code']} · {item['description']}",
            f"{item['prior_year_qty']:,.0f} pairs sold",
            f"Surge in {item['month_name']}",
        ]
        for item in snapshot.seasonal_spikes[:5]
    ]
    return [
        Alert(
            id="seasonal_demand_spike",
            severity=NORMAL,
            dimension="sales",
            title=f"Seasonal demand surge: {_count_products(count)} peak in {month_name}",
            summary=f"Prior-year high demand detected for {month_name}",
            what_happened=(
                f"Historical sales analysis indicates that {count} products experienced "
                f"a surge in {month_name} in prior years. Preparing inventory early "
                "prevents supply bottlenecks during the seasonal peak."
            ),
            recommended_action=(
                f"Check stock levels and place advance orders with suppliers for "
                f"{month_name} seasonal styles."
            ),
            link="revenue",
            measure="seasonal_demand",
            table={
                "columns": [
                    {"label": "Product", "align": "left"},
                    {"label": "Prior-Year Sales", "align": "right"},
                    {"label": "Seasonality", "align": "left"},
                ],
                "rows": rows,
                "note": (
                    f"Showing top {len(rows)} of {count} seasonal items."
                    if count > len(rows)
                    else None
                ),
            },
        )
    ]


def weekly_pattern_demand_rule(snapshot: BranchSnapshot) -> list[Alert]:
    """Highlight a strong Saturday/Sunday or peak-day demand pattern."""
    if not snapshot.weekly_pattern:
        return []

    pattern = snapshot.weekly_pattern
    peak_day = pattern["peak_day"]
    share = pattern["weekend_share_pct"]
    return [
        Alert(
            id="weekly_pattern_demand",
            severity=NORMAL,
            dimension="customer",
            title=f"Weekend demand concentration ({share:.0f}% Saturday & Sunday)",
            summary=f"Peak store volume occurs on {peak_day}",
            what_happened=(
                f"Store transaction patterns show that weekend trading accounts for "
                f"{share:.0f}% of weekly footwear sales, peaking on {peak_day} "
                f"({pattern['peak_day_qty']} pairs, vs {pattern['weekday_avg_qty']} "
                "weekday average). Floor shelves risk stockout during peak shopping hours."
            ),
            recommended_action=(
                f"Replenish sales floor and footwear display racks before {peak_day} "
                "store opening."
            ),
            link="customer",
            measure="weekly_pattern",
            facts=_facts(
                _fact("Peak Day", peak_day),
                _fact("Weekend Share", f"{share:.1f}%"),
                _fact("Peak Day Sales", f"{pattern['peak_day_qty']:,.0f} pairs"),
                _fact(
                    "Weekday Average",
                    f"{pattern['weekday_avg_qty']:,.1f} pairs",
                ),
            ),
        )
    ]


def sale_data_quality_rule(snapshot: BranchSnapshot) -> list[Alert]:
    """Raise a critical alert for invalid sale values or missing descriptions only."""
    issues = snapshot.sale_data_quality_issues or {}
    total = issues.get("total_issues", 0)
    if total == 0:
        return []

    numeric_count = issues.get("invalid_numeric_count", 0)
    description_count = issues.get("missing_description_count", 0)
    details = []
    if numeric_count:
        details.append(f"{numeric_count} with zero/negative/invalid numbers")
    if description_count:
        details.append(f"{description_count} with missing description")
    detail = " and ".join(details)
    return [
        Alert(
            id="sale_data_quality",
            severity=CRITICAL,
            dimension="data_quality",
            title="Critical sale data quality issues detected",
            summary=(
                f"{total} sale {'line has' if total == 1 else 'lines have'} invalid "
                f"values ({detail})"
            ),
            what_happened=(
                f"The system detected {total} sale "
                f"{'line' if total == 1 else 'lines'} with data quality issues: "
                f"{detail}. Missing buying prices are excluded. Invalid transaction "
                "numbers distort revenue and inventory calculations."
            ),
            recommended_action=(
                "Open Data Quality to inspect the affected sales lines, revert the "
                "incorrect POS export file, and re-import the corrected file."
            ),
            link="warnings",
            measure="critical_data_issue_count",
            facts=_facts(
                _fact("Invalid Numeric Lines", str(numeric_count)),
                _fact("Missing Descriptions", str(description_count)),
                _fact("Total Flawed Lines", str(total)),
            ),
        )
    ]


def purchase_data_quality_rule(snapshot: BranchSnapshot) -> list[Alert]:
    """Raise a critical alert for invalid purchase quantity/cost or descriptions."""
    issues = snapshot.purchase_data_quality_issues or {}
    total = issues.get("total_issues", 0)
    if total == 0:
        return []

    numeric_count = issues.get("invalid_numeric_count", 0)
    description_count = issues.get("missing_description_count", 0)
    details = []
    if numeric_count:
        details.append(
            f"{numeric_count} with zero/negative/invalid quantity or unit cost"
        )
    if description_count:
        details.append(f"{description_count} with missing description")
    detail = " and ".join(details)
    return [
        Alert(
            id="purchase_data_quality",
            severity=CRITICAL,
            dimension="data_quality",
            title="Critical purchase data quality issues detected",
            summary=(
                f"{total} purchase {'line has' if total == 1 else 'lines have'} "
                f"invalid values ({detail})"
            ),
            what_happened=(
                f"The system detected {total} purchase "
                f"{'line' if total == 1 else 'lines'} with data quality issues: "
                f"{detail}. Zero or negative quantities and costs corrupt inventory "
                "valuation and margin pricing."
            ),
            recommended_action=(
                "Open Data Quality to check supplier invoice numbers, update item "
                "costs/descriptions in the external system, and re-import."
            ),
            link="warnings",
            measure="critical_data_issue_count",
            facts=_facts(
                _fact("Invalid Qty / Cost Lines", str(numeric_count)),
                _fact("Missing Descriptions", str(description_count)),
                _fact("Total Flawed Lines", str(total)),
            ),
        )
    ]


Rule = Callable[[BranchSnapshot], list[Alert]]

RULES: tuple[Rule, ...] = (
    daily_import_missing_rule,
    sale_data_quality_rule,
    purchase_data_quality_rule,
    urgent_reorder_rule,
    stock_allocation_rule,
    footwear_aging_rule,
    physical_stock_audit_rule,
    seasonal_demand_spike_rule,
    weekly_pattern_demand_rule,
)


def evaluate(snapshot: BranchSnapshot) -> list[Alert]:
    alerts = [alert for rule in RULES for alert in rule(snapshot)]
    return sorted(alerts, key=lambda alert: _SEVERITY_RANK[alert.severity])


def build_alerts(snapshot: BranchSnapshot) -> list[dict]:
    return [asdict(alert) for alert in evaluate(snapshot)]
