/**
 * Git read rules (Rust `sync::git_api`): the request URL and not-connected check, the
 * failed-read message and the commit normalising. The fetch and the auth headers stay in
 * `features/sync/infrastructure/git-client.ts`.
 */
import type {
  GhCommit,
  GitCommit,
  GitReadInput,
  GitReadPlan,
  GlCommit,
} from "./bindings.js";

export {
  gitReadFailureMessage,
  gitReadPlan,
  githubCommits,
  gitlabCommits,
} from "../pkg/wf_wasm.js";

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

