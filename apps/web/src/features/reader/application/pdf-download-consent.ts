/**
 * Whether the no-account copy may fetch a paper's PDF from its publisher.
 *
 * Online, with an account, a paper's PDF is fetched the moment it is opened
 * and nobody is asked: the proxy is the app's own server. The no-account copy
 * keeps everything on this computer, so the first reach out to arXiv or
 * OpenReview is something the person should choose — once, if they say so.
 * The answer is kept per browser, next to the other view preferences.
 */

import { isLocalMode } from "@/backend/providers/local/local-identity";
import { desktop } from "@/lib/desktop/desktop-bridge";

const KEY = "thesis.reader.pdfDownload";

/** True when the reader should ask before fetching a PDF for this paper. */
export function pdfDownloadNeedsConsent(): boolean {
  if (!isLocalMode()) return false;
  return !pdfDownloadRemembered();
}

/**
 * True when the copy can fetch a publisher's PDF without an account: the
 * desktop shell serves the proxy itself, and a sign-in is neither needed nor
 * possible. A browser in local mode has no such route — its proxy is the web
 * server's, and that one asks for a token.
 */
export function pdfProxyNeedsToken(): boolean {
  return desktop() === null;
}

export function pdfDownloadRemembered(): boolean {
  try {
    return localStorage.getItem(KEY) === "always";
  } catch {
    return false;
  }
}

export function rememberPdfDownload(always: boolean): void {
  try {
    if (always) localStorage.setItem(KEY, "always");
    else localStorage.removeItem(KEY);
  } catch {
    /* a private window forgets; the prompt returns next time */
  }
}
