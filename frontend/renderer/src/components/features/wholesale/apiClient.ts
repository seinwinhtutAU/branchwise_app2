// The one write helper every wholesale-domain api file (shipmentsApi.ts, receivingsApi.ts,
// customerOrdersApi.ts, ...) funnels through. A write here is never retried automatically
// — lib/network.ts only retries reads, since a write that timed out may already have been
// applied — so a timeout is reported as "reload to see whether it saved" rather than
// silently sent again.
//
// Reads go through React Query (see each page's useQuery/useQueries call), which already
// knows how to retry, and wraps the same apiBaseUrl.

import { apiBaseUrl, type Session } from "@renderer/lib/auth";
import { RequestTimeoutError } from "@renderer/lib/network";
import { invalidateEverything } from "@renderer/lib/queryClient";

export class WholesaleApiError extends Error {}

/** Every write funnels through here: the Bearer header, the body, reading FastAPI's
 *  `detail` as the message on a non-2xx response, and turning a network timeout into a
 *  message that tells the truth — the write may or may not have gone through. Callers
 *  never see a raw fetch. */
export async function request<T>(
  session: Session,
  path: string,
  init: { method: "POST" | "PATCH" | "PUT" | "DELETE"; body?: unknown },
): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${apiBaseUrl}${path}`, {
      method: init.method,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${session.access_token}`,
      },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
    });
  } catch (error) {
    if (error instanceof RequestTimeoutError) {
      throw new WholesaleApiError(
        "The connection timed out. Reload the page to see whether this was saved before trying again — sending it twice could duplicate it.",
      );
    }
    throw new WholesaleApiError(
      "Could not reach the server — check the connection and try again.",
    );
  }

  if (response.status === 204) {
    invalidateEverything();
    return undefined as T;
  }

  const body = await response.json().catch(() => null);
  if (!response.ok) {
    throw new WholesaleApiError(
      body?.detail ?? `Request failed: ${response.status}`,
    );
  }

  invalidateEverything();
  return body as T;
}
