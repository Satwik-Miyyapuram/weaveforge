/**
 * Semantic Scholar relay for the hosted web app.
 *
 * `apps/desktop/src/semantic-scholar-proxy.ts` answers this path inside the
 * Electron shell, where the renderer's `app://` origin cannot fetch the API at
 * all. The web app had no equivalent, so the page called
 * `https://api.semanticscholar.org` directly — and the API sends
 * `access-control-allow-origin: *` on a good answer but **not** on a 429. A
 * throttled call therefore reached the reader as a bare "Failed to fetch"
 * indistinguishable from a dead network, and the retry in
 * `lib/semantic-scholar-fetch.ts` had nothing to act on. Through this route the
 * real status comes back, and a 429 is retried here first.
 *
 * Same shape as the desktop relay on purpose: one prefix, one upstream, GET and
 * POST only, and only the headers the sources actually set travel upstream.
 * Only route handlers and route config may be exported from this file, so the
 * forwarding lives in the sibling `_relay.ts` where its tests point.
 */

import { requireSdkUser } from "@/app/api/sdk/_shared";
import { relaySemanticScholar } from "../_relay";

export const runtime = "nodejs";

export async function GET(request: Request) {
  // Authenticated for the reason `/api/url-meta` and `/api/fetch-url` are: a
  // route that fetches an address a caller names, from inside our network, is
  // otherwise an open relay and a bandwidth service for whoever finds it. The
  // upstream is pinned to one host, but the *who* still has to be answered.
  const auth = await requireSdkUser(request);
  if (!auth.ok) return auth.response;

  return relaySemanticScholar(request);
}

export async function POST(request: Request) {
  const auth = await requireSdkUser(request);
  if (!auth.ok) return auth.response;

  return relaySemanticScholar(request);
}
