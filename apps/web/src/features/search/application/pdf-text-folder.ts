import type { PdfIndexSource } from "@weaveforge/core";
import { activeWorkspaceFs } from "@/features/workspace/application/workspace-folder";
import { FOLDER_CACHE_DIR } from "../infrastructure/vector-store";
import { loadPdfTexts, removePdfTexts, savePdfText } from "../infrastructure/pdf-text-store";

/**
 * A copy of the extracted PDF text in the connected workspace folder.
 *
 * IndexedDB is cleared on sign-out and lost with the app's storage; the folder
 * is the reader's own and outlives both. Without this copy the vectors in the
 * folder survived a sign-out but the next sync dropped every PDF passage,
 * because the text they were checked against was gone.
 *
 * IndexedDB stays the working copy, because the index worker reads it directly
 * and has no folder to read. This module keeps the two in step from the main
 * thread: every save and delete goes to both, and each index build first
 * restores into IndexedDB whatever only the folder still holds. One JSON file
 * per paper, written whole by the shell's atomic write.
 */

const folderDir = (projectId: string | null) => `${FOLDER_CACHE_DIR}/pdf-text/${projectId ?? "-"}`;
const folderFile = (projectId: string | null, paperId: string) =>
  `${folderDir(projectId)}/${encodeURIComponent(paperId)}.json`;

async function writeToFolder(projectId: string | null, source: PdfIndexSource): Promise<void> {
  const fs = activeWorkspaceFs();
  if (!fs) return;
  try {
    await fs.mkdirp(folderDir(projectId));
    await fs.writeFile(folderFile(projectId, source.paperId), JSON.stringify(source));
  } catch {
    /* best-effort: IndexedDB still has it */
  }
}

async function readFolder(projectId: string | null): Promise<PdfIndexSource[]> {
  const fs = activeWorkspaceFs();
  if (!fs) return [];
  let entries;
  try {
    entries = await fs.list(folderDir(projectId));
  } catch {
    return [];
  }
  const out: PdfIndexSource[] = [];
  for (const entry of entries) {
    if (entry.kind !== "file" || !entry.path.endsWith(".json")) continue;
    try {
      const parsed = JSON.parse(await fs.readText(entry.path)) as PdfIndexSource;
      if (parsed?.paperId && Array.isArray(parsed.pages)) out.push(parsed);
    } catch {
      /* one unreadable file costs one paper, not the rest */
    }
  }
  return out;
}

/** Save to IndexedDB and the folder. */
export async function savePdfTextDurably(projectId: string | null, source: PdfIndexSource): Promise<void> {
  if (source.pages.length === 0) return;
  await Promise.all([savePdfText(projectId, source), writeToFolder(projectId, source)]);
}

/** Delete from IndexedDB and the folder. */
export async function removePdfTextsDurably(projectId: string | null, paperIds: readonly string[]): Promise<void> {
  await removePdfTexts(projectId, paperIds);
  const fs = activeWorkspaceFs();
  if (!fs) return;
  for (const paperId of paperIds) {
    try {
      if (await fs.stat(folderFile(projectId, paperId))) await fs.remove(folderFile(projectId, paperId));
    } catch {
      /* already gone */
    }
  }
}

/**
 * Bring the two copies level before a build: text only the folder has goes
 * back into IndexedDB (after a sign-out or a fresh install), text only
 * IndexedDB has goes into the folder (papers read before this copy existed).
 */
export async function reconcilePdfTextFolder(projectId: string | null): Promise<void> {
  if (!activeWorkspaceFs()) return;
  const [own, folder] = await Promise.all([loadPdfTexts(projectId), readFolder(projectId)]);
  const ownIds = new Set(own.map((source) => source.paperId));
  const folderIds = new Set(folder.map((source) => source.paperId));
  for (const source of folder) if (!ownIds.has(source.paperId)) await savePdfText(projectId, source);
  for (const source of own) if (!folderIds.has(source.paperId)) await writeToFolder(projectId, source);
}
