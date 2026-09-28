import { FOLDER_DRAFTS_DIR, parseFolderDraft, type FolderDraft, type IWorkspaceFs } from "@weaveforge/core";

/**
 * Move the local MCP's suggestions from the folder into the review queue.
 *
 * Each file becomes one pending proposal and is then deleted, so a draft is
 * queued once. Files that are not drafts are left alone for the user to see.
 * Nothing here applies a draft: approval stays in the review queue.
 */
export async function importFolderDrafts(
  fs: IWorkspaceFs,
  queue: (draft: FolderDraft) => Promise<unknown>,
): Promise<number> {
  const entries = await fs.list(FOLDER_DRAFTS_DIR).catch(() => []);
  let imported = 0;
  for (const entry of entries) {
    if (entry.kind !== "file" || !entry.path.endsWith(".json")) continue;
    const raw = await fs.readText(entry.path).catch(() => null);
    const draft = raw === null ? null : parseFolderDraft(raw);
    if (!draft) continue;
    await queue(draft);
    await fs.remove(entry.path).catch(() => undefined);
    imported += 1;
  }
  return imported;
}

let running: Promise<number> | null = null;
let again = false;

/** One import at a time; a call during a run schedules one more pass after it. */
export function importFolderDraftsOnce(
  fs: IWorkspaceFs,
  queue: (draft: FolderDraft) => Promise<unknown>,
): Promise<number> {
  if (running) {
    again = true;
    return running;
  }
  running = (async () => {
    let total = 0;
    do {
      again = false;
      total += await importFolderDrafts(fs, queue);
    } while (again);
    return total;
  })().finally(() => {
    running = null;
  });
  return running;
}
