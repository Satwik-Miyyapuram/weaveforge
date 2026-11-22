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
    if (!url.startsWith(baseUrl)) return inner(input, init);
    const token = await accessToken();
    const headers = new Headers(init?.headers);
    if (token) headers.set("Authorization", `Bearer ${token}`);
    return inner(input, { ...init, headers });
  };
}
