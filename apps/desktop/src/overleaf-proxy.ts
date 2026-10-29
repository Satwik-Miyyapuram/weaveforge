/**
 * Overleaf Workshop relay, served from the `app://` origin.
 *
 * The Workshop panel signs in with an Overleaf session cookie, lists projects,
 * compiles and fetches the PDF through `/api/overleaf/workshop/*`. Those are
 * server routes that seal the cookie and talk to Overleaf; the static bundle
 * has none, so the shell relays exactly those paths to the hosted app. The
 * user's bearer token goes along; the Overleaf cookie stays in the body, as on
 * the web.
 */

import { relayToHostedApp } from "./blob-proxy";
import { refuse, type ProxyFetch } from "./proxy-shared";

/** Each Workshop route and the methods its server route answers. */
const OVERLEAF_PROXY_ROUTES: Readonly<Record<string, readonly string[]>> = {
  "/api/overleaf/workshop/session": ["POST", "DELETE"],
  "/api/overleaf/workshop/projects": ["POST"],
  "/api/overleaf/workshop/compile": ["POST"],
  "/api/overleaf/workshop/pdf": ["POST"],
};

export function isOverleafProxyRequest(requestUrl: string): boolean {
  return Object.hasOwn(OVERLEAF_PROXY_ROUTES, new URL(requestUrl).pathname);
}

export function proxyOverleaf(request: Request, fetchFn: ProxyFetch = fetch): Promise<Response> {
  const { pathname, search } = new URL(request.url);
  if (!OVERLEAF_PROXY_ROUTES[pathname]?.includes(request.method.toUpperCase())) {
    return Promise.resolve(refuse(405, "Method not allowed"));
  }
  return relayToHostedApp(request, pathname + search, fetchFn);
}
