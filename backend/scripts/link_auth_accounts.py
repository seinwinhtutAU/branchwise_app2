"""Create a Neon Auth account for every row in `users` and link the two.

Run once, at the cutover from Supabase Auth (2026-09-05). Neon Auth cannot import
Supabase's bcrypt hashes — it hashes differently — so every account starts with a
generated password that the person changes afterwards. Six people, so this is a
smaller problem than it sounds.

Idempotent: an email that already has a Neon Auth account is linked, not recreated.

    uv run --directory backend python scripts/link_auth_accounts.py
"""

import secrets
import string
import sys
from pathlib import Path

import httpx
from sqlalchemy import text

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.config import get_settings  # noqa: E402
from app.db.session import SessionLocal  # noqa: E402
from app.models.user import User  # noqa: E402

ORIGIN = "http://localhost:8000"
ALPHABET = string.ascii_letters + string.digits


def temporary_password() -> str:
    """Readable enough to type once from a note, random enough not to be guessable."""
    return "Bw-" + "".join(secrets.choice(ALPHABET) for _ in range(10))


def main() -> None:
    base = get_settings().neon_auth_base_url.rstrip("/")
    if not base:
        raise SystemExit("NEON_AUTH_BASE_URL is not set in backend/.env")

    db = SessionLocal()
    created: list[tuple[str, str]] = []
    try:
        users = db.query(User).order_by(User.email).all()
        with httpx.Client(timeout=30.0) as client:
            for user in users:
                if user.auth_user_id:
                    print(f"{user.email:<32} already linked")
                    continue

                password = temporary_password()
                response = client.post(
                    f"{base}/sign-up/email",
                    json={"email": user.email, "password": password, "name": user.name},
                    headers={"Origin": ORIGIN},
                )
                if response.status_code == 200:
                    user.auth_user_id = response.json()["user"]["id"]
                    created.append((user.email, password))
                    print(f"{user.email:<32} created and linked")
                    continue

                # Already there (a re-run, or an account made by hand in the console).
                # Signing in would need the password, so read the id straight out of
                # Neon Auth's own tables — they live in this same database.
                row = db.execute(
                    text('select id from neon_auth."user" where lower(email) = lower(:email)'),
                    {"email": user.email},
                ).first()
                if row:
                    user.auth_user_id = row[0]
                    print(f"{user.email:<32} linked to the existing auth account")
                else:
                    print(
                        f"{user.email:<32} FAILED: {response.status_code} {response.text[:90]}"
                    )
        db.commit()
    finally:
        db.close()

    if created:
        print("\nTemporary passwords — give these out, then have each person change theirs:\n")
        for email, password in created:
            print(f"  {email:<32} {password}")


if __name__ == "__main__":
    main()
