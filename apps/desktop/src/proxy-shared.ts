import { errorMessage, isIpAddress, isPublicAddress } from "@weaveforge/core";

/** What every shell proxy shares: its injectable fetch, its error answer, and its host rule. */

export type ProxyFetch = (input: string, init?: RequestInit) => Promise<Response>;

/** A JSON `{ error }` answer with the given status. */
export function refuse(status: number, error: string): Response {
  return new Response(JSON.stringify({ error }), {
    status,
    headers: { "content-type": "application/json" },
  });
}

/**
 * `refuse`, for when upstream could not be reached or broke off: the page gets
 * the plain refusal, and the log gets why (with the cause, which is where
 * Node's fetch keeps the useful part: `fetch failed (getaddrinfo ENOTFOUND …)`).
 */
export function upstreamFailed(
  proxy: string,
  error: unknown,
  status: number,
  refusal: string,
  warn: (line: string) => void = console.warn,
): Response {
  const cause = error instanceof Error && error.cause !== undefined ? ` (${errorMessage(error.cause)})` : "";
  warn(`[proxy:${proxy}] ${refusal}: ${`${errorMessage(error)}${cause}`.slice(0, 300)}`);
  return refuse(status, refusal);
}

/**
 * A host this machine or its network answers for: `localhost`, loopback, the
 * private ranges, link-local (which includes the cloud metadata address) and
 * every other address core's `isPublicAddress` refuses. Literal addresses and
 * `localhost` names only; a name that *resolves* to one is not caught here,
 * because that would take a resolver the shell does not have.
 */
export function isPrivateHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, "").replace(/\.$/, "");
  if (host === "localhost" || host.endsWith(".localhost")) return true;
  return isIpAddress(host) && !isPublicAddress(host);
}

/** An https address without credentials on a public host. */
export function isPublicHttpsUrl(raw: string): boolean {
  try {
    const url = new URL(raw);
    return url.protocol === "https:" && !url.username && !url.password && !isPrivateHost(url.hostname);
  } catch {
    return false;
  }
}

const MAX_REDIRECTS = 5;

/** `url` is the last address asked for: where the chain ended when the response does not say. */
export type CheckedFetch = { ok: true; response: Response; url: string } | { ok: false; refusal: Response };

/**
 * Fetch `target`, following redirects one hop at a time so each address is
 * held to `allowed` before it is fetched, not only the one the chain ended on.
 *
 * An `opaqueredirect` (a fetch that will not show where it is going) is
 * followed blind only when `followOpaque` says the host is trusted to; the
 * final address is checked either way.
 */
export async function fetchCheckedHops(
  target: string,
  allowed: (url: string) => boolean,
  fetchFn: ProxyFetch,
  init: { headers: Record<string, string>; signal: AbortSignal },
  followOpaque: boolean,
  /** Names the proxy in the log when the fetch fails. */
  proxy: string,
): Promise<CheckedFetch> {
  let response: Response;
  let at = target;
  try {
    for (let hop = 0; ; hop++) {
      response = await fetchFn(at, { ...init, redirect: "manual" });
      const next = response.status >= 300 && response.status < 400 ? response.headers.get("location") : null;
      if (next) {
        if (hop >= MAX_REDIRECTS) return { ok: false, refusal: refuse(502, "Too many redirects") };
        at = new URL(next, at).toString();
        if (!allowed(at)) return { ok: false, refusal: refuse(400, "Redirect target not allowed") };
        continue;
      }
      if (response.type === "opaqueredirect") {
        if (!followOpaque) return { ok: false, refusal: refuse(502, "Redirect could not be checked") };
        response = await fetchFn(at, { ...init, redirect: "follow" });
      }
      break;
    }
  } catch (error) {
    return { ok: false, refusal: upstreamFailed(proxy, error, 502, "Upstream fetch failed") };
  }
  if (response.url && !allowed(response.url)) {
    return { ok: false, refusal: refuse(400, "Redirect target not allowed") };
  }
  return { ok: true, response, url: response.url || at };
}
