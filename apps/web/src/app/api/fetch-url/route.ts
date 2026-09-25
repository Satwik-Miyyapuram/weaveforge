import { NextResponse } from "next/server";
import { fetchPageTitle, fetchRemoteImage } from "@/backend/net/fetch-for-paste";
import { pasteFetchLimiter } from "@/backend/net/rate-limit";
import { requireSdkUser } from "@/app/api/sdk/_shared";

/**
 * Fetching a page a visitor pasted, on their behalf.
 *
 * Two things ride on this and both have the same shape: read the title behind a
 * pasted link, and download the picture behind a pasted image URL. A browser
 * cannot do either — the site is a different origin and CORS says no — so the
 * server does it, which is exactly the arrangement that turns a paste box into
 * a way into the network. Everything about *what may be fetched* lives in
 * `fetch-for-paste`, which the desktop app calls directly; this route is auth
 * and shaping.
 *
 * Authenticated, because an unauthenticated version of this is a scanning
 * service anybody on the internet can point at anything.
 *
 * `requireSdkUser` — the same helper `pdf-proxy` and `url-meta` use, and the
 * same one the blob routes now use. This route used to carry its own
 * `bearerToken()` + `userIdFromToken()` pair, which was the fourth variant of
 * the same check in this codebase and the one that reported a *configuration*
 * failure as `401 Not authenticated.`: a Supabase URL missing from the
 * deployment told the caller to sign in again, which no amount of signing in
 * would fix. The shared helper answers `500`/`503` for that and `401` only for
 * a genuinely absent or invalid credential.
 *
 * It also accepts an SDK API token, which is the point of consolidating on it:
 * this is an outbound fetch the Python SDK has the same reason to want as the
 * browser does, and the scope check in `requireSdkUser` is what keeps an
 * `mcp_relay`-scoped token out.
 */
export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const target = params.get("url");
  const as = params.get("as") ?? "title";

  if (!target) return NextResponse.json({ error: "url is required" }, { status: 400 });
  if (as !== "title" && as !== "image") {
    return NextResponse.json({ error: "as must be title or image" }, { status: 400 });
  }

  const auth = await requireSdkUser(request);
  if (!auth.ok) return auth.response;

  // Per user, and only for the expensive half: a title is half a kilobyte and a
  // lookup, an image is up to twelve megabytes held in this process on the way
  // through. The bucket is what makes the second one cost the *caller* something.
  if (as === "image") {
    const budget = pasteFetchLimiter.take(auth.userId);
    if (!budget.allowed) {
      return NextResponse.json(
        { error: "Too many image fetches. Try again shortly." },
        { status: 429, headers: { "Retry-After": String(budget.retryAfterSeconds) } },
      );
    }
  }

  if (as === "title") {
    const result = await fetchPageTitle(target);
    return result.ok
      ? NextResponse.json({ title: result.title, url: result.url })
      : NextResponse.json({ error: result.message }, { status: result.status });
  }

  const result = await fetchRemoteImage(target);
  if (!result.ok) return NextResponse.json({ error: result.message }, { status: result.status });

  return new NextResponse(result.body as unknown as BodyInit, {
    status: 200,
    headers: {
      "Content-Type": result.contentType,
      "Content-Length": String(result.body.byteLength),
      // The bytes came from somewhere else; nothing may execute them or read
      // them as anything but the picture they claim to be.
      "Content-Security-Policy": "default-src 'none'; sandbox",
      "X-Content-Type-Options": "nosniff",
      "Content-Disposition": "inline",
      "Cache-Control": "private, max-age=300",
    },
  });
}
