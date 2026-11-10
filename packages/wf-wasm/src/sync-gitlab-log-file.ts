/**
 * GitLab log-file plan (Rust `sync::gitlab_log_file`): the file URL, branch, path,
 * content and commit messages for one log entry. The requests stay in
 * `features/sync/infrastructure/gitlab-log-exporter.ts`.
 */
import type {
  GitlabLogFileInput,
  GitlabLogFilePlan,
} from "./bindings.js";

export {
  gitlabLogFilePlan,
} from "../pkg/wf_wasm.js";

export type { GitlabLogFileInput, GitlabLogFilePlan } from "./bindings.js";

