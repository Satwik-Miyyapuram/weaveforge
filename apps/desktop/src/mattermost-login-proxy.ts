/**
 * Mattermost sign-in relay, served from the `app://` origin.
 *
 * The web app answers `/api/mattermost/login` with a server route because most
 * Mattermost servers do not expose the `Token` header over CORS. The static
 * bundle has no server routes, so the sign-in form got a 404 from the bundle.
 * The shell posts the same login with `net.fetch` and returns only the token.
 * LDAP accounts (e.g. a NetID) sign in on this same endpoint.
 */

import type { ProxyFetch } from "./semantic-scholar-proxy";

export const MATTERMOST_LOGIN_PATH = "/api/mattermost/login";

interface LoginBody {
  serverUrl?: unknown;
  loginId?: unknown;
  password?: unknown;
  mfaToken?: unknown;
}

export function isMattermostLoginRequest(requestUrl: string): boolean {
  return new URL(requestUrl).pathname === MATTERMOST_LOGIN_PATH;
}

function reply(status: number, body: object): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });
}

const text = (v: unknown): string => (typeof v === "string" ? v : "");

function loginUrl(serverUrl: string): string | null {
  try {
    const url = new URL(serverUrl);
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    return new URL("/api/v4/users/login", url.origin).toString();
  } catch {
    return null;
  }
}

/** Mattermost's own `message` (e.g. LDAP vs MFA), so a 401 says which part failed. */
async function mattermostReason(res: Response): Promise<string | null> {
  try {
    const { message } = (await res.json()) as { message?: unknown };
    return typeof message === "string" && message.trim() ? message.trim().slice(0, 300) : null;
  } catch {
    return null;
  }
}

export async function proxyMattermostLogin(request: Request, fetchFn: ProxyFetch = fetch): Promise<Response> {
  if (request.method.toUpperCase() !== "POST") return reply(405, { error: "Method not allowed" });
  let body: LoginBody;
  try {
    body = (await request.json()) as LoginBody;
  } catch {
    return reply(400, { error: "Invalid request body." });
  }
  const serverUrl = text(body.serverUrl).trim();
  const loginId = text(body.loginId).trim();
  const password = text(body.password);
  const mfaToken = text(body.mfaToken).trim();

  if (!serverUrl) return reply(400, { error: "Mattermost server URL is required." });
  if (!loginId) return reply(400, { error: "Username or email is required." });
  if (!password) return reply(400, { error: "Password is required." });
  const url = loginUrl(serverUrl);
  if (!url) return reply(400, { error: "Mattermost server URL must be a valid http(s) URL." });

  let res: Response;
  try {
    res = await fetchFn(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ login_id: loginId, password, ...(mfaToken ? { token: mfaToken } : {}) }),
      redirect: "error",
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    return reply(502, { error: "Unable to reach the Mattermost server." });
  }
  if (!res.ok) {
    const reason = await mattermostReason(res);
    const status = res.status >= 400 && res.status < 600 ? res.status : 502;
    const generic =
      res.status === 401
        ? "Mattermost rejected those credentials. Check your username, password and MFA code."
        : `Mattermost sign-in failed (${res.status}).`;
    return reply(status, { error: reason ? `Mattermost: ${reason}` : generic });
  }
  await res.body?.cancel().catch(() => {});
  const token = res.headers.get("Token");
  if (!token) return reply(502, { error: "Signed in, but Mattermost did not return a session token." });
  return reply(200, { token });
}
