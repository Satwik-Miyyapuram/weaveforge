/**
 * Git text output parsers (Rust `sync::vault_git_parse`), re-exported from feature-wrappers.ts.
 * Keeps running git and reading its stdout in apps/shell/sidecar/src/vault-git.ts.
 */
export {
  gitNulList,
  gitOverwrittenFiles,
  gitParseLog,
  gitParseStatus,
  gitPathChunks,
} from "../pkg/wf_wasm.js";

export interface ParsedGitFileStatus {
  /** Path relative to the repository root. */
  path: string;
  state: "deleted" | "added" | "modified";
}

export interface ParsedGitLogCommit {
  /** Full commit id. */
  oid: string;
  /** Author date as git prints it. */
  authoredAt: string;
  /** Author name. */
  author: string;
  /** Subject and body, rejoined with the field separator. */
  message: string;
}
