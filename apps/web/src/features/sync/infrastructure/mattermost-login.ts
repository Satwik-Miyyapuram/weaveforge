/**
 * Trades a Mattermost username/password for a session token, the same value a
 * bot token would be: both go out as `Authorization: Bearer <token>`.
 *
 * This is Mattermost's own login endpoint, called from the app's own form with
 * credentials the reader typed — never a token lifted from a browser's cookie
 * store. The session token is returned in the `Token` response header, so the
 * Mattermost admin must both allow this origin in AllowCorsFrom and expose the
 * header via CorsExposedHeaders, or the token cannot be read cross-origin.
 */

function serverOrigin(serverUrl: string): string {
  try {
    const url = new URL(serverUrl);
    if (url.protocol !== "https:" && url.protocol !== "http:") throw new Error();
    return url.origin;
  } catch {
    throw new Error("Mattermost server URL must be a valid http(s) URL.");
  }
}

export async function loginForSessionToken(
  serverUrl: string,
  loginId: string,
  password: string,
  mfaToken?: string,
  fetchFn: typeof fetch = (...a) => fetch(...a),
): Promise<string> {
  const origin = serverOrigin(serverUrl);
  const res = await fetchFn(`${origin}/api/v4/users/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      login_id: loginId,
      password,
      ...(mfaToken ? { token: mfaToken } : {}),
    }),
  });
  if (!res.ok) {
    const d = await res.text().catch(() => "");
    // Mattermost answers a bad password or a missing MFA code with 401; say so
    // plainly rather than leaking the raw body, which may be an HTML error page.
    if (res.status === 401) {
      throw new Error("Mattermost rejected those credentials. Check your username, password and MFA code.");
    }
    throw new Error(`Mattermost sign-in failed (${res.status}). ${d}`.trim());
  }
  const token = res.headers.get("Token");
  if (!token) {
    // The request succeeded but the browser could not see the header: the server
    // is not exposing it to this origin.
    throw new Error(
      "Signed in, but the server did not expose the session token to this origin. Ask the admin to add it to Mattermost's CorsExposedHeaders.",
    );
  }
  return token;
}
