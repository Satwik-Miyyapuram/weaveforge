/**
 * Git error-line pick (Rust `sync::git_reason`), re-exported from index.ts.
 * Keeps `gitReason` in apps/shell/sidecar/src/vault-git.ts; reading the text off the error stays in TS.
 */
import { gitReason as rawGitReason } from "../pkg/wf_wasm.js";

/** Git's `fatal:`/`error:` lines from a failed command's text, else its first line, else "Could not commit.". */
export function gitReason(text: string): string {
  return rawGitReason(text);
}
