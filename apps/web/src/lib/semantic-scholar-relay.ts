/**
 * The Semantic Scholar relay's policy, shared by both relays: the hosted
 * route (`app/api/semantic-scholar/_relay.ts`) and the desktop shell's
 * (`apps/desktop/src/semantic-scholar-proxy.ts`). The two stay separate
 * modules because they sit in different runtimes; what must not drift is
 * this: one prefix, one upstream host, and two forwarded headers.
 */

/** The path the browser calls. `semanticScholarUrl` builds it. */
export const SEMANTIC_SCHOLAR_RELAY_PREFIX = "/api/semantic-scholar/";
const UPSTREAM = "https://api.semanticscholar.org";

/**
 * Request headers forwarded upstream, and nothing else.
 *
 * `x-api-key` is the caller's own credential and `content-type` is needed for
 * the POST endpoints. Cookies, `authorization` and `referer` are not: the
 * upstream has no use for them, and passing a browser's whole header set to a
 * third party is how a relay leaks a session it was never asked to.
 */
const FORWARDED = ["x-api-key", "content-type"] as const;

/**
 * The upstream address for a relay path, or `null` when the path is not one.
 *
 * No traversal, and no absolute target smuggled in the path: the destination
 * is always the upstream host plus the relay path's remainder.
 */
export function semanticScholarTarget(pathname: string, search: string): string | null {
  if (!pathname.startsWith(SEMANTIC_SCHOLAR_RELAY_PREFIX)) return null;
  const rest = pathname.slice(SEMANTIC_SCHOLAR_RELAY_PREFIX.length);
  if (!rest || rest.includes("..") || rest.startsWith("/") || /^[a-z]+:\/\//i.test(rest)) return null;
  return `${UPSTREAM}/${rest}${search}`;
}

/** The headers sent upstream: JSON accepted, plus the forwarded ones present. */
export function forwardedHeaders(incoming: Headers): Record<string, string> {
  const headers: Record<string, string> = { accept: "application/json" };
  for (const name of FORWARDED) {
    const value = incoming.get(name);
    if (value) headers[name] = value;
  }
  return headers;
}
