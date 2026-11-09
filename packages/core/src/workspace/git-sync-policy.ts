/**
 * What may enter the git history of the workspace folder.
 *
 * The workspace is the user's notes, LaTeX and papers. Git history grows with
 * every byte it ever sees, so a folder synced as-is can turn into gigabytes of
 * build output, dependency trees and render caches. These rules gate what the
 * browser-side (isomorphic-git) commit path stages, and the desktop's native
 * commit path (`apps/shell/sidecar/src/vault-git.ts`) applies the same rules before
 * anything is committed or pushed to a remote.
 *
 * The decision (`decideGitSyncPath`, `isUnderIgnoredFolder`) lives in Rust and is
 * called through `rust()`. This file keeps the rule data and the result types.
 *
 * Kept separate from `IMPORT_LIMITS`: that cap is about what the app will read
 * in from a file; this one is about what git will store, and they can differ.
 */

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
  | "invalid-path";

export type GitSyncDecision = { include: true } | { include: false; reason: GitSyncSkipReason };
