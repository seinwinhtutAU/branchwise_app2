"""Builds scripts/data/wholesale_demo.json: two months of made-up wholesale trading.

The data is simulated day by day rather than random rows, so every figure ties out the way
the app's own rules need it to: a delivery only leaves stock a package has already brought
in, a voucher's received quantity is what its receiving packages hold, payments never pass
what is owed, and nothing is dated after "today". Run it again to regenerate the file
(the seed is fixed, so the same file comes out each time), then load it with
scripts/seed_wholesale_demo.py.

    python backend/scripts/build_wholesale_demo_data.py

Everything is counted in sets and priced per set, matching how the screens take entry.
"""

import json
import random
from collections import defaultdict
from datetime import date, timedelta
from pathlib import Path

OUT = Path(__file__).parent / "data" / "wholesale_demo.json"
TODAY = date(2026, 9, 24)
START = date(2026, 7, 24)
rnd = random.Random(2026)

GOODY, LEK, PANDA, MALDINI, STAR = "Goody Factory", "Lek", "Panda Shoes", "Maldini", "Star Footwear"
SHWE, AYAR, TIGER = "Shwe Moe Cargo", "Ayar Cargo", "Tiger Cargo"
MAW, MAG, MDY = "Bogyoke Rd, Mawlamyine", "Zay Gyi St, Magway", "78th St, Mandalay"
CARRIERS = ["U Hla Myint", "Ko Zaw Lin", "Ma Khin Khin"]

SUPPLIERS = {
    GOODY: ("09-5000-1111", "Bangkok", SHWE),
    LEK: ("09-5000-2222", "Bangkok", AYAR),
    PANDA: ("09-5000-3333", "Guangzhou", TIGER),
    MALDINI: ("09-5000-4444", "Bangkok", SHWE),
    STAR: ("09-5000-5555", "Guangzhou", AYAR),
}
CARGO_RATE = {SHWE: 24000, AYAR: 28000, TIGER: 26000}  # per package

# code: (description, group, supplier, colours, buying price per set, gates it is stocked at)
PRODUCTS = {
    "A1001": ("Men's leather sandal", "man", GOODY, ["black", "white", "brown"], 108000, [MAW, MAG]),
    "A1002": ("Men's slipper", "man", GOODY, ["white", "pink", "grey"], 120000, [MAW]),
    "A1003": ("Men's sports shoe", "man", GOODY, ["black", "grey", "navy"], 132000, [MAG, MDY]),
    "A1004": ("Men's canvas shoe", "man", STAR, ["navy", "black", "beige"], 96000, [MDY]),
    "B2001": ("Ladies' flat sandal", "lady", LEK, ["brown", "black", "beige"], 117000, [MAG, MAW]),
    "B2002": ("Ladies' heel sandal", "lady", LEK, ["black", "beige", "red"], 126000, [MAW, MDY]),
    "B2003": ("Ladies' wedge sandal", "lady", LEK, ["black", "white", "pink"], 138000, [MDY]),
    "C3001": ("Kids' school shoe", "child", PANDA, ["navy", "black"], 102000, [MAG]),
    "C3002": ("Kids' sandal", "child", PANDA, ["red", "white", "blue"], 102000, [MAG, MAW]),
    "C3003": ("Kids' sports shoe", "child", PANDA, ["blue", "grey", "black"], 114000, [MDY, MAW]),
    "D4001": ("Ladies' rubber slipper", "lady", MALDINI, ["beige", "pink", "black"], 114000, [MAW]),
    "D4002": ("Ladies' beach slipper", "lady", MALDINI, ["white", "pink", "blue"], 90000, [MAG, MDY]),
    "D4003": ("Men's rubber slipper", "man", MALDINI, ["black", "grey", "navy"], 96000, [MDY]),
    "E5001": ("Kids' rain boot", "child", STAR, ["red", "blue", "yellow"], 126000, [MAW, MAG]),
}

# name: (phone, address, the gate that serves them)
CUSTOMERS = {
    "KKNN": ("09-4500-45678", "Shwe Taung St, Mawlamyine", MAW),
    "Ma Su Su Hlaing": ("09-4500-12345", "No. 24, Bogyoke Rd, Mawlamyine", MAW),
    "Ko Zin Min Htet": ("09-4500-77821", "Zeyar Thiri Market, Mawlamyine", MAW),
    "Ko Kaung Htet": ("09-7800-34567", "Zay Gyi Market, Magway", MAG),
    "U Tun Tun": ("09-7900-22334", "Main Rd, Magway", MAG),
    "Daw Khin Sandar": ("09-7900-55190", "Lanmadaw St, Magway", MAG),
    "MPPA": ("09-7800-67890", "78th St, Mandalay", MDY),
    "Ko Htoo Aung": ("09-4300-11220", "Zegyo Market, Mandalay", MDY),
    "Daw Thida Win": ("09-4300-90417", "35th St, Mandalay", MDY),
    "Ko Nyi Nyi": ("09-4300-66051", "Chan Mya Thazi, Mandalay", MDY),
}


def ref(prefix: str, on: date, counter: dict) -> str:
    counter[(prefix, on)] += 1
    return f"{prefix}-{on:%y%m%d}-{counter[(prefix, on)]:04d}"


def colour_string(parts: dict[str, int]) -> str:
    return ",".join(f"{colour}{sets}s" for colour, sets in parts.items() if sets > 0)


def daterange(first: date, last: date):
    for offset in range((last - first).days + 1):
        yield first + timedelta(days=offset)


counters: dict = defaultdict(int)

# --- vouchers, shipments, receivings ---------------------------------------------------

vouchers, shipments, receivings, write_offs = [], [], [], []
opened_stock: list[tuple[date, str, str, str, int]] = []  # (day, gate, code, colour, sets)

voucher_days = []
day = START
while day <= TODAY - timedelta(days=2):
    voucher_days.append(day)
    day += timedelta(days=rnd.choice([1, 2, 2, 3]))

lost_budget = 2  # shipments that lose one package on the road
for index, voucher_date in enumerate(voucher_days):
    supplier = list(SUPPLIERS)[index % len(SUPPLIERS)]
    cargo = SUPPLIERS[supplier][2]
    gate_options = sorted({g for c, p in PRODUCTS.items() if p[2] == supplier for g in p[5]})
    gate = rnd.choice(gate_options)
    codes = [c for c, p in PRODUCTS.items() if p[2] == supplier and gate in p[5]]
    chosen = rnd.sample(codes, k=min(len(codes), rnd.choice([1, 2, 2, 3])))

    lines = []
    for code in chosen:
        description, group, _, colours, price, _ = PRODUCTS[code]
        parts = {c: rnd.randint(4, 14) for c in rnd.sample(colours, k=min(len(colours), rnd.choice([2, 2, 3])))}
        lines.append({
            "stock_code": code, "description": description, "group": group,
            "color_qty": colour_string(parts), "unit": "set", "qty": sum(parts.values()),
            "buying_price": price + rnd.choice([0, 0, 2000, -2000]),
            "_parts": parts,
        })
    total_sets = sum(line["qty"] for line in lines)
    packages = max(3, round(total_sets / 5))
    voucher_no = ref("VCH", voucher_date, counters)
    total_amount = sum(line["qty"] * line["buying_price"] for line in lines)

    sent = voucher_date + timedelta(days=rnd.randint(1, 3))
    payments = []
    advance = round(total_amount * rnd.choice([0.4, 0.5, 0.5, 0.6]) / 100000) * 100000
    if advance > 0 and rnd.random() < 0.9:
        payments.append({"date": voucher_date.isoformat(), "amount": advance, "note": "Advance to the factory"})

    shipment_entry = None
    if sent <= TODAY:
        shipment_no = ref("SHP", sent, counters)
        at_yangon = sent + timedelta(days=rnd.randint(1, 3))
        left_yangon = at_yangon + timedelta(days=rnd.randint(0, 2))
        at_gate = left_yangon + timedelta(days=rnd.randint(2, 4))
        carrier = rnd.choice(CARRIERS)
        if index == 4:
            # One shipment sits at the Yangon carrier and never goes on, so the
            # Dashboard has a stuck shipment to flag.
            left_yangon = TODAY + timedelta(days=30)
            at_gate = left_yangon + timedelta(days=3)

        legs = []
        if at_yangon <= TODAY:
            legs.append({"stop_name": "Yangon", "carrier_name": carrier, "packages_received": packages,
                         "packages_sent": packages if left_yangon <= TODAY else 0})

        # What each package holds: the goods laid end to end, one set at a time, and dealt
        # out as evenly as they go.
        flat = [(l["stock_code"], colour) for l in lines for colour, n in l["_parts"].items() for _ in range(n)]
        base, extra = divmod(len(flat), packages)
        contents, cursor = [], 0
        for i in range(packages):
            size = base + (1 if i < extra else 0)
            contents.append(flat[cursor:cursor + size])
            cursor += size

        lost_package = at_gate <= TODAY - timedelta(days=8) and lost_budget > 0 and rnd.random() < 0.3
        if lost_package:
            lost_budget -= 1
        arrived_packages = packages - 1 if lost_package else packages
        reached_gate = at_gate <= TODAY

        shipment_entry = {
            "shipment_no": shipment_no, "voucher_no": voucher_no, "supplier_name": supplier, "cargo_name": cargo,
            "final_location": gate, "sent_date": sent.isoformat(), "total_packages": packages,
            "total_pairs": total_sets * 6, "total_unit": "set", "packages_sent_by_cargo": packages,
            "final_received_packages": arrived_packages if reached_gate else 0,
            "lost_packages": 1 if (lost_package and reached_gate) else 0,
            "legs": legs,
        }
        shipments.append(shipment_entry)

        if reached_gate:
            lost_sets = defaultdict(int)
            if lost_package:
                for code, _ in contents[-1]:
                    lost_sets[code] += 1
                write_offs.append({
                    "subject": "shipment", "shipment_no": shipment_no, "packages": 1, "reason": "lost_in_transit",
                    "note": "The cargo company could not find this package", "date": (at_gate + timedelta(days=3)).isoformat(),
                })
                for code, sets in lost_sets.items():
                    write_offs.append({
                        "subject": "voucher_line", "voucher_no": voucher_no, "stock_code": code, "sets": sets,
                        "reason": "lost_in_transit", "note": "Lost with the missing package",
                        "date": (at_gate + timedelta(days=3)).isoformat(),
                    })

            receiving_packages = []
            for i in range(arrived_packages):
                open_day = at_gate + timedelta(days=(i * 3) // arrived_packages)
                if open_day > TODAY:
                    receiving_packages.append({"package_no": i + 1, "opened": False, "received_date": None, "note": "", "items": []})
                    continue
                by_code: dict[str, dict[str, int]] = defaultdict(lambda: defaultdict(int))
                for code, colour in contents[i]:
                    by_code[code][colour] += 1
                    opened_stock.append((open_day, gate, code, colour, 1))
                items = [{
                    "stock_code": code, "description": PRODUCTS[code][0], "group": PRODUCTS[code][1],
                    "color_qty": colour_string(parts), "qty": sum(parts.values()), "unit": "set",
                } for code, parts in by_code.items()]
                receiving_packages.append({"package_no": i + 1, "opened": True, "received_date": open_day.isoformat(),
                                           "note": "", "items": items})

            cost_day = at_gate.isoformat()
            costs = [
                {"cost_date": cost_day, "stage": cargo, "carrier": cargo, "kind": "Cargo fee",
                 "amount": CARGO_RATE[cargo] * packages, "note": ""},
                {"cost_date": cost_day, "stage": "Yangon", "carrier": carrier, "kind": "Carrier fee",
                 "amount": 8000 * packages, "note": ""},
                {"cost_date": cost_day, "stage": gate, "carrier": "Gate porters", "kind": "Porters",
                 "amount": rnd.choice([15000, 20000, 25000]), "note": ""},
            ]
            receivings.append({
                "receiving_no": ref("RCV", at_gate, counters), "shipment_no": shipment_no, "gate": gate,
                "received_date": at_gate.isoformat(), "total_unit": "set", "total_qty": total_sets - sum(lost_sets.values()),
                "costs": costs, "packages": receiving_packages,
            })

            # The balance is settled once the last package is counted, most of the time.
            last_open = max((date.fromisoformat(p["received_date"]) for p in receiving_packages if p["received_date"]), default=None)
            all_open = all(p["opened"] for p in receiving_packages)
            paid_so_far = sum(p["amount"] for p in payments)
            if all_open and last_open and rnd.random() < 0.8:
                pay_day = last_open + timedelta(days=rnd.randint(0, 6))
                if pay_day <= TODAY:
                    owed = total_amount - paid_so_far
                    payments.append({"date": pay_day.isoformat(), "amount": owed, "note": "Balance after counting"})

    vouchers.append({
        "voucher_no": voucher_no, "supplier_name": supplier, "voucher_date": voucher_date.isoformat(),
        "total_packages": packages, "cargo_name": cargo,
        "lines": [{k: v for k, v in line.items() if not k.startswith("_")} for line in lines],
        "payments": payments,
    })

# --- customer orders and deliveries ----------------------------------------------------

orders = []
sim_orders = []
order_days = sorted(rnd.choice(list(daterange(START + timedelta(days=2), TODAY - timedelta(days=1)))) for _ in range(70))
for order_date in order_days:
    customer = rnd.choice(list(CUSTOMERS))
    phone, address, gate = CUSTOMERS[customer]
    # The beach slipper went out of fashion: nobody orders it after early August, so its
    # leftover stock is what the Dashboard's "not selling" card is for.
    codes = [c for c, p in PRODUCTS.items() if gate in p[5] and not (c == "D4002" and order_date > date(2026, 8, 5))]
    lines = []
    for code in rnd.sample(codes, k=rnd.choice([1, 1, 2])):
        description, group, supplier, colours, buying, _ = PRODUCTS[code]
        parts = {c: rnd.randint(2, 9) for c in rnd.sample(colours, k=rnd.choice([1, 2, 2]))}
        lines.append({
            "stock_code": code, "description": description, "group": group, "supplier_name": supplier,
            "color_qty": colour_string(parts), "qty": sum(parts.values()), "unit": "set",
            "selling_price": round(buying * 1.28 / 1000) * 1000 + rnd.choice([0, 0, 3000, -3000]),
            "_parts": parts,
        })
    cancelled = order_date < TODAY - timedelta(days=20) and rnd.random() < 0.06
    entry = {
        "order_no": ref("ORD", order_date, counters), "customer_name": customer, "customer_phone": phone,
        "customer_address": address, "order_date": order_date.isoformat(), "lines": lines, "payments": [],
    }
    if cancelled:
        entry["cancelled"] = True
    orders.append(entry)
    sim_orders.append({"entry": entry, "gate": gate, "date": order_date, "cancelled": cancelled,
                       "wait": rnd.randint(0, 2), "hold": rnd.random() < 0.5, "remaining": {(l["stock_code"], c): n for l in lines for c, n in l["_parts"].items()}})

stock: dict[tuple[str, str, str], int] = defaultdict(int)
opens_by_day: dict[date, list] = defaultdict(list)
for open_day, gate, code, colour, sets in opened_stock:
    opens_by_day[open_day].append((gate, code, colour, sets))

outgoing = []
last_delivery: dict[str, date] = {}
for today in daterange(START, TODAY):
    for gate, code, colour, sets in opens_by_day[today]:
        stock[(gate, code, colour)] += sets
    for order in sim_orders:
        if order["cancelled"] or today < order["date"] + timedelta(days=order["wait"]):
            continue
        if order["hold"] and today > TODAY - timedelta(days=3):
            continue  # stock is in, the truck just has not gone out yet
        # The app shares stock out by product and colour across every gate, so a delivery
        # takes from the customer's own gate first and then from any other that has it.
        delivered_today: dict[tuple[str, str], dict[str, int]] = defaultdict(lambda: defaultdict(int))
        for (code, colour), remaining in list(order["remaining"].items()):
            gates = [order["gate"]] + [g for g in (MAW, MAG, MDY) if g != order["gate"]]
            available = sum(stock[(g, code, colour)] for g in gates)
            take = min(remaining, available)
            if take <= 0 or (take < remaining and rnd.random() > 0.3):
                continue
            order["remaining"][(code, colour)] -= take
            for g in gates:
                part = min(take, stock[(g, code, colour)])
                if part <= 0:
                    continue
                stock[(g, code, colour)] -= part
                delivered_today[(code, g)][colour] += part
                take -= part
        for (code, g), parts in delivered_today.items():
            outgoing.append({
                "seed_key": f"seed:delivery:{order['entry']['order_no']}:{code}:{g}:{today.isoformat()}",
                "order_no": order["entry"]["order_no"], "stock_code": code, "color_qty": colour_string(parts),
                "qty": sum(parts.values()), "unit": "set", "location": g, "date": today.isoformat(),
            })
            last_delivery[order["entry"]["order_no"]] = today

# --- customer payments -----------------------------------------------------------------

for order in sim_orders:
    entry = order["entry"]
    if order["cancelled"]:
        continue
    total = sum(l["qty"] * l["selling_price"] for l in entry["lines"])
    paid = 0
    if rnd.random() < 0.75:
        deposit = min(total, round(total * rnd.uniform(0.3, 0.5) / 10000) * 10000)
        if deposit > 0:
            entry["payments"].append({"date": entry["order_date"], "amount": deposit, "note": "Deposit"})
            paid += deposit
    finished = all(n == 0 for n in order["remaining"].values())
    if finished and rnd.random() < 0.85:
        pay_day = last_delivery[entry["order_no"]] + timedelta(days=rnd.randint(0, 4))
        if pay_day <= TODAY:
            entry["payments"].append({"date": pay_day.isoformat(), "amount": total - paid, "note": "Paid on delivery"})
    entry["payments"] = [p for p in entry["payments"] if p["amount"] > 0]
    for line in entry["lines"]:
        line.pop("_parts", None)

# --- master data and file --------------------------------------------------------------

customers_seen = {o["customer_name"] for o in orders}
master = {
    "suppliers": [{"name": n, "phone": p, "address": a} for n, (p, a, _) in SUPPLIERS.items()],
    "customers": [{"name": n, "phone": p, "address": a} for n, (p, a, _) in CUSTOMERS.items() if n in customers_seen],
    "cargo_companies": [SHWE, AYAR, TIGER],
    "carriers": CARRIERS,
    "destinations": [MAW, MAG, MDY],
    "gates": [MAW, MAG, MDY],
    "products": [{"stock_code": c, "description": p[0], "group": p[1], "default_unit": "set"} for c, p in PRODUCTS.items()],
}

OUT.write_text(json.dumps({
    "_comment": "Two months of demo trading (24 Jul - 24 Sep 2026), generated by scripts/build_wholesale_demo_data.py. "
                "Quantities are in sets, prices per set. Edit the generator, not this file.",
    "master_data": master, "shipments": shipments, "vouchers": vouchers, "receivings": receivings,
    "orders": orders, "outgoing": outgoing, "write_offs": write_offs,
}, indent=1, ensure_ascii=False) + "\n")

sales = sum(l["qty"] * l["selling_price"] for o in orders if not o.get("cancelled") for l in o["lines"])
paid_in = sum(p["amount"] for o in orders for p in o["payments"])
print(f"{len(vouchers)} vouchers, {len(shipments)} shipments, {len(receivings)} receivings, "
      f"{len(orders)} orders ({sum(1 for o in orders if o.get('cancelled'))} cancelled), "
      f"{len(outgoing)} deliveries, {len(write_offs)} write-offs")
print(f"ordered value {sales:,.0f} Ks, collected {paid_in:,.0f} Ks")
print(f"sets bought {sum(l['qty'] for v in vouchers for l in v['lines'])}, "
      f"sets delivered {sum(o['qty'] for o in outgoing)}, sets on shelf {sum(stock.values())}")
