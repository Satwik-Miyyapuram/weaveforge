/**
 * Whether the workspace folder may be committed to.
 *
 * The decision (`decideVaultCommit`) lives in Rust, away from any process that
 * can run `git`, and is called through `rust()`. The refusal rules are there:
 * off unless switched on, and refused anyway when the folder sits under a
 * repository whose root is somewhere else. This file keeps the shapes.
 */

export type VaultRepoState =
  /** No repository at or above the folder. */
  | { kind: "none" }
  /** The folder is itself the repository root. */
  | { kind: "own" }
  /** The folder sits inside a repository rooted elsewhere. */
  | { kind: "enclosing"; root: string };

export type GitVerdict =
  | { ok: true; action: "init" | "commit" }
  | { ok: false; reason: string };
