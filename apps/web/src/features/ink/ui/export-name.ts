/** Longest base name an export gets, so `-page-N.png` still fits any file system. */
const MAX_LENGTH = 120;

/**
 * The base name of a printed or exported page: the note's title, made safe as
 * a file name on every desktop (no `<>:"/\|?*` or control characters, no
 * trailing dot or space), or the note's id when the title leaves nothing.
 */
export function exportBaseName(title: string | undefined, noteId: string): string {
  const name = (title ?? "")
    .replace(/[<>:"/\\|?*\u0000-\u001f\u007f]+/g, "-")
    .slice(0, MAX_LENGTH)
    .replace(/^[\s.]+|[\s.]+$/g, "");
  return /[\p{L}\p{N}]/u.test(name) ? name : noteId;
}
