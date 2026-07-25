import { NextResponse } from "next/server";

/**
 * Server-side proxy for the arXiv Atom API.
 *
 * arXiv does not send CORS headers, so the browser cannot call it directly.
 * The client-side `ArxivMetadataSource` points at this same-origin route, which
 * fetches arXiv from the server (no CORS) and returns the Atom XML verbatim.
 */
export async function GET(request: Request) {
  const idList = new URL(request.url).searchParams.get("id_list");
  if (!idList) {
    return NextResponse.json({ error: "id_list is required" }, { status: 400 });
  }
  const upstream = `https://export.arxiv.org/api/query?id_list=${encodeURIComponent(idList)}`;
  const res = await fetch(upstream, {
    headers: { "User-Agent": "thesis-tracker (mailto:noreply@example.com)" },
  });
  const body = await res.text();
  return new NextResponse(body, {
    status: res.status,
    headers: { "content-type": "application/atom+xml; charset=utf-8" },
  });
}
