import type { VaultPage, VaultPageSummary } from "@weaveforge/core";

/**
 * The body text a card, a backlink scan or a hashtag scan can see.
 *
 * Lives here rather than beside `NoteCard` because more than one feature needs
 * it: the notes screen scans the list it renders, and the editor workspace
 * indexes the same list into its document set. A helper that two features share
 * cannot sit under either one's `ui/`, or the second import is a cross-feature
 * `ui/` import and fails `check:solid`.
 *
 * The list holds summaries (title and `bodyPreview`); opening a note replaces
 * its entry with the full page, which is what makes backlinks and transclusion
 * work for the note you are reading. So this takes either shape and prefers the
 * full body when the entry has been hydrated.
 *
 * Written with `in` rather than `page.body || page.bodyPreview` because the
 * declared type no longer promises a `body`: reading one off a summary is how a
 * card edit came to persist an empty body over a real note (review-2 F6). The
 * property test is also what keeps an intentionally empty body (`body: ""`)
 * distinguishable from an unhydrated summary.
 */
export function noteBodyText(page: VaultPageSummary | VaultPage): string {
  const full = "body" in page ? page.body : undefined;
  const preview = "bodyPreview" in page ? page.bodyPreview : undefined;
  return full || preview || "";
}

/**
 * Whether an entry in a screen's list carries its full body yet.
 *
 * The guard callers need before handing an entry to an editor: an editor that
 * seeds its draft from `page.body` would start on `undefined` for a summary, and
 * the first save would then write that emptiness back over the note.
 */
export function isHydratedPage(page: VaultPageSummary | VaultPage): page is VaultPage {
  // `"body" in page` alone is not enough: the repositories' `listSummaries`
  // rows carry `body: ""` beside their `bodyPreview` (`toSummaryDomain`), so
  // the property test alone called every summary hydrated and no tab ever
  // fetched its full text. A preview is the mark of a summary — `VaultPage`
  // keeps it empty on a full page precisely so this can tell them apart.
  if (!("body" in page) || typeof page.body !== "string") return false;
  return !("bodyPreview" in page && page.bodyPreview);
}
