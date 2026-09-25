"""Operational Business Alerts derived from a branch health snapshot.

Only alerts that lead to a defined retail operation belong here: importing daily data,
fixing invalid sale or purchase data, purchasing/reordering, checking stock, allocating
stock between branches, managing aging inventory, and preparing for known demand.
"""

from dataclasses import asdict, dataclass
from datetime import date
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
    # None for an alert whose action is done off-screen (e.g. urgent reorder): no button.
    link: str | None
    measure: str
    context: str | None = None
    facts: tuple[dict, ...] = ()
    table: dict | None = None
    # For an alert that points at the Warning page: how many days back from today its
    # counts reach, so that page can open on the same stretch of days.
    evidence_days: int | None = None


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
    """After cutoff, require Sale and Inventory to each be current for today —
    one alert per missing type, since they're two separate imports/files with
    their own dimension, not one combined problem."""
    if not snapshot.is_after_8pm:
        return []

    cutoff = _format_time(snapshot.daily_check_cutoff_time)

    def data_state(data_date: str | None) -> str:
        if data_date:
            return f"{data_date} (not today)"
        return "No update today"

    def alert_for(kind: str, dimension: str, is_current: bool, data_date: str | None) -> Alert | None:
        if is_current:
            return None
        # Checked by data date, not by whether anything was imported today: if an
        # older file gets confirmed today, this still fires, since today's own
        # date still has no data. "hasn't been imported" would read as false to
        # someone who just imported *something* today, so the copy below stays
        # to what the check actually knows — today's data is missing or dated.
        # Only name pages that actually exist in the retail nav (Dashboard, Data
        # Overview) — earlier drafts said "Reports" and "today's business
        # summary", neither of which is a screen the user can find or check.
        kind_lower = "sales" if dimension == "sales" else "inventory"
        what_happened = (
            "Until today's sales file is imported, today's numbers won't show "
            "up on the Dashboard or Data Overview."
            if dimension == "sales"
            else (
                "Until today's inventory file is imported, today's stock "
                "levels won't show up on the Dashboard or Data Overview."
            )
        )
        return Alert(
            id=f"daily_import_missing_{dimension}",
            severity=CRITICAL,
            # A missing file is a data problem (it sits under Data quality on the
            # Business Alerts page and stays out of the Summary's decisions), even though
            # the id still says which of sales/inventory it is.
            dimension="data_quality",
            title=f"Today's {kind_lower} data is missing or out of date",
            summary=(
                f"The latest {kind_lower} file on record isn't for today "
                f"(checked after {cutoff})."
            ),
            what_happened=what_happened,
            recommended_action=(
                f"Upload today's {kind_lower} file so today's numbers are complete."
            ),
            link="import",
            measure="daily_import",
            facts=_facts(
                _fact("Store Status", f"Closed (after {cutoff})"),
                _fact(f"Latest {kind} Date", data_state(data_date)),
                _fact("Today's Business Day", date.today().isoformat()),
            ),
        )

    candidates = [
        alert_for("Sale", "sales", snapshot.has_today_sales, snapshot.sales_data_date),
        alert_for(
            "Inventory",
            "inventory",
            snapshot.has_today_inventory,
            snapshot.inventory_data_date,
        ),
    ]
    return [alert for alert in candidates if alert is not None]


def purchase_number_sequence_rule(snapshot: BranchSnapshot) -> list[Alert]:
    """Escalate any missing numbers inside an otherwise known purchase sequence."""
    integrity = snapshot.purchase_number_integrity or {}
    gaps = integrity.get("gaps", [])
    if not gaps:
        return []

    missing_count = integrity.get("missing_number_count", 0)
    gap_count = integrity.get("gap_count", len(gaps))
    sample = gaps[0]

    def range_label_for(gap: dict) -> str:
        start = str(gap["start_number"])
        end = str(gap["end_number"])
        return start if start == end else f"{start}–{end}"

    range_label = range_label_for(sample)
    rows = [
        [
            range_label_for(gap),
            str(gap["missing_count"]),
        ]
        for gap in gaps[:5]
    ]
    return [
        Alert(
            id="purchase_number_sequence_gap",
            severity=CRITICAL,
            dimension="data_quality",
            # The gap in the numbering is a fact; that a file is actually missing is
            # an inference from it, not something confirmed — so this stays a
            # "possible" finding rather than a claim the records are confirmed gone.
            title="Possible missing purchase records",
            summary=(
                f"{missing_count} purchase number{'s' if missing_count != 1 else ''} "
                f"{'appears' if missing_count == 1 else 'appear'} to be missing, "
                f"including {range_label}."
            ),
            what_happened=(
                f"Purchase numbers skip {range_label}. A Purchase Orders file "
                "covering that range may still need to be imported."
            ),
            recommended_action=(
                "Find and import the missing purchase file so the sequence is complete."
            ),
            link="import",
            measure="purchase_number_sequence",
            facts=(),
            table={
                "columns": [
                    {"label": "Missing purchase number or range", "align": "left"},
                    {"label": "Records", "align": "right"},
                ],
                "rows": rows,
                "total_count": missing_count,
                "note": (
                    f"Showing {len(rows)} of {gap_count} missing ranges."
                    if gap_count > len(rows)
                    else None
                ),
            },
        )
    ]


def physical_stock_audit_rule(snapshot: BranchSnapshot) -> list[Alert]:
    """Ask staff to recount the products whose stock records don't add up.

    The alert carries the list itself, not a pointer to another screen: the products to
    count, and an Excel copy to take to the shelf with a blank column for the count.
    """
    items = snapshot.checking_items
    if not items:
        return []

    count = len(items)
    # The last column is left empty on purpose — it is where the count gets written.
    rows = [
        [
            str(item["stock_code"]),
            str(item["description"] or "—"),
            "—" if item["on_hand_qty"] is None else f"{item['on_hand_qty']:,.0f}",
            "",
        ]
        for item in items
    ]
    return [
        Alert(
            id="physical_stock_audit",
            severity=WARNING,
            dimension="inventory",
            title="Physical stock count is required",
            summary=(
                f"{count} product{'s' if count != 1 else ''} "
                f"{'need' if count != 1 else 'needs'} to be counted in the shop."
            ),
            what_happened=(
                "The system found inventory records that don't match expected "
                "stock. Please verify the actual shelf quantity before updating "
                "inventory."
            ),
            recommended_action=(
                "Count these products and upload the file to match actual stock."
            ),
            link="checking",
            measure="physical_stock_audit",
            table={
                "columns": [
                    {"label": "Stock Code", "align": "left"},
                    {"label": "Description", "align": "left"},
                    {"label": "System Qty", "align": "right"},
                    {"label": "Actual Count", "align": "right"},
                ],
                # Every product: the panel shows the list in a fixed, scrolling window.
                "rows": rows,
                "export_rows": rows,
                "note": None,
            },
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
        for item in snapshot.stock_allocations
    ]
    return [
        Alert(
            id="stock_allocation",
            severity=WARNING,
            dimension="inventory",
            title="Move slow-moving stock to another branch",
            summary=(
                f"{count} product{'s' if count != 1 else ''} "
                f"{'are' if count != 1 else 'is'} selling in other branches but not here."
            ),
            what_happened=(
                "These products haven't sold in this branch for the last 90 days, "
                f"while other branches ({', '.join(target_branches)}) are actively "
                "selling the same items."
            ),
            recommended_action=(
                f"Move the suggested units to {', '.join(target_branches)} to use stock that sells."
            ),
            link="inventory",
            measure="stock_allocation",
            table={
                "columns": [
                    {"label": "Product", "align": "left"},
                    {"label": "In stock", "align": "right"},
                    {"label": "Selling branch", "align": "left"},
                    {"label": "Sales (90d)", "align": "right"},
                    {"label": "Recommendation", "align": "right"},
                ],
                "rows": rows,
                "export_rows": rows,
            },
        )
    ]


def urgent_reorder_rule(snapshot: BranchSnapshot) -> list[Alert]:
    """Flag best sellers that are out of stock — the Reorder page's "Urgent Reorder" list."""
    if not snapshot.urgent_reorders:
        return []

    count = len(snapshot.urgent_reorders)
    rows = [
        [
            f"{item['stock_code']} · {item['description']}",
            f"{item['on_hand_qty']:,.0f}",
            f"{item['avg_monthly_sales']:,.1f}",
            f"Order {item['recommended_reorder_qty']:,.0f}",
        ]
        for item in snapshot.urgent_reorders
    ]
    return [
        Alert(
            id="urgent_reorder",
            severity=CRITICAL,
            dimension="reorder",
            title=f"Urgent reorder needed for {_count_products(count)}",
            summary=(
                f"{count} best-selling product{'s are' if count != 1 else ' is'} "
                "out of stock."
            ),
            what_happened=(
                "These are among your top sellers and there is none left on the "
                "shelf, so every day without them is lost sales."
            ),
            recommended_action="Reorder these products at the recommended quantity.",
            link=None,
            measure="urgent_reorder",
            table={
                "columns": [
                    {"label": "Product", "align": "left"},
                    {"label": "In stock", "align": "right"},
                    {"label": "Sold per month", "align": "right"},
                    {"label": "Recommended Order", "align": "right"},
                ],
                "rows": rows,
                "export_rows": rows,
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
        for item in snapshot.aged_footwear
    ]
    return [
        Alert(
            id="footwear_aging",
            severity=WARNING,
            dimension="inventory",
            title="Old stock has been sitting for over 6 months",
            summary=(
                f"{count} product{'s' if count != 1 else ''} "
                f"{'have' if count != 1 else 'has'} stayed in stock for more than "
                "180 days."
            ),
            what_happened=(
                "Older footwear becomes harder to sell over time and may lose "
                "value if it stays in storage too long. The oldest item has been "
                f"in stock for {oldest['age_days']} days."
            ),
            recommended_action="Put these products on promotion or clearance to help them sell.",
            link="agedStock",
            measure="aging_stock",
            table={
                "columns": [
                    {"label": "Product", "align": "left"},
                    {"label": "In stock", "align": "right"},
                    {"label": "Age", "align": "right"},
                    {"label": "Last Purchased", "align": "left"},
                ],
                "rows": rows,
                "export_rows": rows,
            },
        )
    ]


def seasonal_demand_spike_rule(snapshot: BranchSnapshot) -> list[Alert]:
    """Highlight products that sold strongly in the equivalent month last year."""
    if not snapshot.seasonal_spikes:
        return []

    month_name = snapshot.seasonal_spikes[0]["month_name"]
    rows = [
        [
            f"{item['stock_code']} · {item['description']}",
            f"{item['prior_year_qty']:,.0f} pairs sold",
            f"Surge in {item['month_name']}",
        ]
        for item in snapshot.seasonal_spikes
    ]
    return [
        Alert(
            id="seasonal_demand_spike",
            severity=NORMAL,
            dimension="sales",
            title=f"Prepare for higher demand in {month_name}",
            summary=f"Last year's sales were strong in {month_name}.",
            what_happened=(
                f"These products each sold at least 5 units in {month_name} last "
                "year. If the same pattern repeats, stock may run low if it "
                "isn't ordered ahead of time."
            ),
            recommended_action=(
                f"Check stock and order before {month_name} to prepare for demand."
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
                "export_rows": rows,
            },
        )
    ]


def weekly_pattern_demand_rule(snapshot: BranchSnapshot) -> list[Alert]:
    """Highlight a strong weekend or peak-day demand pattern."""
    if not snapshot.weekly_pattern:
        return []

    pattern = snapshot.weekly_pattern
    peak_day = pattern["peak_day"]
    peak_qty = float(pattern["peak_day_qty"])
    weekday_avg = float(pattern["weekday_avg_qty"])
    above_weekday_pct = (
        ((peak_qty - weekday_avg) / weekday_avg) * 100
        if weekday_avg > 0
        else None
    )
    comparison = (
        f"{above_weekday_pct:.0f}% higher than weekdays"
        if above_weekday_pct is not None
        else "higher than weekdays"
    )
    facts = [
        _fact("Busiest Day", peak_day),
        _fact("Peak Day Sales", f"{peak_qty:,.0f} pairs"),
        _fact("Weekday Average", f"{weekday_avg:,.1f} pairs"),
    ]

    return [
        Alert(
            id="weekly_pattern_demand",
            severity=NORMAL,
            dimension="customer",
            # This fires on either of two separate conditions — weekend trade is at
            # least 35% of the week, or one single day sells at least 1.8x a normal
            # weekday — and `peak_day` is whichever day actually sold the most,
            # which is not always a weekend day even when the alert fires from the
            # weekend-share condition. So the copy names that day rather than
            # assuming "weekend", which would misdescribe a weekday-peak case.
            title=f"{peak_day} is your busiest day",
            summary=f"{peak_day} sales are {comparison}.",
            what_happened=(
                f"{peak_day}: {peak_qty:,.0f} pairs vs {weekday_avg:,.1f} on a "
                "typical weekday."
            ),
            recommended_action=f"Restock before {peak_day} to avoid running out.",
            link="customer",
            measure="weekly_pattern",
            facts=_facts(*facts),
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

    rows = []
    for item in issues.get("sample_numeric", []):
        qty_val = item.get("qty")
        price_val = item.get("selling_price")
        issue_detail = []
        if qty_val is not None and qty_val <= 0:
            issue_detail.append(f"Qty: {qty_val:,.0f}")
        if price_val is not None and price_val <= 0:
            issue_detail.append(f"Price: {price_val:,.0f}")
        reason = ", ".join(issue_detail) if issue_detail else "Invalid numeric value"
        rows.append([
            str(item.get("slip_number") or item.get("slip_id") or "—"),
            str(item.get("stock_code") or "—"),
            "Invalid Number",
            reason,
        ])
    for item in issues.get("sample_missing_desc", []):
        rows.append([
            str(item.get("slip_number") or item.get("slip_id") or "—"),
            str(item.get("stock_code") or "—"),
            "Missing Description",
            "Description is blank",
        ])

    table = None
    if rows:
        table = {
            "columns": [
                {"label": "Slip #", "align": "left"},
                {"label": "Stock Code", "align": "left"},
                {"label": "Issue", "align": "left"},
                {"label": "Details", "align": "left"},
            ],
            "rows": rows,
            "export_rows": rows,
        }

    return [
        Alert(
            id="sale_data_quality",
            severity=CRITICAL,
            dimension="data_quality",
            title="Sales data needs to be fixed",
            summary=(
                f"{total} sales {'line' if total == 1 else 'lines'} "
                f"{'contains' if total == 1 else 'contain'} invalid values ({detail})."
            ),
            what_happened=(
                "Some sales lines have invalid values (quantity, price, or "
                "amount) or are missing a product description, which can make "
                "the numbers on the Dashboard and Data Overview wrong."
            ),
            recommended_action=(
                "Fix these sales records and upload the file again so numbers are accurate."
            ),
            link=None,
            measure="critical_data_issue_count",
            evidence_days=snapshot.sale_check_days,
            facts=(),
            table=table,
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
            title="Purchase data needs attention",
            summary=(
                f"{total} purchase {'line' if total == 1 else 'lines'} "
                f"{'contains' if total == 1 else 'contain'} invalid quantities or "
                f"costs ({detail})."
            ),
            what_happened=(
                "Some purchase lines have invalid quantities or unit costs, or "
                "are missing a product description, which can make product "
                "costs and stock value on the Dashboard wrong."
            ),
            recommended_action=(
                "Fix these purchase records and upload the file again so costs stay accurate."
            ),
            link="warnings",
            measure="critical_data_issue_count",
            evidence_days=snapshot.purchase_check_days,
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
    purchase_number_sequence_rule,
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
