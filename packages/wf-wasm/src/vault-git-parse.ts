/**
 * Git text output parsers (Rust `sync::vault_git_parse`), re-exported from feature-wrappers.ts.
 * Keeps running git and reading its stdout in apps/shell/sidecar/src/vault-git.ts.
 */
import {
  gitNulList as rawGitNulList,
  gitOverwrittenFiles as rawGitOverwrittenFiles,
  gitParseLog as rawGitParseLog,
  gitParseStatus as rawGitParseStatus,
  gitPathChunks as rawGitPathChunks,
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

/** Porcelain v1 `git status -z` output, reduced to three states. */
export function gitParseStatus(stdout: string): ParsedGitFileStatus[] {
  return rawGitParseStatus(stdout) as ParsedGitFileStatus[];
}

/** `git log` lines written with the unit-separator field format. */
export function gitParseLog(stdout: string): ParsedGitLogCommit[] {
  return rawGitParseLog(stdout) as ParsedGitLogCommit[];
}

/** Paths listed under a "would be overwritten" git message. */
export function gitOverwrittenFiles(output: string): string[] {
  return rawGitOverwrittenFiles(output) as string[];
}

/** The non-empty entries of a NUL-separated git listing. */
export function gitNulList(stdout: string): string[] {
  return rawGitNulList(stdout) as string[];
}

/** Batches of paths, each within `maxUnits` UTF-16 units (default 8000) for one command line. */
export function gitPathChunks(paths: readonly string[], maxUnits?: number): string[][] {
  return rawGitPathChunks([...paths], maxUnits) as string[][];
}
