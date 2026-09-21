/**
 * CORS for the shell's own API calls, settled in the main process.
 *
 * ## Why this exists
 *
 * The bundled app is served from `app://weaveforge`, so every call the renderer
 * makes to `api.weaveforge.org` is cross-origin and goes through CORS. That
 * puts the desktop at the mercy of the server's origin allow-list: the day the
 * deployed Caddyfile does not list `app://weaveforge` — which happened, and was
 * measured as a `403` on the preflight — the installed app cannot sign in and
 * reports the reader's network as down. Nothing on this side of the wire was
 * wrong, and nothing the reader could do would fix it.
 *
 * A shell is not a web page, though. The main process sees every request the
 * renderer makes and every response before the renderer does, so it can settle
 * CORS itself and never depend on the server's list:
 *
 * 1. **Outbound**, the `Origin` header is rewritten to the web app's own host,
 *    `https://app.weaveforge.org`. That origin is always on the allow-list — it
 *    is the deployment — so the preflight answers `204` with the full set of
 *    allowed headers, whatever else the list does or does not name.
 *
 * 2. **Inbound**, `Access-Control-Allow-Origin` is rewritten to the origin the
 *    page actually has, so the renderer's own CORS check accepts the answer
 *    the server gave to a different origin. Everything else the server sent —
 *    allowed headers, methods, exposed headers, max-age — is kept as is,
 *    because Caddy's explicit list is what makes `Authorization` reach
 *    PostgREST; a `*` here would not cover it.
 *
 * Only the API host is touched. Any other origin the page talks to keeps the
 * browser's ordinary rules.
 *
 * The rewrite only ever applies to requests the shell's own window makes, and
 * the window is held to the app's origin by the navigation guard in `main.ts`,
 * so this does not let a foreign page borrow the deployment's identity.
 */
import type { Session } from "electron";

/** The origin every API call is presented as: the deployment's own. */
export const PRESENTED_ORIGIN = "https://app.weaveforge.org";

/** Hosts whose responses are settled here rather than by the renderer. */
export function isApiHost(url: string): boolean {
  try {
    const host = new URL(url).hostname;
    return host === "weaveforge.org" || host.endsWith(".weaveforge.org");
  } catch {
    return false;
  }
}

type Headers = Record<string, string>;
type ResponseHeaders = Record<string, string[]>;

/**
 * Delete every spelling of a header.
 *
 * Header names arrive in whatever case the sender used — Caddy lowercases,
 * Cloudflare does not always — and a second `Access-Control-Allow-Origin` left
 * beside the one set here is refused by the browser as an ambiguous answer,
 * which is exactly the failure this file exists to prevent.
 */
function dropHeader<T>(headers: Record<string, T>, name: string): Record<string, T> {
  const wanted = name.toLowerCase();
  const kept: Record<string, T> = {};
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() !== wanted) kept[key] = value;
  }
  return kept;
}

/** The request's headers as they leave: `Origin` replaced by the presented one. */
export function outboundHeaders(headers: Headers): Headers {
  if (!Object.keys(headers).some((key) => key.toLowerCase() === "origin")) return headers;
  return { ...dropHeader(headers, "origin"), Origin: PRESENTED_ORIGIN };
}

/**
 * The response's headers as the renderer sees them: the allow-origin set to the
 * page's own origin, and every other CORS header the server sent kept.
 */
export function inboundHeaders(headers: ResponseHeaders, pageOrigin: string): ResponseHeaders {
  return {
    ...dropHeader(headers, "access-control-allow-origin"),
    "access-control-allow-origin": [pageOrigin],
  };
}

/** Install both rewrites on a session. Once, at startup. */
export function installApiCors(session: Session, appOrigin: string): void {
  session.webRequest.onBeforeSendHeaders((details, callback) => {
    if (!isApiHost(details.url)) return callback({});
    callback({ requestHeaders: outboundHeaders(details.requestHeaders) });
  });
  session.webRequest.onHeadersReceived((details, callback) => {
    if (!isApiHost(details.url)) return callback({});
    // The response has no record of who asked; the app's own origin is the
    // only page this shell holds, and the navigation guard keeps it so.
    callback({ responseHeaders: inboundHeaders(details.responseHeaders ?? {}, appOrigin) });
  });
}
