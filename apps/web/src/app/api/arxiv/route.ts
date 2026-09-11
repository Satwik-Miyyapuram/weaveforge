import { NextResponse } from "next/server";

/**
 * Server-side proxy for the arXiv Atom API.
 *
 * arXiv does not send CORS headers, so the browser cannot call it directly.
 * The client-side `ArxivMetadataSource` points at this same-origin route, which
 * fetches arXiv from the server (no CORS) and returns the Atom XML verbatim.
 *
 * Unauthenticated, unlike the other outbound routes, and deliberately: the host
 * is fixed and only the id list is the caller's, so this cannot be pointed at
 * anything. What it does need is a deadline — arXiv is still somebody else's
 * server, and `fetch` with no signal waits as long as they care to take.
 *
 * Two things are bounded here, and both are cheap: the size of the id list and
 * the reuse of an answer. Neither is a rate limit.
 *
 * ## Rate limiting: what is here and what is not
 *
 * There is no general rate limiter in this application. The one rate limiter in
 * the schema is `check_share_link_rate(bucket, max_attempts, window)`
 * (migration 0049), and it was considered for this route and deliberately not
 * used:
 *
 *   * Its bucket key is the caller's identity, and for an unauthenticated route
 *     the only candidate is `x-forwarded-for` — which the caller writes. The
 *     repository has no trusted-proxy configuration anywhere (no `x-forwarded-for`
 *     reader, no `TRUSTED_PROXY_*` variable), so a limiter keyed on a header the
 *     caller chooses is a limiter the caller turns off by changing it.
 *   * The function is granted to `service_role` only, and reaching it from here
 *     would make an unauthenticated route depend on the service-role key. On a
 *     deployment without it the limiter would have to fail open — silently,
 *     which is the same behaviour as not having one while reading as though it
 *     were enforced.
 *
 * So the honest state is: `id_list` is capped and the response is cacheable,
 * which bounds the per-request cost and discourages a repeat; a per-caller rate
 * limit remains open. Doing it properly needs a trusted client identity (a
 * proxy allowlist) and a decision about failing open or closed, and belongs in
 * one place that every outbound route uses rather than bolted onto this one.
 */

/** Long enough for a slow day at arXiv, short enough not to pin a request open. */
const TIMEOUT_MS = 10_000;

/**
 * Longest `id_list` accepted, in characters.
 *
 * Not a formatting rule: each id becomes a result in arXiv's answer, and the
 * whole answer is read into memory and then forwarded. arXiv's own guidance is
 * to ask for few ids at a time and to cache the result, so the cap is set at
 * what a large library import needs (roughly 200 ids of 20 characters) rather
 * than at what the URL could carry.
 */
const MAX_ID_LIST_CHARS = 4_000;

/**
 * Cache policy for an answer that is a pure function of the request.
 *
 * No caller's data is in the response, so a shared cache may hold it — and
 * holding it is the point: arXiv asks callers not to re-ask, and an Atom feed
 * for a fixed id list does not change between two imports a minute apart.
 */
const CACHE_CONTROL = "public, max-age=600, s-maxage=3600, stale-while-revalidate=86400";

export async function GET(request: Request) {
  const idList = new URL(request.url).searchParams.get("id_list");
  if (!idList) {
    return NextResponse.json({ error: "id_list is required" }, { status: 400 });
  }
  if (idList.length > MAX_ID_LIST_CHARS) {
    return NextResponse.json(
      { error: `id_list must be at most ${MAX_ID_LIST_CHARS} characters.` },
      { status: 400 },
    );
  }
  const upstream = `https://export.arxiv.org/api/query?id_list=${encodeURIComponent(idList)}`;
  const res = await fetch(upstream, {
    headers: { "User-Agent": "weaveforge (mailto:noreply@example.com)" },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  }).catch(() => null);
  if (!res) {
    return NextResponse.json({ error: "arXiv did not answer in time." }, { status: 504 });
  }
  const body = await res.text();
  return new NextResponse(body, {
    status: res.status,
    headers: {
      "content-type": "application/atom+xml; charset=utf-8",
      // Only a success is worth caching; an error body from arXiv must not be
      // stored under this URL for an hour.
      ...(res.ok ? { "cache-control": CACHE_CONTROL } : { "cache-control": "no-store" }),
    },
  });
}
