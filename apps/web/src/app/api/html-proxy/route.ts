import { NextResponse } from "next/server";
import { requireSdkUser } from "@/app/api/sdk/_shared";
import { isAllowedPdfProxyUrl } from "@/features/reader/application/sanitize-reader-url";
import { pageFetchLimiter } from "@/backend/net/rate-limit";
import { proxyAllowlistedHtml, proxyAnyHtml } from "./_proxy";

/**
 * Same-origin relay for papers published as web pages (arXiv HTML, PubMed
 * Central, open-access journals, research blogs), for the reader's HTML view
 * and for reading a link's details. Signed-in only. The open-access hosts go
 * through the allowlisted relay; any other page through the address-guarded
 * `safeFetch`, with a per-user budget. The rules live in `./_proxy` because a
 * route module may only export handlers.
 */

export const runtime = "nodejs";

export async function GET(request: Request) {
  const auth = await requireSdkUser(request);
  if (!auth.ok) return auth.response;

  const target = new URL(request.url).searchParams.get("url");
  if (!target) return NextResponse.json({ error: "url is required" }, { status: 400 });
  if (isAllowedPdfProxyUrl(target)) return proxyAllowlistedHtml(target);

  const budget = pageFetchLimiter.take(auth.userId);
  if (!budget.allowed) {
    return NextResponse.json(
      { error: "Too many pages fetched. Try again shortly." },
      { status: 429, headers: { "Retry-After": String(budget.retryAfterSeconds) } },
    );
  }
  return proxyAnyHtml(target);
}
