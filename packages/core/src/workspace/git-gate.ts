/**
 * Whether the workspace folder may be committed to.
 *
 * The decision is here, away from any process that can run `git`, because it
 * is the part that has to be right. Committing is the one thing the mirror
 * does that changes state the user did not ask us to keep, and the case that
 * matters is a mirror folder placed inside a repository that belongs to
 * somebody else: their history is not ours to write into, and a stray commit
 * in it is noticed long after it is easy to explain.
 *
 * So the gate refuses twice over — off unless switched on, and refused anyway
 * when the folder sits under a repository whose root is somewhere else.
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

export const GIT_OFF = "Folder history is switched off.";

export function decideVaultCommit(enabled: boolean, state: VaultRepoState): GitVerdict {
  if (!enabled) return { ok: false, reason: GIT_OFF };
  switch (state.kind) {
    case "own":
      return { ok: true, action: "commit" };
    case "none":
      return { ok: true, action: "init" };
    case "enclosing":
      // Deliberately not offered as something to override. Turning the setting
      // on says "keep a history of my folder", not "commit into whatever
      // repository happens to contain it".
      return {
        ok: false,
        reason: `This folder is inside the repository at ${state.root}, so WeaveForge will not commit here.`,
      };
  }
}
