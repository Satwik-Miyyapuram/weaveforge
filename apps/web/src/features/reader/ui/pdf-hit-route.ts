/**
 * Where the reader sends a PDF source the ladder resolved. Pure, so it is tested
 * without a DOM or the wasm core.
 *
 * - `open`: show it in the PDF view now (stored bytes, a same-origin or vault path,
 *   or anything outside local mode).
 * - `download`: an absolute http(s) PDF not on this computer; ask before fetching.
 * - `web-page`: the paper is a web article with no PDF; show its own page instead.
 * - `none`: the GitHub-repo guess names a file the repo does not hold; there is no PDF.
 */
export type PdfHitRoute = "open" | "download" | "web-page" | "none";

export interface PdfHitInput {
  url: string;
  resolverId: string;
  localMode: boolean;
  /** Bytes the app already holds (`blob:` or `cache://`). */
  stored: boolean;
  /** The paper is a web article (no PDF of its own), see `isWebArticle`. */
  webArticle: boolean;
  /** For a GitHub-repo guess: whether the file is really there (`servedPdfExists`). */
  guessFound?: boolean;
}

/** The GitHub-repo step always answers with a guessed path, so it may name a file that is not there. */
const GITHUB_GUESS = "github-repo";

export function routePdfHit(input: PdfHitInput): PdfHitRoute {
  const guess = input.resolverId === GITHUB_GUESS;
  if (input.webArticle && guess) return "web-page";
  if (guess && input.guessFound === false) return "none";
  if (!input.localMode || input.stored) return "open";
  return /^https?:\/\//i.test(input.url) ? "download" : "open";
}

/**
 * Whether the served file is really there: a HEAD answer of 200. Anything else (a
 * 404 for no such file, a 204 that only says a remote is set) and a failed request
 * count as missing, so the reader falls back rather than opening a 404 in pdf.js.
 */
export async function servedPdfExists(
  url: string,
  fetchFn: (url: string, init?: RequestInit) => Promise<Response> = fetch,
): Promise<boolean> {
  try {
    const res = await fetchFn(url, { method: "HEAD" });
    return res.status === 200;
  } catch {
    return false;
  }
}

/** The host of a URL, or the raw text when it is not an absolute URL. Never throws. */
export function safeHostname(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}
