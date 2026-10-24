import { normalizeTitleKey } from "@weaveforge/core";

export interface CreateNoteFromLinkDeps {
  /** Notes already known, matched by title the way titles are kept unique. */
  existing: readonly { id: string; title: string }[];
  add(title: string): Promise<{ id: string }>;
  reload(): Promise<void>;
  open(id: string): void;
}

/**
 * Resolve a `[[title]]` to a note: reuse one with the same title, else create
 * it. The editor creates notes for finished links with `open: false`, so the
 * note being typed in stays open. Returns the note id, or null for a blank title.
 */
export async function createNoteFromLink(
  title: string,
  opts: { open?: boolean } | undefined,
  deps: CreateNoteFromLinkDeps,
): Promise<string | null> {
  const key = normalizeTitleKey(title);
  if (!key) return null;
  const found = deps.existing.find((p) => normalizeTitleKey(p.title) === key);
  let id = found?.id;
  if (!id) {
    id = (await deps.add(title)).id;
    await deps.reload();
  }
  if (opts?.open !== false) deps.open(id);
  return id;
}
