import { requireSdkUser } from "@/app/api/sdk/_shared";
import { resolveUrlMetadata } from "./_meta";

/**
 * Extract paper metadata from an arbitrary URL.
 *
 * Authenticated, for the same reason `/api/fetch-url` is: a route that fetches
 * any address a caller names, from inside our network, is a scanning and
 * bandwidth service for whoever finds it. The address guard decides *where* it
 * may go; this decides *who* may ask. It was open until now, which was an
 * oversight rather than a decision — the reasoning had been written down one
 * route over and not applied here.
 *
 * `requireSdkUser` rather than a bare token check because it is what the other
 * outbound fetcher, `pdf-proxy`, uses: it accepts a browser session and an SDK
 * API token alike, so importing a paper works from the app and from a script.
 *
 * Everything about *what* is fetched and parsed lives in `./_meta`, which is
 * where its tests point.
 */
export async function GET(request: Request) {
  const auth = await requireSdkUser(request);
  if (!auth.ok) return auth.response;

  return resolveUrlMetadata(new URL(request.url).searchParams.get("url"));
}
