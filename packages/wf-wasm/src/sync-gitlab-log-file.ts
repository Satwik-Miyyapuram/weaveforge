/**
 * GitLab log-file plan (Rust `sync::gitlab_log_file`): the file URL, branch, path,
 * content and commit messages for one log entry. The requests stay in
 * `features/sync/infrastructure/gitlab-log-exporter.ts`.
 */
import { gitlabLogFilePlan as rawGitlabLogFilePlan } from "../pkg/wf_wasm.js";
import type { GitlabLogFileInput, GitlabLogFilePlan } from "./bindings.js";

export type { GitlabLogFileInput, GitlabLogFilePlan } from "./bindings.js";

/** The GitLab file writes for one log entry. */
export function gitlabLogFilePlan(input: GitlabLogFileInput): GitlabLogFilePlan {
  return rawGitlabLogFilePlan(input);
}
