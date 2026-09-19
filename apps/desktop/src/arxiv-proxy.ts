/**
 * arXiv relay, served from the `app://` origin.
 *
 * The web app answers `/api/arxiv` with a server route because arXiv sends no
 * CORS headers. The static bundle the shell serves has no server routes, so a
 * "Read later" on a reference with an arXiv id resolved to a 404 from the
 * bundle itself. The shell answers the same path with `net.fetch`, where no
 * CORS applies, and returns the Atom XML verbatim.
 *
 * Only `export.arxiv.org` is reachable, only GET is forwarded, and only the
 * `id_list` query travels upstream — the same bounds as the web route.
 */

import type { ProxyFetch } from "./semantic-scholar-proxy";

export const ARXIV_PROXY_PATH = "/api/arxiv";
const UPSTREAM = "https://export.arxiv.org/api/query";
/** Same cap as the web route: each id is a result read into memory. */
const MAX_ID_LIST_CHARS = 4_000;

export function isArxivProxyRequest(requestUrl: string): boolean {
  return new URL(requestUrl).pathname === ARXIV_PROXY_PATH;
}

function refuse(status: number, error: string): Response {
  return new Response(JSON.stringify({ error }), {
    status,
    headers: { "content-type": "application/json" },
  });
}

export async function proxyArxiv(request: Request, fetchFn: ProxyFetch = fetch): Promise<Response> {
  if (request.method.toUpperCase() !== "GET") return refuse(405, "Method not allowed");
  const idList = new URL(request.url).searchParams.get("id_list");
  if (!idList) return refuse(400, "id_list is required");
  if (idList.length > MAX_ID_LIST_CHARS) {
    return refuse(400, `id_list must be at most ${MAX_ID_LIST_CHARS} characters.`);
  }

  let upstream: Response;
  try {
    upstream = await fetchFn(`${UPSTREAM}?id_list=${encodeURIComponent(idList)}`, {
      method: "GET",
      headers: { "User-Agent": "weaveforge (mailto:noreply@example.com)" },
      redirect: "error",
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    return refuse(502, "Upstream fetch failed");
  }
  if (!upstream.ok) return refuse(502, `arXiv responded ${upstream.status}`);

  return new Response(await upstream.arrayBuffer(), {
    status: 200,
    headers: {
      "content-type": upstream.headers.get("content-type") ?? "application/atom+xml; charset=utf-8",
      "x-content-type-options": "nosniff",
    },
  });
}
