import argparse
import logging
from pathlib import Path

from app.retail.services.inventory_import import parse_inventory_export

REPO_ROOT = Path(__file__).resolve().parents[2]


def main() -> None:
    parser = argparse.ArgumentParser(description="Clean a raw POS inventory.csv export.")
    parser.add_argument(
        "--input", type=Path, default=REPO_ROOT / "retail_data" / "inventory.csv"
    )
    parser.add_argument(
        "--output", type=Path, default=REPO_ROOT / "retail_data" / "inventory_clean.csv"
    )
    parser.add_argument(
        "--nonzero-only",
        action="store_true",
        help="Filter out zero on-hand quantity rows (keep On_Hand_Qty != 0)",
    )
    args = parser.parse_args()

    logging.basicConfig(level=logging.INFO, format="%(levelname)s: %(message)s")

    df = parse_inventory_export(args.input)
    if args.nonzero_only:
        initial_count = len(df)
        df = df[df["On_Hand_Qty"] != 0]
        print(
            f"Filtered out {initial_count - len(df)} zero-stock rows (kept {len(df)} non-zero rows)"
        )
    df.to_csv(args.output, index=False)
    print(f"Wrote {len(df)} rows to {args.output}")


if __name__ == "__main__":
    main()
