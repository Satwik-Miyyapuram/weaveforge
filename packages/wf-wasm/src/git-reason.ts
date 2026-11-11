/**
 * Git error-line pick (Rust `sync::git_reason`), re-exported from index.ts.
 * Keeps `gitReason` in apps/shell/sidecar/src/vault-git.ts; reading the text off the error stays in TS.
 */
export {
  gitReason,
} from "../pkg/wf_wasm.js";
