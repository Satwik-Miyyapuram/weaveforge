/**
 * `⌘D`: a copy of the note on screen, beside it, titled "X (copy)".
 *
 * Pure, so the title rule and the "is this a note" question are testable; the
 * screen hands the plan to the same create call the explorer uses.
 */

import type { Document } from "./workspace-load";

type Source = Pick<Document, "kind" | "title" | "body" | "hydrated" | "parentId">;

export interface DuplicatePlan {
  title: string;
  parentId: string | undefined;
  body: string;
}

const NOTE_KINDS = new Set(["vault_page", "ink_page"]);

/**
 * What to create, or `null` when the document is not a note or its body is
 * still the preview (copying that would cut the note at 320 characters).
 */
export function duplicatePlan(
  doc: Source | undefined,
  documents: readonly Source[],
  titleKey: (title: string) => string = (title) => title.toLowerCase(),
): DuplicatePlan | null {
  if (!doc || !NOTE_KINDS.has(doc.kind) || !doc.hydrated) return null;
  // Note titles are unique across the vault (a taken one would open, not
  // create), so the copy takes the first free one.
  const taken = new Set(documents.filter((d) => NOTE_KINDS.has(d.kind)).map((d) => titleKey(d.title)));
  let title = `${doc.title} (copy)`;
  for (let n = 2; taken.has(titleKey(title)); n += 1) title = `${doc.title} (copy ${n})`;
  return { title, parentId: doc.parentId, body: doc.body };
}
