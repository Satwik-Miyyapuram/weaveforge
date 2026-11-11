/**
 * Semantic Scholar relay, served from the `app://` origin.
 *
 * The API does send `access-control-allow-origin: *` on a good answer, but
 * not on a 429 — and it rate-limits hard. In a page that means the renderer
 * sees a bare "Failed to fetch" for a throttled call, cannot tell it from a
 * dead network, and cannot retry the way the web app's fetch policy does.
 * The shell answers `/api/semantic-scholar/<path>` itself with `net.fetch`,
 * where no CORS applies: the real status comes back, and a 429 is retried
 * here before the renderer hears about it.
 *
 * Only `api.semanticscholar.org` is reachable, only GET and POST are
 * forwarded, and only the headers the sources set (`x-api-key`,
 * `content-type`) travel upstream.
 */

import { readyCore } from "@/lib/rust-core";
import { refuse, upstreamFailed, type ProxyFetch } from "./proxy-shared";

// --- semantic-scholar-relay (moved from apps/web/src/lib) ---
/** The path the browser calls. `semanticScholarUrl` builds it. */
export const SEMANTIC_SCHOLAR_RELAY_PREFIX = "/api/semantic-scholar/";

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
  return readyCore().semanticScholarTarget(pathname, search) ?? null;
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

export const SEMANTIC_SCHOLAR_PROXY_PREFIX = SEMANTIC_SCHOLAR_RELAY_PREFIX;
const RETRIES = 3;

export function isSemanticScholarProxyRequest(requestUrl: string): boolean {
  return new URL(requestUrl).pathname.startsWith(SEMANTIC_SCHOLAR_PROXY_PREFIX);
}


export async function proxySemanticScholar(
  request: Request,
  fetchFn: ProxyFetch = fetch,
  wait: (ms: number) => Promise<void> = (ms) => new Promise((r) => setTimeout(r, ms)),
): Promise<Response> {
  const url = new URL(request.url);
  const method = request.method.toUpperCase();
  if (method !== "GET" && method !== "POST") return refuse(405, "Method not allowed");
  const target = semanticScholarTarget(url.pathname, url.search);
  if (!target) return refuse(400, "Bad Semantic Scholar path");
  const headers = forwardedHeaders(request.headers);
  const body = method === "POST" ? await request.text() : undefined;

  const send = () =>
    fetchFn(target, {
      method,
      headers,
      ...(body !== undefined ? { body } : {}),
      redirect: "error",
      signal: AbortSignal.timeout(30_000),
    });

  let upstream: Response;
  try {
    upstream = await send();
    for (let attempt = 0; upstream.status === 429 && attempt < RETRIES; attempt++) {
      await wait(1000 * (attempt + 1));
      upstream = await send();
    }
  } catch (error) {
    return upstreamFailed("semantic-scholar", error, 502, "Upstream fetch failed");
  }

  return new Response(await upstream.arrayBuffer(), {
    status: upstream.status,
    statusText: upstream.statusText,
    headers: {
      "content-type": upstream.headers.get("content-type") ?? "application/json",
      "x-content-type-options": "nosniff",
    },
  });
}
