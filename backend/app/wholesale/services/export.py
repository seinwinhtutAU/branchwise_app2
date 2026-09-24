"""Turns every wholesale record into flat tables for analysis in Excel, pandas or a BI tool.

The rows handed in are the same dicts the list endpoints send the screens (see
routers/export.py), so every status, total and balance in the export is the one the app
itself shows — nothing here recomputes a business rule. Two things are worked out only
here, and only because a flat table needs them: a line's amount (quantity x price in the
unit the price was quoted in) and the per-colour split of a colour string.

Each table has one row per real-world fact (a voucher line, a payment, a delivered
package...). Money totals live only on the header tables (Vouchers, Orders), never
repeated on the line tables, so summing a column can never double-count.
"""

import csv
import io
import zipfile
from dataclasses import dataclass
from datetime import date, datetime
from typing import Any, Callable

from openpyxl import Workbook
from openpyxl.styles import Alignment, Font, PatternFill
from openpyxl.utils import get_column_letter

from app.wholesale.models.entities import WholesaleUnit
from app.wholesale.services.colors import parse_color_qty
from app.wholesale.services.units import PAIRS_PER, priced_amount

DEFAULT_RATES = {unit.value: pairs for unit, pairs in PAIRS_PER.items()}

TEXT, INT, MONEY, DATE, DECIMAL, YESNO = "text", "int", "money", "date", "decimal", "yesno"
_NUMBER_FORMATS = {INT: "#,##0", MONEY: "#,##0", DATE: "yyyy-mm-dd", DECIMAL: "#,##0.0"}


@dataclass
class Column:
    header: str
    kind: str
    get: Callable[[dict], Any]


@dataclass
class Table:
    name: str
    columns: list[Column]
    rows: list[dict]
    about: str


def _key(name: str, kind: str = TEXT, header: str | None = None) -> Column:
    return Column(header or name.replace("_", " ").capitalize(), kind, lambda row, n=name: row.get(n))


def _sets(pairs: Any, rates: dict | None) -> float | None:
    if pairs is None:
        return None
    return round(pairs / (rates or DEFAULT_RATES)["set"], 2)


def _pairs_to_sets(name: str = "quantity_pairs", header: str = "Sets") -> Column:
    return Column(header, DECIMAL, lambda row: _sets(row.get(name), row.get("unit_conversions")))


def _as_date(value: Any) -> date | None:
    if value in (None, ""):
        return None
    if isinstance(value, datetime):
        return value.date()
    if isinstance(value, date):
        return value
    return date.fromisoformat(str(value)[:10])


def _payment_status(order: dict) -> str:
    if order.get("order_status") == "cancelled":
        return "cancelled"
    if order["balance_due"] <= 0:
        return "paid"
    return "partial" if order["paid_amount"] > 0 else "unpaid"


def _line_amount(line: dict, price_key: str) -> float:
    unit = WholesaleUnit(line["unit"])
    return round(priced_amount(line["quantity_pairs"], unit, line[price_key], line.get("unit_conversions")), 2)


def _colour_rows(source: str, reference: str, when: Any, party: str, location: str, line: dict, text: str) -> list[dict]:
    """One row per colour in a colour string such as "black3s,white2p", counted in pairs."""
    rates = line.get("unit_conversions") or DEFAULT_RATES
    rows = []
    for entry in parse_color_qty(text or ""):
        if entry.qty <= 0:
            continue
        pairs = entry.qty * rates[entry.unit.value] if entry.unit else entry.qty
        rows.append({
            "source": source, "reference": reference, "date": when, "party": party, "location": location,
            "stock_code": line["stock_code"], "description": line.get("description", ""),
            "product_group": line.get("product_group", ""), "color": entry.color, "pairs": pairs,
            "sets": round(pairs / rates["set"], 2),
        })
    return rows


def build_tables(data: dict[str, Any]) -> list[Table]:
    vouchers, shipments, receivings = data["vouchers"], data["shipments"], data["receivings"]
    orders, movements, stock = data["orders"], data["movements"], data["stock"]

    voucher_lines = [{**line, "voucher": v} for v in vouchers for line in v["lines"]]
    supplier_payments = [{**p, "voucher": v} for v in vouchers for p in v["payment"]["payments"]]
    legs = [{**leg, "shipment": s} for s in shipments for leg in s["legs"]]
    receiving_items = [
        {**item, "package": p, "receiving": r} for r in receivings for p in r["packages"] for item in p["items"]
    ]
    receiving_costs = [{**c, "receiving": r} for r in receivings for c in r["costs"]]
    order_lines = [{**line, "order": o} for o in orders for line in o["lines"]]
    customer_payments = [{**p, "order": o} for o in orders for p in o["payment"]["payments"]]
    stock_locations = [{**loc, "stock": s} for s in stock for loc in s["locations"]]
    shipment_no_by_id = {s["shipment_id"]: s["shipment_no"] for s in shipments}

    colour_detail: list[dict] = []
    for v in vouchers:
        for line in v["lines"]:
            colour_detail += _colour_rows("Supplier voucher (ordered from factory)", v["voucher_no"], v["voucher_date"],
                                          v["supplier_name"], "", line, line["color_breakdown"])
    for r in receivings:
        for p in r["packages"]:
            if not p["opened"]:
                continue
            for item in p["items"]:
                colour_detail += _colour_rows("Received at gate", r["receiving_no"], p["received_on"] or r["received_on"],
                                              r["supplier_name"], r["gate"], item, item["color_breakdown"])
    for o in orders:
        for line in o["lines"]:
            colour_detail += _colour_rows("Customer order", o["order_no"], o["order_date"], o["customer_name"], "",
                                          line, line["color_breakdown"])
    for m in movements:
        if m["movement_type"] == "out":
            colour_detail += _colour_rows("Delivered to customer", m["reference"], m["moved_on"],
                                          m.get("counterparty_name", ""), m["location"], m, m["color_breakdown"])

    v = lambda name, kind=TEXT, header=None: Column(  # noqa: E731 - a voucher field on a line row
        header or name.replace("_", " ").capitalize(), kind, lambda row, n=name: row["voucher"].get(n))
    o = lambda name, kind=TEXT, header=None: Column(  # noqa: E731 - an order field on a line row
        header or name.replace("_", " ").capitalize(), kind, lambda row, n=name: row["order"].get(n))
    r = lambda name, kind=TEXT, header=None: Column(  # noqa: E731 - a receiving field on an item row
        header or name.replace("_", " ").capitalize(), kind, lambda row, n=name: row["receiving"].get(n))

    tables = [
        Table("Vouchers", [
            _key("voucher_no", header="Voucher no"), _key("voucher_date", DATE, "Voucher date"),
            _key("supplier_name", header="Supplier"), _key("carrier_name", header="Cargo company"),
            _key("status"), _key("total_packages", INT, "Packages"),
            _key("total_quantity_pairs", INT, "Ordered pairs"), _key("received_quantity_pairs", INT, "Received pairs"),
            _key("lost_quantity_pairs", INT, "Written-off pairs"), _key("remaining_quantity_pairs", INT, "Still to arrive pairs"),
            _key("total_amount", MONEY, "Total (Ks)"), _key("paid_amount", MONEY, "Paid (Ks)"),
            _key("balance_due", MONEY, "Balance owed to supplier (Ks)"),
        ], vouchers, "One row per supplier voucher (what was bought from a factory), with what is paid and still owed."),
        Table("Voucher Lines", [
            v("voucher_no", header="Voucher no"), v("voucher_date", DATE, "Voucher date"),
            v("supplier_name", header="Supplier"), v("status", header="Voucher status"),
            _key("stock_code", header="Stock code"), _key("description"), _key("product_group", header="Group"),
            _key("color_breakdown", header="Colours"), _key("quantity_pairs", INT, "Ordered pairs"),
            _pairs_to_sets("quantity_pairs", "Ordered sets"), _key("received_quantity_pairs", INT, "Received pairs"),
            _key("lost_quantity_pairs", INT, "Written-off pairs"), _key("remaining_quantity_pairs", INT, "Still to arrive pairs"),
            _key("unit", header="Price quoted per"), _key("buying_price", MONEY, "Buying price (Ks)"),
            Column("Line amount (Ks)", MONEY, lambda row: _line_amount(row, "buying_price")),
        ], voucher_lines, "One row per product on a supplier voucher."),
        Table("Supplier Payments", [
            v("voucher_no", header="Voucher no"), v("supplier_name", header="Supplier"),
            _key("paid_on", DATE, "Paid on"), _key("amount", MONEY, "Amount (Ks)"), _key("note"),
        ], supplier_payments, "One row per payment made to a factory."),
        Table("Shipments", [
            _key("shipment_no", header="Shipment no"), _key("voucher_no", header="Voucher no"),
            _key("supplier_name", header="Supplier"), _key("carrier_name", header="Cargo company"),
            _key("final_destination", header="Final gate"), _key("sent_on", DATE, "Sent on"),
            _key("shipment_status", header="Status"), _key("total_packages", INT, "Packages"),
            _key("total_quantity_pairs", INT, "Pairs"), _key("packages_sent_by_cargo", INT, "Packages sent by cargo"),
            _key("final_received_packages", INT, "Packages received at gate"),
            _key("lost_packages", INT, "Packages lost"), _key("final_remaining", INT, "Packages still on the way"),
            Column("Split from shipment", TEXT, lambda row: shipment_no_by_id.get(row.get("split_from_shipment_id"), "")),
        ], shipments, "One row per shipment (a voucher's goods travelling as freight)."),
        Table("Shipment Legs", [
            Column("Shipment no", TEXT, lambda row: row["shipment"]["shipment_no"]),
            Column("Supplier", TEXT, lambda row: row["shipment"]["supplier_name"]),
            _key("stop_name", header="Stop"), _key("carrier_name", header="Carrier"),
            _key("packages_received", INT, "Packages received"), _key("packages_sent", INT, "Packages sent on"),
            _key("lost_packages", INT, "Packages lost"),
        ], legs, "One row per stop a shipment passes through before its gate."),
        Table("Receivings", [
            _key("receiving_no", header="Receiving no"), _key("shipment_no", header="Shipment no"),
            _key("voucher_no", header="Voucher no"), _key("supplier_name", header="Supplier"), _key("gate", header="Gate"),
            _key("received_on", DATE, "Received on"), _key("receiving_status", header="Status"),
            _key("total_packages", INT, "Packages"), _key("opened_package_count", INT, "Packages opened"),
            _key("expected_quantity_pairs", INT, "Expected pairs"), _key("counted_quantity_pairs", INT, "Counted pairs"),
            _key("quantity_difference_pairs", INT, "Difference pairs"), _key("total_cost", MONEY, "Total cost (Ks)"),
        ], receivings, "One row per receiving (goods counted in at a gate)."),
        Table("Receiving Items", [
            r("receiving_no", header="Receiving no"), r("shipment_no", header="Shipment no"), r("gate", header="Gate"),
            Column("Package no", INT, lambda row: row["package"]["package_no"]),
            Column("Received on", DATE, lambda row: row["package"]["received_on"]),
            _key("stock_code", header="Stock code"), _key("description"), _key("product_group", header="Group"),
            _key("color_breakdown", header="Colours"), _key("quantity_pairs", INT, "Pairs"), _pairs_to_sets(),
        ], receiving_items, "One row per product counted out of an opened package."),
        Table("Receiving Costs", [
            r("receiving_no", header="Receiving no"), r("shipment_no", header="Shipment no"), r("supplier_name", header="Supplier"),
            _key("cost_date", DATE, "Date"), _key("stage"), _key("carrier"), _key("kind", header="Kind"),
            _key("amount", MONEY, "Cost (Ks)"), _key("note"),
        ], receiving_costs, "One row per cost of getting a shipment in (cargo fee, carrier fee, porters...)."),
        Table("Orders", [
            _key("order_no", header="Order no"), _key("order_date", DATE, "Order date"),
            _key("customer_name", header="Customer"), _key("customer_phone", header="Phone"),
            _key("customer_address", header="Address"), _key("order_status", header="Order status"),
            Column("Payment status", TEXT, _payment_status), _key("total_quantity_pairs", INT, "Ordered pairs"),
            _key("delivered_quantity_pairs", INT, "Delivered pairs"), _key("lost_quantity_pairs", INT, "Written-off pairs"),
            _key("remaining_quantity_pairs", INT, "Still to deliver pairs"), _key("total_amount", MONEY, "Total (Ks)"),
            _key("paid_amount", MONEY, "Paid (Ks)"), _key("balance_due", MONEY, "Balance owed by customer (Ks)"),
        ], orders, "One row per customer order, with what is paid and still owed."),
        Table("Order Lines", [
            o("order_no", header="Order no"), o("order_date", DATE, "Order date"), o("customer_name", header="Customer"),
            o("order_status", header="Order status"), _key("stock_code", header="Stock code"), _key("description"),
            _key("product_group", header="Group"), _key("supplier_name", header="Supplier"),
            _key("color_breakdown", header="Colours"), _key("quantity_pairs", INT, "Ordered pairs"),
            _pairs_to_sets("quantity_pairs", "Ordered sets"), _key("allocated_quantity_pairs", INT, "Set aside pairs"),
            _key("delivered_quantity_pairs", INT, "Delivered pairs"), _key("lost_quantity_pairs", INT, "Written-off pairs"),
            _key("remaining_quantity_pairs", INT, "Still to deliver pairs"), _key("unit", header="Price quoted per"),
            _key("selling_price", MONEY, "Selling price (Ks)"),
            Column("Line amount (Ks)", MONEY, lambda row: _line_amount(row, "selling_price")),
        ], order_lines, "One row per product on a customer order."),
        Table("Customer Payments", [
            o("order_no", header="Order no"), o("customer_name", header="Customer"),
            _key("paid_on", DATE, "Paid on"), _key("amount", MONEY, "Amount (Ks)"), _key("note"),
        ], customer_payments, "One row per payment received from a customer."),
        Table("Stock Movements", [
            _key("moved_on", DATE, "Date"), _key("movement_type", header="Type (in / out / allocated)"),
            _key("stock_code", header="Stock code"), _key("description"), _key("product_group", header="Group"),
            _key("color_breakdown", header="Colours"), _key("quantity_pairs", INT, "Pairs"), _pairs_to_sets(),
            _key("location", header="Gate"), _key("reference", header="Reference"),
            _key("counterparty_name", header="Supplier / customer"), _key("note"),
        ], movements, "Every time stock came in to a gate, went out to a customer or was set aside for an order."),
        Table("Stock Now", [
            _key("stock_code", header="Stock code"), _key("description"), _key("product_group", header="Group"),
            _key("status"), _key("on_hand_pairs", INT, "On hand pairs"), _key("allocated_pairs", INT, "Set aside pairs"),
            _key("available_pairs", INT, "Free pairs"), _key("at_supplier_pairs", INT, "At supplier pairs"),
            _key("in_transit_pairs", INT, "In transit pairs"), _key("customer_ordered_pairs", INT, "Ordered by customers pairs"),
            _key("owed_to_customers_pairs", INT, "Still owed to customers pairs"),
            _key("delivered_pairs", INT, "Delivered pairs"), _key("lost_pairs", INT, "Written-off pairs"),
            _key("colors", header="Colours on hand"), _key("last_activity_on", DATE, "Last activity"),
        ], stock, "One row per product: where all of its stock stands right now."),
        Table("Stock By Gate", [
            Column("Stock code", TEXT, lambda row: row["stock"]["stock_code"]),
            Column("Description", TEXT, lambda row: row["stock"]["description"]),
            Column("Group", TEXT, lambda row: row["stock"]["product_group"]),
            _key("location", header="Gate"), _key("on_hand_pairs", INT, "On hand pairs"),
            _key("colors", header="Colours on hand"), _key("last_moved_on", DATE, "Last moved"),
        ], stock_locations, "One row per product per gate holding it."),
        Table("Colour Detail", [
            _key("source", header="Source"), _key("reference", header="Reference"), _key("date", DATE, "Date"),
            _key("party", header="Supplier / customer"), _key("location", header="Gate"),
            _key("stock_code", header="Stock code"), _key("description"), _key("product_group", header="Group"),
            _key("color", header="Colour"), _key("pairs", INT, "Pairs"), _key("sets", DECIMAL, "Sets"),
        ], colour_detail, "Every colour split out on its own row (ordered, received, sold, delivered) for colour analysis."),
        Table("Customer Balances", [
            _key("order_no", header="Order no"), _key("customer_name", header="Customer"),
            _key("order_date", DATE, "Order date"), _key("total_pairs", INT, "Ordered pairs"),
            _key("delivered_pairs", INT, "Delivered pairs"), _key("total_amount", MONEY, "Total (Ks)"),
            _key("paid_amount", MONEY, "Paid (Ks)"), _key("balance", MONEY, "Balance (Ks)"),
            _key("payment_status", header="Payment status"), _key("package_status", header="Delivery / payment position"),
        ], data["finance"], "The Finance screen's per-order receivables."),
        Table("Write-offs", [
            _key("created_at", DATE, "Date"), _key("subject_type", header="Applies to"),
            _key("reference", header="Reference"), _key("description"), _key("stock_code", header="Stock code / voucher"),
            _key("quantity", INT, "Quantity"),
            Column("Unit", TEXT, lambda row: "package" if row["unit"] == "package" else "pairs"),
            _key("reason"), _key("note"),
        ], data["write_offs"], "Goods that will never arrive or be delivered, with the reason."),
        Table("Products", [
            _key("stock_code", header="Stock code"), _key("description"), _key("product_group", header="Group"),
            _key("default_unit", header="Default unit"), _key("active", YESNO, "Active"),
        ], data["products"], "The product catalogue."),
        Table("Suppliers", [
            _key("name"), _key("phone"), _key("address"), _key("active", YESNO, "Active"),
        ], data["suppliers"], "Factories goods are bought from."),
        Table("Customers", [
            _key("name"), _key("phone"), _key("address"), _key("active", YESNO, "Active"),
        ], data["customers"], "Customers who order."),
        Table("Places And Carriers", [
            _key("list", header="List"), _key("name"), _key("active", YESNO, "Active"),
        ], data["named_lists"], "Cargo companies, carriers, destinations and receiving gates."),
    ]
    return tables


def _cell(value: Any, kind: str) -> Any:
    if value is None:
        return None
    if kind == DATE:
        return _as_date(value)
    if kind == YESNO:
        return "Yes" if value else "No"
    if kind in (INT, MONEY, DECIMAL):
        return float(value) if kind != INT else int(value)
    if hasattr(value, "value"):  # an Enum
        return value.value
    return value


def _readme_rows(tables: list[Table], exported_at: datetime, scope: str) -> list[list[Any]]:
    lines: list[list[Any]] = [
        ["Wholesale data export"], [f"Exported {exported_at:%Y-%m-%d %H:%M} — {scope}"], [],
        ["How to read it"],
        ["Quantities are stored in pairs (1 set = 6 pairs, 1 dozen = 12); sets are shown beside pairs where useful."],
        ["Money is in Myanmar Kyat (Ks). Prices are quoted per the unit shown in 'Price quoted per'; 'Line amount' already does the maths."],
        ["Order and voucher totals sit only on the Orders / Vouchers sheets, never repeated on the line sheets, so sums never double-count."],
        ["Status columns are the same ones the app shows on its screens."],
        [], ["Sheet", "Rows", "What is in it"],
    ]
    lines += [[t.name, len(t.rows), t.about] for t in tables]
    return lines


def build_xlsx(tables: list[Table], exported_at: datetime, scope: str) -> bytes:
    workbook = Workbook()
    readme = workbook.active
    readme.title = "Read Me"
    for row in _readme_rows(tables, exported_at, scope):
        readme.append(row)
    readme["A1"].font = Font(bold=True, size=14)
    readme["A4"].font = Font(bold=True)
    for cell in readme[9]:
        cell.font = Font(bold=True)
    readme.column_dimensions["A"].width = 24
    readme.column_dimensions["B"].width = 10
    readme.column_dimensions["C"].width = 100

    header_fill = PatternFill("solid", fgColor="1F4E79")
    for table in tables:
        sheet = workbook.create_sheet(table.name)
        sheet.append([c.header for c in table.columns])
        for cell in sheet[1]:
            cell.font = Font(bold=True, color="FFFFFF")
            cell.fill = header_fill
            cell.alignment = Alignment(vertical="center", wrap_text=True)
        widths = [len(c.header) for c in table.columns]
        for row in table.rows:
            values = [_cell(c.get(row), c.kind) for c in table.columns]
            sheet.append(values)
            for index, (column, value) in enumerate(zip(table.columns, values)):
                cell = sheet.cell(row=sheet.max_row, column=index + 1)
                if column.kind in _NUMBER_FORMATS:
                    cell.number_format = _NUMBER_FORMATS[column.kind]
                widths[index] = max(widths[index], len(str(value)) if value is not None else 0)
        for index, width in enumerate(widths, start=1):
            sheet.column_dimensions[get_column_letter(index)].width = min(max(width + 2, 10), 46)
        sheet.freeze_panes = "A2"
        if table.rows:
            sheet.auto_filter.ref = sheet.dimensions

    buffer = io.BytesIO()
    workbook.save(buffer)
    return buffer.getvalue()


def build_csv_zip(tables: list[Table], exported_at: datetime, scope: str) -> bytes:
    """One UTF-8 CSV per table, ISO dates and plain numbers so pandas/R/BI tools read
    them without a format guess. The BOM lets Excel open them without garbling text."""
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w", zipfile.ZIP_DEFLATED) as archive:
        readme = io.StringIO()
        csv.writer(readme).writerows(_readme_rows(tables, exported_at, scope))
        archive.writestr("00 read me.csv", "﻿" + readme.getvalue())
        for number, table in enumerate(tables, start=1):
            out = io.StringIO()
            writer = csv.writer(out)
            writer.writerow([c.header for c in table.columns])
            for row in table.rows:
                writer.writerow(
                    [("" if (v := _cell(c.get(row), c.kind)) is None else v.isoformat() if isinstance(v, date) else v)
                     for c in table.columns]
                )
            archive.writestr(f"{number:02d} {table.name.lower()}.csv", "﻿" + out.getvalue())
    return buffer.getvalue()
