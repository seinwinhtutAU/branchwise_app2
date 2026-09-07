"""One-off: bring existing product descriptions in line with the import rule.

Imports title-case descriptions from now on (see `import_common.clean_description`), but
rows imported before that keep whatever casing the POS operator typed — so the same shelf
shows "lily" next to "Lily" and "NIKE" next to "adidas" until they are re-imported. This
walks the `products` table once and applies exactly the same function.

Dry run by default: it prints every change it would make and touches nothing.

    uv run --directory backend python scripts/titlecase_product_descriptions.py
    uv run --directory backend python scripts/titlecase_product_descriptions.py --apply

Only `products.description` is rewritten — a display label. `stock_code`, the key that
actually identifies a product, is never touched, so nothing that references a product can
break. Wholesale order/voucher lines are left alone on purpose: those descriptions are
typed by hand in the app, where the person entering them chooses the casing.
"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.db.session import SessionLocal  # noqa: E402
from app.models import Product  # noqa: E402
from app.services.import_common import title_case  # noqa: E402


def main() -> None:
    apply_changes = "--apply" in sys.argv

    db = SessionLocal()
    try:
        products = db.query(Product).order_by(Product.stock_code).all()
        changed = [
            (product, title_case(product.description))
            for product in products
            if product.description and title_case(product.description) != product.description
        ]

        for product, new_description in changed:
            print(f"  {product.stock_code:14} {product.description!r} -> {new_description!r}")

        print(f"\n{len(changed)} of {len(products)} descriptions would change.")

        if not apply_changes:
            print("Dry run — nothing written. Re-run with --apply to save.")
            return

        for product, new_description in changed:
            product.description = new_description
        db.commit()
        print(f"Updated {len(changed)} descriptions.")
    finally:
        db.close()


if __name__ == "__main__":
    main()
