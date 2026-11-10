/**
 * Git read rules (Rust `sync::git_api`): the request URL and not-connected check, the
 * failed-read message and the commit normalising. The fetch and the auth headers stay in
 * `features/sync/infrastructure/git-client.ts`.
 */
import {
  gitReadPlan as rawGitReadPlan,
  githubCommits as rawGithubCommits,
  gitlabCommits as rawGitlabCommits,
  gitReadFailureMessage as rawGitReadFailureMessage,
} from "../pkg/wf_wasm.js";
import type {
  GhCommit,
  GitCommit,
  GitReadInput,
  GitReadPlan,
  GlCommit,
} from "./bindings.js";

export type {
  GhAuthor,
  GhCommit,
  GhCommitBody,
  GitCommit,
  GitHost,
  GitReadInput,
  GitReadKind,
  GitReadPlan,
  GlCommit,
} from "./bindings.js";

/** The request URL for a git read, or why the integration is not connected. */
export function gitReadPlan(input: GitReadInput): GitReadPlan {
  return rawGitReadPlan(input);
}

/** GitHub commits as the UI shows them. */
export function githubCommits(items: GhCommit[]): GitCommit[] {
  return rawGithubCommits(items);
}

/** GitLab commits as the UI shows them. */
export function gitlabCommits(items: GlCommit[]): GitCommit[] {
  return rawGitlabCommits(items);
}

/** The message for a failed git read. */
export function gitReadFailureMessage(status: number, body: string): string {
  return rawGitReadFailureMessage(status, body);
}
