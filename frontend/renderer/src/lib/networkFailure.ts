/**
 * Only failures that prove the request could not travel to the API belong to the
 * connection indicator. API validation, permission, and server errors are returned as
 * HTTP responses; wrapper code may also throw ordinary Errors after receiving one.
 */
export function isTransportFailure(error: unknown, timedOut: boolean): boolean {
  if (timedOut) return true;
  if (error instanceof TypeError) return true;
  return (
    error instanceof Error &&
    (error.name === "NetworkError" || error.name === "AbortError")
  );
}
