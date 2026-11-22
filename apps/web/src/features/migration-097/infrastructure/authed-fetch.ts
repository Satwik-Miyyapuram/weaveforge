/**
 * A fetch that adds the signed-in user's bearer token to calls under `baseUrl` only.
 * The token is read per request, so a refreshed session is used without rebuilding the
 * source. Other URLs (presigned blob downloads) get no Authorization header: storage
 * rejects one alongside its signature.
 */
export function authedFetch(
  baseUrl: string,
  accessToken: () => Promise<string | null>,
  inner: typeof fetch,
): typeof fetch {
  return async (input, init) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    if (!isUnder(url, baseUrl)) return inner(input, init);
    const token = await accessToken();
    // As fetch does: an init headers object replaces the Request's headers; otherwise the Request's own are kept.
    const headers = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined));
    if (token) headers.set("Authorization", `Bearer ${token}`);
    return inner(input, { ...init, headers });
  };
}

/** True for the base itself or a path or query under it, on the same origin. `rest/v1.evil` is not under `rest/v1`. */
function isUnder(url: string, rawBase: string): boolean {
  const baseUrl = rawBase.replace(/\/+$/, "");
  if (!(url === baseUrl || url.startsWith(`${baseUrl}/`) || url.startsWith(`${baseUrl}?`))) return false;
  return new URL(url).origin === new URL(baseUrl).origin;
}
