import { NextResponse } from "next/server";
import { requireSdkUser } from "@/app/api/sdk/_shared";
import { isAllowedPdfProxyUrl } from "@/features/reader/application/sanitize-reader-url";
import { proxyAllowlistedPdf } from "./_proxy";

/**
 * Same-origin PDF proxy for the read-only reader (Phase D).
 *
 * Publisher hosts (arXiv, OpenReview, …) typically omit CORS headers, so
 * pdf.js cannot fetch them from the browser. This route fetches on the server
 * for an allowlisted set of hosts and streams the bytes back same-origin.
 *
 * Only route handlers and route config may be exported from this file — the
 * fetch/redirect/sniffing logic lives in `./_proxy` so the production build's
 * route type check passes.
 */

export const runtime = "nodejs";

export async function GET(request: Request) {
  const auth = await requireSdkUser(request);
  if (!auth.ok) return auth.response;

  const target = new URL(request.url).searchParams.get("url");
  if (!target) {
    return NextResponse.json({ error: "url is required" }, { status: 400 });
  }
  if (!isAllowedPdfProxyUrl(target)) {
    return NextResponse.json({ error: "URL host is not allowed for PDF proxy" }, { status: 400 });
  }

  return proxyAllowlistedPdf(target);
}
