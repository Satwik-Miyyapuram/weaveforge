import { NextResponse } from "next/server";

/**
 * Same-origin PDF proxy for the read-only reader (Phase D).
 *
 * Publisher hosts (arXiv, OpenReview, …) typically omit CORS headers, so
 * pdf.js cannot fetch them from the browser. This route fetches on the server
 * for an allowlisted set of hosts and streams the bytes back same-origin.
 *
 * Security: only https URLs on the allowlist; no credentials; no redirects off
 * the allowlist. Size is capped so a hostile upstream cannot fill memory.
 */

const ALLOWED_HOSTS = new Set([
  "arxiv.org",
  "www.arxiv.org",
  "export.arxiv.org",
  "openreview.net",
  "www.openreview.net",
]);

const MAX_BYTES = 80 * 1024 * 1024; // 80 MiB

export function isAllowedPdfProxyUrl(raw: string): boolean {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return false;
  }
  if (url.protocol !== "https:") return false;
  if (url.username || url.password) return false;
  return ALLOWED_HOSTS.has(url.hostname.toLowerCase());
}

export async function GET(request: Request) {
  const target = new URL(request.url).searchParams.get("url");
  if (!target) {
    return NextResponse.json({ error: "url is required" }, { status: 400 });
  }
  if (!isAllowedPdfProxyUrl(target)) {
    return NextResponse.json({ error: "URL host is not allowed for PDF proxy" }, { status: 400 });
  }

  const upstream = await fetch(target, {
    redirect: "follow",
    headers: {
      "User-Agent": "weaveforge-reader/1.0 (mailto:noreply@example.com)",
      Accept: "application/pdf,*/*",
    },
  });

  // After redirects, re-check the final URL host.
  if (!isAllowedPdfProxyUrl(upstream.url)) {
    return NextResponse.json({ error: "Redirect left the allowlist" }, { status: 400 });
  }

  if (!upstream.ok || !upstream.body) {
    return NextResponse.json(
      { error: `Upstream returned ${upstream.status}` },
      { status: upstream.status >= 400 && upstream.status < 600 ? upstream.status : 502 },
    );
  }

  const lengthHeader = upstream.headers.get("content-length");
  if (lengthHeader && Number(lengthHeader) > MAX_BYTES) {
    return NextResponse.json({ error: "PDF too large" }, { status: 413 });
  }

  const contentType = upstream.headers.get("content-type") || "application/pdf";
  return new NextResponse(upstream.body, {
    status: 200,
    headers: {
      "content-type": contentType.includes("pdf") ? "application/pdf" : contentType,
      "cache-control": "private, max-age=3600",
    },
  });
}
