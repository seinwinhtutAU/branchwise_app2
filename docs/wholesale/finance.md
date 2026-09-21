# Finance

Receivables, payables, and shipment costs — three tabs, none with a data model of its own.
There's no dedicated finance service module; `app/wholesale/routers/finance.py` computes
everything inline from services the other screens already own.

## Customer receivables — the only endpoint here

**`GET /api/wholesale/finance/customers`** — for every non-cancelled [Customer
Order](./customer-orders.md): `order_id`, `customer_name`, `order_no`, `order_date`,
`total_pairs`, `delivered_pairs`, `remaining_to_deliver_pairs`, `paid_pairs` (sum of
`payment.paid_quantity_pairs`), `delivered_but_unpaid_pairs = max(0, delivered - paid_pairs)`,
`total_amount`/`paid_amount`/`balance` (from `order_totals`), `payment_status`
(unpaid/partial/paid, from `_payment_status`), `package_status` (`no_delivery` /
`delivered_unpaid` / `partially_paid` / `fully_paid`, from `_package_status` comparing
delivered pairs against paid pairs). Filters: `search`, `payment_status`, `package_status`.

## Supplier payables and shipment costs — reused, not separate endpoints

There is **no** `/api/wholesale/finance/suppliers` endpoint. The "Supplier Payables" tab
instead calls `GET /api/wholesale/supplier-vouchers` directly and computes totals client-side
with the same `pricedAmount`/`voucherBalance`/`paymentStatus` helpers every other screen uses.
The "Shipment Costs" tab similarly calls `GET /api/wholesale/receivings` and flattens each
receiving's `costs[]` array client-side — see [Receiving](./receiving.md#costs). Finance is a
read-only lens over data that already fully exists elsewhere, not a third source of truth.

## Frontend

`FinancePage.tsx` — one page, three tabs (`customers` / `suppliers` / `shipment-costs`), each
backed by its own `useQuery` against the endpoint(s) above. Three KPI cards up top (Customer
Receivables total + unpaid count, Supplier Payables total + unpaid count, Shipment Costs total
+ entry count); each tab's table is filterable/paginated with a "Record payment" action that
opens a shared `RecordPaymentModal`, which posts via `addCustomerOrderPayment` or
`addSupplierVoucherPayment` depending on which kind of row was clicked.
