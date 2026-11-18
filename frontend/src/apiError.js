/**
 * Human-readable message for a failed API call.
 *
 * Prefers the backend's own {error: "..."} body (the shape every Flask route
 * here returns on 4xx/5xx), then the transport/JS error message, then the
 * caller's fallback. Written out inline in ~180 places across the app; prefer
 * this so a caller only has to supply the part that's actually specific — the
 * fallback.
 *
 * Always returns a string. A route that answers {error: {...}} or {error: [...]}
 * would otherwise put a non-string straight into a React child via setError(),
 * which throws — cheap insurance given how many call sites this is meant to take.
 */
export function apiErrorMessage(err, fallback = 'Something went wrong.') {
  const body = err?.response?.data?.error;
  if (typeof body === 'string' && body) return body;
  if (body != null && typeof body !== 'string') return JSON.stringify(body);
  return err?.message || fallback;
}
