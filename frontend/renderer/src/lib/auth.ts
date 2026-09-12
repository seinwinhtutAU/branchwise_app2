// Signing in, staying signed in, and signing out.
//
// Logins moved from Supabase Auth to Neon Auth on 2026-09-05. The app does not talk to
// the auth service at all: it posts credentials to this project's own backend, which
// holds the conversation with Neon Auth and hands back a JWT (see
// backend/app/routers/auth.py for why — Neon Auth's session is a cookie, and a packaged
// Electron app runs from `file://`, whose requests carry `Origin: null`).
//
// The shape kept here on purpose is `session.access_token`: it is what every page in the
// app already sends as a bearer token, so the move touched the sign-in screen and this
// file rather than fifty call sites.

export const apiBaseUrl =
  import.meta.env.VITE_API_BASE_URL || "http://127.0.0.1:8000";

const STORAGE_KEY = "branchwise:session";

// A Neon Auth JWT lives 15 minutes. Refreshing at 10 leaves room for a slow network and
// for a laptop that was asleep, without hammering the endpoint.
const REFRESH_INTERVAL_MS = 10 * 60 * 1000;

export interface SessionUser {
  id: string;
  email: string;
  name?: string;
}

export interface Session {
  /** The bearer token every API call carries. Short-lived; refreshed in the background. */
  access_token: string;
  /** The long-lived opaque session that mints new access tokens. Never sent to the API. */
  session: string;
  user: SessionUser;
}

interface AuthResponse {
  access_token: string;
  session: string;
  user?: { id?: string; email?: string; name?: string };
}

function toSession(body: AuthResponse, fallbackEmail: string): Session {
  return {
    access_token: body.access_token,
    session: body.session,
    user: {
      id: body.user?.id ?? "",
      email: body.user?.email ?? fallbackEmail,
      name: body.user?.name,
    },
  };
}

/**
 * The server answered, and the answer was no — wrong password, revoked session, expired
 * session. Told apart from "the request never got there", because only this one means the
 * person has to sign in again; the other just means the internet is down, and signing
 * someone out for that would be the app punishing them for their connection.
 */
export class AuthRejectedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AuthRejectedError";
  }
}

async function post(path: string, payload: unknown): Promise<AuthResponse> {
  let response: Response;
  try {
    response = await fetch(`${apiBaseUrl}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
  } catch {
    // Nothing came back at all. Deliberately *not* an AuthRejectedError.
    throw new Error("No connection — check the internet and try again.");
  }
  const body = await response.json().catch(() => null);
  if (!response.ok) {
    // The backend forwards Neon Auth's own message ("Invalid email or password"), which
    // is what the sign-in screen should show.
    throw new AuthRejectedError(
      body?.detail ?? body?.message ?? `Sign-in failed (${response.status})`,
    );
  }
  return body as AuthResponse;
}

export function storeSession(session: Session | null): void {
  try {
    if (session) localStorage.setItem(STORAGE_KEY, JSON.stringify(session));
    else localStorage.removeItem(STORAGE_KEY);
  } catch {
    // A session that cannot be persisted still works for this run — the person just
    // signs in again next launch.
  }
}

export function loadStoredSession(): Session | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Session;
    return parsed?.access_token && parsed?.session ? parsed : null;
  } catch {
    return null;
  }
}

export async function signIn(
  email: string,
  password: string,
): Promise<Session> {
  const session = toSession(
    await post("/api/auth/login", { email, password }),
    email,
  );
  storeSession(session);
  return session;
}

export async function signUp(
  email: string,
  password: string,
  name: string,
): Promise<Session> {
  const session = toSession(
    await post("/api/auth/signup", { email, password, name }),
    email,
  );
  storeSession(session);
  return session;
}

export async function signOut(session: Session | null): Promise<void> {
  storeSession(null);
  if (!session) return;
  try {
    await post("/api/auth/logout", { session: session.session });
  } catch {
    // The local copy is already gone, which is what signing out means to this app.
  }
}

/**
 * A fresh access token from the stored session, or null when the session itself has
 * expired or been revoked — which is the only case that should send someone back to the
 * sign-in screen.
 *
 * A refresh that simply couldn't reach the server returns the session unchanged. This
 * matters more than it looks: the refresh runs immediately at launch, so treating its
 * failure as "signed out" meant that opening the app on a branch machine with no
 * connection dropped straight to the sign-in screen — where signing in was impossible
 * too, since that needs the network as well. Keeping the session lets the app open on
 * its saved data and pick the connection up when it returns.
 */
export async function refreshSession(
  current: Session,
): Promise<Session | null> {
  try {
    const body = await post("/api/auth/refresh", { session: current.session });
    const next: Session = { ...current, access_token: body.access_token };
    storeSession(next);
    return next;
  } catch (error) {
    return error instanceof AuthRejectedError ? null : current;
  }
}

/**
 * Keeps `session.access_token` fresh for as long as the app is open, and returns a
 * cleanup function. `onSession(null)` means the session itself is gone for good.
 *
 * The token is refreshed **immediately**, not only on the timer: a stored session comes
 * back from a previous run, where its 15-minute token has almost certainly expired. The
 * first version of this waited for the timer, so every launch spent its first ten minutes
 * showing "Couldn't load" on every page — the pages were fine, the token was stale.
 */
export function startSessionRefresh(
  getSession: () => Session | null,
  onSession: (session: Session | null) => void,
): () => void {
  const refreshNow = async (): Promise<void> => {
    const current = getSession();
    if (!current) return;
    onSession(await refreshSession(current));
  };
  void refreshNow();
  const timer = setInterval(refreshNow, REFRESH_INTERVAL_MS);
  return () => clearInterval(timer);
}

/** Seconds of slack, so a token about to expire in flight is treated as expired. */
const EXPIRY_SKEW_SECONDS = 30;

function isExpired(token: string): boolean {
  try {
    const [, payload] = token.split(".");
    const claims = JSON.parse(
      atob(payload.replace(/-/g, "+").replace(/_/g, "/")),
    ) as { exp?: number };
    if (!claims.exp) return false;
    return claims.exp - EXPIRY_SKEW_SECONDS <= Math.floor(Date.now() / 1000);
  } catch {
    // An unreadable token is not worth guessing about — send it and let the 401 path deal
    // with whatever comes back.
    return false;
  }
}

/**
 * Refreshes and retries once when a call to our own API comes back 401.
 *
 * Every page fetches with the access token it was handed, so without this a token that
 * expires mid-session turns into "Couldn't load" on whatever the reader touches next —
 * an error about a token, shown as though the data were missing. Patching `fetch` once
 * here beats threading a retry through fifty call sites, and it is scoped tightly: only
 * requests to this app's API, only a 401, only one retry.
 */
export function installAuthRetry(
  getSession: () => Session | null,
  onSession: (session: Session | null) => void,
): () => void {
  const original = window.fetch;
  // One refresh serves every caller that needs it: a launch fires half a dozen requests
  // at once, and each starting its own refresh would be six round trips for one token.
  let inFlight: Promise<Session | null> | null = null;

  const refreshOnce = async (current: Session): Promise<Session | null> => {
    if (!inFlight) {
      inFlight = refreshSession(current).then((next) => {
        inFlight = null;
        onSession(next);
        return next;
      });
    }
    return inFlight;
  };

  const withToken = (
    input: RequestInfo | URL,
    init: RequestInit | undefined,
    token: string,
  ): RequestInit => {
    const headers = new Headers(
      init?.headers ?? (input instanceof Request ? input.headers : undefined),
    );
    headers.set("Authorization", `Bearer ${token}`);
    return { ...init, headers };
  };

  window.fetch = async (
    input: RequestInfo | URL,
    init?: RequestInit,
  ): Promise<Response> => {
    const url =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.href
          : input.url;
    const ours = url.startsWith(apiBaseUrl) && !url.includes("/api/auth/");

    // A session restored from a previous run almost always carries a dead token, so
    // renew it before spending a request on a 401 that is already known to be coming.
    if (ours) {
      const current = getSession();
      if (current && isExpired(current.access_token)) {
        const next = await refreshOnce(current);
        if (next)
          return original(input, withToken(input, init, next.access_token));
      }
    }

    const response = await original(input, init);
    if (response.status !== 401 || !ours) return response;

    const current = getSession();
    if (!current) return response;
    const next = await refreshOnce(current);
    if (!next) return response;
    return original(input, withToken(input, init, next.access_token));
  };
  return () => {
    window.fetch = original;
  };
}
