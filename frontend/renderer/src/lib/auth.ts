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

export const apiBaseUrl = import.meta.env.VITE_API_BASE_URL || 'http://127.0.0.1:8000'

const STORAGE_KEY = 'branchwise:session'

// A Neon Auth JWT lives 15 minutes. Refreshing at 10 leaves room for a slow network and
// for a laptop that was asleep, without hammering the endpoint.
const REFRESH_INTERVAL_MS = 10 * 60 * 1000

export interface SessionUser {
  id: string
  email: string
  name?: string
}

export interface Session {
  /** The bearer token every API call carries. Short-lived; refreshed in the background. */
  access_token: string
  /** The long-lived opaque session that mints new access tokens. Never sent to the API. */
  session: string
  user: SessionUser
}

interface AuthResponse {
  access_token: string
  session: string
  user?: { id?: string; email?: string; name?: string }
}

function toSession(body: AuthResponse, fallbackEmail: string): Session {
  return {
    access_token: body.access_token,
    session: body.session,
    user: {
      id: body.user?.id ?? '',
      email: body.user?.email ?? fallbackEmail,
      name: body.user?.name
    }
  }
}

async function post(path: string, payload: unknown): Promise<AuthResponse> {
  const response = await fetch(`${apiBaseUrl}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  })
  const body = await response.json().catch(() => null)
  if (!response.ok) {
    // The backend forwards Neon Auth's own message ("Invalid email or password"), which
    // is what the sign-in screen should show.
    throw new Error(body?.detail ?? body?.message ?? `Sign-in failed (${response.status})`)
  }
  return body as AuthResponse
}

export function storeSession(session: Session | null): void {
  try {
    if (session) localStorage.setItem(STORAGE_KEY, JSON.stringify(session))
    else localStorage.removeItem(STORAGE_KEY)
  } catch {
    // A session that cannot be persisted still works for this run — the person just
    // signs in again next launch.
  }
}

export function loadStoredSession(): Session | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as Session
    return parsed?.access_token && parsed?.session ? parsed : null
  } catch {
    return null
  }
}

export async function signIn(email: string, password: string): Promise<Session> {
  const session = toSession(await post('/api/auth/login', { email, password }), email)
  storeSession(session)
  return session
}

export async function signUp(email: string, password: string, name: string): Promise<Session> {
  const session = toSession(await post('/api/auth/signup', { email, password, name }), email)
  storeSession(session)
  return session
}

export async function signOut(session: Session | null): Promise<void> {
  storeSession(null)
  if (!session) return
  try {
    await post('/api/auth/logout', { session: session.session })
  } catch {
    // The local copy is already gone, which is what signing out means to this app.
  }
}

/**
 * A fresh access token from the stored session, or null when the session itself has
 * expired or been revoked — which is the only case that should send someone back to the
 * sign-in screen.
 */
export async function refreshSession(current: Session): Promise<Session | null> {
  try {
    const body = await post('/api/auth/refresh', { session: current.session })
    const next: Session = { ...current, access_token: body.access_token }
    storeSession(next)
    return next
  } catch {
    return null
  }
}

/**
 * Keeps `session.access_token` fresh for as long as the app is open. Returns a cleanup
 * function. `onSession(null)` means the session is gone for good.
 */
export function startSessionRefresh(
  getSession: () => Session | null,
  onSession: (session: Session | null) => void
): () => void {
  const timer = setInterval(async () => {
    const current = getSession()
    if (!current) return
    onSession(await refreshSession(current))
  }, REFRESH_INTERVAL_MS)
  return () => clearInterval(timer)
}
