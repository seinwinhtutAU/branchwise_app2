# Business Alerts

Business Alerts presents the operational issues that require action. It is separate
from the Dashboard's performance reporting and from the row-level Warning page.

Alerts are grouped into Sales, Inventory, Reorder, Customer, and Data quality tabs.
Urgent reorder is intentionally in **Reorder**, rather than Inventory, so stock
operations and immediate purchasing decisions can be reviewed separately.

## Active alerts

| Alert | Severity | When it appears | Action |
| --- | --- | --- | --- |
| Daily import missing | Critical | After the business cutoff, today's Sale or Inventory file is missing. Purchase files are not required daily. Listed under **Data quality** (a missing file is a data problem, not a business decision), so it does not appear in the Summary's Recommended decisions. | Open Import Hub and confirm the missing file. |
| Sale data quality | Critical | A sale line has a quantity below 1, a negative price, or a missing/invalid number, or its product description is missing. Missing buying price is intentionally ignored. These are exactly the lines the Warning page lists ("Sale — fix these numbers" and "Sale — add missing descriptions"); the alert's link opens that page on the same days the alert counted. | Open Data Quality, correct the source file, then re-import. |
| Purchase data quality | Critical | A purchase line has a quantity below 1, a negative unit cost, or a missing/invalid number, or its product description is missing. Listed on the Warning page the same way as sales. | Open Data Quality, correct the source file, then re-import. |
| Urgent reorder | Critical | An active-selling product has three or fewer days of stock cover. | Place an urgent purchase order using the recommended quantity. |
| Physical stock audit | Warning | One or more products have a stock record that doesn't match (sold or bought but missing from inventory, or the daily reconciliation is off). The alert lists those products right in its detail, with a Download Excel button that includes a blank Actual Count column. | Count them in the shop, fill in the Excel sheet, correct the external system, and re-import Inventory. |
| Stock allocation | Warning | A branch has stock with no sales in 90 days while another branch sells the same product. | Transfer the recommended quantity to the selling branch: what it sold in 90 days minus what it already has on its shelf, and never more than is on hand here. A branch that already has enough is not suggested. |
| Inventory aging | Warning | Footwear stock has been held for more than 180 days since it was last bought. Products with no purchase record are not judged (a stock file does not say when something was bought). | Review the purchase batch and use clearance, promotion, or return actions. |
| Seasonal demand | Normal | Products that sold strongly in *next* calendar month last year (in September, it looks at last October), so there is time to order stock. | Prepare stock and supplier orders for the expected demand. |
| Weekly demand pattern | Normal | Saturday/Sunday demand is concentrated, or a day sells much more than the weekday average. | Replenish the sales floor before the peak day. |

## Scope

Business Alerts intentionally does not raise general revenue-decline, margin,
low-stock/watch-stock, generic dead-stock, traffic-decline, or duplicate Warning-page
alerts. The Dashboard continues to show its normal sales, profit, inventory, and
customer reporting; those figures are not removed by this alert policy.
