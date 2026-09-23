# Data Cleaning Notebooks

This folder separates the data-preparation work by business area so it is easy to present and review.

| Notebook | Purpose |
| --- | --- |
| `sales_cleaning.ipynb` | Cleans sales transactions and calculates line totals. |
| `inventory_cleaning.ipynb` | Cleans stock records and flags inventory issues. |
| `purchase_cleaning.ipynb` | Cleans supplier purchase records and calculates line totals. |

## How to use

1. Put the source CSV or Excel file in the `data/` folder (or update `DATA_FILE` in the notebook).
2. Open the matching notebook and run its cells from top to bottom.
3. Find the cleaned file in `cleaning/output/`.

Each notebook keeps an audit summary: the number of input rows, removed duplicates, missing values, and final output rows.
