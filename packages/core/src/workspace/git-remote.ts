/**
 * Syncing the workspace folder's files with a git remote.
 *
 * Separate from `IWorkspaceGit` (local history) so a backend that only keeps
 * history does not have to pretend to talk to servers. Database rows are not
 * part of this: they keep their own sync engine. This moves the folder's files.
 *
 * The rule every implementation keeps: a pull never overwrites a local edit.
 * Local changes are committed first, so they are in history whatever happens,
 * and a merge that conflicts is abandoned and reported, leaving the folder as
 * it was.
 */

import type { GitAuthor } from "./git-port.js";

export interface GitRemoteConfig {
  /** An `https://` URL with no credentials in it. */
  url: string;
  /** Personal access token, sent as HTTP basic auth. Never logged or stored in the repo. */
  token?: string;
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

/**
 * Accepts only `https://host/...` with no user or password in it. A token in
 * the URL would be written to `.git/config` in plain text and echoed by git in
 * error messages, so it is refused here and passed separately instead.
 */
export function checkGitRemoteUrl(raw: unknown): GitRemoteUrlCheck {
  if (typeof raw !== "string" || raw.trim() === "") return { ok: false, reason: "Enter the remote's https URL." };
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return { ok: false, reason: "That is not a URL." };
  }
  if (url.protocol !== "https:") return { ok: false, reason: "Only https:// remotes are supported." };
  if (url.username || url.password) {
    return { ok: false, reason: "Leave the token out of the URL; put it in the token field." };
  }
  if (!url.hostname || url.pathname === "/" || url.pathname === "") {
    return { ok: false, reason: "The URL needs the repository path, e.g. https://github.com/you/notes.git." };
  }
  return { ok: true, url: url.toString() };
}

/** Removes a token from text before it is shown or logged (git echoes URLs and headers in errors). */
export function redactSecret(text: string, secret: string | undefined): string {
  if (!secret) return text;
  return text.split(secret).join("***");
}

/** One line for the Settings panel. */
export function describePull(result: GitPullResult): string {
  switch (result.kind) {
    case "up-to-date":
      return "Already up to date.";
    case "fast-forward":
      return "Pulled the remote's changes.";
    case "merged":
      return "Merged the remote's changes with yours.";
    case "conflict":
      return `Not pulled: ${result.files.length} file${result.files.length === 1 ? "" : "s"} changed on both sides (${result.files.slice(0, 5).join(", ")}${result.files.length > 5 ? ", …" : ""}). Your files were left as they were.`;
  }
}

export function describePush(result: GitPushResult): string {
  switch (result.kind) {
    case "pushed":
      return "Pushed.";
    case "up-to-date":
      return "Nothing to push.";
    case "rejected":
      return `Not pushed: ${result.reason}`;
  }
}
