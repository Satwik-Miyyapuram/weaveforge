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
 */

/** Long enough for a slow day at arXiv, short enough not to pin a request open. */
const TIMEOUT_MS = 10_000;
export async function GET(request: Request) {
  const idList = new URL(request.url).searchParams.get("id_list");
  if (!idList) {
    return NextResponse.json({ error: "id_list is required" }, { status: 400 });
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
    headers: { "content-type": "application/atom+xml; charset=utf-8" },
  });
}
