/**
 * What the reader shows for a web-article paper that has no PDF. Pure, so it is
 * tested without a DOM.
 *
 * - `kept`: a full-text page kept earlier; show it.
 * - `fetch`: no kept page yet; fetch it and keep it (the free-copy search does this).
 * - `live`: the fetch failed; offer the live page, opened in the browser.
 * - `none`: the article has no page address to show.
 *
 * A web article never gets a PDF download prompt.
 */
export type WebArticlePlan =
  | { kind: "kept" }
  | { kind: "fetch" }
  | { kind: "live"; url: string; host: string }
  | { kind: "none" };

export interface WebArticleInput {
  /** A full-text page is already kept for this paper. */
  kept: boolean;
  /** The paper's own page address (`OpenAccessIds.pageUrl`). */
  pageUrl: string | null | undefined;
  /** The last attempt to fetch the page failed. */
  fetchFailed: boolean;
}

export function planWebArticle(input: WebArticleInput): WebArticlePlan {
  if (input.kept) return { kind: "kept" };
  const url = input.pageUrl?.trim() ?? "";
  if (!url) return { kind: "none" };
  if (input.fetchFailed) return { kind: "live", url, host: hostOf(url) };
  return { kind: "fetch" };
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}
