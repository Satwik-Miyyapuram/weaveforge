import { safeHostname } from "./pdf-hit-route";

/**
 * What the reader shows for a web-article paper that has no PDF. Pure, so it is
 * tested without a DOM.
 *
 * - `kept`: a full-text page kept earlier; show it.
 * - `fetch`: no kept page yet; fetch it and keep it (the free-copy search does this).
 * - `live`: the fetch failed; offer the live page, opened in the browser.
 * - `sign-in`: the web reader is signed out, so the relay refuses the page;
 *   say so instead of offering a live page as if the fetch had failed.
 * - `none`: the article has no page address to show.
 *
 * A web article never gets a PDF download prompt.
 */
export type WebArticlePlan =
  | { kind: "kept" }
  | { kind: "fetch" }
  | { kind: "live"; url: string; host: string }
  | { kind: "sign-in"; host: string }
  | { kind: "none" };

export interface WebArticleInput {
  /** A full-text page is already kept for this paper. */
  kept: boolean;
  /** The paper's own page address (`OpenAccessIds.pageUrl`). */
  pageUrl: string | null | undefined;
  /** The last attempt to fetch the page failed. */
  fetchFailed: boolean;
  /** Web app and signed out: the relay will refuse the fetch without a token. */
  needsSignIn?: boolean;
}

export function planWebArticle(input: WebArticleInput): WebArticlePlan {
  if (input.kept) return { kind: "kept" };
  const url = webPageUrl(input.pageUrl);
  if (!url) return { kind: "none" };
  if (input.needsSignIn) return { kind: "sign-in", host: safeHostname(url) };
  if (input.fetchFailed) return { kind: "live", url, host: safeHostname(url) };
  return { kind: "fetch" };
}

/**
 * Whether the reader can fetch web pages. `signed-out` only when the reader needs a
 * token (the web app) and has none; a token lookup that fails is `unknown`, so the
 * fetch decides instead of a sign-in card. Local and desktop never need sign-in.
 */
export type AccountState = "signed-in" | "signed-out" | "unknown";

export async function resolveAccount(
  needsToken: boolean,
  getAccessToken: () => Promise<string | null>,
): Promise<AccountState> {
  if (!needsToken) return "signed-in";
  try {
    return (await getAccessToken()) ? "signed-in" : "signed-out";
  } catch {
    return "unknown";
  }
}

/** Only a plain web address may be linked from the reader: no javascript:, file: or data:. */
function webPageUrl(raw: string | null | undefined): string | null {
  const url = raw?.trim() ?? "";
  if (!url) return null;
  try {
    const protocol = new URL(url).protocol;
    return protocol === "http:" || protocol === "https:" ? url : null;
  } catch {
    return null;
  }
}
