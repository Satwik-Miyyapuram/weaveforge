import { FOLDER_DRAFTS_DIR, parseFolderDraft, type FolderDraft, type IWorkspaceFs } from "@weaveforge/core";

/**
 * Move the local MCP's suggestions from the folder into the review queue.
 *
 * Each file is deleted and then queued as one pending proposal, so a draft is
 * queued once: a file that cannot be deleted is skipped, and a draft the queue
 * refuses is written back for the next pass. One refusal does not hold back
 * the rest; the first error is thrown once every draft has been tried.
 * Files that are not drafts are left alone for the user to see.
 * A draft for another project waits until that project is open.
 * Nothing here applies a draft: approval stays in the review queue.
 */
export async function importFolderDrafts(
  fs: IWorkspaceFs,
  queue: (draft: FolderDraft) => Promise<unknown>,
  projectId?: string,
): Promise<number> {
  const entries = await fs.list(FOLDER_DRAFTS_DIR).catch(() => []);
  let imported = 0;
  let firstError: unknown = null;
  for (const entry of entries) {
    if (entry.kind !== "file" || !entry.path.endsWith(".json")) continue;
    const raw = await fs.readText(entry.path).catch(() => null);
    const draft = raw === null ? null : parseFolderDraft(raw);
    if (!draft || (draft.projectId && projectId && draft.projectId !== projectId)) continue;
    try {
      await fs.remove(entry.path);
    } catch {
      continue;
    }
    try {
      await queue(draft);
      imported += 1;
    } catch (err) {
      firstError ??= err;
      await fs.writeFile(entry.path, raw!).catch(() => undefined);
    }
  }
  if (firstError !== null) throw firstError;
  return imported;
}

type ImportArgs = Parameters<typeof importFolderDrafts>;

let running: Promise<number> | null = null;
let again = false;
let latest: ImportArgs | null = null;

/**
 * One import at a time; a call during a run schedules one more pass after it,
 * and that pass uses the latest call's folder, queue and project.
 */
export function importFolderDraftsOnce(
  fs: IWorkspaceFs,
  queue: (draft: FolderDraft) => Promise<unknown>,
  projectId?: string,
): Promise<number> {
  latest = [fs, queue, projectId];
  if (running) {
    again = true;
    return running;
  }
  running = (async () => {
    let total = 0;
    do {
      again = false;
      total += await importFolderDrafts(...latest!);
    } while (again);
    return total;
  })().finally(() => {
    running = null;
  });
  return running;
}
