import argparse
import logging
from pathlib import Path

from app.retail.services.purchase_import import parse_purchase_export

REPO_ROOT = Path(__file__).resolve().parents[2]


def main() -> None:
    parser = argparse.ArgumentParser(description="Clean a raw POS purchase.csv export.")
    parser.add_argument(
        "--input", type=Path, default=REPO_ROOT / "retail_data" / "purchase.csv"
    )
    parser.add_argument(
        "--output", type=Path, default=REPO_ROOT / "retail_data" / "purchase_clean.csv"
    )
    args = parser.parse_args()

    logging.basicConfig(level=logging.INFO, format="%(levelname)s: %(message)s")

    df = parse_purchase_export(args.input)
    df.to_csv(args.output, index=False)
    print(f"Wrote {len(df)} rows to {args.output}")


if __name__ == "__main__":
    main()
