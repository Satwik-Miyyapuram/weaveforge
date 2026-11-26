/** Where a note lives in the open workspace folder, and how it leaves it. */
export interface NoteFiles {
  /** The note's `.md` path in the open folder; null when no folder is open or the note has no file. */
  pathOf(noteId: string): Promise<string | null>;
  /** Moves the note's file and its ink pages to `.weaveforge/trash` and forgets its mirror base. */
  trash(notePath: string): Promise<void>;
}

/**
 * The vault page writes, where deleting a note also moves its file in the open
 * workspace folder to `.weaveforge/trash`.
 *
 * Files are the source of truth (0.9.5): a delete that removed only the row
 * left the `.md` behind, and the next "Check for changes" offered it as a new
 * note. The path is found first, since a file repository's delete moves the
 * `.md` itself and the strokes folder would then be left behind. A file that
 * cannot be found or moved is reported through `warn` and the delete still
 * stands, since the import then reads the file's unchanged manifest base as
 * "deleted in the app".
 */
export function withDeleteTrashesFile<T extends { remove(id: string): Promise<void> }>(
  pages: T,
  files: NoteFiles,
  warn: (message: string) => void,
): T {
  const remove = async (id: string): Promise<void> => {
    let path: string | null = null;
    let lookupError: unknown = null;
    try {
      path = await files.pathOf(id);
    } catch (error) {
      lookupError = error;
    }
    await pages.remove(id);
    try {
      if (lookupError) throw lookupError;
      if (path) await files.trash(path);
    } catch (error) {
      warn(`Note deleted, but its file stays in the workspace folder: ${error instanceof Error ? error.message : String(error)}`);
    }
  };
  return Object.assign(Object.create(pages) as T, { remove });
}
