/**
 * Git remote credentials (Rust `sync::git_auth`), re-exported from feature-wrappers.ts.
 * Keeps spawning git and merging `process.env` in apps/shell/sidecar/src/vault-git.ts.
 */
import { gitBasicAuth as rawGitBasicAuth, gitRemoteAuth as rawGitRemoteAuth } from "../pkg/wf_wasm.js";

export interface GitRemoteAuthInput {
  /** The remote URL as stored. */
  url: string;
  /** The access token. Empty or absent sends no credentials. */
  token?: string;
  /** The user name paired with the token. Absent uses `x-access-token`. */
  username?: string;
}

export interface GitRemoteAuthPlan {
  /** Arguments to put before the git subcommand. */
  flags: string[];
  /** Environment keys to set on top of `process.env`. */
  env: Record<string, string>;
}

/** Base64 of `username:token` for HTTP basic auth. */
export function gitBasicAuth(token: string, username?: string): string {
  return rawGitBasicAuth(token, username);
}

/** The git flags and environment overrides for one remote command. */
export function gitRemoteAuth(input: GitRemoteAuthInput): GitRemoteAuthPlan {
  return rawGitRemoteAuth(input) as GitRemoteAuthPlan;
}
