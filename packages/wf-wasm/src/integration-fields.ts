/**
 * Sync integration field accessors (Rust `sync::integration_fields`),
 * re-exported from index.ts.
 *
 * Storage keeps one shape (`token`, `repo`, `branch`) for every provider; each
 * provider reads those keys with its own meaning.
 */
import {
  gitConnection as rawGitConnection,
  gitConnectionReady as rawGitConnectionReady,
  emptyIntegration as rawEmptyIntegration,
  mattermostConnection as rawMattermostConnection,
  mattermostConnectionReady as rawMattermostConnectionReady,
} from "../pkg/wf_wasm.js";
import type {
  EmptyIntegration,
  GitConnection,
  Integration,
  MattermostConnection,
  SyncProvider,
} from "./bindings.js";

export type { Integration as IntegrationInput } from "./bindings.js";

/** GitHub / GitLab: token + repo path + branch. */
export function gitConnection(i: Integration): GitConnection {
  return rawGitConnection(i) as GitConnection;
}

/** Mattermost: bot token + server URL (repo) + channel id (branch). */
export function mattermostConnection(i: Integration): MattermostConnection {
  return rawMattermostConnection(i) as MattermostConnection;
}

/** Switched on, with a non-blank token and repo. */
export function gitConnectionReady(i: Integration): boolean {
  return rawGitConnectionReady(i);
}

/** Switched on, with a non-blank bot token, server URL and channel id. */
export function mattermostConnectionReady(i: Integration): boolean {
  return rawMattermostConnectionReady(i);
}

/** The integration a provider starts from: switched off, on the default branch (Mattermost: no channel). */
export function emptyIntegration(provider: SyncProvider): EmptyIntegration {
  return rawEmptyIntegration(provider) as EmptyIntegration;
}
