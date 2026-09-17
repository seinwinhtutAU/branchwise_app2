"""Derived money totals shared by wholesale routers and monitoring views."""

from app.wholesale.services.units import priced_amount


def order_totals(order) -> dict[str, float]:
    total = sum(
        priced_amount(line.quantity_pairs, line.unit, float(line.selling_price), getattr(line, "unit_conversions", None))
        for line in order.lines
    )
    paid = sum(float(payment.amount) for payment in order.payments)
    return {"total": total, "paid": paid, "balance_due": total - paid}


def voucher_totals(voucher) -> dict[str, float]:
    total = sum(
        priced_amount(line.quantity_pairs, line.unit, float(line.buying_price), getattr(line, "unit_conversions", None))
        for line in voucher.lines
    )
    paid = sum(float(payment.amount) for payment in voucher.payments)
    return {"total": total, "paid": paid, "balance_due": total - paid}
