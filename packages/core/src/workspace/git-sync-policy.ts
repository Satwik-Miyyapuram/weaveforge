/**
 * What may enter the git history of the workspace folder.
 *
 * The workspace is the user's notes, LaTeX and papers. Git history grows with
 * every byte it ever sees, so a folder synced as-is can turn into gigabytes of
 * build output, dependency trees and render caches. These rules gate what the
 * browser-side (isomorphic-git) commit path stages, and the desktop's native
 * commit path (`apps/desktop/src/vault-git.ts`) applies the same rules before
 * anything is committed or pushed to a remote.
 *
 * Kept separate from `IMPORT_LIMITS`: that cap is about what the app will read
 * in from a file; this one is about what git will store, and they can differ.
 */

import { WORKSPACE_META_DIR } from "./folder-layout.js";

export const GIT_SYNC_LIMITS = {
  /** A single file above this is skipped and reported, rather than committed. */
  maxFileBytes: 25 * 1024 * 1024,
} as const;

/**
 * Folder names that are never synced, wherever they appear below the root.
 * Matched case-insensitively. Generic names such as `build` or `out` are not
 * here: a user's own folder of that name must keep syncing.
 */
export const GIT_SYNC_IGNORED_DIRS: readonly string[] = [
  ".git",
  "node_modules",
  "dist",
  ".next",
  ".cache",
  "pdf-cache",
  "__pycache__",
  ".venv",
  "coverage",
];

/** File names that are never synced, wherever they appear. Case-insensitive. */
export const GIT_SYNC_IGNORED_FILES: readonly string[] = ["desktop.ini"];

/** LaTeX build byproducts: regenerated on every compile, so never worth history. */
export const GIT_SYNC_IGNORED_EXTENSIONS: readonly string[] = [".aux", ".fdb_latexmk", ".fls", ".synctex.gz"];

export type GitSyncSkipReason =
  | "ignored-directory"
  | "ignored-file"
  | "too-large"
  | "unreadable"
  | "invalid-path";

export type GitSyncDecision = { include: true } | { include: false; reason: GitSyncSkipReason };

const IGNORED_DIR_SET = new Set(GIT_SYNC_IGNORED_DIRS);
const IGNORED_FILE_SET = new Set(GIT_SYNC_IGNORED_FILES);

/** Lowercased segments of a workspace path; both slash styles, no empty or `.` parts. */
function segmentsOf(relPath: string): string[] {
  return relPath
    .replace(/\\/g, "/")
    .split("/")
    .map((segment) => segment.toLowerCase())
    .filter((segment) => segment !== "" && segment !== ".");
}

/**
 * True when a path sits inside an ignored folder. The last segment is never a
 * folder here, so a file or folder named `dist` at any level is not matched by
 * itself, only what is below it. This is what the status walk filters on, so
 * ignored trees are not hashed on every mirror pass.
 */
export function isUnderIgnoredFolder(relPath: string): boolean {
  const segments = segmentsOf(relPath);
  // The root `.weaveforge` folder is this machine's database; `notes/.weaveforge` is not.
  if (segments[0] === WORKSPACE_META_DIR) return true;
  return segments.slice(0, -1).some((segment) => IGNORED_DIR_SET.has(segment));
}

/**
 * Decide whether one workspace-relative path goes into git.
 *
 * Only directory segments count as "folders": the last segment is a file name,
 * so `notes/dist` (a file called dist) is synced and `notes/dist/x.md` is not.
 * The exception is `.git`, which is a folder or a pointer file either way.
 *
 * Backslashes are accepted so a path from a Windows API matches the same rules.
 */
export function decideGitSyncPath(
  relPath: string,
  sizeBytes: number,
  maxFileBytes: number = GIT_SYNC_LIMITS.maxFileBytes,
): GitSyncDecision {
  const segments = segmentsOf(relPath);
  if (segments.length === 0) return { include: false, reason: "invalid-path" };

  const fileName = segments[segments.length - 1]!;
  if (isUnderIgnoredFolder(relPath) || fileName === ".git") {
    return { include: false, reason: "ignored-directory" };
  }
  if (IGNORED_FILE_SET.has(fileName) || GIT_SYNC_IGNORED_EXTENSIONS.some((ext) => fileName.endsWith(ext))) {
    return { include: false, reason: "ignored-file" };
  }

  // A size that is not a finite non-negative number cannot be checked against the cap, so it is skipped.
  if (!Number.isFinite(sizeBytes) || sizeBytes < 0 || sizeBytes > maxFileBytes) {
    return { include: false, reason: "too-large" };
  }
  return { include: true };
}
