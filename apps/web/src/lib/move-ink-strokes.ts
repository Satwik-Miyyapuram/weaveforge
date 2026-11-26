/**
 * A note's strokes folder (`x/foo.note.ink/`) follows the note when its file is renamed.
 * Shared by the folder import and the notes repository, so both move strokes the same way.
 */
import type { IWorkspaceFs } from "@weaveforge/core";
import { readyCore } from "@/lib/rust-core";

/**
 * Whether another note that still exists keeps its strokes in `notePath`'s
 * strokes folder (`x/foo.md` and a legacy `x/foo.ink.md` share `x/foo.ink`).
 */
export async function inkFolderShared(fs: IWorkspaceFs, notePath: string): Promise<boolean> {
  const sharer = readyCore().inkStrokesDirSharer(notePath);
  return sharer !== undefined && (await fs.stat(sharer)) !== null;
}

/**
 * A renamed note takes its strokes with it (every note can hold ink): the pages in its
 * strokes folder (`notes/<old>.note.ink/`, or a legacy `notes/<old>.ink/`) are copied to the
 * new note's folder, then the old page is removed once its copy reads back the same bytes. A
 * page already at the new place is kept as it is (a different one keeps the old page too).
 * Two names that share one folder move nothing, and neither does a folder another
 * existing note still shares (`foo.md` beside a legacy `foo.ink.md`).
 */
export async function moveInkStrokes(fs: IWorkspaceFs, fromNote: string, toNote: string): Promise<void> {
  if (!fromNote.endsWith(".md") || !toNote.endsWith(".md")) return;
  let from: string;
  let to: string;
  try {
    from = readyCore().inkStrokesDir(fromNote);
    to = readyCore().inkStrokesDir(toNote);
  } catch {
    // Not a note path the strokes rule accepts: there is no strokes folder to move.
    return;
  }
  if (from === to || !(await fs.stat(from)) || (await inkFolderShared(fs, fromNote))) return;
  // A case-only rename may name the same folder (Windows, macOS): the page found at
  // the new place can be the page itself, so nothing is removed.
  const sameFolderMaybe = from.toLowerCase() === to.toLowerCase();
  await fs.mkdirp(to);
  for (const entry of await fs.list(from)) {
    if (entry.kind !== "file") continue;
    const dest = `${to}/${entry.path.split("/").pop() ?? ""}`;
    const page = await fs.readFile(entry.path);
    if (!(await fs.stat(dest))) await fs.writeFile(dest, page);
    if (sameFolderMaybe) continue;
    // The source goes only once the copy reads back byte for byte: a short write, or a
    // different page already at the new place, keeps it.
    if (sameBytes(await fs.readFile(dest), page)) await fs.remove(entry.path);
  }
  // Every page moved: the old folder is empty and goes too. Anything left in it keeps it.
  if (!sameFolderMaybe && (await fs.list(from)).length === 0) await fs.remove(from);
}

function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
  return a.length === b.length && a.every((byte, i) => byte === b[i]);
}
