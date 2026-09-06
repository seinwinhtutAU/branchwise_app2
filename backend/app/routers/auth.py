"""Sign-in, sign-up and token refresh, proxied to Neon Auth.

Why the backend sits in the middle rather than the app talking to Neon Auth directly:
Neon Auth keeps its session in a `__Secure-neon-auth.session_token` cookie and mints a
short-lived (15 minute) JWT from it. A cookie is the one thing an Electron renderer
cannot hold comfortably — a packaged app runs from `file://`, whose requests carry
`Origin: null`, so the cookie is neither reliably set nor reliably sent. Doing it here
means the desktop app talks to exactly one origin (this backend), keeps using the same
`Authorization: Bearer` header it always has, and the app's content-security-policy
needs no third-party entry.

The session token is handed back to the app rather than stored here: it is the same
opaque value a browser would keep, this backend has no session table, and keeping one
would make signing in stateful for no gain at six users.
"""

from typing import Any

import httpx
from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel

from app.config import get_settings
from app.core.security import get_current_app_user
from app.models.user import User

router = APIRouter(prefix="/api", tags=["auth"])


@router.get("/me")
def me(user: User = Depends(get_current_app_user)) -> dict:
    """The app-level profile behind the bearer token: role, branch and name, which the
    JWT itself does not carry (it only proves *which account* is calling)."""
    return {
        "id": user.id,
        "email": user.email,
        "name": user.name,
        "role": user.role.value,
        "branch_id": user.branch_id,
        "branch_name": user.branch.name if user.branch else None,
    }


SESSION_COOKIE = "__Secure-neon-auth.session_token"
# Neon Auth refuses a request with no Origin ("MISSING_ORIGIN") because it wants to know
# where a callback would land. Nothing here uses callbacks, but the header has to be
# something, so it names this backend.
ORIGIN_HEADER = "http://localhost:8000"
TIMEOUT = httpx.Timeout(15.0)


class Credentials(BaseModel):
    # Validated by Neon Auth itself; keeping it a plain str avoids pulling in
    # email-validator for one field.
    email: str
    password: str


class SignUp(Credentials):
    name: str


class SessionToken(BaseModel):
    session: str


def _base_url() -> str:
    base = get_settings().neon_auth_base_url.rstrip("/")
    if not base:
        raise HTTPException(
            status.HTTP_500_INTERNAL_SERVER_ERROR, "NEON_AUTH_BASE_URL is not configured"
        )
    return base


def _forward_error(response: httpx.Response) -> HTTPException:
    """Neon Auth's own message, not a generic one — 'Invalid email or password' is
    exactly what the sign-in screen should show, and inventing our own wording would
    only drift from it."""
    try:
        message = response.json().get("message") or "Authentication failed"
    except ValueError:
        message = "Authentication failed"
    status_code = response.status_code if response.status_code in (400, 401, 403, 409, 422) else 502
    return HTTPException(status_code, message)


def _mint_jwt(client: httpx.Client, session: str) -> dict[str, Any]:
    """Exchange the opaque session for a JWT the rest of the API can verify."""
    response = client.get(
        f"{_base_url()}/token",
        headers={"Origin": ORIGIN_HEADER},
        cookies={SESSION_COOKIE: session},
    )
    if response.status_code != 200:
        raise _forward_error(response)
    token = response.json().get("token")
    if not token:
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, "Auth service returned no token")
    return {"access_token": token, "session": session}


def _session_from(response: httpx.Response) -> str:
    """The signed cookie value, which is what /token accepts — not the bare `token`
    field in the body, which is only the first half of it."""
    session = response.cookies.get(SESSION_COOKIE)
    if not session:
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, "Auth service returned no session")
    return session


@router.post("/auth/login")
def login(credentials: Credentials) -> dict[str, Any]:
    with httpx.Client(timeout=TIMEOUT) as client:
        response = client.post(
            f"{_base_url()}/sign-in/email",
            json={"email": credentials.email, "password": credentials.password},
            headers={"Origin": ORIGIN_HEADER},
        )
        if response.status_code != 200:
            raise _forward_error(response)
        body = response.json()
        result = _mint_jwt(client, _session_from(response))
        result["user"] = body.get("user", {})
        return result


@router.post("/auth/signup")
def signup(payload: SignUp) -> dict[str, Any]:
    with httpx.Client(timeout=TIMEOUT) as client:
        response = client.post(
            f"{_base_url()}/sign-up/email",
            json={"email": payload.email, "password": payload.password, "name": payload.name},
            headers={"Origin": ORIGIN_HEADER},
        )
        if response.status_code != 200:
            raise _forward_error(response)
        body = response.json()
        result = _mint_jwt(client, _session_from(response))
        result["user"] = body.get("user", {})
        return result


@router.post("/auth/refresh")
def refresh(payload: SessionToken) -> dict[str, Any]:
    """A JWT lasts 15 minutes; the session behind it lasts far longer. The app calls
    this on a timer and after any 401, and only a rejected *session* means signing in
    again."""
    with httpx.Client(timeout=TIMEOUT) as client:
        return _mint_jwt(client, payload.session)


@router.post("/auth/logout")
def logout(payload: SessionToken) -> dict[str, str]:
    with httpx.Client(timeout=TIMEOUT) as client:
        # Best effort: a session that is already gone is the state we wanted anyway, so
        # a failure here must not stop the app from clearing its own copy.
        client.post(
            f"{_base_url()}/sign-out",
            headers={"Origin": ORIGIN_HEADER},
            cookies={SESSION_COOKIE: payload.session},
        )
    return {"status": "signed out"}
