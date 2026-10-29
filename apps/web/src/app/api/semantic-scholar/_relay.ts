import { NextResponse } from "next/server";
import { formatError } from "@/lib/format-error";
import {
  forwardedHeaders,
  SEMANTIC_SCHOLAR_RELAY_PREFIX,
  semanticScholarTarget,
} from "@/lib/semantic-scholar-relay";

/**
 * The Semantic Scholar relay's forwarding half.
 *
 * Lives outside `route.ts` because a Next.js App Router route module may only
 * export route handlers and route config — exporting helpers from it fails the
 * production build's route type check. Underscore-prefixed files are ignored by
 * the router, matching `api/pdf-proxy/_proxy.ts` and `api/sdk/_shared.ts`.
 *
 * The desktop shell has the same relay (`apps/desktop/src/semantic-scholar-proxy.ts`).
 * The two stay separate modules: the shell's is mounted on `app://` in front of
 * `net.fetch`, this one is a Next route with `requireSdkUser` in front of it.
 * The *policy* is shared, from `@/lib/semantic-scholar-relay`: one prefix, one
 * upstream host, no smuggled target, and only the two headers the sources set.
 */

export { SEMANTIC_SCHOLAR_RELAY_PREFIX };
const RETRIES = 3;
const TIMEOUT_MS = 30_000;

function refuse(status: number, error: string): NextResponse {
  return NextResponse.json({ error }, { status });
}

export type RelayFetch = (input: string, init?: RequestInit) => Promise<Response>;

export async function relaySemanticScholar(
  request: Request,
  fetchFn: RelayFetch = fetch,
  wait: (ms: number) => Promise<void> = (ms) => new Promise((r) => setTimeout(r, ms)),
): Promise<Response> {
  const method = request.method.toUpperCase();
  if (method !== "GET" && method !== "POST") return refuse(405, "Method not allowed");

  const url = new URL(request.url);
  const target = semanticScholarTarget(url.pathname, url.search);
  if (!target) return refuse(400, "Bad Semantic Scholar path");
  const headers = forwardedHeaders(request.headers);
  const body = method === "POST" ? await request.text() : undefined;

  const send = () =>
    fetchFn(target, {
      method,
      headers,
      ...(body !== undefined ? { body } : {}),
      // A redirect off the pinned host would make this an open redirector.
      redirect: "error",
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });

  let upstream: Response;
  let payload: ArrayBuffer;
  try {
    upstream = await send();
    for (let attempt = 0; upstream.status === 429 && attempt < RETRIES; attempt++) {
      await wait(1000 * (attempt + 1));
      upstream = await send();
    }
    // Buffered inside the try: the timeout also covers the body, and a read
    // cut off there is the upstream failing, not this route.
    payload = await upstream.arrayBuffer();
  } catch (err) {
    return refuse(502, `Semantic Scholar fetch failed: ${formatError(err)}`);
  }

  // The status and the body are the upstream's; the headers are not. The API's
  // own `access-control-allow-origin` is meaningless same-origin, and copying
  // a redirect's `location` through would let the browser follow it off-origin.
  return new NextResponse(payload, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers: {
      "content-type": upstream.headers.get("content-type") ?? "application/json",
      "x-content-type-options": "nosniff",
      "cache-control": "no-store",
    },
  });
}
