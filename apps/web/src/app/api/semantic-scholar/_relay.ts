import { NextResponse } from "next/server";

/**
 * The Semantic Scholar relay's forwarding half.
 *
 * Lives outside `route.ts` because a Next.js App Router route module may only
 * export route handlers and route config — exporting helpers from it fails the
 * production build's route type check. Underscore-prefixed files are ignored by
 * the router, matching `api/pdf-proxy/_proxy.ts` and `api/sdk/_shared.ts`.
 *
 * The desktop shell has the same relay (`apps/desktop/src/semantic-scholar-proxy.ts`).
 * They are kept deliberately parallel rather than shared: the shell's is
 * mounted on `app://` in front of `net.fetch`, this one is a Next route with
 * `requireSdkUser` in front of it, and the two have no module boundary between
 * them that does not drag one runtime into the other. The *policy* is what must
 * not drift, and it is four lines: one prefix, one upstream host, GET and POST
 * only, and only the two headers the sources set.
 */

/** The path the browser calls. `semanticScholarUrl` builds it. */
export const SEMANTIC_SCHOLAR_RELAY_PREFIX = "/api/semantic-scholar/";
const UPSTREAM = "https://api.semanticscholar.org";
const RETRIES = 3;
const TIMEOUT_MS = 30_000;

/**
 * Request headers forwarded upstream, and nothing else.
 *
 * `x-api-key` is the caller's own credential — the reader's sources read it
 * from settings and send it per call — and `content-type` is needed for the
 * POST endpoints. Cookies, `authorization` and `referer` are not forwarded: the
 * upstream has no use for them, and passing a browser's whole header set to a
 * third party is how a relay leaks a session it was never asked to.
 */
const FORWARDED = ["x-api-key", "content-type"] as const;

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
  const rest = url.pathname.slice(SEMANTIC_SCHOLAR_RELAY_PREFIX.length);
  // No traversal, and no absolute target smuggled in the path: the destination
  // is this origin's own path plus the upstream host, always.
  if (!rest || rest.includes("..") || rest.startsWith("/") || /^[a-z]+:\/\//i.test(rest)) {
    return refuse(400, "Bad Semantic Scholar path");
  }
  const target = `${UPSTREAM}/${rest}${url.search}`;

  const headers: Record<string, string> = { accept: "application/json" };
  for (const name of FORWARDED) {
    const value = request.headers.get(name);
    if (value) headers[name] = value;
  }
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
  try {
    upstream = await send();
    for (let attempt = 0; upstream.status === 429 && attempt < RETRIES; attempt++) {
      await wait(1000 * (attempt + 1));
      upstream = await send();
    }
  } catch {
    return refuse(502, "Upstream fetch failed");
  }

  // The status and the body are the upstream's; the headers are not. The API's
  // own `access-control-allow-origin` is meaningless same-origin, and copying
  // a redirect's `location` through would let the browser follow it off-origin.
  return new NextResponse(await upstream.arrayBuffer(), {
    status: upstream.status,
    statusText: upstream.statusText,
    headers: {
      "content-type": upstream.headers.get("content-type") ?? "application/json",
      "x-content-type-options": "nosniff",
      "cache-control": "no-store",
    },
  });
}
