/**
 * Account deletion relay, served from the `app://` origin.
 *
 * Settings → Delete account posts to `/api/account/delete-user/otp` and then
 * `/api/account/delete-user`. Both are server routes holding the service-role
 * key; the static bundle has neither, so on the desktop each call fell through
 * to the bundle's 404 page and the panel showed a JSON parse error instead of
 * sending the code. The shell relays exactly those two paths, POST only, to the
 * hosted app.
 */

import { relayToHostedApp } from "./blob-proxy";
import { refuse, type ProxyFetch } from "./proxy-shared";

export const ACCOUNT_PROXY_PATHS: readonly string[] = [
  "/api/account/delete-user",
  "/api/account/delete-user/otp",
];

export function isAccountProxyRequest(requestUrl: string): boolean {
  return ACCOUNT_PROXY_PATHS.includes(new URL(requestUrl).pathname);
}

export function proxyAccount(request: Request, fetchFn: ProxyFetch = fetch): Promise<Response> {
  if (request.method.toUpperCase() !== "POST") return Promise.resolve(refuse(405, "Method not allowed"));
  return relayToHostedApp(request, new URL(request.url).pathname, fetchFn);
}
