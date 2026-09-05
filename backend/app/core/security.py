from dataclasses import dataclass
from functools import lru_cache
from urllib.parse import urlsplit

import jwt
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from jwt import PyJWKClient
from sqlalchemy.orm import Session

from app.config import get_settings
from app.db.session import get_db
from app.models.user import User

bearer_scheme = HTTPBearer(auto_error=False)

# Neon Auth (managed Better Auth) signs with EdDSA/Ed25519 and puts the auth instance's
# own base URL in both `iss` and `aud`. Supabase Auth, which issued these tokens until
# 2026-09-05, used ES256 with the audience "authenticated" — the shape of the check is
# the same, only the algorithm and the expected claims moved.
JWT_ALGORITHMS = ["EdDSA"]


def _jwks_url() -> str:
    settings = get_settings()
    if settings.neon_auth_jwks_url:
        return settings.neon_auth_jwks_url
    return f"{settings.neon_auth_base_url.rstrip('/')}/.well-known/jwks.json"


@lru_cache
def _get_jwk_client() -> PyJWKClient:
    # Cached because it holds the fetched key set: these tokens live 15 minutes, so a
    # fresh fetch per request would mean a network round trip on every single call.
    return PyJWKClient(_jwks_url())


def _origin_of(url: str) -> str:
    parts = urlsplit(url)
    return f"{parts.scheme}://{parts.netloc}"


@dataclass
class CurrentUser:
    id: str
    email: str | None


def get_current_user(
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer_scheme),
) -> CurrentUser:
    if credentials is None:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Missing bearer token")

    settings = get_settings()
    if not settings.neon_auth_base_url:
        raise HTTPException(
            status.HTTP_500_INTERNAL_SERVER_ERROR, "NEON_AUTH_BASE_URL is not configured"
        )

    # `iss` and `aud` are the auth host's ORIGIN — https://<host> — while the configured
    # base URL carries a path too (…/neondb/auth). Comparing against the full base URL
    # fails every token, which is exactly how this was found.
    issuer = _origin_of(settings.neon_auth_base_url)
    try:
        signing_key = _get_jwk_client().get_signing_key_from_jwt(credentials.credentials)
        payload = jwt.decode(
            credentials.credentials,
            signing_key.key,
            algorithms=JWT_ALGORITHMS,
            audience=issuer,
            issuer=issuer,
        )
    except jwt.PyJWTError as exc:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Invalid or expired token") from exc

    return CurrentUser(id=payload["sub"], email=payload.get("email"))


def get_current_app_user(
    current: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> User:
    """The app-level profile behind the token — role, branch, name.

    Matched on `users.auth_user_id`, falling back to the primary key. The fallback is
    what makes the auth move survivable: before 2026-09-05 a user's primary key *was*
    their Supabase auth id, so any row not yet linked to a Neon Auth account still
    resolves the old way. It can be dropped once every row carries `auth_user_id`.
    """
    user = db.query(User).filter(User.auth_user_id == current.id).one_or_none()
    if user is None:
        user = db.get(User, current.id)
    if user is None:
        raise HTTPException(
            status.HTTP_404_NOT_FOUND, "No user profile found for this account"
        )
    return user
