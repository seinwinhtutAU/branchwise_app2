# Business Alerts

Business Alerts presents the operational issues that require action. It is separate
from the Dashboard's performance reporting and from the row-level Warning page.

Alerts are grouped into Sales, Inventory, Reorder, Customer, and Data quality tabs.
Urgent reorder is intentionally in **Reorder**, rather than Inventory, so stock
operations and immediate purchasing decisions can be reviewed separately.

## Active alerts

| Alert | Severity | When it appears | Action |
| --- | --- | --- | --- |
| Daily import missing | Critical | After the business cutoff, today's Sale or Inventory file is missing. Purchase files are not required daily. | Open Import Hub and confirm the missing file. |
| Sale data quality | Critical | A sale line has a quantity below 1, a negative price, or a missing/invalid number, or its product description is missing. Missing buying price is intentionally ignored. These are exactly the lines the Warning page lists ("Sale — fix these numbers" and "Sale — add missing descriptions"); the alert's link opens that page on the same days the alert counted. | Open Data Quality, correct the source file, then re-import. |
| Purchase data quality | Critical | A purchase line has a quantity below 1, a negative unit cost, or a missing/invalid number, or its product description is missing. Listed on the Warning page the same way as sales. | Open Data Quality, correct the source file, then re-import. |
| Urgent reorder | Critical | An active-selling product has three or fewer days of stock cover. | Place an urgent purchase order using the recommended quantity. |
| Physical stock audit | Warning | Inventory discrepancies require a physical count. The checking sheet unlocks after the cutoff once today's Sale and Inventory imports are complete. | Open Checking, count stock, correct the external system, and re-import Inventory. |
| Stock allocation | Warning | A branch has stock with no sales in 90 days while another branch sells the same product. | Transfer the recommended quantity to the selling branch. |
| Inventory aging | Warning | Footwear stock has been held for more than 180 days. | Review the purchase batch and use clearance, promotion, or return actions. |
| Seasonal demand | Normal | Products sold strongly in the equivalent calendar month last year. | Prepare stock and supplier orders for the expected demand. |
| Weekly demand pattern | Normal | Saturday/Sunday demand is concentrated, or a day sells much more than the weekday average. | Replenish the sales floor before the peak day. |

## Scope

Business Alerts intentionally does not raise general revenue-decline, margin,
low-stock/watch-stock, generic dead-stock, traffic-decline, or duplicate Warning-page
alerts. The Dashboard continues to show its normal sales, profit, inventory, and
customer reporting; those figures are not removed by this alert policy.
