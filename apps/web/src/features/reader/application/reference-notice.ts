/**
 * The popover's one-line status after an action, and which entry it is about.
 *
 * A range like `[2–4]` shows several entries in one popover, one tab each. The
 * notice used to be a bare string shared by every tab, so "Added to library"
 * under one entry stayed on screen when the reader switched to the next and
 * read as if that one had been added too. Tying the notice to an entry index
 * keeps it with the entry it describes.
 */
export interface ReferenceNotice {
  index: number;
  text: string;
}

/** The notice to show under `entryIndex`, or null when it is about another entry. */
export function noticeFor(notice: ReferenceNotice | null, entryIndex: number): string | null {
  return notice && notice.index === entryIndex ? notice.text : null;
}

/** What an add says: a dedupe that found the paper already there did not add it. */
export function addedNotice(created: boolean): string {
  return created ? "Added to library" : "Already in library";
}
