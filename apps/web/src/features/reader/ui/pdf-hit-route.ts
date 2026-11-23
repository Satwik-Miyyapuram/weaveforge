/**
 * Where the reader sends a PDF source the ladder resolved. Pure, so it is tested
 * without a DOM or the wasm core.
 *
 * - `open`: show it in the PDF view now (stored bytes, a same-origin or vault path,
 *   or anything outside local mode).
 * - `download`: an absolute http(s) PDF not on this computer; ask before fetching.
 * - `web-page`: the paper is a web article with no PDF; show its own page instead.
 */
export type PdfHitRoute = "open" | "download" | "web-page";

export interface PdfHitInput {
  url: string;
  resolverId: string;
  localMode: boolean;
  /** Bytes the app already holds (`blob:` or `cache://`). */
  stored: boolean;
  /** The paper is a web article (no PDF of its own), see `isWebArticle`. */
  webArticle: boolean;
}

/** The GitHub-repo step always answers with a guessed path, so for an article that is not a PDF. */
const GITHUB_GUESS = "github-repo";

export function routePdfHit(input: PdfHitInput): PdfHitRoute {
  if (input.webArticle && input.resolverId === GITHUB_GUESS) return "web-page";
  if (!input.localMode || input.stored) return "open";
  return /^https?:\/\//i.test(input.url) ? "download" : "open";
}

/** The host of a URL, or the raw text when it is not an absolute URL. Never throws. */
export function safeHostname(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}
