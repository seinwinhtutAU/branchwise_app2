import re

ATS_BRANCHES = {
    "1": "Bogyoke",
    "2": "BHS 1",
    "3": "Ashley",
    "4": "AungThitSar",
}
_SHOP_NUMBER = re.compile(r"au(?:ng|nt)\s*thit\s*sar\s*-\s*([1-4])", re.IGNORECASE)


def normalize_ats_branch(shop: object) -> str | None:
    match = _SHOP_NUMBER.search(str(shop).strip())
    return ATS_BRANCHES.get(match.group(1)) if match else None
