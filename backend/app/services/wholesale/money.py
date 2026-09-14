"""Derived money totals shared by wholesale routers and monitoring views."""


def order_totals(order) -> dict[str, float]:
    total = sum(float(line.quantity_pairs) * float(line.selling_price) for line in order.lines)
    paid = sum(float(payment.amount) for payment in order.payments)
    return {"total": total, "paid": paid, "balance_due": max(0, total - paid)}


def voucher_totals(voucher) -> dict[str, float]:
    total = sum(float(line.quantity_pairs) * float(line.buying_price) for line in voucher.lines)
    paid = sum(float(payment.amount) for payment in voucher.payments)
    return {"total": total, "paid": paid, "balance_due": max(0, total - paid)}
