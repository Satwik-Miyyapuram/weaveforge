import { desktop } from "@/lib/desktop/desktop-bridge";

/**
 * Where Semantic Scholar is reached from: always our own relay.
 *
 * Both hosts have one, with the same shape — the shell's handler on `app://`
 * (`apps/desktop/src/semantic-scholar-proxy.ts`) and a Next route in the hosted
 * app (`apps/web/src/app/api/semantic-scholar/[...path]/route.ts`). A browser
 * is not a special case any more: it used to call `api.semanticscholar.org`
 * directly, and that API sends `access-control-allow-origin: *` on a good
 * answer but **not** on a 429 — so a throttled lookup arrived as a bare
 * `TypeError`, indistinguishable from a dead network, with no status for the
 * retry below to read. Behind the relay the real status comes back.
 *
 * `desktop()` is read anyway, because the browser and the shell disagree about
 * what a failed relay *means*: see `fetchSemanticScholar`.
 */
export function semanticScholarUrl(path: string): string {
  const rest = path.startsWith("/") ? path.slice(1) : path;
  return `/api/semantic-scholar/${rest}`;
}

const RETRIES = 3;

/**
 * Shared Semantic Scholar retry policy for metadata and citation endpoints.
 *
 * A 429 is retried: the relay has its own three attempts, and these cover the
 * case where it is itself rate-limited by something in front, or where a
 * different instance answered. A thrown `TypeError` is retried too, but only in
 * a browser, and only because there it is ambiguous — a cross-origin refusal, a
 * dropped connection and a relay that is briefly unreachable all look the same.
 * In the shell the relay is in-process, so a `TypeError` is not a throttled
 * lookup and retrying it would just delay the error.
 *
 * If it never clears, the original throw is what the caller gets, so a dead
 * network still reads as one.
 */
export async function fetchSemanticScholar(
  fetchFn: typeof fetch,
  url: string,
  init?: RequestInit,
  wait: (ms: number) => Promise<void> = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
): Promise<Response> {
  let outcome = await attempt(fetchFn, url, init);
  for (let n = 0; throttled(outcome) && n < RETRIES; n++) {
    await wait(1000 * (n + 1));
    outcome = await attempt(fetchFn, url, init);
  }
  if (outcome instanceof Response) return outcome;
  throw outcome;
}

async function attempt(fetchFn: typeof fetch, url: string, init?: RequestInit): Promise<Response | TypeError> {
  try {
    return await fetchFn(url, init);
  } catch (error) {
    // The relay path, and only outside the desktop: see the note above.
    if (error instanceof TypeError && !desktop() && url.startsWith("/api/semantic-scholar/")) return error;
    throw error;
  }
}

function throttled(outcome: Response | TypeError): boolean {
  return outcome instanceof Response ? outcome.status === 429 : true;
}
