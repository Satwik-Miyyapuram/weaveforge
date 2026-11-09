/**
 * Git repo web links (Rust `repo_web_url`), re-exported from index.ts.
 * Keeps the signatures of apps/web/src/features/sync/infrastructure/git-client.ts.
 */
import { repoWebUrl as rawRepoWebUrl, commitUrl as rawCommitUrl } from "../pkg/wf_wasm.js";

/** The trimmed repo URL when it is http(s), otherwise undefined. */
export function repoWebUrl(repoUrl?: string): string | undefined {
  return rawRepoWebUrl(repoUrl) ?? undefined;
}

/** A commit's web URL from a repo URL and sha, or undefined. */
export function commitUrl(repoUrl?: string, sha?: string): string | undefined {
  return rawCommitUrl(repoUrl, sha) ?? undefined;
}
