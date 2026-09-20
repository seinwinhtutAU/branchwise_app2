"""Seed the Bogyoke and BHS 1 branches and retail user accounts.

Idempotent: branches and users that already exist are preserved.

    uv run --directory backend python scripts/seed_retail_accounts.py
"""

import sys
import uuid
from pathlib import Path

import httpx
from sqlalchemy import text

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.config import get_settings  # noqa: E402
from app.db.session import SessionLocal  # noqa: E402
from app.models.branch import Branch  # noqa: E402
from app.models.user import User, UserRole  # noqa: E402

BRANCHES_TO_SEED = [
    {"name": "Bogyoke", "phone_number": "09-12345678", "address": "Bogyoke Market, Yangon"},
    {"name": "BHS 1", "phone_number": "09-87654321", "address": "BHS 1 Branch, Yangon"},
]

USERS_TO_SEED = [
    {
        "email": "bogyoke@branchwise.app",
        "name": "Bogyoke Retail",
        "branch_name": "Bogyoke",
        "role": UserRole.RETAIL,
    },
    {
        "email": "bhs1@branchwise.app",
        "name": "BHS 1 Retail",
        "branch_name": "BHS 1",
        "role": UserRole.RETAIL,
    },
]

ORIGIN = "http://localhost:8000"
DEV_PASSWORD = "12345678"  # Standard dev password (>= 8 chars for Neon Auth)


def main() -> None:
    db = SessionLocal()
    try:
        branch_map: dict[str, Branch] = {}
        for b_data in BRANCHES_TO_SEED:
            branch = db.query(Branch).filter(Branch.name == b_data["name"]).first()
            if not branch:
                branch = Branch(
                    id=str(uuid.uuid4()),
                    name=b_data["name"],
                    phone_number=b_data["phone_number"],
                    address=b_data["address"],
                )
                db.add(branch)
                db.flush()
                print(f"Created branch '{branch.name}' ({branch.id})")
            else:
                print(f"Branch '{branch.name}' already exists ({branch.id})")
            branch_map[branch.name] = branch

        users_to_auth: list[User] = []
        for u_data in USERS_TO_SEED:
            user = db.query(User).filter(User.email == u_data["email"]).first()
            target_branch = branch_map.get(u_data["branch_name"])
            if not user:
                user = User(
                    id=str(uuid.uuid4()),
                    email=u_data["email"],
                    name=u_data["name"],
                    role=u_data["role"],
                    branch_id=target_branch.id if target_branch else None,
                )
                db.add(user)
                db.flush()
                print(f"Created user '{user.email}' ({user.name})")
            else:
                if target_branch and user.branch_id != target_branch.id:
                    user.branch_id = target_branch.id
                print(f"User '{user.email}' already exists")
            users_to_auth.append(user)

        db.commit()

        # Optional: Link / create Neon Auth if configured
        base = get_settings().neon_auth_base_url.rstrip("/")
        if base:
            with httpx.Client(timeout=15.0) as client:
                for user in users_to_auth:
                    if user.auth_user_id:
                        continue
                    try:
                        res = client.post(
                            f"{base}/sign-up/email",
                            json={"email": user.email, "password": DEV_PASSWORD, "name": user.name},
                            headers={"Origin": ORIGIN},
                        )
                        if res.status_code == 200:
                            user.auth_user_id = res.json()["user"]["id"]
                            print(f"Auth linked for '{user.email}'")
                        else:
                            row = db.execute(
                                text('select id from neon_auth."user" where lower(email) = lower(:email)'),
                                {"email": user.email},
                            ).first()
                            if row:
                                user.auth_user_id = row[0]
                                print(f"Existing auth linked for '{user.email}'")
                    except Exception as e:
                        print(f"Could not reach auth service for '{user.email}': {e}")
            db.commit()

        print("Seeding finished successfully.")
    finally:
        db.close()


if __name__ == "__main__":
    main()
