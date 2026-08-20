import { NextResponse } from "next/server";
import { fetchPageTitle, fetchRemoteImage } from "@/backend/net/fetch-for-paste";
import { bearerToken, userIdFromToken } from "@/storage/server/blob-api";

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
 */
export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const target = params.get("url");
  const as = params.get("as") ?? "title";

  if (!target) return NextResponse.json({ error: "url is required" }, { status: 400 });
  if (as !== "title" && as !== "image") {
    return NextResponse.json({ error: "as must be title or image" }, { status: 400 });
  }

  const token = bearerToken(request);
  if (!token) return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
  try {
    await userIdFromToken(token);
  } catch {
    return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
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
