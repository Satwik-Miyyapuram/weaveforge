/** Types for git-remote. Its logic is in Rust (crates/wf-core, exposed by wf-wasm). */
import type { GitAuthor } from "./git-port.js";

export interface GitRemoteConfig {
  /** An `https://` URL with no credentials in it. */
  url: string;
  /** Personal access token, sent as HTTP basic auth. Never logged or stored in the repo. */
  token?: string;
  /** The basic-auth user name sent with the token. Hosts that ignore it get `x-access-token`; Overleaf wants `git`. */
  username?: string;
}

export interface GitRemoteStatus {
  /** The URL of the sync remote, or null when no remote is connected. */
  url: string | null;
  branch: string;
  /** Local commits the remote does not have yet. */
  ahead: number;
  /** Remote commits not merged here yet (as of the last fetch). */
  behind: number;
}

export type GitPullResult =
  | { kind: "up-to-date" }
  | { kind: "fast-forward"; oid: string }
  | { kind: "merged"; oid: string }
  /** Nothing was changed locally; these files need resolving by hand. */
  | { kind: "conflict"; files: readonly string[] };

export type GitPushResult =
  | { kind: "pushed" }
  | { kind: "up-to-date" }
  /** The remote has commits this folder does not; pull first. */
  | { kind: "rejected"; reason: string };

export interface IWorkspaceGitRemote {
  /** Point the sync remote (`weaveforge`, never the user's own `origin`) at the URL (creating the repo when there is none) and fetch once to prove access. */
  connect(remote: GitRemoteConfig): Promise<GitRemoteStatus>;
  /** Fetches, then counts commits on each side. */
  remoteStatus(remote: GitRemoteConfig): Promise<GitRemoteStatus>;
  /** Commits local changes, fetches, then fast-forwards or merges. */
  pull(remote: GitRemoteConfig, author: GitAuthor): Promise<GitPullResult>;
  /** Commits local changes, then pushes the branch. Never forces. */
  push(remote: GitRemoteConfig, author: GitAuthor): Promise<GitPushResult>;
}

/**
 * The remote branch every sync uses. The folder's checked-out branch is what is
 * pulled into and pushed from, whatever its local name (`master` on an older git).
 */
export const DEFAULT_SYNC_BRANCH = "main";

/** Who the commits made before a pull or push are by, when the user is not named. */
export const SYNC_AUTHOR: GitAuthor = { name: "WeaveForge", email: "sync@weaveforge.local" };

export type GitRemoteUrlCheck = { ok: true; url: string } | { ok: false; reason: string };

/** Signatures of the functions that moved to the Rust core (wf-wasm). */
export interface GitRemoteFns {
  /**
 * Accepts only `https://host/...` with no user or password in it. A token in
 * the URL would be written to `.git/config` in plain text and echoed by git in
 * error messages, so it is refused here and passed separately instead.
 */
  checkGitRemoteUrl(raw: unknown): GitRemoteUrlCheck;
  /** One line for the Settings panel. */
  describePull(result: GitPullResult): string;
  describePush(result: GitPushResult): string;
}
