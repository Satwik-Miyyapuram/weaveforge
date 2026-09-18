import { desktop } from "@/lib/desktop/desktop-bridge";

/**
 * Where Semantic Scholar is reached from.
 *
 * In a browser the page calls the API directly — it allows any origin on a
 * good answer. In the desktop shell the same call goes to the shell's relay
 * (`apps/desktop/src/semantic-scholar-proxy.ts`), which fetches without
 * CORS: a throttled call then comes back as a 429 the retry below can act
 * on, instead of the "Failed to fetch" the page would see.
 */
export function semanticScholarUrl(path: string): string {
  const rest = path.startsWith("/") ? path.slice(1) : path;
  return desktop() ? `/api/semantic-scholar/${rest}` : `https://api.semanticscholar.org/${rest}`;
}

const RETRIES = 3;

/**
 * Shared Semantic Scholar retry policy for metadata and citation endpoints.
 *
 * A 429 from the API carries no CORS header, so in a page it surfaces as a
 * thrown `TypeError` rather than a status. That throw is retried like a 429;
 * if it never clears, the original error is what the caller gets, so a dead
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
    if (error instanceof TypeError && url.startsWith("https://api.semanticscholar.org/")) return error;
    throw error;
  }
}

function throttled(outcome: Response | TypeError): boolean {
  return outcome instanceof Response ? outcome.status === 429 : true;
}
