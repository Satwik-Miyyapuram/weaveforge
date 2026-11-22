/** A conflict copy's name: " (conflict)" or " (conflict N)" before the extension. */
const COPY_SUFFIX = / \(conflict( \d+)?\)(\.[^./]*)?$/;

/**
 * The name the DB version gets when the file at `path` differs from it. Candidate 1 is "(conflict)",
 * candidate 2 "(conflict 2)", and so on. The extension stays last, so the copy keeps its type.
 */
export function conflictCopyPath(path: string, n: number): string {
  const slash = path.lastIndexOf("/");
  const dot = path.lastIndexOf(".");
  const hasExt = dot > slash + 1;
  const stem = hasExt ? path.slice(0, dot) : path;
  const ext = hasExt ? path.slice(dot) : "";
  return `${stem} (conflict${n > 1 ? ` ${n}` : ""})${ext}`;
}

/** The original path a conflict copy belongs to, or null when the path is not a conflict copy. */
export function conflictBasePath(path: string): string | null {
  const m = COPY_SUFFIX.exec(path);
  if (!m) return null;
  return path.slice(0, m.index) + (m[2] ?? "");
}
