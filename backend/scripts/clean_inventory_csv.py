import argparse
import logging
from pathlib import Path

from app.services.inventory_import import parse_inventory_export

REPO_ROOT = Path(__file__).resolve().parents[2]


def main() -> None:
    parser = argparse.ArgumentParser(description="Clean a raw POS inventory.csv export.")
    parser.add_argument(
        "--input", type=Path, default=REPO_ROOT / "retail_data" / "inventory.csv"
    )
    parser.add_argument(
        "--output", type=Path, default=REPO_ROOT / "retail_data" / "inventory_clean.csv"
    )
    args = parser.parse_args()

    logging.basicConfig(level=logging.INFO, format="%(levelname)s: %(message)s")

    df = parse_inventory_export(args.input)
    df.to_csv(args.output, index=False)
    print(f"Wrote {len(df)} rows to {args.output}")


if __name__ == "__main__":
    main()
