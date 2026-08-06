import { idbSetSearchIndex } from "./search-index-idb";

/**
 * Whether an index is worth persisting, and where.
 *
 * The cache is not free: a 15 000-document index serializes to about 110 MB.
 * In an installed app that is a reasonable thing to keep — it is the user's own
 * device, they chose to install, and the payoff is a cold start that rehydrates
 * in half a second instead of rebuilding for ten. In a browser tab it is not:
 * the visit may be a one-off on a shared or borrowed machine, storage there is
 * evictable under pressure anyway, and writing a hundred megabytes to earn a
 * cache the browser may drop before the next visit is a bad trade.
 *
 * So the rule is by surface, not by device. Installed app: persist whatever it
 * is. Website: persist up to a threshold, and above it rebuild each session —
 * which, now that the build happens in a worker, costs background time rather
 * than a frozen tab.
 */

/**
 * Documents past which the website stops persisting.
 *
 * Chosen from the measured curve rather than a round number: at 5 000 documents
 * the serialized index is roughly 37 MB, which is the point where writing it
 * starts to cost more than the rebuild it saves.
 */
export const WEB_CACHE_DOCUMENT_LIMIT = 5_000;

/**
 * Is this the installed app rather than a browser tab?
 *
 * Three signals because no single one covers every platform: the standard
 * display-mode query (installed PWAs and TWAs on desktop and Android), the
 * legacy iOS Safari flag, and the Android TWA referrer, which is the only tell
 * when a trusted web activity has not yet matched the display mode.
 */
export function isInstalledApp(): boolean {
  if (typeof window === "undefined") return false;
  try {
    if (window.matchMedia?.("(display-mode: standalone)").matches) return true;
    if (window.matchMedia?.("(display-mode: fullscreen)").matches) return true;
    if ((window.navigator as { standalone?: boolean }).standalone === true) return true;
    return document.referrer.startsWith("android-app://");
  } catch {
    return false;
  }
}

export function shouldPersistIndex(documentCount: number): boolean {
  return isInstalledApp() || documentCount <= WEB_CACHE_DOCUMENT_LIMIT;
}

/**
 * Persist an index, if this surface should.
 *
 * The payload is a thunk rather than a string so a build that will not be
 * cached never serializes at all — serializing is itself a second-scale stall
 * on a large corpus, and paying it to then discard the result is the worst of
 * both.
 */
export async function persistSearchIndex(
  projectId: string | null,
  serialize: () => string,
  documentCount: number,
): Promise<void> {
  if (!shouldPersistIndex(documentCount)) return;
  await idbSetSearchIndex(projectId, serialize());
}
